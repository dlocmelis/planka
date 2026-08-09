const http = require('http');
const { expect } = require('chai');
const supertest = require('supertest');

const endpoints = require('../../../utils/voice-endpoints');

/**
 * The two voice endpoints, driven through the real router, the real policies
 * and the real provider clients — with the providers themselves replaced by a
 * local server that records what was sent to it.
 *
 * What these are for is everything a unit test of the helpers cannot see: that
 * the routes exist and are reachable, that an anonymous caller is refused, that
 * the feature gate answers 503 rather than 500, that the card scoping is the
 * board's own membership rule, and that the request this server actually puts
 * on the wire is the one the providers document.
 */
describe('Voice chat endpoints', function describeVoice() {
  this.timeout(30000);

  let request;
  let project;
  let board;
  let list;
  let card;
  let editor;
  let viewer;
  let outsider;

  const tokens = {};

  let provider;
  let providerUrl;
  let providerCalls;
  let providerResponses;

  let originalCustom;
  let originalDeepgramUrl;
  let originalCartesiaUrl;

  const mintAccessToken = async (user) => {
    const { token } = sails.helpers.utils.createJwtToken(user.id);

    await sails.helpers.sessions.createOne.with({
      values: {
        accessToken: token,
        userId: user.id,
        remoteAddress: '127.0.0.1',
        userAgent: 'mocha',
      },
    });

    return token;
  };

  /**
   * Point the config at a new object rather than mutating the one that is
   * there: `sails.helpers.voice.getConfig` caches against the object's
   * identity, so a mutated key would not be seen.
   */
  const configure = (values) => {
    sails.config.custom = { ...originalCustom, ...values };
  };

  /** A deployment with both credentials, plus whatever this test wants to
   * change about it. Every override goes through here rather than through
   * `configure`, which would drop the keys and turn the feature gate off. */
  const withVoice = (values) =>
    configure({
      deepgramApiKey: 'deepgram-test-key',
      cartesiaApiKey: 'cartesia-test-key',
      voiceSttMaxBytes: 700 * 1024,
      voiceSttMaxDurationSec: 300,
      voiceTtsMaxChars: 2000,
      voiceTtsVoices: 'ru=voice-ru',
      ...values,
    });

  const postTranscription = (token, body) => {
    const req = request.post(`/api/cards/${card.id}/voice/transcription`);

    if (token) {
      req.set('Authorization', `Bearer ${token}`);
    }

    return req.send(body);
  };

  const postSpeech = (token, body) => {
    const req = request.post(`/api/cards/${card.id}/voice/speech`);

    if (token) {
      req.set('Authorization', `Bearer ${token}`);
    }

    return req.send(body);
  };

  const audioBody = (bytes = 1024) => ({
    data: Buffer.alloc(bytes, 7).toString('base64'),
    mimeType: 'audio/webm;codecs=opus',
  });

  before(async () => {
    request = supertest(sails.hooks.http.app);

    originalCustom = sails.config.custom;
    originalDeepgramUrl = endpoints.deepgramListenUrl;
    originalCartesiaUrl = endpoints.cartesiaBaseUrl;

    provider = http.createServer((req, res) => {
      const chunks = [];

      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const call = {
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks),
        };

        providerCalls.push(call);

        let canned = providerResponses.deepgram;

        if (req.url.startsWith('/tts/bytes')) {
          canned = providerResponses.cartesia;
        } else if (req.url.startsWith('/voices/')) {
          canned = providerResponses.voices;
        }

        res.writeHead(canned.status, canned.headers);
        res.end(canned.body);
      });
    });

    await new Promise((resolve) => {
      provider.listen(0, '127.0.0.1', resolve);
    });

    providerUrl = `http://127.0.0.1:${provider.address().port}`;
    endpoints.deepgramListenUrl = `${providerUrl}/v1/listen`;
    endpoints.cartesiaBaseUrl = providerUrl;

    // GET /bootstrap reads it, and an in-memory test datastore starts empty —
    // this is the row `db/init.js` writes on a real install.
    const internalConfig = await InternalConfig.qm.getOneMain();

    if (!internalConfig) {
      await InternalConfig.create({
        id: InternalConfig.MAIN_ID,
        isInitialized: true,
      }).fetch();
    }

    project = await Project.create({
      id: '1925476504885136001',
      name: 'Voice Test Project',
    }).fetch();

    board = await Board.create({
      id: '1925476504885136002',
      projectId: project.id,
      position: 1,
      name: 'Voice Test Board',
    }).fetch();

    list = await List.create({
      id: '1925476504885136003',
      boardId: board.id,
      type: List.Types.ACTIVE,
      position: 65536,
      name: 'Voice Test List',
    }).fetch();

    card = await Card.create({
      id: '1925476504885136004',
      boardId: board.id,
      listId: list.id,
      type: Card.Types.PROJECT,
      position: 65536,
      name: 'Voice Test Card',
    }).fetch();

    [editor, viewer, outsider] = await Promise.all(
      ['voiceeditor', 'voiceviewer', 'voiceoutsider'].map((name, index) =>
        User.create({
          id: `192547650488513600${5 + index}`,
          email: `${name}@example.com`,
          username: name,
          role: User.Roles.BOARD_USER,
          name,
        }).fetch(),
      ),
    );

    await BoardMembership.create({
      projectId: project.id,
      boardId: board.id,
      userId: editor.id,
      role: BoardMembership.Roles.EDITOR,
    }).fetch();

    await BoardMembership.create({
      projectId: project.id,
      boardId: board.id,
      userId: viewer.id,
      role: BoardMembership.Roles.VIEWER,
      canComment: false,
    }).fetch();

    tokens.editor = await mintAccessToken(editor);
    tokens.viewer = await mintAccessToken(viewer);
    tokens.outsider = await mintAccessToken(outsider);
  });

  after(async () => {
    sails.config.custom = originalCustom;
    endpoints.deepgramListenUrl = originalDeepgramUrl;
    endpoints.cartesiaBaseUrl = originalCartesiaUrl;

    await new Promise((resolve) => {
      provider.close(resolve);
    });
  });

  beforeEach(() => {
    providerCalls = [];
    providerResponses = {
      deepgram: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metadata: { duration: 2.5 },
          results: {
            channels: [
              {
                alternatives: [{ transcript: '  what is blocking this  ', confidence: 0.94 }],
                languages: ['en'],
              },
            ],
          },
        }),
      },
      cartesia: {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
        body: Buffer.from([0xff, 0xfb, 0x90, 0x00]),
      },
      // GET /voices/ — the catalogue the automatic voice switch reads. The
      // shape is Cartesia's, cut to the fields the switch uses.
      voices: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          has_more: false,
          data: [
            {
              id: 'catalog-covers-de',
              language: 'de',
              locales: [
                { locale: 'en-US', is_native: true },
                { locale: 'de-DE', is_native: false },
              ],
            },
            {
              id: 'catalog-native-de',
              language: 'de',
              locales: [{ locale: 'de-DE', is_native: true }],
            },
          ],
        }),
      },
    };

    withVoice();
  });

  describe('when neither credential is configured', () => {
    beforeEach(() => {
      configure({ deepgramApiKey: '', cartesiaApiKey: '' });
    });

    it('answers 503 on both routes, and calls no provider', async () => {
      // 503 is the one status the client branches on: it means the feature is
      // not configured here, so the controls are withdrawn rather than the user
      // being told to try again.
      const transcription = await postTranscription(tokens.editor, audioBody());
      expect(transcription.status).to.equal(503);
      expect(transcription.body.code).to.equal('E_SERVICE_UNAVAILABLE');

      const speech = await postSpeech(tokens.editor, { text: 'hello' });
      expect(speech.status).to.equal(503);

      expect(providerCalls).to.have.lengthOf(0);
    });

    it('reports both halves off in the bootstrap', async () => {
      const res = await request.get('/api/bootstrap');

      expect(res.status).to.equal(200);
      expect(res.body.item.voiceChat).to.deep.equal({
        sttEnabled: false,
        ttsEnabled: false,
        sttMaxBytes: null,
        sttMaxDurationSec: null,
        ttsMaxChars: null,
      });
    });
  });

  describe('the bootstrap capability', () => {
    it('reports each half separately, with the caps the client checks against', async () => {
      withVoice({ cartesiaApiKey: '' });

      const res = await request.get('/api/bootstrap');

      expect(res.body.item.voiceChat.sttEnabled).to.equal(true);
      expect(res.body.item.voiceChat.ttsEnabled).to.equal(false);
      expect(res.body.item.voiceChat.sttMaxBytes).to.equal(700 * 1024);
      expect(res.body.item.voiceChat.ttsMaxChars).to.equal(null);
    });
  });

  /**
   * A typo in an optional knob must not stop PLANKA from booting, and must not
   * silently serve the default instead — it leaves that ONE half off and says
   * so (see `api/helpers/voice/get-config.js`). Driven through the bootstrap
   * and the routes rather than through the helper, because "that half stays
   * disabled" only means anything if the endpoint really answers 503 and the
   * client is really told the mode is unavailable.
   */
  describe('when a knob is misconfigured', () => {
    const cases = [
      {
        what: 'a speech-to-text provider nobody implements',
        values: { voiceSttProvider: 'whisper' },
        half: 'stt',
      },
      {
        what: 'a text-to-speech provider nobody implements',
        values: { voiceTtsProvider: 'elevenlabs' },
        half: 'tts',
      },
      {
        what: 'an output format the request builder has no shape for',
        values: { voiceTtsOutputFormat: 'flac' },
        half: 'tts',
      },
      {
        what: 'a voice map that is not <language>=<voice id>',
        values: { voiceTtsVoices: 'russian' },
        half: 'tts',
      },
      {
        what: 'a voice map naming one language twice, differently',
        values: { voiceTtsVoices: 'ru=voice-one,ru-RU=voice-two' },
        half: 'tts',
      },
      {
        // The one that is not one wrong accent but a provider 400 on every
        // message: this voice reads everything no language was resolved for.
        what: 'a fallback voice that is not a voice id',
        values: { voiceTtsVoice: 'the nice sounding one' },
        half: 'tts',
      },
      {
        what: 'a fallback voice set to nothing at all',
        values: { voiceTtsVoice: '   ' },
        half: 'tts',
      },
    ];

    cases.forEach(({ what, values, half }) => {
      it(`leaves only the affected half off for ${what}`, async () => {
        withVoice(values);

        const bootstrap = await request.get('/api/bootstrap');

        expect(bootstrap.status).to.equal(200);
        expect(bootstrap.body.item.voiceChat.sttEnabled).to.equal(half !== 'stt');
        expect(bootstrap.body.item.voiceChat.ttsEnabled).to.equal(half !== 'tts');

        const broken =
          half === 'stt'
            ? await postTranscription(tokens.editor, audioBody())
            : await postSpeech(tokens.editor, { text: 'hello' });

        expect(broken.status).to.equal(503);
        expect(broken.body.code).to.equal('E_SERVICE_UNAVAILABLE');

        // Nothing was dialled for the broken half — a misconfigured deployment
        // must not be spending on a provider it cannot ask properly.
        expect(providerCalls).to.have.lengthOf(0);

        // ...and the other half is untouched, which is the whole point of
        // failing one at a time.
        const working =
          half === 'stt'
            ? await postSpeech(tokens.editor, { text: 'hello' })
            : await postTranscription(tokens.editor, audioBody());

        expect(working.status).to.equal(200);
      });
    });
  });

  describe('POST /cards/:cardId/voice/transcription', () => {
    it('refuses an anonymous caller', async () => {
      const res = await postTranscription(null, audioBody());

      expect(res.status).to.equal(401);
      expect(providerCalls).to.have.lengthOf(0);
    });

    it('transcribes for a board editor', async () => {
      const res = await postTranscription(tokens.editor, audioBody());

      expect(res.status).to.equal(200);
      expect(res.body.item).to.deep.equal({
        text: 'what is blocking this',
        languages: ['en'],
        durationSec: 2.5,
        confidence: 0.94,
      });
    });

    it('sends the provider the request its documentation describes', async () => {
      await postTranscription(tokens.editor, audioBody(64));

      expect(providerCalls).to.have.lengthOf(1);

      const [call] = providerCalls;
      const url = new URL(`${providerUrl}${call.url}`);

      expect(url.pathname).to.equal('/v1/listen');
      expect(url.searchParams.get('model')).to.equal('nova-3');
      expect(url.searchParams.get('language')).to.equal('multi');
      expect(url.searchParams.get('smart_format')).to.equal('true');
      // Repeated once per term, which is the Nova-3 feature. The older
      // `keywords` parameter is silently ignored by Nova-3 — it would look
      // configured and do nothing.
      expect(url.searchParams.getAll('keyterm')).to.deep.equal(['PLANKA', 'planka_bot']);

      expect(call.headers.authorization).to.equal('Token deepgram-test-key');
      expect(call.headers['content-type']).to.equal('audio/webm');
      // The audio itself, not a base64 string and not a multipart envelope.
      expect(call.body).to.have.lengthOf(64);
    });

    it('refuses a container that is not on the allowlist, before calling anyone', async () => {
      const res = await postTranscription(tokens.editor, {
        ...audioBody(),
        mimeType: 'application/octet-stream',
      });

      expect(res.status).to.equal(422);
      expect(res.body.message).to.contain('Unsupported audio content type');
      expect(providerCalls).to.have.lengthOf(0);
    });

    it('refuses a recording with no bytes in it, before calling anyone', async () => {
      // `====` is legal base64 for nothing at all — the shape a recorder that
      // produced silence would upload. An empty STRING never reaches the
      // handler: the action's own `required` check answers 400 first.
      const nothing = await postTranscription(tokens.editor, { ...audioBody(), data: '====' });
      expect(nothing.status).to.equal(422);
      expect(nothing.body.message).to.contain('empty');

      const absent = await postTranscription(tokens.editor, { ...audioBody(), data: '' });
      expect(absent.status).to.equal(400);

      expect(providerCalls).to.have.lengthOf(0);
    });

    it('refuses a recording over the cap, before calling anyone', async () => {
      withVoice({ voiceSttMaxBytes: 10 });

      const res = await postTranscription(tokens.editor, audioBody(64));

      expect(res.status).to.equal(422);
      expect(res.body.message).to.contain('too large');
      expect(providerCalls).to.have.lengthOf(0);
    });

    it('discards a transcript whose audio was longer than the cap', async () => {
      // Enforced against the duration the PROVIDER reports: nothing in a
      // browser-produced webm states it reliably, so this is the first
      // trustworthy measurement. The transcript is discarded rather than
      // returned truncated.
      withVoice({ voiceSttMaxDurationSec: 1 });

      const res = await postTranscription(tokens.editor, audioBody());

      expect(res.status).to.equal(422);
      expect(res.body.message).to.contain('too long');
    });

    it('refuses a member who may not comment', async () => {
      // The transcript is about to be posted as a comment, so the bar is the
      // bar for commenting.
      const res = await postTranscription(tokens.viewer, audioBody());

      expect(res.status).to.equal(403);
      expect(providerCalls).to.have.lengthOf(0);
    });

    it('answers 404 to somebody who is not on the board at all', async () => {
      const res = await postTranscription(tokens.outsider, audioBody());

      expect(res.status).to.equal(404);
      expect(providerCalls).to.have.lengthOf(0);
    });

    it('does not re-report a provider refusal as this server failing', async () => {
      providerResponses.deepgram = { status: 400, headers: {}, body: 'bad audio' };

      const res = await postTranscription(tokens.editor, audioBody());

      expect(res.status).to.equal(422);
      // Fixed copy, not the vendor's error page.
      expect(res.body.message).to.not.contain('bad audio');
    });

    it('answers 502 when the provider itself is broken', async () => {
      providerResponses.deepgram = { status: 500, headers: {}, body: 'upstream on fire' };

      const res = await postTranscription(tokens.editor, audioBody());

      expect(res.status).to.equal(502);
      expect(res.body.code).to.equal('E_BAD_GATEWAY');
      expect(res.body.message).to.not.contain('upstream on fire');
    });
  });

  describe('POST /cards/:cardId/voice/speech', () => {
    it('refuses an anonymous caller', async () => {
      const res = await postSpeech(null, { text: 'hello' });

      expect(res.status).to.equal(401);
      expect(providerCalls).to.have.lengthOf(0);
    });

    it('answers with the audio, base64-encoded, and the voice that read it', async () => {
      const res = await postSpeech(tokens.editor, { text: 'It is waiting on review.' });

      expect(res.status).to.equal(200);
      expect(res.body.item.mimeType).to.equal('audio/mpeg');
      expect(Buffer.from(res.body.item.data, 'base64')).to.deep.equal(
        Buffer.from([0xff, 0xfb, 0x90, 0x00]),
      );
      expect(res.body.item.voice).to.be.a('string');
    });

    it('sends the provider the request its documentation describes', async () => {
      await postSpeech(tokens.editor, { text: '## Heading\n\nSome **bold** text.' });

      expect(providerCalls).to.have.lengthOf(1);

      const [call] = providerCalls;
      expect(call.url).to.equal('/tts/bytes');
      // Mandatory: a request without it is answered 400.
      expect(call.headers['cartesia-version']).to.equal('2026-03-01');
      // Both headers Cartesia accepts, because they name the same secret and a
      // feature that may sit unprovisioned for months must not break silently
      // if one of them is retired.
      expect(call.headers.authorization).to.equal('Bearer cartesia-test-key');
      expect(call.headers['x-api-key']).to.equal('cartesia-test-key');

      const body = JSON.parse(call.body.toString());
      expect(body.model_id).to.equal('sonic-3.5');
      expect(body.voice).to.deep.equal({ mode: 'id', id: sails.config.custom.voiceTtsVoice });
      expect(body.output_format).to.deep.equal({
        container: 'mp3',
        sample_rate: 44100,
        bit_rate: 128000,
      });
      // The markdown is prepared, not read out as punctuation.
      expect(body.transcript).to.equal('Heading.\n\nSome bold text.');
      // No language was named, so none is sent and Cartesia infers it.
      expect(body).to.not.have.property('language');
    });

    it('narrates a table rather than reading its pipes aloud', async () => {
      await postSpeech(tokens.editor, {
        text: '| Merchant | Volume |\n|---|---|\n| Acme | 12 |\n| Globex | 34 |',
      });

      const body = JSON.parse(providerCalls[0].body.toString());

      expect(body.transcript).to.equal(
        'A table of 2 rows comparing Volume by Merchant. Acme: 12. Globex: 34.',
      );
    });

    it('resolves the pinned voice for a language the deployment named', async () => {
      const res = await postSpeech(tokens.editor, { text: 'Ждём ревью.', language: 'ru-RU' });

      expect(res.status).to.equal(200);
      expect(res.body.item.voice).to.equal('voice-ru');
      // Reported WITH its language, which is what makes it safe to pin onto the
      // rest of the conversation.
      expect(res.body.item.language).to.equal('ru');

      const body = JSON.parse(providerCalls[0].body.toString());
      expect(body.voice).to.deep.equal({ mode: 'id', id: 'voice-ru' });
      expect(body.language).to.equal('ru');
    });

    it('reports no language when it resolved none, so nothing wrong gets pinned', async () => {
      const res = await postSpeech(tokens.editor, { text: 'Anything at all.' });

      expect(res.body.item.voice).to.equal(sails.config.custom.voiceTtsVoice);
      expect(res.body.item.language).to.equal(null);
    });

    it('speaks a voice the caller sent back rather than resolving a new one', async () => {
      await postSpeech(tokens.editor, {
        text: 'Second answer.',
        voice: 'voice-ru',
        language: 'ru',
      });

      const body = JSON.parse(providerCalls[0].body.toString());
      expect(body.voice).to.deep.equal({ mode: 'id', id: 'voice-ru' });
    });

    it('lets a board viewer hear the thread they are allowed to read', async () => {
      // Membership is the whole bar: commenting is a different act, gated where
      // it happens.
      const res = await postSpeech(tokens.viewer, { text: 'It is waiting on review.' });

      expect(res.status).to.equal(200);
    });

    it('answers 404 to somebody who is not on the board at all', async () => {
      const res = await postSpeech(tokens.outsider, { text: 'hello' });

      expect(res.status).to.equal(404);
      expect(providerCalls).to.have.lengthOf(0);
    });

    it('refuses a message over the character ceiling, before calling anyone', async () => {
      withVoice({ voiceTtsMaxChars: 10 });

      const res = await postSpeech(tokens.editor, { text: 'far more than ten characters' });

      expect(res.status).to.equal(422);
      expect(res.body.message).to.contain('too long');
      expect(providerCalls).to.have.lengthOf(0);
    });

    it('refuses a message with nothing speakable in it', async () => {
      const res = await postSpeech(tokens.editor, { text: '```\ncode()\n```' });

      // A fenced block reduces to the placeholder, which IS speakable — so the
      // case that must be refused is one that reduces to nothing at all.
      expect(res.status).to.equal(200);

      const bare = await postSpeech(tokens.editor, { text: '###' });
      expect(bare.status).to.equal(422);
    });

    it('refuses a language hint that is not one', async () => {
      const res = await postSpeech(tokens.editor, { text: 'hello', language: 'english' });

      expect(res.status).to.equal(422);
      expect(providerCalls).to.have.lengthOf(0);
    });

    /**
     * The automatic voice switch: a language the deployment has NOT pinned a
     * voice for is looked up in the provider's own catalogue.
     *
     * It matters because Cartesia's voices are published PER LANGUAGE — the
     * fallback this ships is an en-US voice — and the transcription default is
     * `multi`, ten languages including Russian. Without the switch, every
     * non-English reply on a deployment that configured nothing but the two
     * keys is read by an English voice.
     */
    describe('the automatic voice switch', () => {
      /** Only the calls to GET /voices/, in order. */
      const lookups = () => providerCalls.filter((call) => call.url.startsWith('/voices/'));

      it('asks the catalogue for a language nobody pinned, and prefers a native voice', async () => {
        const res = await postSpeech(tokens.editor, {
          text: 'Es wartet auf Review.',
          language: 'de',
        });

        expect(res.status).to.equal(200);
        // Not `catalog-covers-de`, which merely covers de-DE: a covering voice
        // is the very thing the switch exists to move away from.
        expect(res.body.item.voice).to.equal('catalog-native-de');
        expect(res.body.item.language).to.equal('de');

        expect(lookups()).to.have.lengthOf(1);
        expect(lookups()[0].url).to.equal('/voices/?limit=10&language=de');

        const speech = providerCalls.find((call) => call.url === '/tts/bytes');
        const body = JSON.parse(speech.body.toString());
        expect(body.voice).to.deep.equal({ mode: 'id', id: 'catalog-native-de' });
        // Named on the wire, which is safe now: this voice was published for it.
        expect(body.language).to.equal('de');
      });

      it('sends the lookup the same version and credential headers as the synthesis', async () => {
        await postSpeech(tokens.editor, { text: 'Es wartet auf Review.', language: 'de' });

        const [lookup] = lookups();
        expect(lookup.headers['cartesia-version']).to.equal('2026-03-01');
        expect(lookup.headers.authorization).to.equal('Bearer cartesia-test-key');
        expect(lookup.headers['x-api-key']).to.equal('cartesia-test-key');
      });

      it('asks once per language, not once per message', async () => {
        // The lookup sits IN FRONT of the audio, so paying for it on every
        // message is the thing the cache exists to stop.
        await postSpeech(tokens.editor, { text: 'Erste Antwort.', language: 'de' });
        await postSpeech(tokens.editor, { text: 'Zweite Antwort.', language: 'de-AT' });

        expect(lookups()).to.have.lengthOf(1);
        expect(providerCalls.filter((call) => call.url === '/tts/bytes')).to.have.lengthOf(2);
      });

      it('never asks for a language the deployment pinned itself', async () => {
        // `withVoice` pins ru=voice-ru. A deployment that has chosen its voices
        // must not pay for a round trip to be told so.
        const res = await postSpeech(tokens.editor, { text: 'Ждём ревью.', language: 'ru' });

        expect(res.body.item.voice).to.equal('voice-ru');
        expect(lookups()).to.have.lengthOf(0);
      });

      it('falls back without a language when the catalogue serves none', async () => {
        // Latvian is exactly this case against the live API: the listing comes
        // back empty. The fallback voice reads it and the language is NOT sent
        // — naming a language a voice was not published for is a 400 on every
        // message, which is worse than an accent.
        providerResponses.voices = {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ has_more: false, data: [] }),
        };

        const res = await postSpeech(tokens.editor, {
          text: 'Gaida pārskatīšanu.',
          language: 'lv',
        });

        expect(res.status).to.equal(200);
        expect(res.body.item.voice).to.equal(sails.config.custom.voiceTtsVoice);
        expect(res.body.item.language).to.equal(null);

        const speech = providerCalls.find((call) => call.url === '/tts/bytes');
        expect(JSON.parse(speech.body.toString())).to.not.have.property('language');
      });

      it('still answers when the lookup itself fails', async () => {
        // A catalogue that is down must cost the message its switch, not its
        // answer.
        providerResponses.voices = { status: 500, headers: {}, body: 'catalogue on fire' };

        const res = await postSpeech(tokens.editor, {
          text: 'Es wartet auf Review.',
          language: 'de',
        });

        expect(res.status).to.equal(200);
        expect(res.body.item.voice).to.equal(sails.config.custom.voiceTtsVoice);
        expect(res.body.item.language).to.equal(null);
      });

      it('does not re-ask a failed language on the very next message', async () => {
        providerResponses.voices = { status: 500, headers: {}, body: 'catalogue on fire' };

        await postSpeech(tokens.editor, { text: 'Erste Antwort.', language: 'de' });
        await postSpeech(tokens.editor, { text: 'Zweite Antwort.', language: 'de' });

        // A provider that HANGS would otherwise cost every message the timeout.
        expect(lookups()).to.have.lengthOf(1);
      });

      it('asks nobody when the switch is turned off', async () => {
        withVoice({ voiceTtsAutoVoice: false });

        const res = await postSpeech(tokens.editor, {
          text: 'Es wartet auf Review.',
          language: 'de',
        });

        expect(res.status).to.equal(200);
        expect(lookups()).to.have.lengthOf(0);
        expect(res.body.item.voice).to.equal(sails.config.custom.voiceTtsVoice);
        expect(res.body.item.language).to.equal(null);
      });

      it('asks nobody when the caller sent a voice back', async () => {
        // The pin that keeps one conversation in one voice outranks everything.
        const res = await postSpeech(tokens.editor, {
          text: 'Zweite Antwort.',
          voice: 'catalog-native-de',
          language: 'de',
        });

        expect(res.body.item.voice).to.equal('catalog-native-de');
        expect(lookups()).to.have.lengthOf(0);
      });
    });

    it('answers 502 when the provider is broken, and never plays silence', async () => {
      providerResponses.cartesia = {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
        body: Buffer.alloc(0),
      };

      const res = await postSpeech(tokens.editor, { text: 'hello' });

      // A 200 with no audio in it: the characters were billed and there is
      // nothing to play, so it is a failure rather than a silent clip.
      expect(res.status).to.equal(502);
    });
  });
});
