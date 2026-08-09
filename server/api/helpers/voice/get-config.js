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

/**
 * The per-user spending caps, when the deployment has not said otherwise.
 *
 * Both windows are five minutes, and both sets of numbers are chosen to sit
 * well above what a person can physically do and well below what a script can:
 *
 *  - 20 turns per five minutes is a turn every fifteen seconds sustained. A
 *    real turn is a sentence, a second of hangover, an upload, and then a whole
 *    planka_bot session before there is anything to answer.
 *  - 600 seconds of audio per five minutes is twice as much speech as there is
 *    time to speak in the window, so it cannot bind on a conversation — but it
 *    does stop twenty five-minute recordings, which is the same 20 requests
 *    costing thirty times as much.
 *  - 30000 synthesized characters per five minutes is around half an hour of
 *    speech, so likewise: nobody can listen to their way into it, and it caps
 *    twenty maximum-length answers (which may each prepare to
 *    `PREPARED_TEXT_FACTOR` times the 2000-character input ceiling) at five.
 */
const RATE_LIMIT_DEFAULTS = {
  stt: { windowSec: 300, maxRequests: 20, maxUnits: 600 },
  tts: { windowSec: 300, maxRequests: 20, maxUnits: 30000 },
};

/**
 * One half's spending cap, or an error naming the knob that does not make
 * sense.
 *
 * An unset knob and an unparseable one both arrive here as null and both mean
 * "use the default", which is the safe direction: unlike `VOICE_STT_MAX_BYTES`,
 * where a typo REMOVED the limit, a typo here leaves the deployment on numbers
 * somebody chose. A NEGATIVE value is different — it would refuse every turn
 * for ever, silently, so it is refused loudly instead.
 */
const buildRateLimit = (values, defaults, names) => {
  // Anything that is not a finite number — unset, unparseable, or a key a test
  // left off the config object altogether — is "not stated" and takes the
  // default. Only a number that IS stated can be wrong.
  const stated = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const invalid = Object.keys(names).find((key) => stated(values[key]) < 0);

  if (invalid) {
    return { config: null, error: `${names[invalid]} cannot be negative` };
  }

  const orDefault = (key) => (stated(values[key]) === null ? defaults[key] : values[key]);

  return {
    error: null,
    config: {
      windowMs: orDefault('windowSec') * 1000,
      maxRequests: orDefault('maxRequests'),
      maxUnits: orDefault('maxUnits'),
    },
  };
};

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

  const rateLimit = buildRateLimit(
    {
      windowSec: custom.voiceSttRateWindowSec,
      maxRequests: custom.voiceSttRateMaxRequests,
      maxUnits: custom.voiceSttRateMaxSeconds,
    },
    RATE_LIMIT_DEFAULTS.stt,
    {
      windowSec: 'VOICE_STT_RATE_WINDOW_SEC',
      maxRequests: 'VOICE_STT_RATE_MAX_REQUESTS',
      maxUnits: 'VOICE_STT_RATE_MAX_SECONDS',
    },
  );

  if (rateLimit.error) {
    return { config: null, error: rateLimit.error };
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
      rateLimit: rateLimit.config,
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

  const rateLimit = buildRateLimit(
    {
      windowSec: custom.voiceTtsRateWindowSec,
      maxRequests: custom.voiceTtsRateMaxRequests,
      maxUnits: custom.voiceTtsRateMaxChars,
    },
    RATE_LIMIT_DEFAULTS.tts,
    {
      windowSec: 'VOICE_TTS_RATE_WINDOW_SEC',
      maxRequests: 'VOICE_TTS_RATE_MAX_REQUESTS',
      maxUnits: 'VOICE_TTS_RATE_MAX_CHARS',
    },
  );

  if (rateLimit.error) {
    return { config: null, error: rateLimit.error };
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
      rateLimit: rateLimit.config,
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
