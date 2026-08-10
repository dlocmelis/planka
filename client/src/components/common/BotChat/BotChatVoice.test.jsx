/**
 * @jest-environment jsdom
 */

/* eslint-disable max-classes-per-file, class-methods-use-this --
 * jsdom implements none of the four browser APIs this loop needs, so the file
 * stands all of them up: a MediaRecorder, an AudioContext and an audio element
 * are three fakes, and several of their methods are stubs that legitimately do
 * not touch `this`. Splitting them into files of their own would put the
 * harness further from the tests that read it.
 */

/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * Voice chat mode, driven through the real component.
 *
 * The point of these is the WIRING, which nothing else can check: that a level
 * arriving at the analyser really does reach the detector, that the detector's
 * "send it" really does reach the transcription endpoint, that the transcript
 * really is posted as a comment addressed to the bot, and that the bot's reply
 * really is handed to the speech endpoint and played. The arithmetic behind each
 * of those steps is pinned frame by frame in utils/voice-chat.test.js.
 *
 * jsdom has no getUserMedia, no MediaRecorder, no Web Audio and no playback, so
 * all four are stood up here — with a microphone whose level the test sets.
 */

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { createStore } from 'redux';

import EntryActionTypes from '../../../constants/EntryActionTypes';
import { BoardMembershipRoles, ListTypes } from '../../../constants/Enums';
import { MessageAuthors } from '../../../utils/bot-chat';
import { VOICE_CHAT_TUNING } from '../../../utils/voice-chat';
// The hook file directly, not the `hooks` barrel — that barrel reaches
// `api/socket.js`, which reads `import.meta.env` and cannot be loaded by jest.
import useVoiceChat from '../../../hooks/use-voice-chat';
import BotChat from './BotChat';

const BOT = { id: 'user-bot', username: 'planka_bot', name: 'Orchestrator Bot' };

let mockBot;
let mockPath;
let mockCards;
let mockLists;
let mockMembership;
let mockMemberships;
let mockMessagesByCardId;
let mockChatCards;
let mockVoiceCapability;
const mockNoMessages = [];

jest.mock('react-i18next', () => ({
  useTranslation: () => [(key) => key],
}));

jest.mock('../../../selectors', () => ({
  __esModule: true,
  default: {
    selectPath: () => mockPath,
    selectBotUserForCurrentBoard: () => mockBot,
    selectChatCardsForCurrentBoard: () => mockChatCards,
    selectMembershipsForCurrentBoard: () => mockMemberships,
    selectCurrentUserMembershipForCurrentBoard: () => mockMembership,
    selectVoiceChatCapability: () => mockVoiceCapability,
    selectAccessToken: () => 'access-token',
    makeSelectCardById: () => (_, id) => mockCards.find((card) => card.id === id) || null,
    makeSelectListById: () => (_, id) => mockLists.find((list) => list.id === id) || null,
    makeSelectChatMessagesForCard: () => (_, id) => mockMessagesByCardId[id] || mockNoMessages,
  },
}));

const mockTranscribe = jest.fn();
const mockSpeak = jest.fn();

jest.mock('../../../api/voice', () => ({
  __esModule: true,
  default: {
    transcribeVoiceRecording: (...args) => mockTranscribe(...args),
    speakMessage: (...args) => mockSpeak(...args),
  },
  bytesToBase64: () => 'AAAA',
  base64ToBlob: (data, mimeType) => ({ data, mimeType }),
}));

jest.mock(
  '../Markdown',
  () =>
    ({ children }) =>
      children,
);
jest.mock('../TimeAgo', () => () => null);
jest.mock('../../users/UserAvatar', () => () => null);

let container;
let root;
let store;
let dispatchedActions;
let microphone;
let recorders;
let players;

window.IS_REACT_ACT_ENVIRONMENT = true;

/** Amplitude for a level in dBFS, which is what the analyser hands back. */
const amplitudeFor = (db) => 10 ** (db / 20);

const VOICE_DB = -20;
const QUIET_DB = -70;

/**
 * Stand up the four browser APIs the loop needs, with a microphone whose level
 * the test sets and a recorder that produces one blob per utterance.
 */
const installVoiceEnvironment = () => {
  microphone = { level: amplitudeFor(QUIET_DB) };
  recorders = [];
  players = [];

  const track = { stop: jest.fn(), addEventListener: jest.fn() };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };

  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: jest.fn(() => Promise.resolve(stream)) },
  });

  class FakeMediaRecorder {
    constructor(_stream, options) {
      this.state = 'inactive';
      this.mimeType = (options && options.mimeType) || '';
      this.audioBitsPerSecond = options && options.audioBitsPerSecond;
      recorders.push(this);
    }

    start() {
      this.state = 'recording';
    }

    stop() {
      this.state = 'inactive';

      if (this.ondataavailable) {
        this.ondataavailable({ data: new Blob(['audio'], { type: this.mimeType }) });
      }

      if (this.onstop) {
        this.onstop();
      }
    }
  }

  FakeMediaRecorder.isTypeSupported = (type) => type === 'audio/webm;codecs=opus';
  window.MediaRecorder = FakeMediaRecorder;

  window.AudioContext = class FakeAudioContext {
    constructor() {
      this.state = 'running';
    }

    createMediaStreamSource() {
      return { connect: () => {} };
    }

    createAnalyser() {
      return {
        fftSize: 2048,
        getFloatTimeDomainData: (buffer) => buffer.fill(microphone.level),
      };
    }

    resume() {
      return Promise.resolve();
    }

    close() {
      this.state = 'closed';
      return Promise.resolve();
    }
  };

  window.Audio = class FakeAudio {
    constructor() {
      this.src = '';
      players.push(this);
    }

    play() {
      this.isPlaying = true;
      return Promise.resolve();
    }

    pause() {
      this.isPlaying = false;
    }

    removeAttribute() {
      this.src = '';
    }

    getAttribute() {
      return this.src;
    }

    load() {}

    finish() {
      this.isPlaying = false;

      if (this.onended) {
        this.onended();
      }
    }
  };

  window.URL.createObjectURL = jest.fn(() => 'blob:voice');
  window.URL.revokeObjectURL = jest.fn();

  // jsdom's Blob has no `arrayBuffer()` — the one standard method the upload
  // path actually needs. Every engine this ships to has had it since 2020
  // (Safari 14 last), so this is jsdom missing an API rather than the loop
  // depending on something exotic.
  if (typeof window.Blob.prototype.arrayBuffer !== 'function') {
    // eslint-disable-next-line func-names
    window.Blob.prototype.arrayBuffer = function () {
      return Promise.resolve(new ArrayBuffer(this.size));
    };
  }
};

const render = () => {
  act(() => {
    root.render(
      <Provider store={store}>
        <BotChat />
      </Provider>,
    );
  });
};

const click = (element) => {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

const findByLabel = (label) => container.querySelector(`[aria-label="${label}"]`);
// The label carries the unread count once there is one, so both spellings are
// the same button.
const launcher = () =>
  findByLabel('common.chatWithBot') || findByLabel('common.chatWithBotWithUnread');
const voiceToggle = () =>
  findByLabel('action.turnOnVoiceChat') || findByLabel('action.turnOffVoiceChat');
const status = () => container.querySelector('[role="status"]');
const stopButton = () =>
  [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'action.stopSpeaking',
  );

/** One bot reply, arriving after the mode came on — which is the only kind that
 * is ever read aloud. */
const BOT_REPLY = {
  id: 'comment-1',
  userId: BOT.id,
  author: MessageAuthors.BOT,
  text: 'It is waiting on review.',
  isPersisted: true,
};

const SPOKEN_ANSWER = {
  item: { data: 'QUJD', mimeType: 'audio/mpeg', voice: 'voice-en', language: 'en' },
};

/** Let every pending microtask settle — the microphone is opened in an async
 * chain of four awaits before the sampler even starts. */
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** Hold the microphone at a level for a stretch of time, one sampler tick at a
 * time. */
const hold = async (db, ms) => {
  microphone.level = amplitudeFor(db);

  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
};

/**
 * A whole turn: enough voice to open one, then enough silence to send it.
 *
 * The voice is held for two frames longer than `minSpeechMs` asks, because the
 * first tick after an answer has been read aloud goes on putting a fresh
 * recorder in (the old one was dropped so it would not hold the answer) and
 * credits no speech. A turn on the exact boundary would open on the first turn
 * of a conversation and not on the second.
 */
const saySomething = async () => {
  await hold(VOICE_DB, VOICE_CHAT_TUNING.minSpeechMs + 2 * VOICE_CHAT_TUNING.frameIntervalMs);
  await hold(QUIET_DB, VOICE_CHAT_TUNING.silenceHangoverMs + VOICE_CHAT_TUNING.frameIntervalMs);
  await settle();
};

/** The clip that is playing reaches its end. Until it does the loop stays
 * half-duplex — nothing the microphone hears can open a turn — so a test that
 * wants a SECOND turn has to let the first answer finish. */
const finishSpeaking = async () => {
  await act(async () => {
    players[players.length - 1].finish();
    await Promise.resolve();
  });

  await settle();
};

const actionsOfType = (type) => dispatchedActions.filter((action) => action.type === type);

const receiveMessage = (cardId, message) => {
  act(() => {
    mockMessagesByCardId[cardId] = [...(mockMessagesByCardId[cardId] || []), message];
    store.dispatch({ type: 'MESSAGE_ARRIVED' });
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  window.localStorage.clear();

  mockTranscribe.mockReset();
  mockSpeak.mockReset();
  mockTranscribe.mockResolvedValue({
    item: { text: 'what is blocking this', languages: ['en'], durationSec: 1.2, confidence: 0.9 },
  });
  mockSpeak.mockResolvedValue({
    item: { data: 'QUJD', mimeType: 'audio/mpeg', voice: 'voice-en', language: 'en' },
  });

  mockBot = BOT;
  mockPath = { boardId: 'board-1', cardId: 'card-1' };

  mockLists = [{ id: 'list-1', type: ListTypes.ACTIVE, name: 'In Development' }];

  mockCards = [
    {
      id: 'card-1',
      boardId: 'board-1',
      listId: 'list-1',
      name: 'Add voice chat mode',
      isCommentsFetching: false,
      isAllCommentsFetched: true,
    },
  ];

  mockMembership = { id: 'membership-1', role: BoardMembershipRoles.EDITOR };
  mockMemberships = [{ id: 'membership-1', user: { id: 'user-me', username: 'deniss' } }];

  mockMessagesByCardId = {};
  mockChatCards = [{ id: 'card-1', name: 'Add voice chat mode', hasBotComment: true }];

  mockVoiceCapability = {
    sttEnabled: true,
    ttsEnabled: true,
    sttMaxBytes: 700 * 1024,
    sttMaxDurationSec: 300,
    ttsMaxChars: 2000,
  };

  installVoiceEnvironment();

  dispatchedActions = [];
  store = createStore((state, action) => {
    dispatchedActions.push(action);
    return { revision: (state ? state.revision : 0) + 1 };
  });

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });

  container.remove();
  jest.useRealTimers();
});

test('the control beside Send is the voice chat toggle, and it starts off', () => {
  render();
  click(launcher());

  const toggle = voiceToggle();

  expect(toggle).not.toBeNull();
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  expect(toggle.disabled).toBe(false);
  // Off is silent: no status row and no microphone opened.
  expect(status()).toBeNull();
  expect(window.navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
});

test('the toggle is disabled and says why where the server has no speech', () => {
  mockVoiceCapability = { ...mockVoiceCapability, sttEnabled: false };

  render();
  click(launcher());

  const toggle = voiceToggle();

  expect(toggle.disabled).toBe(true);
  expect(toggle.getAttribute('title')).toBe('common.voiceChatNotAvailable');
});

test('the toggle is disabled where the server can hear but cannot answer', () => {
  // A mode that can hear and not speak is not a conversation, so it does not
  // half-run — it is refused with the same sentence.
  mockVoiceCapability = { ...mockVoiceCapability, ttsEnabled: false };

  render();
  click(launcher());

  expect(voiceToggle().disabled).toBe(true);
});

test('turning it on opens the microphone and says it is listening', async () => {
  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  expect(window.navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  expect(voiceToggle().getAttribute('aria-pressed')).toBe('true');
  expect(status().textContent).toContain('common.voiceChatListening');
});

test('the recorder is asked for a container the server accepts, at a bitrate that fits', async () => {
  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  expect(recorders).toHaveLength(1);
  expect(recorders[0].mimeType).toBe('audio/webm;codecs=opus');
  // Not a quality preference: an utterance travels base64 inside a 1 MB JSON
  // body, and Chrome's own default would put a long one over it.
  expect(recorders[0].audioBitsPerSecond).toBe(32000);
});

test('talking and then stopping sends the recording and posts what was heard', async () => {
  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  await saySomething();

  expect(mockTranscribe).toHaveBeenCalledTimes(1);

  const [cardId, body, headers] = mockTranscribe.mock.calls[0];
  expect(cardId).toBe('card-1');
  expect(body.mimeType).toBe('audio/webm;codecs=opus');
  expect(body.data).toBe('AAAA');
  // Nothing here goes through the saga layer, which is what normally attaches
  // the bearer token. Without it the API answers 401 to every utterance — it
  // reads the Authorization HEADER and never the access-token cookie.
  expect(headers).toEqual({ Authorization: 'Bearer access-token' });

  // ...and the transcript goes straight out as a comment addressed to the bot,
  // without passing through the composer. That is the whole difference between
  // voice chat and a dictation button.
  expect(actionsOfType(EntryActionTypes.COMMENT_FOR_CARD_CREATE)).toEqual([
    {
      type: EntryActionTypes.COMMENT_FOR_CARD_CREATE,
      payload: {
        cardId: 'card-1',
        data: { text: '@[planka_bot](user-bot) what is blocking this' },
      },
    },
  ]);
});

test('a burst of noise the provider heard nothing in is not posted', async () => {
  mockTranscribe.mockResolvedValue({ item: { text: '.', languages: [], durationSec: 0.4 } });

  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  await saySomething();

  expect(mockTranscribe).toHaveBeenCalledTimes(1);
  expect(actionsOfType(EntryActionTypes.COMMENT_FOR_CARD_CREATE)).toHaveLength(0);
});

test('a quiet room is never uploaded', async () => {
  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  // Well past the idle restart, which throws the silence away rather than
  // uploading it: this endpoint is billed by the audio minute.
  await hold(QUIET_DB, VOICE_CHAT_TUNING.idleRestartMs * 3);
  await settle();

  expect(mockTranscribe).not.toHaveBeenCalled();
  expect(recorders.length).toBeGreaterThan(1);
});

test("the bot's reply is read aloud, and the mode says so", async () => {
  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  receiveMessage('card-1', {
    id: 'comment-1',
    userId: BOT.id,
    author: MessageAuthors.BOT,
    text: 'It is waiting on review.',
    createdAt: new Date(Date.now() + 1000),
    isPersisted: true,
  });

  await settle();

  expect(mockSpeak).toHaveBeenCalledWith(
    'card-1',
    { text: 'It is waiting on review.' },
    {
      Authorization: 'Bearer access-token',
    },
    expect.any(AbortSignal),
  );
  // The turn is what carries that signal, so it is not aborted while the answer
  // is still wanted.
  expect(mockSpeak.mock.calls[0][3].aborted).toBe(false);
  expect(players).toHaveLength(1);
  expect(players[0].src).toBe('blob:voice');
  expect(status().textContent).toContain('common.voiceChatSpeaking');
});

test('a reply is not read aloud while the mode is off', async () => {
  // The rule the Setlfi assistant had to be repaired to keep — *"Do not enable
  // TTS without voice chat mode ON (currently when user types and assistant
  // replies automatically TTS is enabled)"*, 2026-08-09. There, a second
  // always-on read-aloud preference spoke replies with the mode switched off;
  // here there has never been one and this is what says so. The panel is OPEN
  // and the deployment has both halves of the voice configured, so the only
  // thing not true of this conversation is the mode itself.
  //
  // WHAT THIS DOES AND DOES NOT PIN. Two independent gates keep the rule —
  // `pendingSpeech` in BotChat.jsx returning null unless `isVoiceRunning`, and
  // `if (!isEnabled …) return` in hooks/use-voice-chat.js — and through the
  // panel they are indistinguishable: with either one present the other never
  // gets the chance to fail, so THIS case only goes red when both are removed.
  // The hook-level case below pins the second one on its own. The first is
  // covered in combination only; a panel test cannot reach past it, because
  // `pendingSpeech` is the panel's own memo and has no other observable.
  render();
  click(launcher());
  await settle();

  receiveMessage('card-1', {
    id: 'comment-1',
    userId: BOT.id,
    author: MessageAuthors.BOT,
    text: 'It is waiting on review.',
    createdAt: new Date(Date.now() + 1000),
    isPersisted: true,
  });

  await settle();

  expect(mockSpeak).not.toHaveBeenCalled();
  expect(players).toHaveLength(0);
});

/**
 * The speech half of `useVoiceChat`, with nothing else in the hook running.
 *
 * `canComment` is false on purpose: `isRunnable` needs it and the read-aloud
 * effect does not, so the microphone never opens and the only thing left to
 * decide anything is the gate under test. Everything else is a working
 * deployment — a card, a token, both halves of the voice configured — so a
 * refusal here can only have come from the mode being off.
 *
 * Props are spread rather than read one by one so this stays a probe and not a
 * component with an interface.
 */
function SpeechProbe(props) {
  useVoiceChat({
    cardId: 'card-1',
    capability: mockVoiceCapability,
    canComment: false,
    accessToken: 'access-token',
    onTranscript: () => {},
    onSpoken: () => {},
    onNotice: () => {},
    onStop: () => {},
    ...props,
  });

  return null;
}

const renderProbe = async (props) => {
  await act(async () => {
    // `createElement` rather than JSX: the props are a bag this helper passes
    // straight through, and spreading one in JSX is forbidden here.
    root.render(React.createElement(SpeechProbe, props));
  });

  await settle();
};

test('the hook will not synthesize a reply while the mode is off, and it is the mode that decides', async () => {
  // The second of the two gates, on its own. The panel case above cannot fail
  // for this one alone — BotChat hands the hook a null `pendingSpeech` long
  // before it gets here — so the hook is driven directly, with a reply already
  // in hand and every other condition satisfied.
  const reply = { id: 'comment-1', text: 'It is waiting on review.' };

  await renderProbe({ isEnabled: false, pendingSpeech: reply });

  expect(mockSpeak).not.toHaveBeenCalled();

  // …and the control that makes the line above mean something: the same hook,
  // the same reply, the same everything, with the mode ON. Without this the
  // assertion would pass just as well for a probe that was never wired up.
  await renderProbe({ isEnabled: true, pendingSpeech: reply });

  expect(mockSpeak).toHaveBeenCalledTimes(1);
  expect(mockSpeak.mock.calls[0][0]).toBe('card-1');
  expect(mockSpeak.mock.calls[0][1].text).toBe('It is waiting on review.');
});

test('a reply that was already on the card when the mode came on is not read out', async () => {
  // Otherwise turning voice chat on would read out whichever answer happened to
  // be at the bottom of a conversation from last week.
  mockMessagesByCardId['card-1'] = [
    {
      id: 'comment-old',
      userId: BOT.id,
      author: MessageAuthors.BOT,
      text: 'An answer from last week.',
      createdAt: new Date(Date.now() - 60000),
      isPersisted: true,
    },
  ];

  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  expect(mockSpeak).not.toHaveBeenCalled();
});

test('the same reply is not read out twice', async () => {
  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  receiveMessage('card-1', {
    id: 'comment-1',
    userId: BOT.id,
    author: MessageAuthors.BOT,
    text: 'It is waiting on review.',
    createdAt: new Date(Date.now() + 1000),
    isPersisted: true,
  });

  await settle();
  expect(mockSpeak).toHaveBeenCalledTimes(1);

  // Another render pass over the same thread.
  act(() => {
    store.dispatch({ type: 'SOMETHING_ELSE' });
  });
  await settle();

  expect(mockSpeak).toHaveBeenCalledTimes(1);
});

test('the microphone cannot open an utterance while the answer is being read', async () => {
  // This loop is half-duplex: the Stop button is how you interrupt it, not
  // talking over it. See the header of utils/voice-chat.js.
  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  let resolveSpeech;
  mockSpeak.mockReturnValue(
    new Promise((resolve) => {
      resolveSpeech = resolve;
    }),
  );

  receiveMessage('card-1', {
    id: 'comment-1',
    userId: BOT.id,
    author: MessageAuthors.BOT,
    text: 'It is waiting on review.',
    createdAt: new Date(Date.now() + 1000),
    isPersisted: true,
  });

  await settle();
  expect(status().textContent).toContain('common.voiceChatSpeaking');

  await saySomething();

  expect(mockTranscribe).not.toHaveBeenCalled();

  resolveSpeech({
    item: { data: 'QUJD', mimeType: 'audio/mpeg', voice: 'voice-en', language: 'en' },
  });
  await settle();
});

test('the answer can be stopped, and the loop goes back to listening', async () => {
  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  receiveMessage('card-1', {
    id: 'comment-1',
    userId: BOT.id,
    author: MessageAuthors.BOT,
    text: 'It is waiting on review.',
    createdAt: new Date(Date.now() + 1000),
    isPersisted: true,
  });

  await settle();

  const stop = stopButton();

  expect(stop).toBeDefined();

  click(stop);
  await settle();

  expect(status().textContent).toContain('common.voiceChatListening');
});

test('stopping a synthesis that is still in flight cancels it and plays nothing', async () => {
  // The Stop button is offered for the WHOLE request, not only for the clip, so
  // most presses of it land here. What must not happen is the answer arriving
  // afterwards and playing anyway: this loop is half-duplex, the microphone
  // re-arms the moment speaking ends, and an answer talking under an armed
  // microphone gets transcribed and posted to the card as if the user had said
  // it.
  let deliverAnswer;
  mockSpeak.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        deliverAnswer = resolve;
      }),
  );

  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  receiveMessage('card-1', { ...BOT_REPLY, createdAt: new Date(Date.now() + 1000) });
  await settle();

  expect(mockSpeak).toHaveBeenCalledTimes(1);
  expect(stopButton()).toBeDefined();

  const { signal } = { signal: mockSpeak.mock.calls[0][3] };

  click(stopButton());
  await settle();

  // The request itself is given up, not merely its result: synthesis is billed
  // per character.
  expect(signal.aborted).toBe(true);
  expect(status().textContent).toContain('common.voiceChatListening');

  await act(async () => {
    deliverAnswer(SPOKEN_ANSWER);
    await Promise.resolve();
  });

  await settle();

  expect(players).toHaveLength(0);
  expect(status().textContent).toContain('common.voiceChatListening');
  // And nothing offers the same answer again on the next render.
  expect(mockSpeak).toHaveBeenCalledTimes(1);
});

test('the microphone stays shut after a stop that beat the answer home', async () => {
  // The other half of the same bug: `isSpeaking` gating the VAD is what keeps
  // the loop half-duplex, so an answer that plays after Stop plays under an
  // armed microphone.
  let deliverAnswer;
  mockSpeak.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        deliverAnswer = resolve;
      }),
  );

  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  receiveMessage('card-1', { ...BOT_REPLY, createdAt: new Date(Date.now() + 1000) });
  await settle();

  click(stopButton());
  await settle();

  await act(async () => {
    deliverAnswer(SPOKEN_ANSWER);
    await Promise.resolve();
  });

  await settle();

  // Nothing is playing, so what the microphone hears now is the room and not
  // the bot: one turn goes out, and it is the user's.
  await saySomething();

  expect(players).toHaveLength(0);
  expect(mockTranscribe).toHaveBeenCalledTimes(1);
});

test('a socket reconnect while the answer is being synthesised does not pay for it twice', async () => {
  // `selectVoiceChatCapability` returns `bootstrap.voiceChat`, and the reducer
  // replaces the whole bootstrap on SOCKET_RECONNECT_HANDLE — so every
  // reconnect hands the panel an equal but NEW object. A speech effect that
  // depended on it would restart here: a second billed synthesis, and an answer
  // that never plays because the first run's teardown clears the pending one.
  let deliverAnswer;
  mockSpeak.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        deliverAnswer = resolve;
      }),
  );

  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  receiveMessage('card-1', { ...BOT_REPLY, createdAt: new Date(Date.now() + 1000) });
  await settle();

  expect(mockSpeak).toHaveBeenCalledTimes(1);

  act(() => {
    mockVoiceCapability = { ...mockVoiceCapability };
    store.dispatch({ type: 'SOCKET_RECONNECT_HANDLE' });
  });

  await settle();

  expect(mockSpeak).toHaveBeenCalledTimes(1);
  expect(mockSpeak.mock.calls[0][3].aborted).toBe(false);

  await act(async () => {
    deliverAnswer(SPOKEN_ANSWER);
    await Promise.resolve();
  });

  await settle();

  // The answer the user waited for is the one they hear.
  expect(mockSpeak).toHaveBeenCalledTimes(1);
  expect(players).toHaveLength(1);
  expect(players[0].src).toBe('blob:voice');
  expect(status().textContent).toContain('common.voiceChatSpeaking');
});

test('an answer the browser refuses to play is given up rather than repeated', async () => {
  // `audio.onerror` is one of only two things that ever settle the playback
  // promise, so a decode failure that was not handled would leave the row
  // saying "Reading the answer aloud" for the rest of the conversation and the
  // microphone shut behind it.
  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  receiveMessage('card-1', { ...BOT_REPLY, createdAt: new Date(Date.now() + 1000) });
  await settle();

  expect(players).toHaveLength(1);

  await act(async () => {
    players[0].onerror();
    await Promise.resolve();
  });

  await settle();

  expect(status().textContent).toContain('common.voiceChatListening');
  // Marked spoken all the same: a message that cannot be played must not be
  // retried on every render for ever.
  expect(mockSpeak).toHaveBeenCalledTimes(1);
});

test('a browser that will not leave the audio context suspended stops the mode and says so', async () => {
  // The mode remembers itself across a reload and reopens the microphone with
  // no user gesture; an autoplay policy answers that by handing back frames of
  // zeroes, which read as a very quiet room rather than as a failure — so the
  // row would say "Listening" at a microphone that can never hear anything.
  window.AudioContext = class SuspendedAudioContext {
    constructor() {
      this.state = 'suspended';
    }

    resume() {
      return Promise.resolve();
    }

    close() {
      return Promise.resolve();
    }
  };

  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  expect(voiceToggle().getAttribute('aria-pressed')).toBe('false');
  expect(status().textContent).toContain('common.voiceChatAudioBlocked');
});

test('a session the server no longer accepts stops the mode and logs the app out', async () => {
  // These two endpoints are the only requests in the app that do not go through
  // `sagas/core/request.js`, which is what turns a 401 into a logout
  // everywhere else.
  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  mockTranscribe.mockRejectedValue({
    code: 'E_UNAUTHORIZED',
    message: 'Access token is invalid',
  });

  await saySomething();

  expect(voiceToggle().getAttribute('aria-pressed')).toBe('false');
  expect(status().textContent).toContain('common.voiceChatSessionExpired');
  expect(actionsOfType(EntryActionTypes.LOGOUT)).toHaveLength(1);
});

test('a stored preference for a mode this deployment cannot run is forgotten', async () => {
  // Otherwise a returning user is stuck looking at "not available on this
  // server" with the only control that could clear it disabled.
  window.localStorage.setItem('planka-bot-chat-voice', 'true');
  mockVoiceCapability = { ...mockVoiceCapability, ttsEnabled: false };

  render();
  click(launcher());
  await settle();

  expect(voiceToggle().getAttribute('aria-pressed')).toBe('false');
  expect(window.localStorage.getItem('planka-bot-chat-voice')).toBeNull();
  expect(window.navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
});

test('a recorder that fails mid-utterance stops the mode rather than losing turns quietly', async () => {
  // Its audio is gone and no `onstop` is coming, so the VAD would go on
  // crediting speech into a recording that no longer exists — every turn from
  // there on silently lost, with the row still saying "listening".
  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  expect(recorders).toHaveLength(1);

  await act(async () => {
    recorders[0].onerror(new Error('device went away'));
    await Promise.resolve();
  });

  await settle();

  expect(voiceToggle().getAttribute('aria-pressed')).toBe('false');
  expect(status().textContent).toContain('common.voiceChatFailed');
});

test('turning the mode off mid-upload stops paying for the recording', async () => {
  // The transcript would be discarded by the generation guard either way; what
  // this is about is the provider, which bills per audio minute whether or not
  // anybody reads the answer.
  let uploadSignal;
  mockTranscribe.mockImplementationOnce(
    (cardId, data, headers, signal) =>
      new Promise(() => {
        uploadSignal = signal;
      }),
  );

  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  await saySomething();

  expect(mockTranscribe).toHaveBeenCalledTimes(1);
  expect(uploadSignal.aborted).toBe(false);

  click(voiceToggle());
  await settle();

  expect(uploadSignal.aborted).toBe(true);
});

test('a server that has lost its speech-to-text turns the mode off and says so', async () => {
  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  mockTranscribe.mockRejectedValue({
    code: 'E_SERVICE_UNAVAILABLE',
    message: 'Speech-to-text is not configured on this server',
  });

  await saySomething();

  expect(voiceToggle().getAttribute('aria-pressed')).toBe('false');
  expect(status().textContent).toContain('common.voiceChatNotAvailable');
  expect(actionsOfType(EntryActionTypes.COMMENT_FOR_CARD_CREATE)).toHaveLength(0);
});

test('a recording the server refuses costs one turn, not the mode', async () => {
  // 422 is "this recording was wrong" — an unsupported container, audio past
  // the duration cap. Turning voice chat off over one of them would make the
  // user press the button again for something that was never broken.
  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  mockTranscribe.mockRejectedValue({
    code: 'E_UNPROCESSABLE_ENTITY',
    message: 'Audio is too long: 340.0s exceeds the 300s limit',
  });

  await saySomething();

  expect(voiceToggle().getAttribute('aria-pressed')).toBe('true');
  expect(status().textContent).toContain('common.voiceChatTurnRefused');
  // Still listening: the next turn goes through.
  expect(status().textContent).toContain('common.voiceChatListening');
  expect(actionsOfType(EntryActionTypes.COMMENT_FOR_CARD_CREATE)).toHaveLength(0);
});

test('an answer the server refuses is said so, and is not read again', async () => {
  // A reply that reduces to nothing speakable — a bare heading, a fenced block
  // — is one answer that cannot be read, not a broken mode.
  mockSpeak.mockRejectedValue({
    code: 'E_UNPROCESSABLE_ENTITY',
    message: 'There is nothing in that message to read aloud',
  });

  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  receiveMessage('card-1', {
    id: 'comment-1',
    userId: BOT.id,
    author: MessageAuthors.BOT,
    text: '###',
    createdAt: new Date(Date.now() + 1000),
    isPersisted: true,
  });
  await settle();

  expect(voiceToggle().getAttribute('aria-pressed')).toBe('true');
  expect(status().textContent).toContain('common.voiceChatAnswerRefused');

  // Marked spoken whatever happened, so nothing retries it on the next render.
  await settle();
  expect(mockSpeak).toHaveBeenCalledTimes(1);
});

test('a broken speech provider turns the mode off, and says whose fault it is', async () => {
  // 502 is the provider behind the endpoint, not this machine — so the copy
  // does not invite an immediate retry that would meet the same outage.
  mockSpeak.mockRejectedValue({
    code: 'E_BAD_GATEWAY',
    message: 'The speech service rejected the request',
  });

  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  receiveMessage('card-1', {
    id: 'comment-1',
    userId: BOT.id,
    author: MessageAuthors.BOT,
    text: 'First answer.',
    createdAt: new Date(Date.now() + 1000),
    isPersisted: true,
  });
  await settle();

  expect(voiceToggle().getAttribute('aria-pressed')).toBe('false');
  expect(status().textContent).toContain('common.voiceChatProviderFailed');
});

test('a turn the server will not pay for costs one turn, not the mode', async () => {
  // 429 is the deployment's per-user spending cap. Turning voice chat off for
  // it would punish somebody for speaking twice quickly — worse than having no
  // cap at all — so the mode stays on and the loop says when to come back.
  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  mockTranscribe.mockRejectedValue({
    code: 'E_TOO_MANY_REQUESTS',
    message: 'Too many voice turns just now',
    retryAfterSec: 12,
  });

  await saySomething();

  expect(voiceToggle().getAttribute('aria-pressed')).toBe('true');
  expect(status().textContent).toContain('common.voiceChatTooManyTurns');
  expect(actionsOfType(EntryActionTypes.COMMENT_FOR_CARD_CREATE)).toHaveLength(0);
});

test('the microphone waits out a rate limit rather than uploading into it', async () => {
  // The upload is ~a megabyte of audio. Once the server has said when it will
  // take the next one, sending before then buys a refusal this loop could have
  // predicted.
  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  mockTranscribe.mockRejectedValue({
    code: 'E_TOO_MANY_REQUESTS',
    message: 'Too many voice turns just now',
    retryAfterSec: 12,
  });

  await saySomething();
  expect(mockTranscribe).toHaveBeenCalledTimes(1);

  // Still inside the window the server named: heard, and not sent.
  await saySomething();
  expect(mockTranscribe).toHaveBeenCalledTimes(1);
  expect(status().textContent).toContain('common.voiceChatTooManyTurns');

  await act(async () => {
    jest.advanceTimersByTime(12 * 1000);
    await Promise.resolve();
  });

  mockTranscribe.mockResolvedValue({
    item: { text: 'what is blocking this', languages: ['en'], durationSec: 2.5 },
  });

  await saySomething();

  expect(mockTranscribe).toHaveBeenCalledTimes(2);
  expect(actionsOfType(EntryActionTypes.COMMENT_FOR_CARD_CREATE)).toHaveLength(1);
});

test('an answer the server will not pay to read is said so, and is not retried', async () => {
  mockSpeak.mockRejectedValue({
    code: 'E_TOO_MANY_REQUESTS',
    message: 'Too many messages read aloud just now',
    retryAfterSec: 30,
  });

  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  receiveMessage('card-1', {
    id: 'comment-1',
    userId: BOT.id,
    author: MessageAuthors.BOT,
    text: 'First answer.',
    createdAt: new Date(Date.now() + 1000),
    isPersisted: true,
  });
  await settle();

  expect(voiceToggle().getAttribute('aria-pressed')).toBe('true');
  expect(status().textContent).toContain('common.voiceChatAnswerNotRead');

  // Marked spoken all the same, so it is not asked for again on every render.
  await settle();
  expect(mockSpeak).toHaveBeenCalledTimes(1);
});

test('a refused microphone turns the mode off with instructions', async () => {
  window.navigator.mediaDevices.getUserMedia.mockRejectedValue({ name: 'NotAllowedError' });

  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  expect(voiceToggle().getAttribute('aria-pressed')).toBe('false');
  expect(status().textContent).toContain('common.voiceChatMicrophoneBlocked');
});

test('the mode is remembered per browser', async () => {
  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  expect(window.localStorage.getItem('planka-bot-chat-voice')).toBe('true');

  click(voiceToggle());
  await settle();

  expect(window.localStorage.getItem('planka-bot-chat-voice')).toBeNull();
});

test('turning the mode off closes the microphone', async () => {
  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  click(voiceToggle());
  await settle();

  // Every track stopped is what puts the browser's recording indicator out.
  const [track] = (
    await window.navigator.mediaDevices.getUserMedia.mock.results[0].value
  ).getTracks();

  expect(track.stop).toHaveBeenCalled();
  expect(status()).toBeNull();
});

test('a member who may not comment never opens a microphone', async () => {
  mockMembership = { id: 'membership-1', role: BoardMembershipRoles.VIEWER, canComment: false };

  render();
  click(launcher());
  await settle();

  expect(window.navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
});

test('the answer is read back in the language the user was heard in', async () => {
  // The only thing that ever reaches the deployment's per-language voice map:
  // the server resolves a pinned voice from the language a request names, and
  // nothing else on the client names one.
  mockTranscribe.mockResolvedValue({
    item: { text: 'что происходит', languages: ['ru'], durationSec: 1.2, confidence: 0.9 },
  });

  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  await saySomething();

  receiveMessage('card-1', {
    id: 'comment-1',
    userId: BOT.id,
    author: MessageAuthors.BOT,
    text: 'Ждём ревью.',
    createdAt: new Date(Date.now() + 1000),
    isPersisted: true,
  });

  await settle();

  expect(mockSpeak.mock.calls[0][1]).toEqual({ text: 'Ждём ревью.', language: 'ru' });
});

test('a conversation keeps one voice once the server has decided on one', async () => {
  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  receiveMessage('card-1', {
    id: 'comment-1',
    userId: BOT.id,
    author: MessageAuthors.BOT,
    text: 'First answer.',
    createdAt: new Date(Date.now() + 1000),
    isPersisted: true,
  });
  await settle();

  receiveMessage('card-1', {
    id: 'comment-2',
    userId: BOT.id,
    author: MessageAuthors.BOT,
    text: 'Second answer.',
    createdAt: new Date(Date.now() + 2000),
    isPersisted: true,
  });
  await settle();

  expect(mockSpeak.mock.calls[1][1]).toEqual({
    text: 'Second answer.',
    voice: 'voice-en',
    language: 'en',
  });
});

test('switching language mid-conversation gives up the voice pinned for the last one', async () => {
  // The pin exists so one conversation keeps one voice. It is NOT a decision
  // about the speaker: somebody who has started talking Russian has left the
  // English voice behind, and sending it back would have that voice read every
  // answer from here on — which is the same failure as never resolving a voice
  // at all, arrived at from the other side.
  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  await saySomething();

  receiveMessage('card-1', {
    id: 'comment-1',
    userId: BOT.id,
    author: MessageAuthors.BOT,
    text: 'First answer.',
    createdAt: new Date(Date.now() + 1000),
    isPersisted: true,
  });
  await settle();

  expect(mockSpeak.mock.calls[0][1]).toEqual({ text: 'First answer.', language: 'en' });

  await finishSpeaking();

  mockTranscribe.mockResolvedValue({
    item: { text: 'что происходит', languages: ['ru-RU'], durationSec: 1.2, confidence: 0.9 },
  });

  await saySomething();

  // The second turn has to have actually been heard, or the assertion below
  // would pass for the wrong reason.
  expect(mockTranscribe).toHaveBeenCalledTimes(2);

  receiveMessage('card-1', {
    id: 'comment-2',
    userId: BOT.id,
    author: MessageAuthors.BOT,
    text: 'Ждём ревью.',
    createdAt: new Date(Date.now() + 2000),
    isPersisted: true,
  });
  await settle();

  // The new language, and no voice — so the server resolves one for it.
  expect(mockSpeak.mock.calls[1][1]).toEqual({ text: 'Ждём ревью.', language: 'ru-RU' });
});

test('a regional spelling of the same language keeps the voice it pinned', async () => {
  // `ru` and `ru-RU` are one language — the reduction the server makes — so a
  // provider that spells the second must not cost the conversation its voice on
  // every turn.
  mockTranscribe.mockResolvedValue({
    item: { text: 'что происходит', languages: ['ru'], durationSec: 1.2, confidence: 0.9 },
  });
  mockSpeak.mockResolvedValue({
    item: { data: 'QUJD', mimeType: 'audio/mpeg', voice: 'voice-ru', language: 'ru' },
  });

  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  await saySomething();

  receiveMessage('card-1', {
    id: 'comment-1',
    userId: BOT.id,
    author: MessageAuthors.BOT,
    text: 'Ждём ревью.',
    createdAt: new Date(Date.now() + 1000),
    isPersisted: true,
  });
  await settle();

  await finishSpeaking();

  mockTranscribe.mockResolvedValue({
    item: { text: 'а что дальше', languages: ['ru-RU'], durationSec: 1.2, confidence: 0.9 },
  });

  await saySomething();

  expect(mockTranscribe).toHaveBeenCalledTimes(2);

  receiveMessage('card-1', {
    id: 'comment-2',
    userId: BOT.id,
    author: MessageAuthors.BOT,
    text: 'Сейчас посмотрю.',
    createdAt: new Date(Date.now() + 2000),
    isPersisted: true,
  });
  await settle();

  expect(mockSpeak.mock.calls[1][1]).toEqual({
    text: 'Сейчас посмотрю.',
    voice: 'voice-ru',
    language: 'ru',
  });
});

test('closing the panel forgets the voice, so the next conversation resolves its own', async () => {
  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  receiveMessage('card-1', {
    id: 'comment-1',
    userId: BOT.id,
    author: MessageAuthors.BOT,
    text: 'First answer.',
    createdAt: new Date(Date.now() + 1000),
    isPersisted: true,
  });
  await settle();
  await finishSpeaking();

  // Let the clock past the first answer, so reopening does not read it again —
  // only a reply that arrived AFTER the mode started is spoken.
  await hold(QUIET_DB, 3000);

  // Closing stops the loop; the preference survives, so reopening resumes.
  click(launcher());
  await settle();
  click(launcher());
  await settle();

  receiveMessage('card-1', {
    id: 'comment-2',
    userId: BOT.id,
    author: MessageAuthors.BOT,
    text: 'Second answer.',
    createdAt: new Date(Date.now() + 2000),
    isPersisted: true,
  });
  await settle();

  expect(mockSpeak.mock.calls[1][1]).toEqual({ text: 'Second answer.' });
});

test('a voice the server reported with no language is not pinned onto the rest', async () => {
  // A voice with no language beside it is the deployment's default answering
  // "I could not tell". Pinning that would fix the wrong voice onto every
  // answer after one undetectable reply.
  mockSpeak.mockResolvedValue({
    item: { data: 'QUJD', mimeType: 'audio/mpeg', voice: 'voice-default', language: null },
  });

  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  receiveMessage('card-1', {
    id: 'comment-1',
    userId: BOT.id,
    author: MessageAuthors.BOT,
    text: 'First answer.',
    createdAt: new Date(Date.now() + 1000),
    isPersisted: true,
  });
  await settle();

  receiveMessage('card-1', {
    id: 'comment-2',
    userId: BOT.id,
    author: MessageAuthors.BOT,
    text: 'Second answer.',
    createdAt: new Date(Date.now() + 2000),
    isPersisted: true,
  });
  await settle();

  expect(mockSpeak.mock.calls[1][1]).toEqual({ text: 'Second answer.' });
});

test('an answer too long to read is said so, and the loop keeps listening', async () => {
  mockVoiceCapability = { ...mockVoiceCapability, ttsMaxChars: 10 };

  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  receiveMessage('card-1', {
    id: 'comment-1',
    userId: BOT.id,
    author: MessageAuthors.BOT,
    text: 'An answer that is comfortably over the ceiling.',
    createdAt: new Date(Date.now() + 1000),
    isPersisted: true,
  });

  await settle();

  // Not sent at all: the server would refuse it, and the only handler for that
  // refusal turns the whole mode off.
  expect(mockSpeak).not.toHaveBeenCalled();
  expect(status().textContent).toContain('common.voiceChatAnswerTooLong');
  expect(status().textContent).toContain('common.voiceChatListening');
  expect(voiceToggle().getAttribute('aria-pressed')).toBe('true');
});

test('a recording over the cap is refused with a sentence rather than vanishing', async () => {
  mockVoiceCapability = { ...mockVoiceCapability, sttMaxBytes: 1 };

  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  await saySomething();

  expect(mockTranscribe).not.toHaveBeenCalled();
  expect(status().textContent).toContain('common.voiceChatRecordingTooLarge');
  expect(voiceToggle().getAttribute('aria-pressed')).toBe('true');
});

test('a turn ends inside a recording ceiling the deployment lowered', async () => {
  // 10 s, so the loop has 10 s less its idle window to spend on one turn — well
  // under the 45 s it would otherwise take to force-end a shout.
  mockVoiceCapability = { ...mockVoiceCapability, sttMaxDurationSec: 10 };

  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  // One unbroken stretch of talking, longer than the lowered ceiling allows for
  // a turn and far shorter than the shipped maxUtteranceMs.
  await hold(VOICE_DB, 10000 - VOICE_CHAT_TUNING.idleRestartMs + VOICE_CHAT_TUNING.frameIntervalMs);
  await settle();

  // Force-ended and SENT, rather than carrying on to 45 s and being refused by
  // the server after it had already been transcribed and billed.
  expect(mockTranscribe).toHaveBeenCalledTimes(1);
});

test('a recording longer than the server accepts is never uploaded', async () => {
  // The pathological case the shortened turn cannot cover: a room noisy enough
  // to keep resetting the idle clock without ever opening a turn, so the
  // recorder accumulates in front of the sentence that eventually arrives.
  mockVoiceCapability = { ...mockVoiceCapability, sttMaxDurationSec: 4 };

  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  // Blips just short of a turn, spaced under the idle window, for longer than
  // the ceiling: nothing is thrown away and nothing is sent.
  for (let index = 0; index < 6; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await hold(VOICE_DB, VOICE_CHAT_TUNING.frameIntervalMs);
    // eslint-disable-next-line no-await-in-loop
    await hold(QUIET_DB, VOICE_CHAT_TUNING.idleRestartMs - VOICE_CHAT_TUNING.frameIntervalMs);
  }

  await saySomething();

  expect(mockTranscribe).not.toHaveBeenCalled();
  expect(status().textContent).toContain('common.voiceChatRecordingTooLong');
  // One refused turn is not a broken mode.
  expect(status().textContent).toContain('common.voiceChatListening');
  expect(voiceToggle().getAttribute('aria-pressed')).toBe('true');
});

test('a read-only card gets no status row and no microphone', async () => {
  mockMembership = { id: 'membership-1', role: BoardMembershipRoles.VIEWER, canComment: false };
  window.localStorage.setItem('planka-bot-chat-voice', 'true');

  render();
  click(launcher());
  await settle();

  // The row below already says why commenting is not possible; a second line
  // promising a microphone that will never open is a contradiction.
  expect(status()).toBeNull();
  expect(window.navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
});

test('closing the panel closes the microphone, and reopening resumes', async () => {
  render();
  click(launcher());
  click(voiceToggle());
  await settle();

  const [track] = (
    await window.navigator.mediaDevices.getUserMedia.mock.results[0].value
  ).getTracks();

  expect(track.stop).not.toHaveBeenCalled();

  // The launcher is a toggle, so a second press closes the panel.
  click(launcher());
  await settle();

  // Holding a microphone open behind a closed panel is not what hands-free
  // means, and the browser's recording indicator would stay lit with nothing on
  // screen to explain it.
  expect(track.stop).toHaveBeenCalled();

  click(launcher());
  await settle();

  // The preference survived: no second press of the toggle was needed.
  expect(window.navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
  expect(voiceToggle().getAttribute('aria-pressed')).toBe('true');
});
