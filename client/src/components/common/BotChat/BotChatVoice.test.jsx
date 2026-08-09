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
const launcher = () => findByLabel('common.chatWithBot');
const voiceToggle = () =>
  findByLabel('action.turnOnVoiceChat') || findByLabel('action.turnOffVoiceChat');
const status = () => container.querySelector('[role="status"]');

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

/** A whole turn: enough voice to open one, then enough silence to send it. */
const saySomething = async () => {
  await hold(VOICE_DB, VOICE_CHAT_TUNING.minSpeechMs + VOICE_CHAT_TUNING.frameIntervalMs);
  await hold(QUIET_DB, VOICE_CHAT_TUNING.silenceHangoverMs + VOICE_CHAT_TUNING.frameIntervalMs);
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
  );
  expect(players).toHaveLength(1);
  expect(players[0].src).toBe('blob:voice');
  expect(status().textContent).toContain('common.voiceChatSpeaking');
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

  const stop = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'action.stopSpeaking',
  );

  expect(stop).toBeDefined();

  click(stop);
  await settle();

  expect(status().textContent).toContain('common.voiceChatListening');
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
