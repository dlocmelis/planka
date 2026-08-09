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

const endpoints = require('../../../utils/voice-endpoints');
const {
  isOutgoingHostAllowed,
  isVoiceId,
  parseKeyterms,
  parseVoiceMap,
} = require('../../../utils/voice');

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

  // A VOICE_STT_MAX_BYTES that does not parse comes through as null, and `null
  // || 0` is how "no cap at all" is spelled downstream: the guard in
  // `controllers/voice/transcribe.js` stops firing AND the bootstrap publishes
  // `sttMaxBytes: null`, so the browser stops pre-checking too. A typo would
  // therefore REMOVE the upload limit — the loudest possible version of the
  // silent-default failure this file exists to prevent — so the half goes off
  // with an error instead.
  if (typeof custom.voiceSttMaxBytes !== 'number' || custom.voiceSttMaxBytes <= 0) {
    return {
      config: null,
      error:
        "VOICE_STT_MAX_BYTES does not name a size (want something like '700kb'); " +
        'refusing to run the upload with no limit',
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
      maxBytes: custom.voiceSttMaxBytes,
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

  // The fallback voice, held to the same bar as every entry of the map below —
  // it is the id that reads every message no language was resolved for, so a
  // typo in it is not one wrong accent but a 400 from the provider on EVERY
  // synthesis. Empty is refused too: `VOICE_TTS_VOICE=` with nothing after it
  // would otherwise ask Cartesia to speak in voice ''.
  const voice = (custom.voiceTtsVoice || '').trim();

  if (!isVoiceId(voice)) {
    return {
      config: null,
      error: `text-to-speech voice '${voice}' does not name a voice id`,
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
      voice,
      voiceByLanguage,
      // The automatic switch: a language with no pin of its own is looked up in
      // the provider's catalogue. On by default, as it is in setl — leaving it
      // off means every non-English reply is read by the English fallback voice,
      // which is the behaviour the switch exists to end. `false` is the only
      // value that turns it off, so an unset key and a typo both leave it on.
      isAutoVoice: custom.voiceTtsAutoVoice !== false,
      container,
      sampleRate: custom.voiceTtsSampleRate || 44100,
      bitRate: custom.voiceTtsBitRate || 128000,
      maxChars: custom.voiceTtsMaxChars || 0,
      timeoutSec: custom.voiceTtsTimeoutSec || 60,
    },
  };
};

/**
 * The one prerequisite this feature has that nothing else in the app would
 * notice: a deployment using the outgoing allowlist has to put the two provider
 * hostnames on it.
 *
 * `server/start.sh` switches the internal proxy to deny-by-default as soon as
 * `OUTGOING_ALLOWED_HOSTS`/`_IPS` is set at all, so a deployment that turns the
 * keys on and leaves that list alone gets a feature that looks configured,
 * reports itself available in the bootstrap, opens the user's microphone, and
 * then answers 502 on every single turn. Said once, loudly, where an operator
 * looks — and only where it is certainly wrong: `isOutgoingHostAllowed` answers
 * null rather than false wherever it would be guessing.
 */
const warnIfUnreachable = (hostname, what) => {
  // The allowlist variables have no home in `sails.config.custom` — they belong
  // to `start.sh` rather than to this app — so the environment is where they
  // have to be read from. The PROXY does have one, and it is taken from there
  // so that this check and every outbound call in the feature (which dial
  // `sails.config.custom.outgoingProxy`) agree about whether one is in use.
  const env = { ...process.env, OUTGOING_PROXY: sails.config.custom.outgoingProxy };

  if (isOutgoingHostAllowed(hostname, env) !== false) {
    return;
  }

  sails.log.warn(
    `Voice chat: ${what} is configured but '${hostname}' is not on OUTGOING_ALLOWED_HOSTS, ` +
      'so the outgoing proxy denies every call to it and each turn fails with a 502. ' +
      'Add it to that list (see docs/bot-chat-voice.md).',
  );
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

    if (stt.config) {
      warnIfUnreachable(new URL(endpoints.deepgramListenUrl).hostname, 'speech-to-text');
    }

    if (tts.config) {
      // One hostname covers both of this half's calls — the synthesis and the
      // voice catalogue are the same API root.
      warnIfUnreachable(new URL(endpoints.cartesiaBaseUrl).hostname, 'text-to-speech');
    }

    cached = {
      stt: stt.config,
      tts: tts.config,
    };
    cachedFrom = custom;

    return cached;
  },
};
