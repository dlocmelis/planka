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
 *    below, not just the constant.
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
  VoiceProviderError,
  VoiceRequestError,
  isLanguageCode,
  isVoiceId,
  normalizeLanguage,
  speechTextLength,
} = require('../../../utils/voice');
const {
  cutSpeechText,
  hasSpeakableContent,
  stripMarkdown,
} = require('../../../utils/voice-speech-text');

/** The API version this request shape belongs to. */
const CARTESIA_VERSION = '2026-03-01';

/** How much longer the PREPARED text may be than the accepted input before it
 * is cut. Narration turns a table into prose, so the prepared text is longer
 * than the markdown the ceiling measured — three times is setl's own headroom,
 * and the cut speaks "…the rest is on screen…" rather than stopping dead. */
const PREPARED_TEXT_FACTOR = 3;

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
 * A VOICE ON ITS OWN IS NOT A DECISION: the language is only reported back
 * when one was actually resolved, because a reply spoken in parts pins the
 * first part's answer onto the rest, and a default voice reported as though it
 * had been chosen is how a Russian answer ends up read in an American accent
 * for the rest of the message.
 */
const resolveVoice = (config, requestedVoice, requestedLanguage) => {
  if (requestedVoice) {
    if (!isVoiceId(requestedVoice)) {
      throw new VoiceRequestError('Voice id is not valid');
    }

    return { voice: requestedVoice, language: normalizeLanguage(requestedLanguage) };
  }

  const language = normalizeLanguage(requestedLanguage);

  if (language && config.voiceByLanguage[language]) {
    return { voice: config.voiceByLanguage[language], language };
  }

  // The fallback voice, and no language decision to report with it.
  return { voice: config.voice, language: null };
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

    const { voice, language } = resolveVoice(tts, inputs.voice, inputs.language);

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
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorBody = (await response.text()).slice(0, 2048);
      throw new VoiceProviderError(tts.provider, response.status, errorBody);
    }

    const audio = Buffer.from(await response.arrayBuffer());

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
      chars: speechTextLength(prepared),
    };
  },
};
