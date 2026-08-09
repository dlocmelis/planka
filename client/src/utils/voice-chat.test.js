/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import {
  RECORDER_MIME_CANDIDATES,
  RecordingAvailabilities,
  SILENCE_DBFS,
  SpeakAvailabilities,
  VOICE_CHAT_TUNING,
  VadEvents,
  VoiceChatPhases,
  VoiceChatStopReasons,
  formatBytes,
  formatSeconds,
  frameLevelDb,
  isRecordingSupported,
  isSendableTranscript,
  microphoneStopReason,
  newVadState,
  pickRecorderMimeType,
  isRefusal,
  readVoiceChatEnabled,
  recordingAvailability,
  recordingLimitMs,
  requestStopReason,
  sameLanguage,
  speakAvailability,
  speechTextLength,
  uploadContentType,
  vadStep,
  voiceChatPhase,
  voiceChatTuning,
  writeVoiceChatEnabled,
} from './voice-chat';

const { frameIntervalMs, minSpeechMs, silenceHangoverMs, idleRestartMs, maxUtteranceMs } =
  VOICE_CHAT_TUNING;

/** A level comfortably above the activation threshold in a settled room, and
 * one comfortably below it. */
const VOICE_DB = -20;
const QUIET_DB = -70;

/**
 * Drive the tracker over a run of frames at a fixed level and collect every
 * event it produced, with the time it produced it at.
 *
 * The whole endpointing contract is expressed this way rather than through a
 * microphone: same frames in, same events out.
 */
const run = (state, { db, ms, atMs = 0, armed = true, tuning = undefined }) => {
  let current = state;
  const events = [];
  let time = atMs;

  for (let elapsed = 0; elapsed < ms; elapsed += frameIntervalMs) {
    const result = vadStep(current, { db, atMs: time }, { armed, tuning });
    current = result.state;

    if (result.event) {
      events.push({ event: result.event, atMs: time });
    }

    time += frameIntervalMs;
  }

  return { state: current, events, atMs: time };
};

describe('voice-chat', () => {
  describe('frameLevelDb(samples)', () => {
    it('reads digital silence as the clamp rather than -Infinity', () => {
      expect(frameLevelDb(new Float32Array(128))).toBe(SILENCE_DBFS);
      expect(frameLevelDb(new Float32Array(0))).toBe(SILENCE_DBFS);
    });

    it('reads a NaN buffer as silence rather than poisoning the floor', () => {
      // Some browsers hand back an analyser buffer that was never filled. NaN
      // would make every comparison against the floor false for ever, and the
      // microphone would go quietly deaf until the panel remounted.
      const samples = new Float32Array(128).fill(NaN);

      expect(frameLevelDb(samples)).toBe(SILENCE_DBFS);
    });

    it('measures RMS in dBFS', () => {
      // A constant 0.1 is -20 dBFS by definition.
      expect(frameLevelDb(new Float32Array(64).fill(0.1))).toBeCloseTo(-20, 6);
      expect(frameLevelDb(new Float32Array(64).fill(1))).toBeCloseTo(0, 6);
    });
  });

  describe('vadStep(state, frame, options)', () => {
    it('says nothing about a quiet room until the idle clock expires', () => {
      const { events } = run(newVadState(0), { db: QUIET_DB, ms: idleRestartMs });

      expect(events).toEqual([]);
    });

    it('throws a silent recording away once, on the idle clock', () => {
      const { events } = run(newVadState(0), { db: QUIET_DB, ms: idleRestartMs + frameIntervalMs });

      expect(events).toEqual([{ event: VadEvents.IDLE_RESTART, atMs: idleRestartMs }]);
    });

    it('opens a turn exactly minSpeechMs after the first frame of speech', () => {
      const { events } = run(newVadState(0), { db: VOICE_DB, ms: minSpeechMs + frameIntervalMs });

      expect(events).toEqual([{ event: VadEvents.SPEECH_START, atMs: minSpeechMs }]);
    });

    it('does not open a turn on a door, a cough or a keyboard', () => {
      // A hundred milliseconds of loud is not somebody talking, and the credit
      // it earned decays away over the silence that follows.
      const burst = run(newVadState(0), { db: VOICE_DB, ms: 100 });
      const after = run(burst.state, { db: QUIET_DB, ms: 800, atMs: burst.atMs });

      expect(burst.events).toEqual([]);
      expect(after.events).toEqual([]);
      expect(after.state.speechRunStartedAt).toBeNull();
    });

    it('sends the turn after silenceHangoverMs of quiet', () => {
      const speech = run(newVadState(0), { db: VOICE_DB, ms: minSpeechMs + frameIntervalMs });
      const lastVoiceAt = speech.atMs - frameIntervalMs;

      const silence = run(speech.state, {
        db: QUIET_DB,
        ms: silenceHangoverMs + frameIntervalMs,
        atMs: speech.atMs,
      });

      expect(silence.events).toEqual([
        { event: VadEvents.UTTERANCE_END, atMs: lastVoiceAt + silenceHangoverMs },
      ]);
    });

    it('survives the gaps between words rather than needing an unbroken run', () => {
      // 200 ms words with 150 ms between them: a rule that ended the run on a
      // gap would never open a turn for someone talking normally.
      let state = newVadState(0);
      let atMs = 0;
      const events = [];

      for (let word = 0; word < 6; word += 1) {
        const spoken = run(state, { db: VOICE_DB, ms: 200, atMs });
        state = spoken.state;
        atMs = spoken.atMs;
        events.push(...spoken.events);

        const gap = run(state, { db: QUIET_DB, ms: 150, atMs });
        state = gap.state;
        atMs = gap.atMs;
        events.push(...gap.events);
      }

      expect(events.map(({ event }) => event)).toContain(VadEvents.SPEECH_START);
    });

    it('force-ends the sentence that never ends', () => {
      const state = run(newVadState(0), { db: VOICE_DB, ms: minSpeechMs + frameIntervalMs });
      // A level with no gaps in it eventually stops reading as voice (the floor
      // climbs to meet it), so the ceiling is checked with speech that keeps
      // its gaps: a word, a short pause, a word.
      let current = state.state;
      let { atMs } = state;
      let tooLong = null;

      while (atMs < maxUtteranceMs + 2000 && !tooLong) {
        const spoken = run(current, { db: VOICE_DB, ms: 200, atMs });
        current = spoken.state;
        atMs = spoken.atMs;

        const gap = run(current, { db: QUIET_DB, ms: 200, atMs });
        current = gap.state;
        atMs = gap.atMs;

        tooLong = [...spoken.events, ...gap.events].find(
          ({ event }) => event === VadEvents.UTTERANCE_TOO_LONG,
        );
      }

      expect(tooLong).toBeDefined();
      expect(tooLong.atMs).toBeGreaterThanOrEqual(maxUtteranceMs);
      // The ceiling is a bound, not a suggestion: it bites within one word of
      // where it is set.
      expect(tooLong.atMs).toBeLessThan(maxUtteranceMs + 1000);
    });

    it('lets a constant tone raise the floor until it stops reading as speech', () => {
      // A fan has no gaps, so its minimum IS its level. Without the floor
      // climbing to meet it, room tone would hold a turn open until the
      // 45-second ceiling.
      const opened = run(newVadState(0), { db: -30, ms: minSpeechMs + frameIntervalMs });

      expect(opened.events.map(({ event }) => event)).toEqual([VadEvents.SPEECH_START]);

      const held = run(opened.state, { db: -30, ms: 30000, atMs: opened.atMs });

      expect(held.events.map(({ event }) => event)).toContain(VadEvents.UTTERANCE_END);
      // ...and long before the ceiling would have force-ended it.
      const ended = held.events.find(({ event }) => event === VadEvents.UTTERANCE_END);
      expect(ended.atMs).toBeLessThan(maxUtteranceMs);
    });

    it('does not count an unmeasured gap as silence', () => {
      // A background tab is throttled to about one tick a second and the
      // sampler still only ever hears 50 ms of audio per tick. Counting the
      // whole gap as silence would end the utterance of someone who tabbed
      // away mid-sentence and send the first fifth of what they said.
      const speech = run(newVadState(0), { db: VOICE_DB, ms: minSpeechMs + frameIntervalMs });

      // One tick, one second later, still carrying voice.
      const throttled = vadStep(
        speech.state,
        { db: VOICE_DB, atMs: speech.atMs + 1000 },
        { armed: true },
      );

      expect(throttled.event).toBeNull();
      expect(throttled.state.utteranceStartedAt).not.toBeNull();
    });

    it('still terminates a turn in a throttled tab', () => {
      // The other half of the rule: it must not livelock. One frame's worth of
      // every tick IS measured, so the hangover expires — slowly.
      const speech = run(newVadState(0), { db: VOICE_DB, ms: minSpeechMs + frameIntervalMs });

      let { state } = speech;
      let { atMs } = speech;
      let ended = false;

      for (let tick = 0; tick < 200 && !ended; tick += 1) {
        atMs += 1000;
        const result = vadStep(state, { db: QUIET_DB, atMs }, { armed: true });
        state = result.state;
        ended = result.event === VadEvents.UTTERANCE_END;
      }

      expect(ended).toBe(true);
    });

    it('keeps the utterance ceiling in real time even when the tab is hidden', () => {
      // Every other clock is shifted by the unmeasured gap; this one is not,
      // because the ceiling bounds how much audio the recorder may buffer and
      // audio nobody measured is still audio it kept.
      const speech = run(newVadState(0), { db: VOICE_DB, ms: minSpeechMs + frameIntervalMs });

      const result = vadStep(
        speech.state,
        { db: VOICE_DB, atMs: speech.atMs + maxUtteranceMs },
        { armed: true },
      );

      expect(result.event).toBe(VadEvents.UTTERANCE_TOO_LONG);
    });

    it('hears nothing at all while disarmed, and re-arms from a clean silence', () => {
      const disarmed = run(newVadState(0), { db: VOICE_DB, ms: 5000, armed: false });

      expect(disarmed.events).toEqual([]);
      expect(disarmed.state.utteranceStartedAt).toBeNull();
      expect(disarmed.state.voicedMs).toBe(0);

      // And the answer leaking into the microphone has not raised the bar for
      // the user's next turn — which is "the first thing I say after it answers
      // is always ignored".
      expect(disarmed.state.noiseFloorDb).toBe(VOICE_CHAT_TUNING.absoluteFloorDb);

      const armed = run(disarmed.state, {
        db: VOICE_DB,
        ms: minSpeechMs + frameIntervalMs,
        atMs: disarmed.atMs,
      });

      expect(armed.events.map(({ event }) => event)).toEqual([VadEvents.SPEECH_START]);
    });

    it('tracks a room that went quiet under a spoken answer', () => {
      // The floor may still FALL while disarmed. It starts clamped at the
      // absolute floor, so this is checked from a floor that had risen.
      const noisy = run(newVadState(0), { db: -30, ms: 4000 });

      expect(noisy.state.noiseFloorDb).toBeGreaterThan(VOICE_CHAT_TUNING.absoluteFloorDb);

      const quiet = run(noisy.state, {
        db: QUIET_DB,
        ms: 4000,
        atMs: noisy.atMs,
        armed: false,
      });

      expect(quiet.state.noiseFloorDb).toBe(VOICE_CHAT_TUNING.absoluteFloorDb);
    });
  });

  describe('voiceChatTuning(capability)', () => {
    it('leaves the default deployment on the shipped tuning, object and all', () => {
      // Identity, not equality: 300 s is far above the 45 s ceiling, so there is
      // nothing to fold in and every frame should compare the same object.
      expect(voiceChatTuning({ sttMaxDurationSec: 300 })).toBe(VOICE_CHAT_TUNING);
      expect(voiceChatTuning({ sttMaxDurationSec: null })).toBe(VOICE_CHAT_TUNING);
      expect(voiceChatTuning({})).toBe(VOICE_CHAT_TUNING);
      expect(voiceChatTuning(null)).toBe(VOICE_CHAT_TUNING);
    });

    it('ends a turn inside a ceiling the deployment lowered', () => {
      // A recording is the utterance plus whatever silence was in front of it,
      // and the loop tolerates a whole idleRestartMs of that before throwing it
      // away — so the budget is the ceiling less that, not the ceiling.
      const tuning = voiceChatTuning({ sttMaxDurationSec: 30 });

      expect(tuning.maxUtteranceMs).toBe(30000 - idleRestartMs);
      expect(tuning.minSpeechMs).toBe(minSpeechMs);
    });

    it('keeps one usable turn where the ceiling is smaller than one', () => {
      // Nothing here can honour a two-second ceiling by ending turns earlier —
      // there would be no turn left. The loop keeps a turn a person can speak
      // into and `recordingAvailability` refuses the upload instead.
      const tuning = voiceChatTuning({ sttMaxDurationSec: 2 });

      expect(tuning.maxUtteranceMs).toBe(minSpeechMs + silenceHangoverMs);
    });

    it('is the tuning vadStep actually endpoints against', () => {
      const tuning = voiceChatTuning({ sttMaxDurationSec: 10 });
      const shortened = tuning.maxUtteranceMs;

      expect(shortened).toBeLessThan(maxUtteranceMs);

      // One unbroken shout, longer than the shortened ceiling and shorter than
      // the shipped one: it must be force-ended, and it is not without the
      // tuning.
      const { events } = run(newVadState(0), {
        db: VOICE_DB,
        ms: shortened + 2 * frameIntervalMs,
        tuning,
      });

      expect(events.map(({ event }) => event)).toEqual([
        VadEvents.SPEECH_START,
        VadEvents.UTTERANCE_TOO_LONG,
      ]);

      const withoutTuning = run(newVadState(0), {
        db: VOICE_DB,
        ms: shortened + 2 * frameIntervalMs,
      });

      expect(withoutTuning.events.map(({ event }) => event)).toEqual([VadEvents.SPEECH_START]);
    });
  });

  describe('recordingAvailability(sizeBytes, durationMs, capability) / recordingLimitMs', () => {
    const capability = { sttMaxBytes: 700 * 1024, sttMaxDurationSec: 30 };

    it('lets an ordinary recording through', () => {
      expect(recordingAvailability(1024, 5000, capability)).toBe(RecordingAvailabilities.READY);
    });

    it('refuses one over the byte cap', () => {
      expect(recordingAvailability(800 * 1024, 5000, capability)).toBe(
        RecordingAvailabilities.TOO_LARGE,
      );
    });

    it('refuses one over the duration cap, which the server only finds out after paying', () => {
      expect(recordingAvailability(1024, 30001, capability)).toBe(RecordingAvailabilities.TOO_LONG);
      expect(recordingAvailability(1024, 30000, capability)).toBe(RecordingAvailabilities.READY);
    });

    it('treats an unmeasured duration as no reason to refuse', () => {
      expect(recordingAvailability(1024, null, capability)).toBe(RecordingAvailabilities.READY);
    });

    it('reads a missing ceiling as no ceiling rather than as zero', () => {
      expect(recordingAvailability(9e9, 9e9, { sttMaxBytes: null, sttMaxDurationSec: null })).toBe(
        RecordingAvailabilities.READY,
      );
      expect(recordingAvailability(9e9, 9e9, null)).toBe(RecordingAvailabilities.READY);
      expect(recordingLimitMs(null)).toBe(0);
      expect(recordingLimitMs({ sttMaxDurationSec: 30 })).toBe(30000);
    });
  });

  describe('isSendableTranscript(text)', () => {
    it('refuses what a provider answers a burst of noise with', () => {
      expect(isSendableTranscript('')).toBe(false);
      expect(isSendableTranscript('.')).toBe(false);
      expect(isSendableTranscript('  ...  ')).toBe(false);
    });

    it('accepts anything with a letter or a digit in it', () => {
      expect(isSendableTranscript('hello')).toBe(true);
      expect(isSendableTranscript('42')).toBe(true);
      expect(isSendableTranscript('Объём?')).toBe(true);
    });
  });

  describe('pickRecorderMimeType(recorder) / isRecordingSupported(environment)', () => {
    const supporting = (types) => ({ isTypeSupported: (type) => types.includes(type) });

    it('picks the best container this browser can record', () => {
      expect(pickRecorderMimeType(supporting(RECORDER_MIME_CANDIDATES))).toBe(
        'audio/webm;codecs=opus',
      );
      // Safari.
      expect(pickRecorderMimeType(supporting(['audio/mp4']))).toBe('audio/mp4');
    });

    it('answers null when it can record none of them, and empty when it cannot say', () => {
      expect(pickRecorderMimeType(supporting([]))).toBeNull();
      expect(pickRecorderMimeType({})).toBe('');
      expect(pickRecorderMimeType(null)).toBeNull();
    });

    it('needs getUserMedia, MediaRecorder and a container we could upload', () => {
      const mediaDevices = { getUserMedia: () => {} };

      expect(
        isRecordingSupported({
          navigator: { mediaDevices },
          MediaRecorder: supporting(RECORDER_MIME_CANDIDATES),
        }),
      ).toBe(true);

      // An insecure origin — the common way this is false in practice.
      expect(
        isRecordingSupported({
          navigator: {},
          MediaRecorder: supporting(RECORDER_MIME_CANDIDATES),
        }),
      ).toBe(false);

      expect(isRecordingSupported({ navigator: { mediaDevices } })).toBe(false);
      expect(
        isRecordingSupported({ navigator: { mediaDevices }, MediaRecorder: supporting([]) }),
      ).toBe(false);
      expect(isRecordingSupported(null)).toBe(false);
    });
  });

  describe('uploadContentType(blobType, requestedType)', () => {
    it('trusts the blob first, the requested type second, and nothing third', () => {
      expect(uploadContentType('audio/ogg', 'audio/webm')).toBe('audio/ogg');
      expect(uploadContentType('', 'audio/webm')).toBe('audio/webm');
      expect(uploadContentType('', '')).toBe('');
    });
  });

  describe('speechTextLength(text) / speakAvailability(text, capability)', () => {
    it('counts code points, the unit the server counts', () => {
      expect(speechTextLength('a😀b')).toBe(3);
      expect('a😀b'.length).toBe(4);
    });

    it('hides the control when there is no voice or nothing to say', () => {
      expect(speakAvailability('hello', { ttsEnabled: false })).toBe(SpeakAvailabilities.HIDDEN);
      expect(speakAvailability('   ', { ttsEnabled: true })).toBe(SpeakAvailabilities.HIDDEN);
      expect(speakAvailability('hello', null)).toBe(SpeakAvailabilities.HIDDEN);
    });

    it('refuses a message the server would refuse, before the round trip', () => {
      expect(speakAvailability('hello', { ttsEnabled: true, ttsMaxChars: 4 })).toBe(
        SpeakAvailabilities.TOO_LONG,
      );
      expect(speakAvailability('hello', { ttsEnabled: true, ttsMaxChars: 5 })).toBe(
        SpeakAvailabilities.READY,
      );
      // No ceiling reported is no client-side ceiling, not a ceiling of zero.
      expect(speakAvailability('hello', { ttsEnabled: true, ttsMaxChars: null })).toBe(
        SpeakAvailabilities.READY,
      );
    });
  });

  describe('voiceChatPhase(input)', () => {
    const base = {
      isEnabled: true,
      isAvailable: true,
      isMicReady: true,
      isSpeaking: false,
      isWaitingForReply: false,
      isTranscribing: false,
      isCapturing: false,
    };

    it('is off before anything else', () => {
      expect(voiceChatPhase({ ...base, isEnabled: false, isCapturing: true })).toBe(
        VoiceChatPhases.OFF,
      );
    });

    it('is blocked where the loop cannot run at all', () => {
      expect(voiceChatPhase({ ...base, isAvailable: false })).toBe(VoiceChatPhases.BLOCKED);
    });

    it('renders exactly one state, in precedence order', () => {
      expect(voiceChatPhase(base)).toBe(VoiceChatPhases.LISTENING);
      expect(voiceChatPhase({ ...base, isMicReady: false })).toBe(VoiceChatPhases.STARTING);
      expect(voiceChatPhase({ ...base, isWaitingForReply: true })).toBe(VoiceChatPhases.THINKING);
      expect(voiceChatPhase({ ...base, isTranscribing: true, isWaitingForReply: true })).toBe(
        VoiceChatPhases.TRANSCRIBING,
      );
      // Capturing outranks waiting: the microphone stays armed through the gap
      // between sending and the answer arriving, and a screen that said
      // "waiting" there would be recording someone while telling them nothing
      // is listening.
      expect(voiceChatPhase({ ...base, isCapturing: true, isWaitingForReply: true })).toBe(
        VoiceChatPhases.CAPTURING,
      );
      // ...and speaking outranks capturing, because this loop is half-duplex
      // and cannot be doing both.
      expect(voiceChatPhase({ ...base, isSpeaking: true, isCapturing: true })).toBe(
        VoiceChatPhases.SPEAKING,
      );
    });
  });

  describe('readVoiceChatEnabled(storage) / writeVoiceChatEnabled(storage, isEnabled)', () => {
    it('remembers the mode across a reload', () => {
      // The storage arrives as a parameter — this module never reaches for a
      // global — which is what lets the whole thing run on node.
      const entries = new Map();
      const storage = {
        getItem: (key) => (entries.has(key) ? entries.get(key) : null),
        setItem: (key, value) => entries.set(key, value),
        removeItem: (key) => entries.delete(key),
      };

      expect(readVoiceChatEnabled(storage)).toBe(false);

      writeVoiceChatEnabled(storage, true);
      expect(readVoiceChatEnabled(storage)).toBe(true);

      writeVoiceChatEnabled(storage, false);
      expect(readVoiceChatEnabled(storage)).toBe(false);
    });

    it('stays off when storage is refused', () => {
      // A mode that opens a microphone must never turn itself on by accident.
      const blocked = {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
        removeItem: () => {
          throw new Error('blocked');
        },
      };

      expect(readVoiceChatEnabled(blocked)).toBe(false);
      expect(() => writeVoiceChatEnabled(blocked, true)).not.toThrow();
    });
  });

  describe('microphoneStopReason(error)', () => {
    it('tells a refusal from a missing device from anything else', () => {
      expect(microphoneStopReason({ name: 'NotAllowedError' })).toBe(
        VoiceChatStopReasons.PERMISSION_DENIED,
      );
      expect(microphoneStopReason({ name: 'SecurityError' })).toBe(
        VoiceChatStopReasons.PERMISSION_DENIED,
      );
      expect(microphoneStopReason({ name: 'NotFoundError' })).toBe(
        VoiceChatStopReasons.NO_MICROPHONE,
      );
      expect(microphoneStopReason({ name: 'AbortError' })).toBe(VoiceChatStopReasons.FAILED);
      expect(microphoneStopReason(undefined)).toBe(VoiceChatStopReasons.FAILED);
    });
  });

  describe('formatBytes(bytes)', () => {
    it('renders a size the way copy needs it, matching the server', () => {
      expect(formatBytes(512)).toBe('512 bytes');
      expect(formatBytes(2048)).toBe('2 KB');
      expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    });
  });

  describe('formatSeconds(ms)', () => {
    it('renders a duration in the unit the ceiling is set in', () => {
      expect(formatSeconds(30000)).toBe('30s');
      expect(formatSeconds(31400)).toBe('31s');
    });
  });

  describe('requestStopReason(error, unavailableReason) / isRefusal(error)', () => {
    it('reads 503 as the feature going away, with the caller naming which half', () => {
      expect(
        requestStopReason({ code: 'E_SERVICE_UNAVAILABLE' }, VoiceChatStopReasons.DISABLED),
      ).toBe(VoiceChatStopReasons.DISABLED);
      expect(
        requestStopReason({ code: 'E_SERVICE_UNAVAILABLE' }, VoiceChatStopReasons.NO_VOICE),
      ).toBe(VoiceChatStopReasons.NO_VOICE);
    });

    it('tells an upstream failure apart, because the advice differs', () => {
      expect(requestStopReason({ code: 'E_BAD_GATEWAY' }, VoiceChatStopReasons.DISABLED)).toBe(
        VoiceChatStopReasons.PROVIDER_FAILED,
      );
    });

    it('falls back to the generic failure for anything else, a dead request included', () => {
      expect(requestStopReason({ code: 'E_NOT_FOUND' }, VoiceChatStopReasons.DISABLED)).toBe(
        VoiceChatStopReasons.FAILED,
      );
      expect(requestStopReason(undefined, VoiceChatStopReasons.DISABLED)).toBe(
        VoiceChatStopReasons.FAILED,
      );
    });

    it('keeps a refusal of one recording out of the stop reasons entirely', () => {
      // 422 means one turn was refused, not that the mode is broken — so it has
      // no stop reason, and the loop keeps listening.
      expect(isRefusal({ code: 'E_UNPROCESSABLE_ENTITY' })).toBe(true);
      expect(isRefusal({ code: 'E_BAD_GATEWAY' })).toBe(false);
      expect(isRefusal(undefined)).toBe(false);
      expect(requestStopReason({ code: 'E_UNPROCESSABLE_ENTITY' }, null)).toBe(
        VoiceChatStopReasons.FAILED,
      );
    });
  });

  describe('sameLanguage(one, other)', () => {
    it('compares on the primary subtag, the reduction the server makes', () => {
      // A pinned voice must not be given up on every turn a provider happened
      // to spell with a region.
      expect(sameLanguage('ru', 'ru-RU')).toBe(true);
      expect(sameLanguage('ru-RU', 'ru')).toBe(true);
      expect(sameLanguage('EN', 'en_US')).toBe(true);
    });

    it('tells two languages apart, which is what drops a stale voice', () => {
      expect(sameLanguage('en', 'ru')).toBe(false);
      expect(sameLanguage('de', 'nl')).toBe(false);
    });

    it('is never sure about something that is not a language tag', () => {
      expect(sameLanguage('', '')).toBe(false);
      expect(sameLanguage(null, null)).toBe(false);
      expect(sameLanguage('english', 'english')).toBe(false);
      expect(sameLanguage('multi', 'multi')).toBe(false);
    });
  });
});
