/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * One message → one clip of speech, through Cartesia's POST /tts/bytes.
 *
 * Ported from setl's `data/core/tts/cartesia.go`. Three request facts came
 * from that file rather than from documentation, and each was confirmed
 * against the live API there:
 *
 *  - The `Cartesia-Version` header is MANDATORY. A request without it is
 *    answered 400 ("Cartesia-Version header is required in YYYY-MM-DD form").
 *    It is a dated contract, so bumping it means re-reading the request shape
 *    below, not just the constant — which lives in `utils/voice.js` because the
 *    voice lookup sends it too.
 *  - The credential goes in BOTH headers Cartesia accepts. `Authorization:
 *    Bearer` is the documented form and `X-API-Key` the older one that is
 *    still honoured; they name the same secret, so there is nothing to
 *    conflict, and sending one only would make a feature that may sit
 *    unprovisioned for months break silently if that header were retired.
 *  - Because of that, REDIRECTS ARE NOT FOLLOWED (`redirect: 'manual'`). A
 *    cross-host redirect drops `Authorization` but would carry a custom header
 *    like `X-API-Key` straight to wherever it pointed.
 *
 * Which fields `output_format` needs depends on the container and Cartesia
 * lists them all as required for theirs: mp3 wants container + sample_rate +
 * bit_rate, wav wants container + encoding + sample_rate and REJECTS a bit
 * rate. Sending the wrong set is a 400, defaulted-in-the-docs or not.
 */

const { ProxyAgent } = require('undici');

const endpoints = require('../../../utils/voice-endpoints');
const {
  CARTESIA_VERSION,
  MAX_PROVIDER_ERROR_BYTES,
  VoiceProviderError,
  VoiceRequestError,
  isLanguageCode,
  isVoiceId,
  normalizeLanguage,
  readBoundedBody,
  speechTextLength,
} = require('../../../utils/voice');
const { VoiceSources } = require('../../../utils/voice-catalog');
const {
  cutSpeechText,
  hasSpeakableContent,
  stripMarkdown,
} = require('../../../utils/voice-speech-text');

/** How much longer the PREPARED text may be than the accepted input before it
 * is cut. Narration turns a table into prose, so the prepared text is longer
 * than the markdown the ceiling measured — three times is setl's own headroom,
 * and the cut speaks "…the rest is on screen…" rather than stopping dead. */
const PREPARED_TEXT_FACTOR = 3;

/** Nobody reads aloud slower than this, and it is deliberately an under-estimate
 * — it is the denominator of a ceiling, so being wrong on the low side makes
 * that ceiling more generous rather than less. */
const SLOWEST_SPEECH_CHARS_PER_SECOND = 8;

/** The ceiling when the deployment has removed the character cap altogether:
 * with nothing to derive one from, a flat backstop is all that is left. */
const UNCAPPED_MAX_AUDIO_BYTES = 64 * 1024 * 1024;

/**
 * How many bytes of audio this deployment could legitimately be sent back.
 *
 * A backstop on the body read, not a business rule: the prepared text is at
 * most `maxChars * PREPARED_TEXT_FACTOR` characters, that takes at least
 * `SLOWEST_SPEECH_CHARS_PER_SECOND` characters a second to say, and the
 * container fixes the byte rate — wav being the expensive one, at two bytes per
 * sample. Doubled, because none of those three is exact and a legitimate answer
 * must never hit this.
 */
const maxAudioBytesFor = (config) => {
  if (!(config.maxChars > 0)) {
    return UNCAPPED_MAX_AUDIO_BYTES;
  }

  const seconds = (config.maxChars * PREPARED_TEXT_FACTOR) / SLOWEST_SPEECH_CHARS_PER_SECOND;
  const bytesPerSecond =
    config.container === 'wav' ? config.sampleRate * 2 : Math.ceil(config.bitRate / 8);

  return Math.ceil(seconds * bytesPerSecond * 2);
};

const contentTypeFor = (container) => (container === 'wav' ? 'audio/wav' : 'audio/mpeg');

const outputFormatFor = (config) =>
  config.container === 'wav'
    ? {
        container: 'wav',
        sample_rate: config.sampleRate,
        encoding: 'pcm_s16le',
      }
    : {
        container: 'mp3',
        sample_rate: config.sampleRate,
        bit_rate: config.bitRate,
      };

/**
 * Which voice reads this message, and in which language.
 *
 * Three steps, which is setl's own order (`data/core/tts/cartesia.go`
 * `resolveVoice`): a voice the CALLER named, then the deployment's own
 * `VOICE_TTS_VOICES` pin for the language, then the provider's catalogue. The
 * pin is checked before the network so a deployment that has chosen its voices
 * never pays for a lookup.
 *
 * A VOICE ON ITS OWN IS NOT A DECISION: the language is only reported back
 * when one was actually resolved, because the reply's voice is pinned onto the
 * rest of the conversation, and a default voice reported as though it had been
 * chosen is how one undetectable reply fixes an American accent onto every
 * Russian answer after it.
 */
const resolveVoice = async (config, requestedVoice, requestedLanguage) => {
  if (requestedVoice) {
    if (!isVoiceId(requestedVoice)) {
      throw new VoiceRequestError('Voice id is not valid');
    }

    return {
      voice: requestedVoice,
      language: normalizeLanguage(requestedLanguage),
      source: VoiceSources.REQUEST,
    };
  }

  const language = normalizeLanguage(requestedLanguage);

  if (language && config.voiceByLanguage[language]) {
    return {
      voice: config.voiceByLanguage[language],
      language,
      source: VoiceSources.CONFIG,
    };
  }

  // Nothing to choose by. Asking the catalogue "which voice speaks null" is not
  // a question, so the fallback reads it and nothing is reported as decided.
  if (!language || !config.isAutoVoice) {
    return { voice: config.voice, language: null, source: VoiceSources.DEFAULT };
  }

  const { voice, source } = await sails.helpers.voice.lookupVoice(language);

  if (voice) {
    return { voice, language, source };
  }

  // The catalogue had none, or could not be asked. Either way the fallback
  // voice reads it — and WITHOUT the language, because naming a language a
  // voice was not published for is a 400 on every message rather than a worse
  // accent. `source` says which of the two happened, for the operator who has
  // to decide whether to pin one.
  return { voice: config.voice, language: null, source };
};

module.exports = {
  inputs: {
    text: {
      type: 'string',
      required: true,
    },
    language: {
      type: 'string',
      allowNull: true,
    },
    voice: {
      type: 'string',
      allowNull: true,
    },
  },

  async fn(inputs) {
    const { tts } = sails.helpers.voice.getConfig();

    if (!tts) {
      throw new Error('Text-to-speech is not configured');
    }

    if (inputs.language && !isLanguageCode(String(inputs.language).split(/[-_]/)[0])) {
      throw new VoiceRequestError('Language is not a valid code');
    }

    // A cheap gate in front of the exact one. `speechTextLength` spreads the
    // whole string to count CODE POINTS, which on a body written to be big is
    // several megabytes of heap and tens of milliseconds of synchronous event
    // loop — spent before anything has been validated. A UTF-16 length is never
    // below the code-point count and never above twice it, so a string longer
    // than twice the ceiling is certainly over it, and this says so without
    // walking it.
    if (tts.maxChars > 0 && inputs.text.length > tts.maxChars * 2) {
      throw new VoiceRequestError(
        `Text is too long to read aloud: it exceeds the ${tts.maxChars}-character limit`,
      );
    }

    // Measured against the RAW markdown, which is the same string the client
    // measured before it offered the control — so a message the client thought
    // speakable is never refused here.
    const requestedChars = speechTextLength(inputs.text);

    if (tts.maxChars > 0 && requestedChars > tts.maxChars) {
      throw new VoiceRequestError(
        `Text is too long to read aloud: ${requestedChars} characters exceeds the ${tts.maxChars}-character limit`,
      );
    }

    const prepared = cutSpeechText(
      stripMarkdown(inputs.text),
      tts.maxChars > 0 ? tts.maxChars * PREPARED_TEXT_FACTOR : 0,
    );

    if (!hasSpeakableContent(prepared)) {
      throw new VoiceRequestError('There is nothing in that message to read aloud');
    }

    const { voice, language, source } = await resolveVoice(tts, inputs.voice, inputs.language);

    const body = {
      model_id: tts.model,
      transcript: prepared,
      voice: {
        mode: 'id',
        id: voice,
      },
      output_format: outputFormatFor(tts),
    };

    // Omitted rather than sent empty, which is what lets Cartesia infer the
    // language from the text itself.
    if (language) {
      body.language = language;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), tts.timeoutSec * 1000);

    let response;
    let responseBody;
    try {
      response = await fetch(`${endpoints.cartesiaBaseUrl}/tts/bytes`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Cartesia-Version': CARTESIA_VERSION,
          Authorization: `Bearer ${tts.apiKey}`,
          'X-API-Key': tts.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        dispatcher: sails.config.custom.outgoingProxy
          ? new ProxyAgent(sails.config.custom.outgoingProxy)
          : undefined,
      });

      // Read here, INSIDE the window the abort timer covers, and with a
      // ceiling. `arrayBuffer()` reads to the end of the body whatever comes
      // back, and a `finally` around the fetch alone would have disarmed the
      // timeout the moment the headers arrived — so a provider that stalls
      // partway through the audio would pin this request indefinitely.
      responseBody = await readBoundedBody(
        response,
        response.ok ? maxAudioBytesFor(tts) : MAX_PROVIDER_ERROR_BYTES,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new VoiceProviderError(
        tts.provider,
        response.status,
        responseBody.buffer.toString('utf8').slice(0, 2048),
      );
    }

    if (!responseBody.ok) {
      throw new VoiceProviderError(tts.provider, response.status, 'audio response is too large');
    }

    const audio = responseBody.buffer;

    if (audio.length === 0) {
      // A 200 with no audio in it: the character count was spent before the
      // request was made, so this is a failure that still cost money and must
      // be reported rather than played as silence.
      throw new VoiceProviderError(tts.provider, response.status, 'empty audio response');
    }

    return {
      audio,
      contentType: contentTypeFor(tts.container),
      voice,
      language,
      // Not answered to the client — it is an operator's signal, and it goes in
      // the synthesis log line rather than on the wire.
      voiceSource: source,
      chars: speechTextLength(prepared),
    };
  },
};
