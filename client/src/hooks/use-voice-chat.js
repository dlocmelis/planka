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
import ErrorCodes from '../constants/ErrorCodes';
import {
  RECORDER_AUDIO_BITS_PER_SECOND,
  VOICE_CHAT_AUDIO_CONSTRAINTS,
  VOICE_FRAME_INTERVAL_MS,
  SpeakAvailabilities,
  VadEvents,
  VoiceChatStopReasons,
  formatBytes,
  frameLevelDb,
  isRecordingSupported,
  isSendableTranscript,
  microphoneStopReason,
  newVadState,
  pickRecorderMimeType,
  speakAvailability,
  uploadContentType,
  vadStep,
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
  const vadRef = useRef(null);
  const isUploadingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isCapturingRef = useRef(false);
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);
  // Bumped whenever the microphone is torn down, so an upload or a playback
  // that was in flight when the mode was switched off cannot write state back
  // into a loop that no longer exists.
  const generationRef = useRef(0);
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

  const onTranscriptRef = useRef(onTranscript);
  const onSpokenRef = useRef(onSpoken);
  const onNoticeRef = useRef(onNotice);
  const onStopRef = useRef(onStop);
  const capabilityRef = useRef(capability);
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

  const stopSpeaking = useCallback(() => {
    const audio = audioRef.current;

    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      // Without load() the element keeps the decoded clip and a later bare
      // play() replays it.
      audio.load();
    }

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }

    isSpeakingRef.current = false;
    setIsSpeaking(false);
  }, []);

  /** Throw away whatever the recorder is holding, handlers first: `stop()`
   * delivers one final `dataavailable`, and a handler still attached would push
   * it into the chunks of the recording that replaces this one. */
  const dropRecorder = useCallback(() => {
    const recorder = recorderRef.current;

    if (!recorder) {
      return;
    }

    recorderRef.current = null;
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

    try {
      recorder.start();
    } catch {
      onStopRef.current(VoiceChatStopReasons.FAILED);
      return;
    }

    recorderRef.current = recorder;
  }, [dropRecorder]);

  /** Upload one utterance and hand the transcript back. Every early return here
   * is silent on purpose: an empty blob, a burst of noise the provider heard
   * nothing in, and a mode that was switched off mid-upload are all "nothing to
   * say", not failures to report. */
  const transcribe = useCallback(
    async (blob, generation) => {
      const capabilityNow = capabilityRef.current;
      const targetCardId = cardIdRef.current;

      if (!blob || blob.size === 0 || !targetCardId) {
        return;
      }

      const mimeType = uploadContentType(blob.type, recorderMimeRef.current);

      if (mimeType === '') {
        return;
      }

      // Checked here rather than discovered as a 422: the server's cap is
      // published in the bootstrap precisely so an oversized recording costs
      // nothing to refuse. It is SAID, not dropped in silence — a turn that
      // vanished with no explanation is the worst outcome of the three.
      if (
        capabilityNow &&
        typeof capabilityNow.sttMaxBytes === 'number' &&
        capabilityNow.sttMaxBytes > 0 &&
        blob.size > capabilityNow.sttMaxBytes
      ) {
        onNoticeRef.current('common.voiceChatRecordingTooLarge', {
          size: formatBytes(blob.size),
          limit: formatBytes(capabilityNow.sttMaxBytes),
        });

        return;
      }

      isUploadingRef.current = true;
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
        );

        if (!isCurrent(generation)) {
          return;
        }

        // The language the user was actually heard in. It is what the answer is
        // read back in — and it is the ONLY thing that ever reaches the server's
        // per-language voice map, which would otherwise be a configuration knob
        // no request could reach.
        if (item.languages && item.languages.length > 0) {
          [heardLanguageRef.current] = item.languages;
        }

        // A provider answers a burst of noise with "" or ".", and a turn made of
        // that would be a comment nobody wrote and a whole agent session spent
        // answering it.
        if (isSendableTranscript(item.text)) {
          onTranscriptRef.current(item.text);
        }
      } catch (error) {
        if (!isCurrent(generation)) {
          return;
        }

        // 503 means the feature went away server-side. Retrying is pointless
        // and the mode has to stop rather than sit listening at an endpoint
        // that will refuse every utterance.
        onStopRef.current(
          error && error.code === ErrorCodes.SERVICE_UNAVAILABLE
            ? VoiceChatStopReasons.DISABLED
            : VoiceChatStopReasons.FAILED,
          error && error.message,
        );
      } finally {
        isUploadingRef.current = false;

        if (isCurrent(generation)) {
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

      let isSettled = false;

      const settle = () => {
        if (isSettled) {
          return;
        }

        isSettled = true;
        recorder.ondataavailable = null;
        recorder.onstop = null;

        const blob = new Blob(chunks, { type: recorderMimeRef.current || chunks[0]?.type || '' });
        chunks.length = 0;

        transcribe(blob, generation);

        // The microphone is still open and the room may already be talking
        // again, so a fresh recorder goes in immediately rather than waiting
        // for the transcript.
        if (isCurrent(generation)) {
          startRecorder();
        }
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
      setTimeout(settle, RECORDER_STOP_DEADLINE_MS);
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

    analyserRef.current = null;
    frameBufferRef.current = null;
    vadRef.current = null;
    isUploadingRef.current = false;
    isCapturingRef.current = false;

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
          { armed },
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
  useEffect(() => {
    if (!isEnabled || !isAvailable || !pendingSpeech || !cardId) {
      return undefined;
    }

    // A reply the server would refuse for length is not sent at all: the mode
    // says so and carries on listening, rather than spending a round trip on a
    // 422 whose only handler turns the whole loop off.
    if (speakAvailability(pendingSpeech.text, capability) === SpeakAvailabilities.TOO_LONG) {
      onNoticeRef.current('common.voiceChatAnswerTooLong');
      onSpokenRef.current(pendingSpeech.id);

      return undefined;
    }

    const generation = generationRef.current;
    const controller = { isCancelled: false };

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
        );

        if (controller.isCancelled || !isCurrent(generation)) {
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

        if (!audioRef.current) {
          // Through `window` rather than the bare global so a test can hand the
          // hook an element whose `play()` resolves — jsdom's does not
          // implement playback at all.
          audioRef.current = new window.Audio();
        }

        const audio = audioRef.current;
        audioUrlRef.current = url;
        audio.src = url;

        await new Promise((resolve) => {
          audio.onended = resolve;
          audio.onerror = resolve;

          Promise.resolve(audio.play()).catch(resolve);
        });
      } catch (error) {
        if (!controller.isCancelled && isCurrent(generation)) {
          onStopRef.current(
            error && error.code === ErrorCodes.SERVICE_UNAVAILABLE
              ? VoiceChatStopReasons.NO_VOICE
              : VoiceChatStopReasons.FAILED,
            error && error.message,
          );
        }
      } finally {
        if (audioUrlRef.current) {
          URL.revokeObjectURL(audioUrlRef.current);
          audioUrlRef.current = null;
        }

        isSpeakingRef.current = false;

        if (isCurrent(generation)) {
          setIsSpeaking(false);
          // Marked spoken whatever happened, including a failure: a message
          // that could not be read must not be retried on the next render for
          // ever.
          onSpokenRef.current(pendingSpeech.id);
        }
      }
    })();

    return () => {
      controller.isCancelled = true;
    };
    // `pendingSpeech.id` rather than the object: the panel rebuilds it every
    // render and the effect must run once per message, not once per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEnabled, isAvailable, cardId, pendingSpeech && pendingSpeech.id, capability, isCurrent]);

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
