/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * The voice feature's effective configuration, resolved once and remembered.
 *
 * Absence of a key is the whole of the feature gate, the shape setl uses: no
 * `DEEPGRAM_API_KEY` → no transcription → the route answers 503 and the
 * bootstrap says the mode is unavailable, so the client never renders a
 * control it cannot use. The two halves are independent — a deployment may
 * have transcription and no voice, or the other way round — because they are
 * separate credentials with separate vendors.
 *
 * A MISCONFIGURED knob is loud and leaves its half off, rather than fatal: a
 * typo in one optional value must not stop PLANKA from booting (that trades a
 * missing voice for an outage), and silently serving the default instead would
 * be exactly the "nobody chose this" failure the validation exists to prevent.
 */

const { parseKeyterms, parseVoiceMap } = require('../../../utils/voice');

const SUPPORTED_STT_PROVIDERS = ['deepgram'];
const SUPPORTED_TTS_PROVIDERS = ['cartesia'];
const SUPPORTED_TTS_CONTAINERS = ['mp3', 'wav'];

/** Resolved config, or null before the first call. Rebuilt when the underlying
 * `sails.config.custom` object changes identity, which is what lets a test
 * re-point the knobs without reaching into module state. */
let cached = null;
let cachedFrom = null;

const buildSttConfig = (custom) => {
  const apiKey = (custom.deepgramApiKey || '').trim();

  if (apiKey === '') {
    return { config: null, error: null };
  }

  const provider = (custom.voiceSttProvider || 'deepgram').trim().toLowerCase();

  if (!SUPPORTED_STT_PROVIDERS.includes(provider)) {
    return {
      config: null,
      error: `speech-to-text provider '${provider}' is not supported (only ${SUPPORTED_STT_PROVIDERS.join(', ')})`,
    };
  }

  return {
    error: null,
    config: {
      provider,
      apiKey,
      model: (custom.voiceSttModel || 'nova-3').trim(),
      language: (custom.voiceSttLanguage || 'multi').trim(),
      keyterms: parseKeyterms(custom.voiceSttKeyterms),
      maxBytes: custom.voiceSttMaxBytes || 0,
      maxDurationSec: custom.voiceSttMaxDurationSec || 0,
      timeoutSec: custom.voiceSttTimeoutSec || 60,
    },
  };
};

const buildTtsConfig = (custom) => {
  const apiKey = (custom.cartesiaApiKey || '').trim();

  if (apiKey === '') {
    return { config: null, error: null };
  }

  const provider = (custom.voiceTtsProvider || 'cartesia').trim().toLowerCase();

  if (!SUPPORTED_TTS_PROVIDERS.includes(provider)) {
    return {
      config: null,
      error: `text-to-speech provider '${provider}' is not supported (only ${SUPPORTED_TTS_PROVIDERS.join(', ')})`,
    };
  }

  const container = (custom.voiceTtsOutputFormat || 'mp3').trim().toLowerCase();

  if (!SUPPORTED_TTS_CONTAINERS.includes(container)) {
    return {
      config: null,
      error: `text-to-speech output format '${container}' is not supported (want ${SUPPORTED_TTS_CONTAINERS.join('|')})`,
    };
  }

  let voiceByLanguage;
  try {
    voiceByLanguage = parseVoiceMap(custom.voiceTtsVoices);
  } catch (error) {
    return { config: null, error: `text-to-speech ${error.message}` };
  }

  return {
    error: null,
    config: {
      provider,
      apiKey,
      model: (custom.voiceTtsModel || 'sonic-3.5').trim(),
      voice: (custom.voiceTtsVoice || '').trim(),
      voiceByLanguage,
      container,
      sampleRate: custom.voiceTtsSampleRate || 44100,
      bitRate: custom.voiceTtsBitRate || 128000,
      maxChars: custom.voiceTtsMaxChars || 0,
      timeoutSec: custom.voiceTtsTimeoutSec || 60,
    },
  };
};

module.exports = {
  sync: true,

  fn() {
    const { custom } = sails.config;

    if (cached && cachedFrom === custom) {
      return cached;
    }

    const stt = buildSttConfig(custom);
    const tts = buildTtsConfig(custom);

    [stt.error, tts.error].filter(Boolean).forEach((message) => {
      sails.log.error(`Voice chat: ${message}; that half stays disabled`);
    });

    cached = {
      stt: stt.config,
      tts: tts.config,
    };
    cachedFrom = custom;

    return cached;
  },
};
