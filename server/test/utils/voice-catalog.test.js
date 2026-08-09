const { expect } = require('chai');

const {
  VOICE_LIST_LIMIT,
  VoiceSources,
  pickVoiceFromCatalog,
  voiceListPath,
} = require('../../utils/voice-catalog');

/**
 * The listing shape Cartesia answers `GET /voices/` with, cut down to the
 * fields this reads. Pinned by setl against the live API on 2026-08-05 and
 * confirmed against docs.cartesia.ai/api-reference/voices/list on 2026-08-09:
 * `data[]` of `{ id, language, locales: [{ locale, is_native }] }`.
 */
const voice = (id, language, locales) => ({
  id,
  mode: 'similarity',
  name: `${id} - Test`,
  language,
  gender: 'feminine',
  is_public: true,
  locales,
});

describe('voice-catalog', () => {
  describe('#pickVoiceFromCatalog(payload, language)', () => {
    it('should prefer a voice whose native locale is the language over one that merely covers it', () => {
      // This is the whole reason the switch exists. Skylar, the fallback this
      // ships, covers de-DE without being native to it — picking it for German
      // would be the "close enough" reading the switch is meant to end.
      const payload = {
        data: [
          voice('db6b0ed5-d5d3-463d-ae85-518a07d3c2b4', 'de', [
            { locale: 'en-US', is_native: true },
            { locale: 'de-DE', is_native: false },
          ]),
          voice('native-de-voice', 'de', [{ locale: 'de-DE', is_native: true }]),
        ],
      };

      expect(pickVoiceFromCatalog(payload, 'de')).to.equal('native-de-voice');
    });

    it("should take the provider's own first entry when none is native", () => {
      const payload = {
        data: [
          voice('covering-one', 'ru', [{ locale: 'en-US', is_native: true }]),
          voice('covering-two', 'ru', [{ locale: 'en-GB', is_native: true }]),
        ],
      };

      expect(pickVoiceFromCatalog(payload, 'ru')).to.equal('covering-one');
    });

    it('should re-check the language the API was asked to filter by', () => {
      const payload = {
        data: [
          voice('an-english-voice', 'en', [{ locale: 'en-US', is_native: true }]),
          voice('a-russian-voice', 'ru', [{ locale: 'ru-RU', is_native: true }]),
        ],
      };

      expect(pickVoiceFromCatalog(payload, 'ru')).to.equal('a-russian-voice');
    });

    it('should reduce a regional spelling on either side', () => {
      const payload = {
        data: [voice('a-russian-voice', 'ru-RU', [{ locale: 'ru-RU', is_native: true }])],
      };

      expect(pickVoiceFromCatalog(payload, 'ru')).to.equal('a-russian-voice');
      expect(pickVoiceFromCatalog(payload, 'ru-RU')).to.equal('a-russian-voice');
    });

    it('should skip a voice whose id could not go on the wire', () => {
      // The id is sent inside the synthesis request and comes back in a
      // response header, so one that would not survive `isVoiceId` is not a
      // candidate however well it matches.
      const payload = {
        data: [
          voice('not a voice id', 'ru', [{ locale: 'ru-RU', is_native: true }]),
          voice('a-russian-voice', 'ru', [{ locale: 'ru-RU', is_native: true }]),
        ],
      };

      expect(pickVoiceFromCatalog(payload, 'ru')).to.equal('a-russian-voice');
    });

    it('should answer nothing for a language the provider serves no voice for', () => {
      // Latvian is exactly this case against the live API: the listing comes
      // back empty. The caller caches it and falls back rather than re-asking
      // on every message.
      expect(pickVoiceFromCatalog({ data: [] }, 'lv')).to.equal('');
    });

    it('should answer nothing rather than throwing for a body that is not a listing', () => {
      expect(pickVoiceFromCatalog(null, 'ru')).to.equal('');
      expect(pickVoiceFromCatalog({}, 'ru')).to.equal('');
      expect(pickVoiceFromCatalog({ data: 'nope' }, 'ru')).to.equal('');
      expect(pickVoiceFromCatalog({ data: [null, {}] }, 'ru')).to.equal('');
      expect(pickVoiceFromCatalog({ data: [voice('an-id', 'ru', 'nope')] }, 'ru')).to.equal(
        'an-id',
      );
    });

    it('should answer nothing when there is no language to choose by', () => {
      const payload = {
        data: [voice('a-russian-voice', 'ru', [{ locale: 'ru-RU', is_native: true }])],
      };

      expect(pickVoiceFromCatalog(payload, '')).to.equal('');
      expect(pickVoiceFromCatalog(payload, null)).to.equal('');
      expect(pickVoiceFromCatalog(payload, 'not-a-language')).to.equal('');
    });
  });

  describe('#voiceListPath(language)', () => {
    it('should ask for the language, and for enough voices to reach a native one', () => {
      expect(voiceListPath('ru')).to.equal(`/voices/?limit=${VOICE_LIST_LIMIT}&language=ru`);
    });

    it("should stay inside Cartesia's documented 1..100 bound on limit", () => {
      expect(VOICE_LIST_LIMIT).to.be.at.least(1);
      expect(VOICE_LIST_LIMIT).to.be.at.most(100);
    });

    it('should encode what it puts in the query', () => {
      expect(voiceListPath('ru&limit=100')).to.equal(
        `/voices/?limit=${VOICE_LIST_LIMIT}&language=ru%26limit%3D100`,
      );
    });
  });

  describe('VoiceSources', () => {
    it('should tell the four "the fallback voice read it" outcomes apart', () => {
      // They are separate values because the FIX for each is different, and the
      // synthesis log line is where an operator finds out which they have.
      const values = [
        VoiceSources.DEFAULT,
        VoiceSources.NO_VOICE,
        VoiceSources.LOOKUP_FAILED,
        VoiceSources.CONFIG,
        VoiceSources.CATALOG,
        VoiceSources.REQUEST,
      ];

      expect(new Set(values).size).to.equal(values.length);
    });
  });
});
