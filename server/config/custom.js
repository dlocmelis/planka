/**
 * Custom configuration
 * (sails.config.custom)
 *
 * One-off settings specific to your application.
 *
 * For more information on custom configuration, visit:
 * https://sailsjs.com/config/custom
 */

const path = require('path');
const { URL } = require('url');
const bytes = require('bytes');
const sails = require('sails');

const version = require('../version');

const envToNumber = (value) => {
  if (!value) {
    return null;
  }

  const number = parseInt(value, 10);
  return Number.isNaN(number) ? null : number;
};

const envToBytes = (value) => bytes(value);

const envToArray = (value) => (value ? value.split(',') : []);

const baseUrl = envToArray(process.env.BASE_URL)[0];
const parsedBasedUrl = new URL(baseUrl);

module.exports.custom = {
  /**
   *
   * Any other custom config this Sails app should use during development.
   *
   */

  version,

  baseUrl,
  baseUrlPath: parsedBasedUrl.pathname.replace(/\/$/, ''), // Remove trailing slash
  baseUrlSecure: parsedBasedUrl.protocol === 'https:',

  maxUploadFileSize: envToBytes(process.env.MAX_UPLOAD_FILE_SIZE),
  tokenExpiresIn: (parseInt(process.env.TOKEN_EXPIRES_IN, 10) || 365) * 24 * 60 * 60,

  storageLimit: envToBytes(process.env.STORAGE_LIMIT),
  activeUsersLimit: envToNumber(process.env.ACTIVE_USERS_LIMIT),

  // Location to receive uploaded files in. Default (non-string value) is a Sails-specific location.
  uploadsTempPath: null,
  uploadsBasePath: path.join(sails.config.appPath, 'data'),

  faviconsPathSegment: 'protected/favicons',
  userAvatarsPathSegment: 'protected/user-avatars',
  backgroundImagesPathSegment: 'protected/background-images',
  attachmentsPathSegment: 'private/attachments',

  defaultAdminEmail:
    process.env.DEFAULT_ADMIN_EMAIL && process.env.DEFAULT_ADMIN_EMAIL.toLowerCase(),

  showDetailedAuthErrors: process.env.SHOW_DETAILED_AUTH_ERRORS === 'true',
  outgoingProxy: process.env.OUTGOING_PROXY,
  swaggerExposed: process.env.SWAGGER_EXPOSED === 'true',

  s3Endpoint: process.env.S3_ENDPOINT,
  s3Region: process.env.S3_REGION,
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  s3Bucket: process.env.S3_BUCKET,
  s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  s3RequestChecksumCalculation: process.env.S3_REQUEST_CHECKSUM_CALCULATION,

  oidcIssuer: process.env.OIDC_ISSUER,
  oidcClientId: process.env.OIDC_CLIENT_ID,
  oidcClientSecret: process.env.OIDC_CLIENT_SECRET,
  oidcUseOauthCallback: process.env.OIDC_USE_OAUTH_CALLBACK === 'true',
  oidcIdTokenSignedResponseAlg: process.env.OIDC_ID_TOKEN_SIGNED_RESPONSE_ALG,
  oidcUserinfoSignedResponseAlg: process.env.OIDC_USERINFO_SIGNED_RESPONSE_ALG,
  oidcScopes: process.env.OIDC_SCOPES || 'openid email profile',
  oidcResponseMode: process.env.OIDC_RESPONSE_MODE || 'fragment',
  oidcUseDefaultResponseMode: process.env.OIDC_USE_DEFAULT_RESPONSE_MODE === 'true',
  oidcAdminRoles: envToArray(process.env.OIDC_ADMIN_ROLES),
  oidcProjectOwnerRoles: envToArray(process.env.OIDC_PROJECT_OWNER_ROLES),
  oidcBoardUserRoles: envToArray(process.env.OIDC_BOARD_USER_ROLES),
  oidcClaimsSource: process.env.OIDC_CLAIMS_SOURCE || 'userinfo',
  oidcEmailAttribute: process.env.OIDC_EMAIL_ATTRIBUTE || 'email',
  oidcNameAttribute: process.env.OIDC_NAME_ATTRIBUTE || 'name',
  oidcUsernameAttribute: process.env.OIDC_USERNAME_ATTRIBUTE || 'preferred_username',
  oidcRolesAttribute: process.env.OIDC_ROLES_ATTRIBUTE || 'groups',
  oidcIgnoreUsername: process.env.OIDC_IGNORE_USERNAME === 'true',
  oidcIgnoreRoles: process.env.OIDC_IGNORE_ROLES === 'true',
  oidcEnforced: process.env.OIDC_ENFORCED === 'true',
  oidcTimeout: envToNumber(process.env.OIDC_TIMEOUT),
  oidcDebug: process.env.OIDC_DEBUG === 'true',

  // TODO: move client base url to environment variable?
  oidcRedirectUri: `${
    sails.config.environment === 'production' ? baseUrl : 'http://localhost:3000'
  }/oidc-callback`,

  smtpHost: process.env.SMTP_HOST,
  smtpPort: process.env.SMTP_PORT || 587,
  smtpName: process.env.SMTP_NAME,
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpTlsRejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
  smtpUser: process.env.SMTP_USER,
  smtpPassword: process.env.SMTP_PASSWORD,
  smtpFrom: process.env.SMTP_FROM,

  gravatarBaseUrl: process.env.GRAVATAR_BASE_URL,

  /* Voice chat with planka_bot (see docs/bot-chat-voice.md) */

  // Speech-to-text. An empty key is the whole of the feature gate: no key, no
  // provider, the route answers 503 and the bootstrap reports the mode
  // unavailable — the same shape setl's DeepgramAPIKey has.
  deepgramApiKey: process.env.DEEPGRAM_API_KEY,
  voiceSttProvider: process.env.VOICE_STT_PROVIDER || 'deepgram',
  voiceSttModel: process.env.VOICE_STT_MODEL || 'nova-3',
  // 'multi' is Nova-3's code-switching mode (en/es/fr/de/hi/ru/pt/ja/it/nl);
  // a BCP-47 code such as 'lv' transcribes that language alone.
  voiceSttLanguage: process.env.VOICE_STT_LANGUAGE || 'multi',
  voiceSttKeyterms: process.env.VOICE_STT_KEYTERMS || 'PLANKA,planka_bot',
  // The upload cap, and it is NOT arbitrary: an utterance travels base64-encoded
  // inside a JSON body, and the body parser in front of every route admits 1 MB
  // (skipper's default). 700 KB of audio is ~956 KB encoded, which fits with
  // room for the envelope. Raising this without also raising the body-parser
  // limit turns an oversized recording into a parser error instead of the
  // 422 the client knows how to explain.
  voiceSttMaxBytes: envToBytes(process.env.VOICE_STT_MAX_BYTES || '700kb'),
  // Enforced against the duration the provider reports: browsers do not write a
  // reliable duration into a streamed webm/ogg container, so nothing before the
  // call can be trusted. That also makes it the ceiling a refusal has already
  // been billed for, which is why it is published in the bootstrap and the
  // browser ends its turns inside it (client/src/utils/voice-chat.js
  // `voiceChatTuning`, `recordingAvailability`).
  voiceSttMaxDurationSec: envToNumber(process.env.VOICE_STT_MAX_DURATION_SEC) || 300,
  voiceSttTimeoutSec: envToNumber(process.env.VOICE_STT_TIMEOUT_SEC) || 60,
  // The per-user spending cap, and the only cap in this feature that bounds
  // more than one request. Transcription is billed per audio minute, so it has
  // both a request ceiling and an audio-seconds ceiling per window — see
  // `utils/voice-rate-limit.js` for why one of the two is not enough.
  //
  // These three carry no default HERE, unlike everything above, because 0 is a
  // meaningful value for them — it turns that dimension off, for a deployment
  // that limits at its own reverse proxy — and `x || default` cannot say it.
  // `api/helpers/voice/get-config.js` applies the defaults and refuses a
  // negative.
  voiceSttRateWindowSec: envToNumber(process.env.VOICE_STT_RATE_WINDOW_SEC),
  voiceSttRateMaxRequests: envToNumber(process.env.VOICE_STT_RATE_MAX_REQUESTS),
  voiceSttRateMaxSeconds: envToNumber(process.env.VOICE_STT_RATE_MAX_SECONDS),

  // Text-to-speech, gated the same way.
  cartesiaApiKey: process.env.CARTESIA_API_KEY,
  voiceTtsProvider: process.env.VOICE_TTS_PROVIDER || 'cartesia',
  voiceTtsModel: process.env.VOICE_TTS_MODEL || 'sonic-3.5',
  // Cartesia's own documented example voice ("Skylar", en-US) — a public, stable
  // id rather than one picked off an account-scoped list.
  voiceTtsVoice: process.env.VOICE_TTS_VOICE || 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4',
  // Per-language pins for the voice switch, `ru=<id>,de=<id>`. A language with
  // no entry is looked up in the provider's catalogue (see voiceTtsAutoVoice)
  // and, failing that, read by the voice above.
  voiceTtsVoices: process.env.VOICE_TTS_VOICES || '',
  // The automatic switch: a language with no pin of its own gets a voice from
  // Cartesia's own catalogue, one lookup per language per process. On by
  // default, as it is in setl — Cartesia's voices are published PER LANGUAGE,
  // so with it off every non-English reply is read by the English fallback
  // voice above. Written `!== 'false'` rather than the `=== 'true'` the rest of
  // this file uses because this one defaults ON: an unset key must leave it on.
  voiceTtsAutoVoice: process.env.VOICE_TTS_AUTO_VOICE !== 'false',
  voiceTtsOutputFormat: process.env.VOICE_TTS_OUTPUT_FORMAT || 'mp3',
  voiceTtsSampleRate: envToNumber(process.env.VOICE_TTS_SAMPLE_RATE) || 44100,
  voiceTtsBitRate: envToNumber(process.env.VOICE_TTS_BIT_RATE) || 128000,
  // Longer input is rejected with a 422, never truncated. Lower than setl's
  // 5000 because this endpoint answers with the whole clip in one response
  // rather than streaming it, so the ceiling is also the bound on how much
  // audio is held in memory at once.
  voiceTtsMaxChars: envToNumber(process.env.VOICE_TTS_MAX_CHARS) || 2000,
  voiceTtsTimeoutSec: envToNumber(process.env.VOICE_TTS_TIMEOUT_SEC) || 60,
  // The same cap for the other half, in the unit this one is billed in:
  // characters of SYNTHESIZED speech. Note that is not the same as characters
  // sent — narration expands a table, and the ceiling on that expansion is
  // `PREPARED_TEXT_FACTOR` — so the budget is spent against what the provider
  // actually read, which the controller settles up once it knows.
  voiceTtsRateWindowSec: envToNumber(process.env.VOICE_TTS_RATE_WINDOW_SEC),
  voiceTtsRateMaxRequests: envToNumber(process.env.VOICE_TTS_RATE_MAX_REQUESTS),
  voiceTtsRateMaxChars: envToNumber(process.env.VOICE_TTS_RATE_MAX_CHARS),

  /* Internal */

  internalAccessToken: process.env.INTERNAL_ACCESS_TOKEN,
  termsType: process.env.TERMS_TYPE || 'custom',
  customerPanelUrl: process.env.CUSTOMER_PANEL_URL,
  demoMode: process.env.DEMO_MODE === 'true',
};
