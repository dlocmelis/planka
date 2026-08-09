/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * The decisions the voice endpoints make before they touch a provider.
 *
 * Ported from the Setlfi assistant's own speech stack, which is the code this
 * ticket was told to reuse: the upload allowlist, the keyterm parsing and the
 * error classification come from setl's `data/core/stt/stt.go`, and the voice
 * map, the id/language shapes and the character counting from
 * `data/core/tts/cartesia.go`. Go cannot cross into a Sails app, so what came
 * across is the half that actually encodes the behaviour — and it is pure, so
 * `npm test` drives all of it (test/utils/voice.test.js).
 *
 * The two error types the endpoints classify failures with live in
 * `voice-provider-error.js` and `voice-request-error.js` — one class per file
 * is this repo's rule — and are re-exported here so a caller needs one require.
 */

const VoiceProviderError = require('./voice-provider-error');
const VoiceRequestError = require('./voice-request-error');

/**
 * The dated contract every Cartesia request belongs to, synthesis and voice
 * lookup alike.
 *
 * The header is MANDATORY — a request without it is answered 400
 * ("Cartesia-Version header is required in YYYY-MM-DD form") — and because it
 * is DATED, bumping it means re-reading the request shapes in
 * `api/helpers/voice/{synthesize,lookup-voice}.js`, not just the constant. It
 * is here rather than beside either of them because two callers send it and a
 * second copy is how they come to disagree.
 */
const CARTESIA_VERSION = '2026-03-01';

/**
 * The containers a browser's MediaRecorder actually produces, plus the two a
 * non-browser client (a test, curl) reaches for first.
 *
 * Deepgram sniffs the container out of the body regardless, so this list is
 * OUR bound on what may be uploaded rather than the provider's. `video/webm`,
 * `video/mp4` and `video/ogg` are here because Firefox labels an ogg/opus
 * recording `video/ogg` on some versions and Chrome's MediaRecorder offers
 * `video/webm` for an audio-only stream when `audio/webm` is unavailable —
 * both carry exactly the audio we asked for, so refusing them would reject
 * working recordings over a label.
 */
const AUDIO_MIME_TYPES = [
  'audio/aac',
  'audio/flac',
  'audio/m4a',
  'audio/mp4',
  'audio/mpeg',
  'audio/mpg',
  'audio/ogg',
  'audio/wav',
  'audio/wave',
  'audio/webm',
  'audio/x-m4a',
  'audio/x-wav',
  'video/mp4',
  'video/ogg',
  'video/webm',
];

const AUDIO_MIME_TYPE_SET = new Set(AUDIO_MIME_TYPES);

/** The accepted content types, sorted, for error messages and documentation. */
const allowedAudioMimeTypes = () => [...AUDIO_MIME_TYPES].sort();

/**
 * The parameters and casing a browser attaches stripped off
 * (`audio/webm;codecs=opus` → `audio/webm`), so the allowlist can be an exact
 * match.
 *
 * Returns null for anything outside it, including an empty value: an upload
 * with no content type is a client that did not send what it recorded, and
 * guessing on its behalf is how unsupported audio reaches the provider as a
 * paid request.
 */
const normalizeAudioMimeType = (mimeType) => {
  const base = String(mimeType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  return AUDIO_MIME_TYPE_SET.has(base) ? base : null;
};

/**
 * Splits the comma-separated product vocabulary into keyterms, dropping
 * blanks. Each term may itself be a multi-word phrase.
 *
 * The value is split HERE and sent as a repeated query parameter rather than
 * passed through whole: a value joined any other way ("a; b") arrives upstream
 * as one long term that silently boosts nothing.
 */
const parseKeyterms = (value) =>
  String(value || '')
    .split(',')
    .map((term) => term.trim())
    .filter((term) => term !== '');

/**
 * A voice id, as the provider writes them: at most 64 characters of letters,
 * digits and `_ . : -`. Checked rather than trusted because it goes on the
 * wire inside the synthesis request and comes back in a response header the
 * browser reads.
 */
const isVoiceId = (value) => /^[A-Za-z0-9_.:-]{1,64}$/.test(String(value || ''));

/** A primary language subtag: two or three ASCII letters. A region subtag is
 * accepted on the way in and reduced — see `normalizeLanguage`. */
const isLanguageCode = (value) => /^[A-Za-z]{2,3}$/.test(String(value || ''));

/**
 * A language tag reduced to its primary subtag, lowercased, or null when it is
 * not one.
 *
 * `ru-RU` and `ru` name the same voice, and a deployment that pinned one
 * spelling must not find the other unpinned — the same reduction setl's voice
 * map does.
 */
const normalizeLanguage = (value) => {
  const primary = String(value || '')
    .trim()
    .split(/[-_]/)[0]
    .toLowerCase();

  return isLanguageCode(primary) ? primary : null;
};

/**
 * The per-language voice pins, `ru=<id>,de=<id>`, as a map keyed by primary
 * subtag.
 *
 * Throws on a malformed entry rather than dropping it: a deployment that asked
 * for a Russian voice and silently got the default is the failure this
 * validation exists to prevent, and the throw is caught at boot, where it
 * leaves the feature off with an error in the log instead of taking the app
 * down (see api/helpers/voice/get-config.js).
 */
const parseVoiceMap = (raw) => {
  const map = {};

  String(raw || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .forEach((entry) => {
      const separatorIndex = entry.indexOf('=');

      if (separatorIndex <= 0) {
        throw new Error(`voice map entry '${entry}' is not '<language>=<voice id>'`);
      }

      const language = normalizeLanguage(entry.slice(0, separatorIndex));
      const voice = entry.slice(separatorIndex + 1).trim();

      // TWO letters here, though `isLanguageCode` allows two or three: the key
      // of this map is matched against the language a transcript was DETECTED
      // as, and that is always the ISO-639-1 form. A `rus=` entry validates,
      // sits in the map and can never be reached, which is a pinned voice that
      // silently does nothing — the exact failure the validation exists for.
      if (!language || language.length !== 2) {
        throw new Error(
          `voice map entry '${entry}' does not name a two-letter language code (ru, not rus)`,
        );
      }

      if (!isVoiceId(voice)) {
        throw new Error(`voice map entry '${entry}' does not name a voice id`);
      }

      // Two spellings of one language naming two different voices is a
      // coin toss decided by map order; which voice speaks Russian must not
      // differ between restarts.
      if (map[language] && map[language] !== voice) {
        throw new Error(
          `voice map names language '${language}' twice, as '${map[language]}' and '${voice}'`,
        );
      }

      map[language] = voice;
    });

  return map;
};

/**
 * The address `server/start.sh` exports for the Squid it starts itself.
 *
 * It is here so `isOutgoingHostAllowed` can tell that proxy from one the
 * deployment named, which is the difference between an allowlist that is in
 * force and one that was never built. THIS IS A TWIN of the value in
 * `start.sh`; changing it there changes it here.
 */
const INTERNAL_OUTGOING_PROXY = 'http://127.0.0.1:3128';

/**
 * Whether this deployment's outgoing allowlist would let a request out to
 * `hostname`: true, false, or null when the check cannot say.
 *
 * `server/start.sh` writes `http_access deny all` at the end of the Squid
 * config as soon as `OUTGOING_ALLOWED_HOSTS` or `OUTGOING_ALLOWED_IPS` is SET
 * AT ALL — the test there is `${VAR+x}`, so even an empty value flips the proxy
 * to deny-by-default — and each hostname it allows becomes a Squid `dstdomain`
 * ACL, where a bare `api.deepgram.com` matches that host exactly and a leading
 * dot (`.deepgram.com`) matches the domain and everything under it.
 *
 * Null, not false, wherever the answer would be a guess: no allowlist at all,
 * an outgoing proxy the deployment named itself (start.sh returns before
 * building any of these ACLs, and what that proxy permits is not ours to
 * assume), or an IP allowlist, whose entries may well be this host's own
 * addresses and cannot be resolved from here.
 */
const isOutgoingHostAllowed = (hostname, env) => {
  const source = env || {};
  const proxy = String(source.OUTGOING_PROXY || '').trim();

  if (proxy !== '' && proxy !== INTERNAL_OUTGOING_PROXY) {
    return null;
  }

  const hasHostAllowlist = source.OUTGOING_ALLOWED_HOSTS !== undefined;
  const hasIpAllowlist = source.OUTGOING_ALLOWED_IPS !== undefined;

  if (!hasHostAllowlist && !hasIpAllowlist) {
    return null;
  }

  const wanted = String(hostname || '')
    .trim()
    .toLowerCase();

  const isListed = String(source.OUTGOING_ALLOWED_HOSTS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '')
    .some((entry) =>
      entry.startsWith('.')
        ? wanted === entry.slice(1) || wanted.endsWith(entry)
        : wanted === entry,
    );

  if (isListed) {
    return true;
  }

  return String(source.OUTGOING_ALLOWED_IPS || '').trim() === '' ? false : null;
};

/**
 * The length a provider metered per character would measure, which is not
 * `text.length`.
 *
 * A JS string length counts UTF-16 code units, so anything outside the BMP —
 * an emoji in a reply — counts twice. Spreading the string iterates code
 * points, which is the unit the ceiling is expressed in and the unit the
 * frontend counts with the same helper.
 */
const speechTextLength = (text) => [...String(text || '')].length;

/**
 * How much of a provider's ERROR body is worth taking into memory before it is
 * quoted into a log line. Generous for an HTML error page, small enough that a
 * provider answering an outage with something enormous costs nothing.
 */
const MAX_PROVIDER_ERROR_BYTES = 64 * 1024;

/**
 * A response body, with a ceiling on how much of it is read and the connection
 * handed back the moment that ceiling is crossed.
 *
 * `response.json()`, `.text()` and `.arrayBuffer()` all read to the END of the
 * body whatever its size — the `.slice(0, 2048)` a caller then applies happens
 * once the whole thing is already in memory. Both voice halves talk to a third
 * party over a connection this process does not control, so both read through
 * here instead. The repo already answers the same question for favicons in
 * `api/helpers/utils/download-favicon.js`; this is that loop, shared.
 *
 * Answers `{ ok, buffer }`. `ok` is false when the body ran past `maxBytes`,
 * and whatever arrived before that is still in `buffer` so a caller quoting an
 * error page has something to quote.
 *
 * The caller is expected to run this INSIDE the window its abort timer covers:
 * clearing that timer when the headers arrive leaves the body read unbounded in
 * time, and a provider that stalls mid-body pins the request either way.
 */
const readBoundedBody = async (response, maxBytes) => {
  if (!response.body) {
    return { ok: true, buffer: Buffer.alloc(0) };
  }

  const reader = response.body.getReader();

  const chunks = [];
  let length = 0;

  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    chunks.push(value);
    length += value.length;

    if (length > maxBytes) {
      // Not awaited: the connection is being given up, and the only thing
      // waiting on it would be this request.
      reader.cancel().catch(() => {});

      return { ok: false, buffer: Buffer.concat(chunks) };
    }
  }

  return { ok: true, buffer: Buffer.concat(chunks) };
};

/**
 * Give a body back unread.
 *
 * An undici response whose body is never consumed holds its connection open
 * until it is, so a path that throws on the STATUS without touching the body —
 * which is the natural way to write it — leaks one connection per failure.
 */
const discardBody = (response) => {
  if (response.body) {
    response.body.cancel().catch(() => {});
  }
};

/** MB/KB for a byte count, for user-facing copy only. */
const formatBytes = (bytes) => {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${bytes} bytes`;
};

module.exports = {
  AUDIO_MIME_TYPES,
  CARTESIA_VERSION,
  INTERNAL_OUTGOING_PROXY,
  MAX_PROVIDER_ERROR_BYTES,
  VoiceProviderError,
  VoiceRequestError,
  allowedAudioMimeTypes,
  discardBody,
  formatBytes,
  isLanguageCode,
  isOutgoingHostAllowed,
  isVoiceId,
  normalizeAudioMimeType,
  normalizeLanguage,
  parseKeyterms,
  parseVoiceMap,
  readBoundedBody,
  speechTextLength,
};
