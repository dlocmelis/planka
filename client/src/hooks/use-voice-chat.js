/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * Voice chat mode for the planka_bot panel: the browser half.
 *
 * Everything with a side effect — the microphone, the Web Audio analyser, the
 * MediaRecorder, the two network calls and the `<audio>` element — and
 * deliberately no arithmetic: every decision about whether someone is talking,
 * has stopped, or may be heard at all lives in `utils/voice-chat.js`, where a
 * test can drive it frame by frame. This file only carries them out.
 *
 * Ported in shape from setl-web's `lib/assistant/useVoiceChat.ts` (the sampler,
 * the recorder lifecycle, the generation guard) and `lib/assistant/
 * useServerSpeaker.ts` (playback, and stopping it aborting the request). The
 * loop is half-duplex here — see the header of `utils/voice-chat.js` for why —
 * so there is no barge-in path and no echo-suppression subsystem.
 *
 * The loop, once around:
 *
 *   listening → (300 ms of voice) capturing → (1 s of silence) transcribing
 *             → the transcript is posted as a comment → thinking
 *             → the reply arrives over the board socket → speaking → listening
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// The voice module directly rather than the `api` barrel: that barrel pulls in
// `api/socket.js`, which reads `import.meta.env` and cannot be loaded by jest —
// so importing it here would take every test that touches `hooks/index.js` down
// with it.
import voiceApi, { bytesToBase64, base64ToBlob } from '../api/voice';
import {
  RECORDER_AUDIO_BITS_PER_SECOND,
  VOICE_CHAT_AUDIO_CONSTRAINTS,
  VOICE_FRAME_INTERVAL_MS,
  RecordingAvailabilities,
  SpeakAvailabilities,
  VadEvents,
  VoiceChatStopReasons,
  formatBytes,
  formatSeconds,
  frameLevelDb,
  isRateLimited,
  isRecordingSupported,
  isRefusal,
  isSendableTranscript,
  microphoneStopReason,
  newVadState,
  pickRecorderMimeType,
  rateLimitCooldownMs,
  recordingAvailability,
  recordingLimitMs,
  requestStopReason,
  sameLanguage,
  speakAvailability,
  uploadContentType,
  vadStep,
  voiceChatTuning,
} from '../utils/voice-chat';

/**
 * How long to wait for `MediaRecorder.stop()` to deliver its final chunk before
 * giving up on the utterance.
 *
 * Two seconds is far past any real recorder — `stop()` delivers synchronously
 * in every engine — but a recorder whose `onstop` never fires would otherwise
 * leave the loop stuck in `transcribing` for ever, with the microphone open and
 * nothing on screen able to move it on.
 */
const RECORDER_STOP_DEADLINE_MS = 2000;

/**
 * The controller for one turn of speech — one bot answer being fetched and read
 * out — and the answer to "who owns the speaker right now".
 *
 * A turn outlives the run that started it: the run parks inside `await` while
 * the request is in flight and again while the clip plays, and at either point
 * the turn can be revoked by something else entirely — the Stop button, the
 * panel closing, the conversation moving to another card. Everything that must
 * be undone when that happens is held HERE, on the turn, rather than in a ref
 * shared by every run: the request, the object URL, and the promise the run is
 * parked on. That is what makes revoking one turn incapable of cancelling the
 * request, revoking the URL, or resolving the playback of the turn that
 * replaced it.
 *
 * `cancel` answers whether it was this call that cancelled, so that the several
 * places which may revoke the same turn do their share of the work exactly
 * once.
 */
const newSpeechTurn = (messageId) => {
  const abortController = new AbortController();

  let isCancelled = false;
  let audioUrl = null;
  let resolvePlayback = null;

  const releaseAudioUrl = () => {
    if (audioUrl !== null) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = null;
    }
  };

  // The promise the run awaits while the clip plays. Its only other resolvers
  // are the audio element's `onended` and `onerror`, and a cancelled turn takes
  // both away — so without this a stopped answer would leave one pending
  // promise and its whole closure behind, once per Stop press.
  const settlePlayback = () => {
    if (resolvePlayback !== null) {
      const resolve = resolvePlayback;
      resolvePlayback = null;
      resolve();
    }
  };

  return {
    messageId,
    signal: abortController.signal,
    isCancelled: () => isCancelled,
    holdAudioUrl: (url) => {
      audioUrl = url;
    },
    holdPlayback: (resolve) => {
      resolvePlayback = resolve;
    },
    releaseAudioUrl,
    cancel: () => {
      if (isCancelled) {
        return false;
      }

      isCancelled = true;
      // The request itself, not merely its result: synthesis is billed per
      // character, so a turn nobody will hear stops costing money now rather
      // than when its audio arrives and is thrown away.
      abortController.abort();
      settlePlayback();
      releaseAudioUrl();

      return true;
    },
  };
};

/** The `AudioContext` constructor, or null. Safari exposed only the prefixed
 * one until 14.1 and still exposes it. */
const audioContextClass = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.AudioContext || window.webkitAudioContext || null;
};

export default function useVoiceChat({
  isEnabled,
  cardId,
  capability,
  canComment,
  accessToken,
  pendingSpeech,
  onTranscript,
  onSpoken,
  onNotice,
  onStop,
}) {
  const [isMicReady, setIsMicReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const frameBufferRef = useRef(null);
  const tickRef = useRef(null);
  const recorderRef = useRef(null);
  const recorderChunksRef = useRef([]);
  const recorderMimeRef = useRef('');
  // When the running recorder was started, so the length of what it holds is a
  // measurement rather than a guess. The VAD bounds the UTTERANCE; a recording
  // is that plus however much silence was in front of it, and the server's
  // ceiling is on the recording.
  const recorderStartedAtRef = useRef(null);
  const vadRef = useRef(null);
  const isUploadingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isCapturingRef = useRef(false);
  const audioRef = useRef(null);
  // The turn that currently OWNS the speaker: the synthesis in flight, the clip
  // playing, and the shared state both of them write.
  //
  // It exists because a turn can be revoked at any await point — the Stop
  // button, the panel closing, the conversation moving to another card — and
  // the run that was revoked is still there, parked inside an `await`, about to
  // write into refs that may by then belong to the turn that replaced it. Every
  // write below therefore goes through `isSpeechTurnOwner`, and the two things
  // that outlive a revoked turn (the request and the object URL) belong to the
  // turn rather than to the hook, so cancelling one cannot cancel the other's.
  //
  // The microphone loop has had exactly this since it was written, in
  // `generationRef`/`isCurrent`; this is the same idea for the speaker.
  const speechTurnRef = useRef(null);
  // Bumped whenever the microphone is torn down, so an upload or a playback
  // that was in flight when the mode was switched off cannot write state back
  // into a loop that no longer exists.
  const generationRef = useRef(0);
  // The upload in flight, so a mode that is switched off stops paying for the
  // recording it will never read the transcript of.
  const uploadAbortRef = useRef(null);
  const isMountedRef = useRef(true);
  // The voice the server picked for this conversation, sent back on the next
  // message so a conversation is read in one voice rather than resolving a new
  // one per reply. Null until the server has actually DECIDED — a voice with no
  // language beside it is the deployment's default answering "I could not
  // tell", and pinning that is how one undetectable reply fixes the wrong voice
  // onto everything after it.
  const voicePinRef = useRef(null);
  // The language the last utterance was transcribed as. See `transcribe`.
  const heardLanguageRef = useRef(null);
  // When the server will next accept a recording from this user, after it has
  // said they have had their share of the deployment's transcription budget for
  // now. Deliberately NOT cleared when the mode is toggled or the conversation
  // moves: the budget belongs to the user and the server, not to this loop, and
  // forgetting it would just mean uploading a megabyte to be told again.
  const rateLimitedUntilRef = useRef(0);

  const onTranscriptRef = useRef(onTranscript);
  const onSpokenRef = useRef(onSpoken);
  const onNoticeRef = useRef(onNotice);
  const onStopRef = useRef(onStop);
  const capabilityRef = useRef(capability);
  // The deployment's own ceiling folded into the tuning, in a ref rather than in
  // the sampler effect's dependencies: a bootstrap that arrives late must not
  // tear the microphone down and reopen it.
  const tuningRef = useRef(null);
  const cardIdRef = useRef(cardId);
  // Nothing in this hook goes through the saga layer, which is what normally
  // attaches the bearer token — so it is attached here, from the same place the
  // sagas read it. Without it every request is anonymous and the API answers
  // 401: the `/api/*` middleware reads the Authorization HEADER and never the
  // access-token cookie (that path exists only for /attachments/*).
  const authHeadersRef = useRef(null);

  onTranscriptRef.current = onTranscript;
  onSpokenRef.current = onSpoken;
  onNoticeRef.current = onNotice;
  onStopRef.current = onStop;
  capabilityRef.current = capability;
  tuningRef.current = voiceChatTuning(capability);
  cardIdRef.current = cardId;
  authHeadersRef.current = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  // Both halves, not either: a mode that can hear and not answer is not a
  // conversation, and setl-web stops for exactly this rather than degrading
  // into one. The browser check is last because it is the only one that costs
  // anything to make.
  const isAvailable = !!(
    capability &&
    capability.sttEnabled &&
    capability.ttsEnabled &&
    typeof window !== 'undefined' &&
    isRecordingSupported(window)
  );

  const isCurrent = useCallback(
    (generation) => isMountedRef.current && generationRef.current === generation,
    [],
  );

  /** Whether this run still owns the speaker, and may therefore write the
   * shared state. False from the instant it is revoked — which is any await
   * point, so it is re-asked after every one of them. */
  const isSpeechTurnOwner = useCallback(
    (turn) => isMountedRef.current && !turn.isCancelled() && speechTurnRef.current === turn,
    [],
  );

  /** Silence the element and let go of the clip it decoded. Without `load()` it
   * keeps that clip and a later bare `play()` replays it. */
  const releaseAudioElement = useCallback(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }, []);

  /**
   * Take back everything one speech turn owns: the request, the clip, the
   * object URL, and the promise its run is parked on.
   *
   * Deliberately mechanical — it tells nobody anything. Whether the message
   * counts as spoken differs between the two callers (`stopSpeaking` means the
   * user does not want to hear it; the effect's own cleanup means the turn is
   * being replaced) and is decided there.
   */
  const revokeSpeechTurn = useCallback(
    (turn) => {
      // `cancel` gives up the request, the object URL and the promise the run
      // is parked on — everything that belongs to the turn alone — and answers
      // false if somebody had already done it.
      if (!turn || !turn.cancel()) {
        return;
      }

      // The rest is SHARED, so only the turn that still owns it may touch it: a
      // run revoked after another took the speaker would otherwise silence the
      // clip that replaced its own.
      if (speechTurnRef.current !== turn) {
        return;
      }

      speechTurnRef.current = null;

      releaseAudioElement();

      isSpeakingRef.current = false;
      setIsSpeaking(false);
    },
    [releaseAudioElement],
  );

  /**
   * Stop the answer being read out — the Stop button, and everywhere the
   * conversation itself ends.
   *
   * The message is marked spoken as well as revoked: the user has said they do
   * not want to hear this one, and a `pendingSpeech` that survives the press
   * would be offered again on the very next render.
   */
  const stopSpeaking = useCallback(() => {
    const turn = speechTurnRef.current;

    revokeSpeechTurn(turn);
    // Also for the turn that finished on its own: the element still holds the
    // clip it decoded until something asks it not to.
    releaseAudioElement();

    if (turn && isMountedRef.current) {
      onSpokenRef.current(turn.messageId);
    }
  }, [releaseAudioElement, revokeSpeechTurn]);

  /** Throw away whatever the recorder is holding, handlers first: `stop()`
   * delivers one final `dataavailable`, and a handler still attached would push
   * it into the chunks of the recording that replaces this one. */
  const dropRecorder = useCallback(() => {
    const recorder = recorderRef.current;

    if (!recorder) {
      return;
    }

    recorderRef.current = null;
    recorderStartedAtRef.current = null;
    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.onerror = null;

    try {
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    } catch {
      // Already inactive, or a track that went away underneath it.
    }

    recorderChunksRef.current = [];
  }, []);

  const startRecorder = useCallback(() => {
    const stream = streamRef.current;

    if (!stream) {
      return;
    }

    dropRecorder();

    const mimeType = recorderMimeRef.current;

    let recorder;
    try {
      recorder = new window.MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: RECORDER_AUDIO_BITS_PER_SECOND,
      });
    } catch {
      // A stream whose only track ended — a USB or Bluetooth microphone
      // unplugged — throws here rather than recording silence.
      onStopRef.current(VoiceChatStopReasons.FAILED);
      return;
    }

    const chunks = [];
    recorderChunksRef.current = chunks;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    // A recorder that errors mid-utterance keeps no audio and fires no `onstop`
    // — the VAD would go on crediting speech into a recording that no longer
    // exists, and the turn would be lost with nothing on screen to say so. The
    // usual cause is the device going away, which is not something a fresh
    // recorder recovers from, so the mode stops and says it failed.
    recorder.onerror = () => {
      // A recorder that has already been replaced, or whose utterance is
      // already being uploaded, is not this loop's problem any more.
      if (recorderRef.current !== recorder) {
        return;
      }

      dropRecorder();
      onStopRef.current(VoiceChatStopReasons.FAILED);
    };

    try {
      recorder.start();
    } catch {
      onStopRef.current(VoiceChatStopReasons.FAILED);
      return;
    }

    recorderRef.current = recorder;
    recorderStartedAtRef.current = performance.now();
  }, [dropRecorder]);

  /** Upload one utterance and hand the transcript back. Every early return here
   * is silent on purpose: an empty blob, a burst of noise the provider heard
   * nothing in, and a mode that was switched off mid-upload are all "nothing to
   * say", not failures to report. */
  const transcribe = useCallback(
    async (blob, generation, durationMs) => {
      const capabilityNow = capabilityRef.current;
      const targetCardId = cardIdRef.current;

      if (!blob || blob.size === 0 || !targetCardId) {
        return;
      }

      const mimeType = uploadContentType(blob.type, recorderMimeRef.current);

      if (mimeType === '') {
        return;
      }

      // Checked here rather than discovered as a 422: both of the server's caps
      // are published in the bootstrap precisely so a recording it would refuse
      // costs nothing to refuse. The duration one is the expensive half — the
      // server measures it from what the provider reports, so a recording
      // refused for length up there has already been transcribed and billed.
      //
      // It is SAID, not dropped in silence — a turn that vanished with no
      // explanation is the worst outcome of the three.
      const availability = recordingAvailability(blob.size, durationMs, capabilityNow);

      if (availability === RecordingAvailabilities.TOO_LARGE) {
        onNoticeRef.current('common.voiceChatRecordingTooLarge', {
          size: formatBytes(blob.size),
          limit: formatBytes(capabilityNow.sttMaxBytes),
        });

        return;
      }

      if (availability === RecordingAvailabilities.TOO_LONG) {
        onNoticeRef.current('common.voiceChatRecordingTooLong', {
          duration: formatSeconds(durationMs),
          limit: formatSeconds(recordingLimitMs(capabilityNow)),
        });

        return;
      }

      // The server has already refused a turn from this user and said when it
      // would take the next one. Uploading before then is a megabyte of audio
      // sent for a 429 this loop could have predicted, so the turn is dropped
      // here — and SAID, because a turn that vanished in silence is worse than
      // one that was refused out loud.
      const waitMs = rateLimitedUntilRef.current - Date.now();

      if (waitMs > 0) {
        onNoticeRef.current('common.voiceChatTooManyTurns', {
          seconds: Math.ceil(waitMs / 1000),
        });

        return;
      }

      const abortController = new AbortController();

      isUploadingRef.current = true;
      uploadAbortRef.current = abortController;
      setIsTranscribing(true);

      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());

        if (!isCurrent(generation)) {
          return;
        }

        const { item } = await voiceApi.transcribeVoiceRecording(
          targetCardId,
          {
            data: bytesToBase64(bytes),
            mimeType,
          },
          authHeadersRef.current,
          abortController.signal,
        );

        if (!isCurrent(generation)) {
          return;
        }

        // The language the user was actually heard in. It is what the answer is
        // read back in — and it is the ONLY thing that ever reaches the server's
        // per-language voice resolution, which would otherwise be a whole
        // subsystem no request could reach.
        if (item.languages && item.languages.length > 0) {
          const [heard] = item.languages;
          heardLanguageRef.current = heard;

          // Somebody who has switched language mid-conversation has left the
          // pinned voice behind: it was chosen FOR the language before, and
          // sending it back would have a Russian voice read every English
          // answer from here on. Dropping it asks the server to resolve again.
          const pin = voicePinRef.current;

          if (pin && pin.language && !sameLanguage(pin.language, heard)) {
            voicePinRef.current = null;
          }
        }

        // A provider answers a burst of noise with "" or ".", and a turn made of
        // that would be a comment nobody wrote and a whole agent session spent
        // answering it.
        if (isSendableTranscript(item.text)) {
          onTranscriptRef.current(item.text);
        }
      } catch (error) {
        // Includes this loop's own abort, which rejects with a DOMException
        // rather than an API error: the mode was switched off under the upload,
        // so there is nothing to report and nobody to report it to.
        if (!isCurrent(generation)) {
          return;
        }

        // A 422 is the server refusing THIS recording — a container it will not
        // accept, audio past the duration cap. One turn is lost and the loop
        // says so; turning the mode off over one bad recording would make the
        // user press the button again for something that was never broken.
        if (isRefusal(error)) {
          onNoticeRef.current('common.voiceChatTurnRefused');
          return;
        }

        // A 429 is this user having had their share of what the deployment pays
        // for. Nothing is broken and nothing was wrong with the recording, so
        // the mode stays on — turning it off here would punish somebody for
        // speaking twice quickly, which is worse than having no cap at all —
        // and the microphone simply waits out the window the server named.
        if (isRateLimited(error)) {
          const cooldownMs = rateLimitCooldownMs(error);

          rateLimitedUntilRef.current = Date.now() + cooldownMs;

          // A server that refused without saying when to come back gets copy
          // that does not invent a number — "in 0s" is worse than "in a moment".
          onNoticeRef.current(
            cooldownMs > 0 ? 'common.voiceChatTooManyTurns' : 'common.voiceChatTooManyTurnsSoon',
            { seconds: Math.ceil(cooldownMs / 1000) },
          );

          return;
        }

        // 503 means the feature went away server-side, 502 the provider behind
        // it, 401 a session that is no longer good for anything. Retrying is
        // pointless in all three, and the mode has to stop rather than sit
        // listening at an endpoint that will refuse every utterance.
        onStopRef.current(requestStopReason(error, VoiceChatStopReasons.DISABLED));
      } finally {
        if (uploadAbortRef.current === abortController) {
          uploadAbortRef.current = null;
        }

        // Both inside the guard: `isUploadingRef` is the gate that keeps two
        // utterances from racing for one transcript, and it is SHARED. A stale
        // upload resolving after the mode was toggled off and on again would
        // otherwise disarm the new loop's gate and let a second recording be
        // captured and uploaded alongside the first.
        if (isCurrent(generation)) {
          isUploadingRef.current = false;
          setIsTranscribing(false);
        }
      }
    },
    [isCurrent],
  );

  /** End the open utterance: stop the recorder, wait for its last chunk, upload
   * what it held. */
  const finishUtterance = useCallback(
    (generation) => {
      const recorder = recorderRef.current;

      if (!recorder) {
        return;
      }

      const chunks = recorderChunksRef.current;
      recorderRef.current = null;
      // Read before `startRecorder` below overwrites it. Null only for a
      // recorder nobody timed, which `recordingAvailability` treats as "no
      // measurement" rather than as a refusal.
      const startedAt = recorderStartedAtRef.current;
      recorderStartedAtRef.current = null;

      let isSettled = false;
      let deadlineId = null;

      const settle = () => {
        if (isSettled) {
          return;
        }

        isSettled = true;

        // Or it fires up to `RECORDER_STOP_DEADLINE_MS` after the loop has been
        // torn down and puts a dead loop back into `transcribing`.
        if (deadlineId !== null) {
          clearTimeout(deadlineId);
          deadlineId = null;
        }

        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;

        const blob = new Blob(chunks, { type: recorderMimeRef.current || chunks[0]?.type || '' });
        chunks.length = 0;

        // The loop this utterance belongs to may already be gone — the mode was
        // switched off between `stop()` and its final chunk. There is nowhere
        // to send it, and nothing on screen left to tell about it.
        if (!isCurrent(generation)) {
          return;
        }

        transcribe(blob, generation, startedAt === null ? null : performance.now() - startedAt);

        // The microphone is still open and the room may already be talking
        // again, so a fresh recorder goes in immediately rather than waiting
        // for the transcript.
        startRecorder();
      };

      recorder.onstop = settle;

      try {
        recorder.stop();
      } catch {
        settle();
        return;
      }

      // Armed only if `stop()` has not already delivered: a recorder that never
      // fires `onstop` would otherwise strand the loop in `transcribing`.
      deadlineId = setTimeout(settle, RECORDER_STOP_DEADLINE_MS);
    },
    [isCurrent, startRecorder, transcribe],
  );

  const teardown = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }

    dropRecorder();
    stopSpeaking();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      // A context left open holds the microphone indicator lit on some
      // platforms even after the track has ended.
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    // The transcript would be discarded by the generation guard anyway; this is
    // so the upload stops being paid for at the moment the mode goes off rather
    // than when the provider finishes with a recording nobody will read.
    if (uploadAbortRef.current) {
      uploadAbortRef.current.abort();
      uploadAbortRef.current = null;
    }

    analyserRef.current = null;
    frameBufferRef.current = null;
    vadRef.current = null;
    isUploadingRef.current = false;
    isCapturingRef.current = false;

    // Both belong to the conversation that has just ended — the card changed,
    // the mode went off, the panel closed. A voice chosen for the last thread's
    // language reading the next one's is the same bug as never resolving one at
    // all, and re-resolving costs nothing the server has not already cached.
    voicePinRef.current = null;
    heardLanguageRef.current = null;

    setIsMicReady(false);
    setIsCapturing(false);
    setIsTranscribing(false);
  }, [dropRecorder, stopSpeaking]);

  // The microphone, and the loop that samples it. Restarted only when the mode
  // itself goes on or off, or when the conversation moves to another card — the
  // callbacks are read through refs precisely so a re-rendering parent does not
  // reopen the microphone.
  const isRunnable = !!(isEnabled && isAvailable && cardId && canComment);

  useEffect(() => {
    if (!isRunnable) {
      return undefined;
    }

    generationRef.current += 1;
    const generation = generationRef.current;

    let isDisposed = false;

    const abandon = (stream) => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };

    (async () => {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: VOICE_CHAT_AUDIO_CONSTRAINTS,
        });
      } catch (error) {
        if (!isDisposed && isCurrent(generation)) {
          onStopRef.current(microphoneStopReason(error));
        }

        return;
      }

      if (isDisposed || !isCurrent(generation)) {
        abandon(stream);
        return;
      }

      const AudioContextCtor = audioContextClass();

      if (!AudioContextCtor) {
        abandon(stream);
        onStopRef.current(VoiceChatStopReasons.UNSUPPORTED);
        return;
      }

      let audioContext;
      try {
        audioContext = new AudioContextCtor();
      } catch {
        abandon(stream);
        onStopRef.current(VoiceChatStopReasons.FAILED);
        return;
      }

      if (audioContext.state === 'suspended') {
        // The mode remembers itself across a reload and re-opens the microphone
        // with no user gesture; an autoplay policy answers that by handing back
        // frames of zeroes, which read as a very quiet room rather than as a
        // failure. Ask once, and stop if the answer is no.
        try {
          await audioContext.resume();
        } catch {
          // Handled by the state check below.
        }
      }

      if (isDisposed || !isCurrent(generation)) {
        abandon(stream);
        audioContext.close().catch(() => {});
        return;
      }

      if (audioContext.state === 'suspended') {
        abandon(stream);
        audioContext.close().catch(() => {});
        onStopRef.current(VoiceChatStopReasons.AUDIO_SUSPENDED);
        return;
      }

      let analyser;
      try {
        const source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        // Deliberately NOT connected to the destination: routing the microphone
        // to the speakers is a feedback loop with a volume knob.
      } catch {
        // createMediaStreamSource throws on a stream whose track ended between
        // being granted and reaching this line — a device unplugged in that
        // window.
        abandon(stream);
        audioContext.close().catch(() => {});
        onStopRef.current(VoiceChatStopReasons.FAILED);
        return;
      }

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      frameBufferRef.current = new Float32Array(analyser.fftSize);
      recorderMimeRef.current = pickRecorderMimeType(window.MediaRecorder) || '';
      vadRef.current = newVadState(performance.now());

      // A device going away mid-conversation ends the track and nothing else
      // notices: the analyser keeps handing back frames, they read as silence,
      // and the row says "listening" at a microphone that no longer exists.
      const [track] = stream.getAudioTracks();

      if (track && track.addEventListener) {
        track.addEventListener('ended', () => {
          if (isCurrent(generation)) {
            onStopRef.current(VoiceChatStopReasons.FAILED);
          }
        });
      }

      setIsMicReady(true);
      startRecorder();

      tickRef.current = setInterval(() => {
        const node = analyserRef.current;
        const buffer = frameBufferRef.current;

        if (!node || !buffer || !isCurrent(generation)) {
          return;
        }

        node.getFloatTimeDomainData(buffer);

        // Two things close the loop: the answer being read aloud (this loop is
        // half-duplex — the Stop button is how you interrupt it) and an upload
        // already in flight, which is also what keeps two utterances from
        // racing for one transcript.
        //
        // Waiting for the REPLY is deliberately not a third: a hands-free user
        // who adds something in the gap between sending and the answer arriving
        // means it, and a mode that went deaf there would make them say it
        // twice.
        const armed = !isUploadingRef.current && !isSpeakingRef.current;

        const { state, event } = vadStep(
          vadRef.current,
          { db: frameLevelDb(buffer), atMs: performance.now() },
          // The tuning carries this deployment's own recording ceiling, so a
          // turn ENDS inside it rather than being refused after it has been
          // paid for. See `voiceChatTuning`.
          { armed, tuning: tuningRef.current },
        );

        vadRef.current = state;

        if (!armed) {
          if (isCapturingRef.current) {
            isCapturingRef.current = false;
            setIsCapturing(false);
          }

          // A recorder left running through a spoken answer would hold the
          // whole of it, and nothing in it will ever be uploaded.
          if (recorderRef.current && isSpeakingRef.current) {
            dropRecorder();
          }

          return;
        }

        if (!recorderRef.current) {
          startRecorder();
          return;
        }

        if (event === VadEvents.SPEECH_START) {
          isCapturingRef.current = true;
          setIsCapturing(true);
          return;
        }

        if (event === VadEvents.IDLE_RESTART) {
          // Nothing was said. Throw the silence away rather than uploading it in
          // front of the sentence that eventually comes — transcription is
          // billed by the audio minute.
          startRecorder();
          return;
        }

        if (event === VadEvents.UTTERANCE_END || event === VadEvents.UTTERANCE_TOO_LONG) {
          isCapturingRef.current = false;
          setIsCapturing(false);
          finishUtterance(generation);
        }
      }, VOICE_FRAME_INTERVAL_MS);
    })();

    return () => {
      isDisposed = true;
      generationRef.current += 1;
      teardown();
    };
  }, [isRunnable, isCurrent, dropRecorder, finishUtterance, startRecorder, teardown]);

  // Reading the answer aloud. Driven by the caller handing over one message at
  // a time rather than by the hook watching the thread: which message is new,
  // and whether it has been spoken already, is a question about the
  // conversation and belongs to the panel that owns it.
  //
  // The effect keys on the message's ID and not on the object: the panel builds
  // that object fresh on every render, and this must run once per message
  // rather than once per render.
  const pendingSpeechId = pendingSpeech ? pendingSpeech.id : null;

  useEffect(() => {
    if (!isEnabled || !isAvailable || !pendingSpeech || !cardId) {
      return undefined;
    }

    // Through the ref, and `capability` is deliberately NOT a dependency of this
    // effect. `selectVoiceChatCapability` hands back `bootstrap.voiceChat`, and
    // `reducers/common.js` replaces the whole bootstrap on SOCKET_RECONNECT —
    // so depending on the object would tear this run down and start another one
    // every time the socket blinks: a second billed synthesis, and an answer
    // nobody ever hears. The tuning at the top of this file is read through a
    // ref for exactly the same reason.
    const capabilityNow = capabilityRef.current;

    // A reply the server would refuse for length is not sent at all: the mode
    // says so and carries on listening, rather than spending a round trip on a
    // 422 whose only handler turns the whole loop off.
    if (speakAvailability(pendingSpeech.text, capabilityNow) === SpeakAvailabilities.TOO_LONG) {
      onNoticeRef.current('common.voiceChatAnswerTooLong');
      onSpokenRef.current(pendingSpeech.id);

      return undefined;
    }

    const generation = generationRef.current;

    // This turn, and the moment it takes the speaker. Everything below writes
    // through `isSpeechTurnOwner(turn)` rather than straight into a shared ref:
    // the run can be revoked at any await point, and by then the refs may
    // belong to the turn that replaced it.
    const turn = newSpeechTurn(pendingSpeech.id);

    speechTurnRef.current = turn;

    (async () => {
      isSpeakingRef.current = true;
      setIsSpeaking(true);

      try {
        const pin = voicePinRef.current;

        const { item } = await voiceApi.speakMessage(
          cardId,
          {
            text: pendingSpeech.text,
            // The pin once the server has decided; until then the language the
            // user was last heard in, which is what makes the deployment's
            // per-language voice map reachable at all.
            ...(pin
              ? { voice: pin.voice, language: pin.language }
              : (heardLanguageRef.current && { language: heardLanguageRef.current }) || {}),
          },
          authHeadersRef.current,
          turn.signal,
        );

        if (!isSpeechTurnOwner(turn) || !isCurrent(generation)) {
          return;
        }

        // BOTH, or nothing at all: the server names a voice for every request
        // but a language only when it actually resolved one, and a voice
        // reported without one is the default rather than a decision.
        if (item.voice && item.language) {
          voicePinRef.current = { voice: item.voice, language: item.language };
        }

        const blob = base64ToBlob(item.data, item.mimeType);
        const url = URL.createObjectURL(blob);

        // Asked again around the decode: `base64ToBlob` walks a megabyte of
        // answer, and a URL created after the turn was revoked would be one
        // nothing ever revokes — a leak for the life of the document.
        if (!isSpeechTurnOwner(turn)) {
          URL.revokeObjectURL(url);
          return;
        }

        if (!audioRef.current) {
          // Through `window` rather than the bare global so a test can hand the
          // hook an element whose `play()` resolves — jsdom's does not
          // implement playback at all.
          audioRef.current = new window.Audio();
        }

        const audio = audioRef.current;
        turn.holdAudioUrl(url);
        audio.src = url;

        await new Promise((resolve) => {
          // Held on the turn as well as on the element: revoking the turn takes
          // both handlers away, and they are the only two things that would
          // ever settle this.
          turn.holdPlayback(resolve);
          audio.onended = resolve;
          audio.onerror = resolve;

          Promise.resolve(audio.play()).catch(resolve);
        });
      } catch (error) {
        // A revoked turn's rejection is its own abort — a DOMException, not an
        // API error body — and there is nobody left to tell about it.
        if (!isSpeechTurnOwner(turn) || !isCurrent(generation)) {
          return;
        }

        // A 422 is the server refusing THIS message — a reply that reduces to
        // nothing speakable, which a code block or a bare heading does. It is
        // one answer that cannot be read, not a broken mode, and `finally`
        // marks it spoken so nothing retries it.
        if (isRefusal(error)) {
          onNoticeRef.current('common.voiceChatAnswerRefused');
        } else if (isRateLimited(error)) {
          // The synthesis budget is spent, which is one answer nobody hears
          // rather than a mode that is broken. No cooldown is kept for this
          // half: nothing is uploaded to save, the answer is already on screen,
          // and `finally` marks it spoken so it is not retried for ever.
          onNoticeRef.current('common.voiceChatAnswerNotRead');
        } else {
          onStopRef.current(requestStopReason(error, VoiceChatStopReasons.NO_VOICE));
        }
      } finally {
        // The whole of it under the ownership check. A run that has been
        // revoked owns none of this any more: the URL it would revoke, the
        // `isSpeaking` it would clear and the message it would mark spoken may
        // all belong to the turn that replaced it — and marking spoken is the
        // loudest of the three, because it empties `pendingSpeech` and so makes
        // the replacement's own cleanup cancel IT.
        if (isSpeechTurnOwner(turn)) {
          speechTurnRef.current = null;
          turn.releaseAudioUrl();
          isSpeakingRef.current = false;
          setIsSpeaking(false);

          // Marked spoken whatever happened, including a failure: a message
          // that could not be read must not be retried on the next render for
          // ever.
          onSpokenRef.current(turn.messageId);
        }
      }
    })();

    return () => {
      // Not `stopSpeaking`: this turn is being REPLACED, not refused, so it
      // must not be marked spoken — that would empty `pendingSpeech` and cancel
      // whichever run comes next as well.
      revokeSpeechTurn(turn);
    };
    // `pendingSpeech` itself is read inside but deliberately not a dependency —
    // see `pendingSpeechId` above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isEnabled,
    isAvailable,
    cardId,
    pendingSpeechId,
    isCurrent,
    isSpeechTurnOwner,
    revokeSpeechTurn,
  ]);

  // Whatever was playing belongs to a conversation the user has left.
  useEffect(() => {
    if (!isEnabled) {
      stopSpeaking();
    }
  }, [isEnabled, stopSpeaking]);

  return {
    isAvailable,
    isMicReady,
    isCapturing,
    isTranscribing,
    isSpeaking,
    stopSpeaking,
  };
}
