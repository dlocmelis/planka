/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * Voice chat mode for the planka_bot panel: the pure half.
 *
 * Voice chat is the hands-free loop on top of two features that are otherwise
 * buttons — transcription of what you said, and reading the answer aloud. What
 * is missing between them is the part a user cannot press a button for:
 * noticing that they have STARTED talking, noticing that they have STOPPED,
 * and sending what they said without being asked to.
 *
 * Ported from the Setlfi web assistant, which is the implementation this
 * ticket was told to reuse: the endpointing (`vadStep` and its whole tuning,
 * the noise-floor tracker, the gap rule, the speech credit) comes from
 * setl-web's `lib/assistant/voice_chat.ts`, the recorder container choice and
 * the failure copy from `lib/assistant/stt.ts`, and the length rules for
 * reading a message aloud from `lib/assistant/tts.ts`. The React there is
 * Next.js + MUI and cannot cross into this app, but the arithmetic is the half
 * that actually encodes the behaviour, so it is what was carried over —
 * including the measured numbers and the reasons they are what they are.
 *
 * Pure functions only: no React, no `window`, no `fetch`. That is what lets
 * `npm test` drive the endpointing frame by frame instead of through a
 * microphone (utils/voice-chat.test.js).
 *
 * ## One deliberate difference: this loop is half-duplex
 *
 * setl-web lets you talk over the assistant (barge-in) and then has to undo the
 * damage that permits: with the microphone armed through a spoken answer, the
 * answer leaks back into it, is transcribed, and comes back as the user's own
 * words — so that repo carries a second subsystem (`suppressEchoedSpeech`)
 * whose whole job is to recognise the assistant quoting itself.
 *
 * Here the microphone stays open through an answer but nothing it hears can
 * open an utterance, and the user interrupts with the Stop button that is on
 * screen the whole time. Three reasons, in order of weight:
 *
 *  1. Barge-in without the echo subsystem is WORSE than no barge-in: the leaked
 *     audio is prepended to the user's sentence and posted as a public comment
 *     on a card.
 *  2. planka_bot answers in minutes, not seconds — a whole agent session per
 *     comment. Nobody is sitting through a streaming sentence waiting to cut in.
 *  3. Half-duplex is not a shortcut around the ported code: it is what
 *     setl-web's own loop falls back to whenever the browser will not confirm
 *     that echo cancellation was applied.
 *
 * So the barge-in knobs are not ported either, rather than ported and left
 * unreachable. `vadStep`'s `armed` flag is the whole of the mechanism.
 */

/* Phases */

/**
 * What the loop is doing, as one value.
 *
 * The UI renders exactly one of these, which is why it is a phase and not a
 * handful of booleans: "recording" and "the bot is talking" are mutually
 * exclusive states of one conversation, and a surface that derives them
 * separately can paint both at once.
 */
export const VoiceChatPhases = {
  /** Mode is off. */
  OFF: 'off',
  /** Opening the microphone (the permission prompt may be up). */
  STARTING: 'starting',
  /** Microphone open, nobody talking — waiting for the user to begin. */
  LISTENING: 'listening',
  /** The user is talking; their utterance is being recorded. */
  CAPTURING: 'capturing',
  /** They stopped; the utterance is being transcribed. */
  TRANSCRIBING: 'transcribing',
  /** The transcript was posted; planka_bot is working on the answer. */
  THINKING: 'thinking',
  /** The answer is being read aloud. */
  SPEAKING: 'speaking',
  /** The loop cannot run — no microphone, permission refused, feature off. */
  BLOCKED: 'blocked',
};

/**
 * Why a loop stopped, or would not start. Separate from the phase because a
 * phase says what is happening and this says what to tell the user about a
 * mode that has just turned itself off.
 */
export const VoiceChatStopReasons = {
  PERMISSION_DENIED: 'permission-denied',
  NO_MICROPHONE: 'no-microphone',
  UNSUPPORTED: 'unsupported',
  DISABLED: 'disabled',
  /** The AudioContext would not leave `suspended`. The mode remembers itself
   * across a reload and re-opens the microphone with no user gesture, and a
   * browser's autoplay policy answers that by handing back frames of zeroes —
   * which reads as a very quiet room, not as a failure, so the loop would show
   * "Listening" with the microphone light on and never hear anything. */
  AUDIO_SUSPENDED: 'audio-suspended',
  /** There is no voice to answer with: the server has no text-to-speech, or it
   * had one when the bootstrap was read and answered 503 later. The mode stops
   * rather than degrading into a one-way conversation. */
  NO_VOICE: 'no-voice',
  FAILED: 'failed',
};

/* The tuning */

/**
 * The tuning of the loop, in one object so the tests and the hook read the same
 * numbers and a reviewer can see them together.
 *
 * `silenceHangoverMs` is the one that decides when a turn is sent. The rest
 * exist to stop the loop firing on things that are not a turn:
 *
 * - `minSpeechMs` — a door, a cough and a keyboard are all loud and short. An
 *   utterance has to hold the microphone for this long before it counts as the
 *   user talking at all, which is also what keeps a stray click from opening a
 *   turn that then sits open until the hangover expires.
 * - `maxUtteranceMs` — the sentence that never ends. Someone reading a list
 *   aloud may not pause for a full second, and transcription is billed per
 *   audio minute, so an utterance is force-ended here rather than growing until
 *   the server's own duration cap refuses it.
 * - `idleRestartMs` — how long a silent recording may run before it is thrown
 *   away and restarted. Nothing is sent from it; it bounds how much silence
 *   rides in front of the speech that eventually arrives, without ever cutting
 *   into speech, because the restart only happens after this long with no voice
 *   at all.
 * - `speechMarginDb` / `absoluteFloorDb` — the activation threshold, expressed
 *   relative to the measured noise floor rather than as a fixed level, because
 *   a laptop fan, an open-plan office and a quiet room are 25 dB apart and a
 *   fixed threshold works in exactly one of them. The absolute floor is the
 *   bound the adaptation cannot cross: without it a perfectly silent room
 *   drives the floor down until the microphone's own hiss reads as speech.
 * - `speechDecayRate` — how fast credited speech is given back during the
 *   silence between words, as a fraction of the rate it is credited at. It
 *   exists because `minSpeechMs` cannot mean an UNBROKEN above-threshold run,
 *   which ordinary speech is not: words run ~200 ms with 50-300 ms between
 *   them, so any rule that ends the run on a gap means a person talking
 *   normally never opens a turn at all.
 * - `maxFrameGapMs` — see `vadStep`: a browser that stopped delivering frames
 *   must not have the gap counted as silence.
 * - `floorWindowMs` / `floorFallRate` / `floorRiseRate` /
 *   `utteranceFloorRiseRate` — how the noise floor tracks the room. See the
 *   floor section of `vadStep`. The three rates are PER FRAME of
 *   `frameIntervalMs`, so reading one without the other says nothing about how
 *   fast the floor actually moves.
 * - `frameIntervalMs` — how often the browser half samples the microphone. The
 *   gap rule and the adaptation rates are expressed against it.
 *
 * The trailing-silence window is not invented: Deepgram documents >= 1000 ms as
 * the usable range for utterance-end detection and ~1.25 s as a common
 * turn-taking choice (https://developers.deepgram.com/docs/utterance-end), and
 * 1000 ms is the bottom of that range — the fastest turn-taking that still lets
 * someone draw breath mid-sentence. The floor window is Martin's
 * minimum-statistics observation window (IEEE TSAP 9(5), 2001).
 */
export const VOICE_CHAT_TUNING = Object.freeze({
  silenceHangoverMs: 1000,
  minSpeechMs: 300,
  // A quarter of the rate speech is credited at, so a run survives a gap up to
  // four times the length of the words around it. Slower than this and rhythmic
  // noise starts to accumulate; faster and the boundary walks back into
  // ordinary deliberate speech, which at 120 words a minute leaves ~300 ms
  // between words.
  speechDecayRate: 0.25,
  maxUtteranceMs: 45000,
  idleRestartMs: 4000,
  speechMarginDb: 9,
  absoluteFloorDb: -55,
  maxFrameGapMs: 400,
  floorWindowMs: 1500,
  floorFallRate: 0.2,
  floorRiseRate: 0.02,
  // A quarter of `floorRiseRate`, and it is the knob that decides how long a
  // signal with NO gaps in it may hold a turn open. Long enough for an ordinary
  // sentence whose envelope automatic gain control has flattened, and short
  // enough that a fan costs one bounded upload rather than the 45 s ceiling.
  utteranceFloorRiseRate: 0.005,
  frameIntervalMs: 50,
});

/** How often the browser half samples the microphone, in ms. Exported so the
 * gap rule and the sampler cannot drift apart. */
export const VOICE_FRAME_INTERVAL_MS = VOICE_CHAT_TUNING.frameIntervalMs;

/**
 * Microphone constraints for voice chat.
 *
 * All three are asked for by name rather than left to the browser. Echo
 * cancellation is the one that matters even in a half-duplex loop: the answer
 * plays through this same page, and a microphone that hears it drags the noise
 * floor up for the whole of the answer — which is "the first thing I say after
 * it answers is always ignored".
 */
export const VOICE_CHAT_AUDIO_CONSTRAINTS = Object.freeze({
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
});

/**
 * The bitrate the recorder is asked for.
 *
 * Not a quality preference — a hard constraint of the transport. An utterance
 * travels base64-encoded inside a JSON body, and the body parser in front of
 * every PLANKA route admits 1 MB, so a 45-second recording has to fit in about
 * 700 KB before encoding. Opus at 32 kbit/s is transparent for speech and puts
 * the ceiling at ~180 KB; left to itself Chrome would record at 128 kbit/s and
 * a long utterance would be refused. Browsers that ignore the option are still
 * bounded, by the size check the caller makes before uploading.
 */
export const RECORDER_AUDIO_BITS_PER_SECOND = 32000;

/* Levels */

/** Digital silence, clamped. The callers do arithmetic with this value and
 * -Infinity poisons an average. */
export const SILENCE_DBFS = -100;

/**
 * RMS level of one frame of samples, in dBFS.
 *
 * Digital full scale is 0 dB and everything real is below it.
 */
export const frameLevelDb = (samples) => {
  if (!samples || samples.length === 0) {
    return SILENCE_DBFS;
  }

  let sum = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    sum += sample * sample;
  }

  const rms = Math.sqrt(sum / samples.length);

  // `!(rms > 0)` rather than `rms <= 0` so a NaN sample — an analyser buffer
  // that was never filled reads as NaN in some browsers — is silence rather
  // than a NaN level. NaN would poison the noise floor permanently: every
  // comparison against it is false, so `db > threshold` would be false for ever
  // and the microphone would go quietly deaf until the panel remounted.
  if (!(rms > 0)) {
    return SILENCE_DBFS;
  }

  return Math.max(SILENCE_DBFS, 20 * Math.log10(rms));
};

/* The detector */

/** What one frame told us, if anything. */
export const VadEvents = {
  /** The user has been talking for `minSpeechMs`; an utterance is open. The
   * recorder is already running, so this is a UI event, not the start of the
   * capture. */
  SPEECH_START: 'speech-start',
  /** `silenceHangoverMs` of quiet since the last voice frame. This is the
   * send. */
  UTTERANCE_END: 'utterance-end',
  /** The same, forced by `maxUtteranceMs`. Sent exactly like an ordinary end;
   * the distinction is for the caller's copy. */
  UTTERANCE_TOO_LONG: 'utterance-too-long',
  /** Nothing has been said for `idleRestartMs` and no utterance is open, so the
   * silence recorded so far is worth discarding. */
  IDLE_RESTART: 'idle-restart',
};

/** The tracker's whole memory. Created by `newVadState`, advanced by
 * `vadStep`. */
export const newVadState = (atMs = 0) => ({
  // Started at the absolute floor rather than at -100: a first frame of real
  // speech would otherwise drag a -100 floor up so slowly that the threshold
  // sat below the room for several seconds.
  noiseFloorDb: VOICE_CHAT_TUNING.absoluteFloorDb,
  /** When the current run of speech began, or null. A run survives the gaps
   * between words — see `voicedMs`. */
  speechRunStartedAt: null,
  /** How much of the current run was actually above threshold, in ms: credited
   * one frame at a time while the level is up and given back at
   * `speechDecayRate` while it is down. This, not elapsed time, is what
   * `minSpeechMs` is measured against. */
  voicedMs: 0,
  /** When the current utterance was declared, or null when none is open. */
  utteranceStartedAt: null,
  /** The last frame that was above threshold, or null. */
  lastVoiceAt: null,
  /** The last frame seen at all, for the gap rule. */
  lastFrameAt: null,
  /** When the current silent stretch began — the idle-restart clock. */
  silentSinceAt: atMs,
  // Null, not SILENCE_DBFS: the first frame IS the window's minimum. Seeding it
  // with digital silence would pin the floor's target at -100 for the whole
  // first window, and a room that is already noisy when the mode comes on would
  // get a turn opened on it before the floor could move.
  windowMinDb: null,
  /** The same for the window before it, so the floor remembers a quiet moment
   * for between one and two `floorWindowMs`. */
  prevWindowMinDb: null,
  windowStartedAt: atMs,
});

const endUtterance = (state, atMs) => ({
  ...state,
  speechRunStartedAt: null,
  voicedMs: 0,
  utteranceStartedAt: null,
  lastVoiceAt: null,
  silentSinceAt: atMs,
});

/**
 * Advance the tracker by one frame.
 *
 * Pure: same state and frame in, same state and event out, so the whole
 * endpointing contract is a table test rather than something you can only meet
 * by talking at a laptop.
 *
 * Three rules here are less obvious than the thresholds.
 *
 * **The gap rule.** Browsers throttle timers in a background tab — Chrome to
 * roughly one tick a second — and the sampler only ever sees the last ~40 ms of
 * audio per tick. Counting the unobserved time as silence would end the
 * utterance of anyone who tabbed away mid-sentence, and would do it with a
 * transcript containing the first fifth of what they said. So a frame that
 * arrives more than `maxFrameGapMs` after the previous one moves the silence
 * clocks forward by the part of the gap NOBODY MEASURED — the delta less the one
 * frame's worth of audio this tick did carry. Crediting the whole delta instead
 * would be a livelock: at any steady tick period above the threshold every clock
 * would shift by exactly the delta, elapsed time would be pinned at zero, and a
 * turn opened before the tab was hidden would never end at all.
 * `utteranceStartedAt` is deliberately NOT shifted, so the `maxUtteranceMs`
 * ceiling keeps its meaning in real time and a hidden tab cannot buffer an
 * unbounded recording.
 *
 * **The noise floor tracks the QUIETEST thing heard recently**, not the loudest
 * and not an average: it moves toward the minimum level of the last one to two
 * `floorWindowMs`, quickly (`floorFallRate`) when that minimum is below it and
 * slowly (`floorRiseRate`) when it is above. That one rule does both jobs the
 * floor has. Speech is not a level, it is a level with gaps in it — the quiet
 * between words is tens of dB below the peaks — so a sentence pulls the floor
 * toward its own gaps rather than up over the speaker's voice. A fan, an air
 * conditioner or a room tone has no gaps: its minimum IS its level, so the floor
 * climbs to it and the threshold with it, and the noise stops reading as speech
 * instead of holding a turn open until the ceiling force-ends it. It may only
 * FALL while the loop is disarmed: what the microphone is hearing then is the
 * answer being read aloud, and letting leaked playback raise the bar is how a
 * loop goes deaf to the user for the whole of the turn after an answer.
 *
 * The one thing that rule CANNOT do is tell a fan from a voice with no gaps in
 * it, because at the same level they are the same signal. So while an utterance
 * is open the floor rises at `utteranceFloorRiseRate` instead, which is what
 * decides how long a gapless level may hold a turn open.
 *
 * **Speech is credited, not timed.** `minSpeechMs` is measured against
 * `voicedMs` — one frame added per above-threshold frame, `speechDecayRate` of
 * a frame given back per frame below it — rather than against the age of an
 * unbroken run. Any rule that ENDS the run on a gap has a cliff at whatever gap
 * it tolerates, and ordinary speech lives on both sides of every value that
 * cliff can take. A decay degrades instead: a longer gap means a later turn
 * rather than no turn.
 */
export const vadStep = (state, frame, options) => {
  const tuning = (options && options.tuning) || VOICE_CHAT_TUNING;
  const armed = !!(options && options.armed);
  const { db, atMs } = frame;

  // The UNOBSERVED part of the gap, if any. This tick did carry one frame's
  // worth of audio, so that much of the delta was measured and is not shifted
  // away — which is also what stops a steadily throttled tab from pinning every
  // elapsed time at zero for ever.
  const delta = state.lastFrameAt === null ? 0 : atMs - state.lastFrameAt;
  const gap = delta > tuning.maxFrameGapMs ? Math.max(0, delta - tuning.frameIntervalMs) : 0;
  const shift = (time) => (time === null ? null : time + gap);

  const next = {
    ...state,
    lastFrameAt: atMs,
    speechRunStartedAt: shift(state.speechRunStartedAt),
    // NOT shifted, unlike every other clock here: the ceiling is a bound on how
    // much audio one utterance may buffer and upload, and audio nobody measured
    // is still audio the recorder kept.
    utteranceStartedAt: state.utteranceStartedAt,
    lastVoiceAt: shift(state.lastVoiceAt),
    // The very first frame starts the idle clock wherever it lands, so a
    // tracker built before the microphone opened does not report a restart on
    // its first look at the room.
    silentSinceAt: state.lastFrameAt === null ? atMs : shift(state.silentSinceAt),
    windowStartedAt: state.lastFrameAt === null ? atMs : shift(state.windowStartedAt),
  };

  // Two sub-windows of minima, and the floor moves toward the lower of them.
  // Two rather than one so that a window boundary landing mid-syllable cannot
  // briefly make a speech peak the "quietest recent frame".
  if (next.windowStartedAt === null || atMs - next.windowStartedAt >= tuning.floorWindowMs) {
    next.prevWindowMinDb = next.windowMinDb;
    next.windowMinDb = db;
    next.windowStartedAt = atMs;
  } else {
    next.windowMinDb = next.windowMinDb === null ? db : Math.min(next.windowMinDb, db);
  }

  const windowMinDb = next.windowMinDb === null ? db : next.windowMinDb;
  const quietestRecentDb =
    next.prevWindowMinDb === null ? windowMinDb : Math.min(windowMinDb, next.prevWindowMinDb);

  // The activation test. The floor is already clamped at absoluteFloorDb, so
  // floor + margin is also the lowest threshold the loop can ever use.
  const threshold = next.noiseFloorDb + tuning.speechMarginDb;
  const voice = db > threshold;

  const towardQuietest = quietestRecentDb - next.noiseFloorDb;

  if (towardQuietest < 0) {
    next.noiseFloorDb += tuning.floorFallRate * towardQuietest;
  } else if (armed) {
    // Slower while a turn is open. `next.utteranceStartedAt` is still the state
    // this frame STARTED in, which is what is wanted: the frame that opens a
    // turn was measured against the idle rate like every frame before it.
    next.noiseFloorDb +=
      (next.utteranceStartedAt === null ? tuning.floorRiseRate : tuning.utteranceFloorRiseRate) *
      towardQuietest;
  }

  next.noiseFloorDb = Math.max(tuning.absoluteFloorDb, next.noiseFloorDb);

  if (!armed) {
    // Disarmed: the floor above may still have FALLEN (a room that went quiet
    // while the answer played is tracked; one that got louder is not), and
    // everything else is reset so that re-arming starts from a clean silence
    // rather than from half an utterance measured while the microphone was not
    // ours to read.
    next.speechRunStartedAt = null;
    next.voicedMs = 0;
    next.utteranceStartedAt = null;
    next.lastVoiceAt = null;
    next.silentSinceAt = atMs;

    return { state: next, event: null, voice };
  }

  if (voice) {
    next.lastVoiceAt = atMs;
    next.silentSinceAt = null;

    if (next.speechRunStartedAt === null) {
      // The run starts here with nothing credited to it, so an unbroken run
      // still declares a turn exactly `minSpeechMs` after its first frame.
      next.speechRunStartedAt = atMs;
      next.voicedMs = 0;
    } else {
      // One frame's worth, never the whole delta: a throttled tab delivers one
      // tick an hour and still only heard 50 ms of audio in it.
      next.voicedMs = Math.min(tuning.minSpeechMs, next.voicedMs + tuning.frameIntervalMs);
    }

    if (next.utteranceStartedAt === null && next.voicedMs >= tuning.minSpeechMs) {
      next.utteranceStartedAt = next.speechRunStartedAt;

      return { state: next, event: VadEvents.SPEECH_START, voice };
    }
  } else {
    // A run of loud frames that never adds up to minSpeech was a noise, not a
    // turn — but the run is given up gradually, not on the first quiet frame.
    if (next.speechRunStartedAt !== null) {
      next.voicedMs -= tuning.speechDecayRate * tuning.frameIntervalMs;

      if (next.voicedMs <= 0) {
        next.voicedMs = 0;
        next.speechRunStartedAt = null;
      }
    }

    if (next.silentSinceAt === null) {
      next.silentSinceAt = atMs;
    }

    if (
      next.utteranceStartedAt !== null &&
      next.lastVoiceAt !== null &&
      atMs - next.lastVoiceAt >= tuning.silenceHangoverMs
    ) {
      return { state: endUtterance(next, atMs), event: VadEvents.UTTERANCE_END, voice };
    }
  }

  if (next.utteranceStartedAt !== null && atMs - next.utteranceStartedAt >= tuning.maxUtteranceMs) {
    return { state: endUtterance(next, atMs), event: VadEvents.UTTERANCE_TOO_LONG, voice };
  }

  if (
    next.utteranceStartedAt === null &&
    next.silentSinceAt !== null &&
    atMs - next.silentSinceAt >= tuning.idleRestartMs
  ) {
    next.silentSinceAt = atMs;

    return { state: next, event: VadEvents.IDLE_RESTART, voice };
  }

  return { state: next, event: null, voice };
};

/**
 * Whether a transcript is worth sending.
 *
 * A provider answers a burst of noise with an empty string or with punctuation
 * ("."), and a turn made of that would be a comment the user did not write, an
 * answer they did not ask for, and a whole agent session spent on it. At least
 * one letter or digit is the bar.
 */
export const isSendableTranscript = (text) => /[\p{L}\p{N}]/u.test(text || '');

/* Recording */

/**
 * MediaRecorder container candidates, best first.
 *
 * Opus in WebM is what Chrome and Edge produce and what the server's allowlist
 * is written around; Firefox answers to the ogg entries; Safari only ever
 * supports mp4. The bare `audio/webm` / `audio/ogg` entries are there because
 * some builds report the codec-less string as supported and the parameterised
 * one as not.
 *
 * Every entry's base type must be on the server's allowlist
 * (server/utils/voice.js) — a container we can record but not upload is worse
 * than one we never picked.
 */
export const RECORDER_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
];

/**
 * The first candidate this browser can actually record.
 *
 * Returns null when MediaRecorder exists but supports none of them, and '' when
 * it cannot tell us (no `isTypeSupported`): '' means "let the browser choose",
 * which is legal for MediaRecorder and leaves the real type to be read off the
 * blob afterwards.
 */
export const pickRecorderMimeType = (recorder) => {
  if (!recorder) {
    return null;
  }

  if (typeof recorder.isTypeSupported !== 'function') {
    return '';
  }

  return RECORDER_MIME_CANDIDATES.find((candidate) => recorder.isTypeSupported(candidate)) ?? null;
};

/**
 * Whether this browser can record at all: both `getUserMedia` and
 * `MediaRecorder`, and a container we could upload.
 *
 * getUserMedia is absent on an insecure origin (non-localhost http), which is
 * the common way this comes back false in practice.
 */
export const isRecordingSupported = (environment) => {
  if (!environment) {
    return false;
  }

  const { navigator: environmentNavigator, MediaRecorder } = environment;

  if (
    !environmentNavigator ||
    !environmentNavigator.mediaDevices ||
    typeof environmentNavigator.mediaDevices.getUserMedia !== 'function'
  ) {
    return false;
  }

  if (!MediaRecorder) {
    return false;
  }

  return pickRecorderMimeType(MediaRecorder) !== null;
};

/**
 * The content type to upload a recording with.
 *
 * The blob's own type is authoritative — the browser may have recorded a
 * different container from the one we asked for — and the type we requested is
 * the fallback for browsers that leave `Blob.type` empty. With neither we send
 * nothing and let the request fail cleanly rather than mislabelling audio the
 * server would then bill a provider call on.
 */
export const uploadContentType = (blobType, requestedType) =>
  (blobType || requestedType || '').trim();

/* Reading a message aloud */

/**
 * The length the SERVER will measure, which is not `text.length`.
 *
 * A JS string length counts UTF-16 code units, so anything outside the BMP — an
 * emoji in a reply — counts twice there and once on the server. Spreading the
 * string iterates code points, which is the same unit the server counts (see
 * server/utils/voice.js `speechTextLength`).
 */
export const speechTextLength = (text) => [...(text || '')].length;

/** Whether a message can be spoken, and why not when it cannot. */
export const SpeakAvailabilities = {
  /** No control at all: reading aloud is off, or there is nothing to speak. */
  HIDDEN: 'hidden',
  READY: 'ready',
  /** Rendered but refused: the server would answer 422, and finding that out by
   * pressing play is worse than being told up front. */
  TOO_LONG: 'too-long',
};

export const speakAvailability = (text, capability) => {
  if (!capability || !capability.ttsEnabled) {
    return SpeakAvailabilities.HIDDEN;
  }

  if ((text || '').trim() === '') {
    return SpeakAvailabilities.HIDDEN;
  }

  const maxChars = capability.ttsMaxChars;

  if (typeof maxChars === 'number' && maxChars > 0 && speechTextLength(text) > maxChars) {
    return SpeakAvailabilities.TOO_LONG;
  }

  return SpeakAvailabilities.READY;
};

/* The phase */

/**
 * The one value the UI renders, from everything the loop knows.
 *
 * The order is a precedence, and it is the whole of the rule that stops two
 * states being painted at once: `speaking` outranks `capturing` because a
 * half-duplex loop cannot be doing both, and `capturing` outranks `thinking`
 * because the microphone stays armed through the gap between sending a
 * transcript and the answer arriving — a screen that said "thinking" there
 * would be recording someone while telling them nothing is listening.
 */
export const voiceChatPhase = ({
  isEnabled,
  isAvailable,
  isMicReady,
  isSpeaking,
  isWaitingForReply,
  isTranscribing,
  isCapturing,
}) => {
  if (!isEnabled) {
    return VoiceChatPhases.OFF;
  }

  if (!isAvailable) {
    return VoiceChatPhases.BLOCKED;
  }

  if (isSpeaking) {
    return VoiceChatPhases.SPEAKING;
  }

  if (isCapturing) {
    return VoiceChatPhases.CAPTURING;
  }

  if (isTranscribing) {
    return VoiceChatPhases.TRANSCRIBING;
  }

  if (isWaitingForReply) {
    return VoiceChatPhases.THINKING;
  }

  if (!isMicReady) {
    return VoiceChatPhases.STARTING;
  }

  return VoiceChatPhases.LISTENING;
};

/* The preference */

/** Where the on/off preference is remembered. Per browser rather than per user:
 * it is a preference about this device's microphone. */
export const VOICE_CHAT_KEY = 'planka-bot-chat-voice';

/** Whether voice chat was left on. False for a storage the browser refuses
 * (private mode, blocked cookies), which is the safe default — a mode that
 * opens a microphone must never turn itself on by accident. */
export const readVoiceChatEnabled = (storage) => {
  try {
    return storage.getItem(VOICE_CHAT_KEY) === 'true';
  } catch {
    return false;
  }
};

export const writeVoiceChatEnabled = (storage, isEnabled) => {
  try {
    if (isEnabled) {
      storage.setItem(VOICE_CHAT_KEY, 'true');
    } else {
      storage.removeItem(VOICE_CHAT_KEY);
    }
  } catch {
    // Storage blocked — the mode is remembered for this session only.
  }
};

/* Copy */

/** MB/KB for a byte count, for user-facing copy only. Matches the server's own
 * `formatBytes`, so the two halves of an oversize message agree. */
export const formatBytes = (bytes) => {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${bytes} bytes`;
};

/**
 * What a stopped mode tells the user, as i18n keys rather than sentences.
 *
 * Separate copy from a one-off failure's, because the advice differs: a button
 * that failed ends with "try again", which the user does by pressing the button
 * they are already looking at. These have turned the whole mode off, so the
 * sentence has to say that. A denied permission gets instructions rather than
 * an apology — the browser will not ask again on its own, so "try again" is
 * useless advice and the user has to find the site settings themselves.
 */
export const VOICE_CHAT_STOP_REASON_KEYS = Object.freeze({
  [VoiceChatStopReasons.PERMISSION_DENIED]: 'common.voiceChatMicrophoneBlocked',
  [VoiceChatStopReasons.NO_MICROPHONE]: 'common.voiceChatNoMicrophone',
  [VoiceChatStopReasons.UNSUPPORTED]: 'common.voiceChatNotSupported',
  [VoiceChatStopReasons.DISABLED]: 'common.voiceChatNotAvailable',
  [VoiceChatStopReasons.AUDIO_SUSPENDED]: 'common.voiceChatAudioBlocked',
  [VoiceChatStopReasons.NO_VOICE]: 'common.voiceChatNoVoice',
  [VoiceChatStopReasons.FAILED]: 'common.voiceChatFailed',
});

/**
 * The i18n key for a microphone the browser would not open.
 *
 * A denied permission gets instructions rather than an apology: the browser
 * will not ask again on its own, so "try again" is useless advice and the user
 * has to find the site settings themselves — which is why this maps onto a
 * reason and not onto one message.
 */
export const microphoneStopReason = (error) => {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';

  if (['NotAllowedError', 'SecurityError', 'PermissionDeniedError'].includes(name)) {
    return VoiceChatStopReasons.PERMISSION_DENIED;
  }

  if (['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError'].includes(name)) {
    return VoiceChatStopReasons.NO_MICROPHONE;
  }

  return VoiceChatStopReasons.FAILED;
};
