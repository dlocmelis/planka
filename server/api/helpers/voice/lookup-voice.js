/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * Which voice speaks a language the deployment has not pinned one for.
 *
 * Ported from setl's `data/core/tts/cartesia_voices.go`, which is the code this
 * ticket was told to reuse. It exists because Cartesia's voices are NOT
 * interchangeable across languages: each is published FOR a language and
 * carries the locales it can also cover, and the fallback this ships (Skylar)
 * reports language "en" with en-US native plus hi-IN, es-MX, de-DE, he-IL,
 * it-IT, pt-BR and ta-IN. Russian is not among them. So a Russian reply read by
 * the fallback voice is not "the same voice with an accent" — it is a voice
 * being asked for a language it was not published for, and since the
 * transcription default is `multi` (ten languages, Russian included) that is a
 * turn any deployment can reach without configuring anything.
 *
 * THE ANSWER IS CACHED FOR THE LIFE OF THE PROCESS, including the answer "there
 * is no voice for this language": the catalogue changes on Cartesia's release
 * schedule, not on ours, and this call sits IN FRONT of the audio, so paying
 * for it once per language is the whole point. A lookup that FAILED is
 * remembered separately and only for `FAILURE_TTL_MS`, so a provider blip costs
 * one message its switch rather than every message until the next restart, and
 * a provider that HANGS costs the timeout once a TTL rather than once a
 * message.
 *
 * It never throws. Every failure answers with the fallback voice and a source
 * that says which failure it was — a voice that could not be improved on must
 * not cost the user their answer.
 */

const { ProxyAgent } = require('undici');

const endpoints = require('../../../utils/voice-endpoints');
const { CARTESIA_VERSION, discardBody, readBoundedBody } = require('../../../utils/voice');

/** The ceiling on a catalogue page, as a backstop rather than a business rule:
 * Cartesia's list for one language is a few dozen entries. */
const MAX_CATALOG_BYTES = 4 * 1024 * 1024;
const {
  VoiceSources,
  pickVoiceFromCatalog,
  voiceListPath,
} = require('../../../utils/voice-catalog');

/**
 * How long one catalogue lookup may take.
 *
 * Far shorter than a synthesis timeout on purpose: this call is in front of the
 * first clip of a new language, so a provider that has gone slow must cost that
 * message a fraction of a second and the fallback voice, not the whole
 * synthesis. setl measured the same call at 0.17-0.38 s from its own API host.
 */
const LOOKUP_TIMEOUT_MS = 1000;

/** How long a FAILED lookup is remembered. Short enough that a blip heals
 * within a conversation, long enough that a real outage is paid for once a
 * minute rather than once a message. */
const FAILURE_TTL_MS = 30 * 1000;

/** language → voice id ('' meaning "the catalogue has none"), and language →
 * when the lookup last failed. Both are per-process, and both are dropped when
 * the config object changes identity — the same rule `get-config.js` caches by,
 * which is what lets a test re-point the provider without reaching into module
 * state. */
let answers = new Map();
let failures = new Map();
let cachedFrom = null;

const resetIfConfigChanged = () => {
  if (cachedFrom !== sails.config.custom) {
    answers = new Map();
    failures = new Map();
    cachedFrom = sails.config.custom;
  }
};

module.exports = {
  sync: false,

  inputs: {
    language: {
      type: 'string',
      required: true,
    },
  },

  async fn(inputs) {
    const { tts } = sails.helpers.voice.getConfig();

    if (!tts) {
      return { voice: '', source: VoiceSources.DEFAULT };
    }

    resetIfConfigChanged();

    const { language } = inputs;

    if (answers.has(language)) {
      const cached = answers.get(language);

      return {
        voice: cached,
        source: cached === '' ? VoiceSources.NO_VOICE : VoiceSources.CATALOG,
      };
    }

    const failedAt = failures.get(language);

    if (typeof failedAt === 'number' && Date.now() - failedAt < FAILURE_TTL_MS) {
      return { voice: '', source: VoiceSources.LOOKUP_FAILED };
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.min(LOOKUP_TIMEOUT_MS, tts.timeoutSec * 1000),
    );

    let payload;
    try {
      const response = await fetch(`${endpoints.cartesiaBaseUrl}${voiceListPath(language)}`, {
        method: 'GET',
        // Same reasoning as the synthesis call: a cross-host redirect drops
        // `Authorization` but would carry `X-API-Key` wherever it pointed.
        redirect: 'manual',
        headers: {
          'Cartesia-Version': CARTESIA_VERSION,
          Authorization: `Bearer ${tts.apiKey}`,
          'X-API-Key': tts.apiKey,
        },
        signal: controller.signal,
        dispatcher: sails.config.custom.outgoingProxy
          ? new ProxyAgent(sails.config.custom.outgoingProxy)
          : undefined,
      });

      if (!response.ok) {
        // A 401 here is the same operator problem the synthesis is about to
        // report properly; there is nothing this can add. A 4xx on the language
        // is the provider declining to answer, not "no such voice", so it is
        // NOT cached as an answer.
        //
        // The body is never read on this path, and an undici body nobody
        // consumes holds its connection open until it is — so it is given back
        // explicitly rather than left to the collector.
        discardBody(response);

        throw new Error(`HTTP ${response.status}`);
      }

      // Read here rather than through `.json()`, and before the abort timer is
      // cleared: `.json()` has no ceiling, and this is the one call in the
      // feature that sits in FRONT of an answer the user is waiting for.
      const body = await readBoundedBody(response, MAX_CATALOG_BYTES);

      if (!body.ok) {
        throw new Error('catalogue response is too large');
      }

      payload = JSON.parse(body.buffer.toString('utf8'));
    } catch (error) {
      clearTimeout(timeout);

      sails.log.warn(
        `Voice chat: could not read ${tts.provider}'s voice catalogue for '${language}' (${error.message}); ` +
          'the fallback voice reads this message',
      );

      failures.set(language, Date.now());

      return { voice: '', source: VoiceSources.LOOKUP_FAILED };
    }

    clearTimeout(timeout);

    const voice = pickVoiceFromCatalog(payload, language);

    // Cached either way. "This provider has no voice for Latvian" is a durable
    // fact, and re-asking it on every Latvian message would put a pointless
    // round trip in front of each one.
    answers.set(language, voice);
    failures.delete(language);

    return {
      voice,
      source: voice === '' ? VoiceSources.NO_VOICE : VoiceSources.CATALOG,
    };
  },
};
