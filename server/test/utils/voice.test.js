const { expect } = require('chai');

const {
  AUDIO_MIME_TYPES,
  INTERNAL_OUTGOING_PROXY,
  VoiceProviderError,
  VoiceRequestError,
  allowedAudioMimeTypes,
  formatBytes,
  isLanguageCode,
  isOutgoingHostAllowed,
  isVoiceId,
  normalizeAudioMimeType,
  normalizeLanguage,
  parseKeyterms,
  parseVoiceMap,
  speechTextLength,
} = require('../../utils/voice');

describe('voice', () => {
  describe('#normalizeAudioMimeType(mimeType)', () => {
    it('should strip the parameters and casing a browser attaches', () => {
      expect(normalizeAudioMimeType('audio/webm;codecs=opus')).to.equal('audio/webm');
      expect(normalizeAudioMimeType('AUDIO/WEBM')).to.equal('audio/webm');
      expect(normalizeAudioMimeType('  audio/ogg ; codecs=opus ')).to.equal('audio/ogg');
    });

    it('should accept every container a MediaRecorder produces', () => {
      ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'].forEach((mimeType) => {
        expect(normalizeAudioMimeType(mimeType), mimeType).to.equal(mimeType);
      });
    });

    it('should accept the video/* labels browsers put on audio-only recordings', () => {
      // Firefox labels an ogg/opus recording video/ogg on some versions, and
      // Chrome offers video/webm for an audio-only stream.
      expect(normalizeAudioMimeType('video/webm;codecs=opus')).to.equal('video/webm');
      expect(normalizeAudioMimeType('video/ogg')).to.equal('video/ogg');
      expect(normalizeAudioMimeType('video/mp4')).to.equal('video/mp4');
    });

    it('should reject anything outside the allowlist, an absent type included', () => {
      expect(normalizeAudioMimeType('application/octet-stream')).to.equal(null);
      expect(normalizeAudioMimeType('text/plain')).to.equal(null);
      expect(normalizeAudioMimeType('')).to.equal(null);
      expect(normalizeAudioMimeType(undefined)).to.equal(null);
      expect(normalizeAudioMimeType(null)).to.equal(null);
      // Not a prefix match: a type that merely starts with an accepted one is
      // not that one.
      expect(normalizeAudioMimeType('audio/webmx')).to.equal(null);
    });

    it('should accept exactly what it advertises', () => {
      allowedAudioMimeTypes().forEach((mimeType) => {
        expect(normalizeAudioMimeType(mimeType), mimeType).to.equal(mimeType);
      });

      expect(allowedAudioMimeTypes()).to.have.lengthOf(AUDIO_MIME_TYPES.length);
      expect(allowedAudioMimeTypes()).to.deep.equal([...AUDIO_MIME_TYPES].sort());
    });
  });

  describe('#parseKeyterms(value)', () => {
    it('should split on commas, trim and drop blanks', () => {
      expect(parseKeyterms('PLANKA, planka_bot ,, board ')).to.deep.equal([
        'PLANKA',
        'planka_bot',
        'board',
      ]);
    });

    it('should keep a multi-word phrase as one term', () => {
      expect(parseKeyterms('devteam orchestrator,card')).to.deep.equal([
        'devteam orchestrator',
        'card',
      ]);
    });

    it('should answer an empty list for nothing at all', () => {
      expect(parseKeyterms('')).to.deep.equal([]);
      expect(parseKeyterms(undefined)).to.deep.equal([]);
      expect(parseKeyterms('  ,  ')).to.deep.equal([]);
    });
  });

  describe('#parseVoiceMap(raw)', () => {
    it('should read the per-language pins', () => {
      expect(parseVoiceMap('ru=abc-123,de=def-456')).to.deep.equal({
        ru: 'abc-123',
        de: 'def-456',
      });
    });

    it('should reduce a regional spelling to its primary subtag', () => {
      // ru-RU and ru name the same voice: a deployment that pinned one spelling
      // must not find the other unpinned.
      expect(parseVoiceMap('ru-RU=abc-123')).to.deep.equal({ ru: 'abc-123' });
    });

    it('should accept two spellings of one language that agree', () => {
      expect(parseVoiceMap('ru=abc,ru-RU=abc')).to.deep.equal({ ru: 'abc' });
    });

    it('should refuse two spellings of one language that disagree', () => {
      // Which voice speaks Russian must not differ between restarts.
      expect(() => parseVoiceMap('ru=abc,ru-RU=def')).to.throw(/twice/);
    });

    it('should refuse a three-letter code, an empty language and a bad voice id', () => {
      expect(() => parseVoiceMap('rus=abc')).to.throw(/two-letter/);
      expect(() => parseVoiceMap('=abc')).to.throw();
      expect(() => parseVoiceMap('ru=')).to.throw(/voice id/);
      expect(() => parseVoiceMap('ru=has spaces')).to.throw(/voice id/);
      expect(() => parseVoiceMap('nonsense')).to.throw();
    });

    it('should answer an empty map for nothing at all', () => {
      expect(parseVoiceMap('')).to.deep.equal({});
      expect(parseVoiceMap(undefined)).to.deep.equal({});
    });
  });

  describe('#normalizeLanguage(value)', () => {
    it('should reduce to a lowercased primary subtag', () => {
      expect(normalizeLanguage('ru')).to.equal('ru');
      expect(normalizeLanguage('RU')).to.equal('ru');
      expect(normalizeLanguage('ru-RU')).to.equal('ru');
      expect(normalizeLanguage('pt_BR')).to.equal('pt');
    });

    it('should answer null for anything that is not one', () => {
      expect(normalizeLanguage('')).to.equal(null);
      expect(normalizeLanguage(undefined)).to.equal(null);
      expect(normalizeLanguage('english')).to.equal(null);
      expect(normalizeLanguage('1')).to.equal(null);
    });
  });

  describe('#isVoiceId(value) / #isLanguageCode(value)', () => {
    it('should accept the shapes a provider writes', () => {
      expect(isVoiceId('db6b0ed5-d5d3-463d-ae85-518a07d3c2b4')).to.equal(true);
      expect(isVoiceId('a'.repeat(64))).to.equal(true);
      expect(isLanguageCode('en')).to.equal(true);
      expect(isLanguageCode('fil')).to.equal(true);
    });

    it('should refuse anything longer or stranger', () => {
      expect(isVoiceId('a'.repeat(65))).to.equal(false);
      expect(isVoiceId('has spaces')).to.equal(false);
      expect(isVoiceId('')).to.equal(false);
      expect(isLanguageCode('e')).to.equal(false);
      expect(isLanguageCode('engl')).to.equal(false);
      expect(isLanguageCode('en-US')).to.equal(false);
    });
  });

  describe('#speechTextLength(text)', () => {
    it('should count code points, not UTF-16 code units', () => {
      // An emoji is one character to a provider counting runes and two to
      // String.prototype.length, so a message near the ceiling would be
      // measured differently on each side.
      expect(speechTextLength('abc')).to.equal(3);
      expect(speechTextLength('a😀b')).to.equal(3);
      expect('a😀b'.length).to.equal(4);
      expect(speechTextLength('')).to.equal(0);
      expect(speechTextLength(undefined)).to.equal(0);
    });
  });

  describe('#isOutgoingHostAllowed(hostname, env)', () => {
    it('should say nothing when no allowlist is in force', () => {
      expect(isOutgoingHostAllowed('api.deepgram.com', {})).to.equal(null);
      // Blocklists alone leave the proxy allow-by-default: start.sh only writes
      // `http_access deny all` for an ALLOW list.
      expect(
        isOutgoingHostAllowed('api.deepgram.com', { OUTGOING_BLOCKED_HOSTS: 'localhost,postgres' }),
      ).to.equal(null);
    });

    it('should refuse a host an allowlist leaves out', () => {
      expect(
        isOutgoingHostAllowed('api.deepgram.com', { OUTGOING_ALLOWED_HOSTS: 'api.cartesia.ai' }),
      ).to.equal(false);
    });

    it('should refuse every host for an allowlist that is set but empty', () => {
      // The trap the feature's own documentation is about: start.sh tests
      // `${VAR+x}`, so an empty value still switches the proxy to
      // deny-by-default and nothing at all gets out.
      expect(isOutgoingHostAllowed('api.cartesia.ai', { OUTGOING_ALLOWED_HOSTS: '' })).to.equal(
        false,
      );
      expect(isOutgoingHostAllowed('api.cartesia.ai', { OUTGOING_ALLOWED_IPS: '' })).to.equal(
        false,
      );
    });

    it('should accept an exact entry, whatever its spacing and casing', () => {
      expect(
        isOutgoingHostAllowed('api.deepgram.com', {
          OUTGOING_ALLOWED_HOSTS: 'example.com, API.Deepgram.com ,api.cartesia.ai',
        }),
      ).to.equal(true);
    });

    it("should read a leading dot as Squid's dstdomain does", () => {
      // `.deepgram.com` matches the domain and everything under it.
      expect(
        isOutgoingHostAllowed('api.deepgram.com', { OUTGOING_ALLOWED_HOSTS: '.deepgram.com' }),
      ).to.equal(true);
      expect(
        isOutgoingHostAllowed('deepgram.com', { OUTGOING_ALLOWED_HOSTS: '.deepgram.com' }),
      ).to.equal(true);
      // ...and not a different domain that merely ends the same way.
      expect(
        isOutgoingHostAllowed('evildeepgram.com', { OUTGOING_ALLOWED_HOSTS: '.deepgram.com' }),
      ).to.equal(false);
    });

    it('should not guess against an IP allowlist it cannot resolve', () => {
      expect(
        isOutgoingHostAllowed('api.deepgram.com', {
          OUTGOING_ALLOWED_IPS: '104.16.0.1',
          OUTGOING_ALLOWED_HOSTS: 'api.cartesia.ai',
        }),
      ).to.equal(null);
    });

    it('should say nothing when the deployment named an outgoing proxy of its own', () => {
      // start.sh returns before writing any ACL there, so the allowlist below
      // was never built and what that proxy permits is not ours to assume.
      expect(
        isOutgoingHostAllowed('api.deepgram.com', {
          OUTGOING_PROXY: 'http://proxy.internal:8080',
          OUTGOING_ALLOWED_HOSTS: '',
        }),
      ).to.equal(null);

      // ...but the proxy start.sh starts ITSELF is the one enforcing that list.
      expect(
        isOutgoingHostAllowed('api.deepgram.com', {
          OUTGOING_PROXY: INTERNAL_OUTGOING_PROXY,
          OUTGOING_ALLOWED_HOSTS: '',
        }),
      ).to.equal(false);
    });
  });

  describe('#formatBytes(bytes)', () => {
    it('should render a size the way copy needs it', () => {
      expect(formatBytes(512)).to.equal('512 bytes');
      expect(formatBytes(2048)).to.equal('2 KB');
      expect(formatBytes(3 * 1024 * 1024)).to.equal('3.0 MB');
    });
  });

  describe('VoiceProviderError', () => {
    it('should quote the provider, the status and the body', () => {
      const error = new VoiceProviderError('deepgram', 401, ' Invalid credentials ');

      expect(error.message).to.equal('deepgram returned HTTP 401: Invalid credentials');
      expect(error.provider).to.equal('deepgram');
      expect(error.statusCode).to.equal(401);
      expect(error).to.be.an.instanceOf(Error);
    });

    it('should read as retryable only for a rate limit or a provider fault', () => {
      expect(new VoiceProviderError('deepgram', 429, '').isRetryable).to.equal(true);
      expect(new VoiceProviderError('deepgram', 503, '').isRetryable).to.equal(true);
      expect(new VoiceProviderError('deepgram', 400, '').isRetryable).to.equal(false);
      expect(new VoiceProviderError('deepgram', 401, '').isRetryable).to.equal(false);
      expect(new VoiceProviderError('deepgram', 415, '').isRetryable).to.equal(false);
    });

    it('should still say something with no body', () => {
      expect(new VoiceProviderError('cartesia', 500, '').message).to.equal(
        'cartesia returned HTTP 500',
      );
    });
  });

  describe('VoiceRequestError', () => {
    it('should carry its own message', () => {
      const error = new VoiceRequestError('Audio is too long');

      expect(error.message).to.equal('Audio is too long');
      expect(error).to.be.an.instanceOf(Error);
      expect(error).to.not.be.an.instanceOf(VoiceProviderError);
    });
  });
});
