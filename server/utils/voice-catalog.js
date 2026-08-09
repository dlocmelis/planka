/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * Choosing a voice out of the provider's own catalogue.
 *
 * Ported from setl's `data/core/tts/cartesia_voices.go` — `pickVoice` and the
 * `cartesiaVoiceList` envelope — which is the code this ticket was told to
 * reuse. The part that talks to the network is `api/helpers/voice/
 * lookup-voice.js`; this file is the decision, so `npm test` drives all of it
 * (test/utils/voice-catalog.test.js).
 *
 * WHY THERE IS NO CHECKED-IN TABLE OF VOICE IDS HERE, which is the obvious
 * cheaper answer: the catalogue is dated, account-visible and Cartesia's to
 * change, so a table in this repository rots into a 400 on every synthesis in
 * whichever language lost its id first. A deployment that wants a particular
 * voice names it in `VOICE_TTS_VOICES`, which is checked BEFORE this and never
 * goes near the network. setl records the same decision, and keeps exactly one
 * hand-picked entry (Russian) because a human asked for that voice by name;
 * nobody has asked here, so there are none.
 */

const { isVoiceId, normalizeLanguage } = require('./voice');

/**
 * How many voices one lookup asks for.
 *
 * `pickVoiceFromCatalog` prefers a voice whose NATIVE locale matches and falls
 * back to the first that speaks the language at all, so this only has to be big
 * enough to reach a native one past whatever the provider happens to list
 * first. Cartesia's own bound on the parameter is 1..100.
 */
const VOICE_LIST_LIMIT = 10;

/**
 * One voice out of a `GET /voices/` listing, or '' when the listing holds none
 * for this language.
 *
 * The API has already filtered by language, so the language re-check below is
 * defensive; the preference is the point. A voice whose NATIVE locale is this
 * language beats one that merely covers it, because a covering voice is the
 * very thing the switch exists to move away from — the default this ships,
 * Skylar, covers de-DE and es-MX without being native to either, and it is
 * exactly that "close enough" reading the switch is meant to stop. Failing
 * both, the first entry in the provider's own order is taken, which keeps the
 * answer stable for a given catalogue.
 *
 * The envelope is `{ data: [{ id, language, locales: [{ locale, is_native }] }] }`
 * — pinned by setl against the live API on 2026-08-05 and confirmed against
 * docs.cartesia.ai/api-reference/voices/list on 2026-08-09. Only the fields
 * this needs are read, so a field Cartesia adds does not break it.
 */
const pickVoiceFromCatalog = (payload, language) => {
  const wanted = normalizeLanguage(language);

  if (!wanted || !payload || !Array.isArray(payload.data)) {
    return '';
  }

  let fallback = '';

  for (let index = 0; index < payload.data.length; index += 1) {
    const voice = payload.data[index];

    // A voice id that would not survive `isVoiceId` cannot go on the wire of
    // the synthesis request, so it is not a candidate however well it matches.
    if (voice && isVoiceId(voice.id) && normalizeLanguage(voice.language) === wanted) {
      const locales = Array.isArray(voice.locales) ? voice.locales : [];

      const isNative = locales.some(
        (locale) => locale && locale.is_native && normalizeLanguage(locale.locale) === wanted,
      );

      if (isNative) {
        return voice.id;
      }

      if (fallback === '') {
        fallback = voice.id;
      }
    }
  }

  return fallback;
};

/** The path and query one lookup asks for, relative to the provider's root. */
const voiceListPath = (language) =>
  `/voices/?limit=${VOICE_LIST_LIMIT}&language=${encodeURIComponent(language)}`;

/** Where the voice that read a message came from. It goes in the synthesis log
 * line, because "why did it speak in that voice" is the question an operator
 * tuning `VOICE_TTS_VOICES` actually has, and the FIX differs per answer:
 * `catalog` is working as designed, `novoice` wants a pin, `lookupfailed` is an
 * incident, `default` means nothing was detected to choose by. */
const VoiceSources = {
  /** The caller sent a voice back — the pin that keeps one conversation in one
   * voice. */
  REQUEST: 'request',
  /** `VOICE_TTS_VOICES` names one for this language. */
  CONFIG: 'config',
  /** Resolved from the provider's own listing. */
  CATALOG: 'catalog',
  /** The language was named and the catalogue has no voice for it. */
  NO_VOICE: 'novoice',
  /** The lookup itself failed: a timeout, a stale key, a 5xx. */
  LOOKUP_FAILED: 'lookupfailed',
  /** No language to choose by, or the switch is off. The fallback voice read
   * it and nothing was decided. */
  DEFAULT: 'default',
};

module.exports = {
  VOICE_LIST_LIMIT,
  VoiceSources,
  pickVoiceFromCatalog,
  voiceListPath,
};
