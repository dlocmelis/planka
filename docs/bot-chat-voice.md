# Voice chat with planka_bot

A microphone button beside Send in the planka_bot panel turns the conversation
hands-free: you talk, it notices when you have stopped, it posts what you said
as a comment, and it reads the answer back to you out loud. Nothing is pressed
in between.

It is off unless a deployment has provisioned two credentials — see *Setup*
below. Where they are absent the button is still there, disabled, saying that
voice chat is not available on this server; a composer with no voice control at
all leaves the feature undiscoverable on exactly the deployments where somebody
has to be told it is not configured.

Fork-specific: upstream PLANKA has none of this.

## How it works

The transport is the one `docs/bot-chat.md` describes and nothing about it
changes: a message is still a comment on a card, and the bot's answer is still
the comment it posts back over the board's WebSocket. Voice chat only replaces
the typing and the reading.

Once around the loop:

| Phase | What is happening |
| --- | --- |
| `listening` | The microphone is open. Nothing is being uploaded. |
| `capturing` | You have been talking for 300 ms, so this is a turn. |
| `transcribing` | A second of silence ended the turn; the recording is on its way. |
| `thinking` | The transcript was posted as a comment and planka_bot has it. |
| `speaking` | The reply is being read aloud. |

The two ends of a turn are decided by a voice-activity detector that runs in the
browser, frame by frame, at 50 ms — `client/src/utils/voice-chat.js`. It tracks
the noise floor of the room rather than using a fixed threshold (a laptop fan,
an open-plan office and a quiet room are 25 dB apart), credits speech rather
than timing an unbroken run (ordinary speech has 50-300 ms of silence between
its words), and does not count a background tab's throttled timer as silence.
The numbers, and the reasons they are what they are, are in that file.

**The loop is half-duplex.** While the answer is being read aloud the microphone
stays open but nothing it hears can start a turn, and the status row carries a
**Stop speaking** button. Talking over the answer is not how you interrupt it.
That is a deliberate difference from the Setlfi assistant, which does permit
barge-in and needs a whole second subsystem to recognise its own voice coming
back through the microphone; the header of `client/src/utils/voice-chat.js` sets
out why this one does not.

**A reply that was already on the card is never read out.** Only a bot comment
that arrived after the mode was switched on for this conversation is spoken, and
each is spoken once — including when the synthesis failed, which is not retried.

**The mode is remembered per browser** (`planka-bot-chat-voice`), like the
panel's width. Nothing opens a microphone on the strength of that alone: the
loop only starts once the panel is open on a card you may comment on, and a
browser that will not resume audio without a user gesture stops the mode with a
sentence rather than listening at nothing.

## What it costs

Both endpoints are metered — transcription per audio minute, speech per
character — so the loop is written to spend as little as it can:

- A silent recording is thrown away and restarted every 4 seconds, so only the
  speech that eventually arrives is uploaded.
- A turn is force-ended at 45 seconds rather than growing without bound.
- A burst of noise that a provider heard nothing in ("" or ".") is not posted,
  so it costs no comment and no agent session.
- Nothing is ever retried automatically.

And every message is still a comment, so every message still starts a triage job
in devteam-orchestrator — a whole agent session. Voice chat does not change that
cost; it does make it easier to spend, which is worth knowing.

## Privacy

**The audio is never stored.** It is decoded from the request, held only long
enough to be forwarded to the provider, and dropped when the handler returns: no
temp file, no attachment record, and neither the audio nor the transcript text
goes into a log line. The per-request log records the transcript's LENGTH,
because that is the cost signal, and not its content. A change that wants to
keep audio — for a retry, for debugging — is changing that contract.

What does leave the server is the recording (to Deepgram) and the reply's text
(to Cartesia). A deployment that cannot send either to a third party should
leave the two keys unset, which is the default.

## Setup

**Two credentials, both optional, and each turns on one half.** With neither
set, everything below is inert and the panel behaves exactly as it did before.

| Variable | What it turns on |
| --- | --- |
| `DEEPGRAM_API_KEY` | Speech-to-text. Empty → `POST /api/cards/:cardId/voice/transcription` answers 503 and the bootstrap reports `sttEnabled: false`. |
| `CARTESIA_API_KEY` | Text-to-speech. Empty → `POST /api/cards/:cardId/voice/speech` answers 503 and the bootstrap reports `ttsEnabled: false`. |

**Voice chat needs BOTH.** A mode that can hear and not answer is not a
conversation, so the toggle stays disabled unless both halves are configured.

No migration, no new host, no firewall rule beyond outbound HTTPS to
`api.deepgram.com` and `api.cartesia.ai` (which honours `OUTGOING_PROXY` like
every other outbound call this server makes).

### The rest of the knobs

Every one of these has a working default; a deployment that sets only the two
keys above gets a sensible configuration.

| Variable | Default | Notes |
| --- | --- | --- |
| `VOICE_STT_PROVIDER` | `deepgram` | The only accepted value. |
| `VOICE_STT_MODEL` | `nova-3` | The model that serves both keyterm prompting and `language=multi`. |
| `VOICE_STT_LANGUAGE` | `multi` | Nova-3's code-switching mode (en/es/fr/de/hi/ru/pt/ja/it/nl). A BCP-47 code such as `lv` transcribes that language alone. |
| `VOICE_STT_KEYTERMS` | `PLANKA,planka_bot` | Comma-separated product vocabulary, sent as repeated `keyterm` parameters. |
| `VOICE_STT_MAX_BYTES` | `700kb` | See the note below before raising it. |
| `VOICE_STT_MAX_DURATION_SEC` | `300` | Enforced against the duration the provider reports. |
| `VOICE_STT_TIMEOUT_SEC` | `60` | |
| `VOICE_TTS_PROVIDER` | `cartesia` | The only accepted value. |
| `VOICE_TTS_MODEL` | `sonic-3.5` | |
| `VOICE_TTS_VOICE` | Cartesia's documented "Skylar" id | The fallback voice, used when no language was resolved. |
| `VOICE_TTS_VOICES` | *(empty)* | Per-language pins, `ru=<id>,de=<id>`. Two-letter codes only — the key is matched against a DETECTED language, which is always the ISO-639-1 form. |
| `VOICE_TTS_OUTPUT_FORMAT` | `mp3` | `mp3` or `wav`. |
| `VOICE_TTS_SAMPLE_RATE` | `44100` | |
| `VOICE_TTS_BIT_RATE` | `128000` | mp3 only. |
| `VOICE_TTS_MAX_CHARS` | `2000` | A longer message is refused rather than truncated. |
| `VOICE_TTS_TIMEOUT_SEC` | `60` | |

A misconfigured knob is loud and leaves its half off, rather than fatal: an
invalid provider, output format or voice map logs an error at boot and disables
that half. A typo in one optional value must not stop PLANKA from booting, and
silently serving the default instead would be the "nobody chose this" failure
the validation exists to prevent.

### Why 700 KB, and what happens if you raise it

An utterance travels **base64-encoded inside a JSON body**, because Sails' body
parser consumes any unrecognised content type before an action can read a raw
stream, and the multipart path spools large parts to disk — which the privacy
note above forbids. That parser admits **1 MB** (`skipper`'s default for JSON
and urlencoded bodies), so 700 KB of audio (~956 KB encoded) is what fits with
room for the envelope.

Raising `VOICE_STT_MAX_BYTES` past that does not raise the real ceiling: an
oversized upload stops being the 422 the client knows how to explain and becomes
a body-parser error instead. To raise it for real, raise the body parser's limit
in `server/config/http.js` as well — which raises it for every route.

The client keeps its side of this bargain by asking `MediaRecorder` for 32
kbit/s, which is transparent for speech and puts a full 45-second utterance at
about 180 KB. Left to itself Chrome would record at 128 kbit/s.

## Where the code is

| Piece | File |
| --- | --- |
| Endpointing, recorder choice, phases, storage — all pure | `client/src/utils/voice-chat.js` |
| Microphone, sampler, recorder, upload, playback | `client/src/hooks/use-voice-chat.js` |
| The toggle beside Send, the status row | `client/src/components/common/BotChat/{Composer,VoiceStatus}.jsx` |
| Mode state, which reply to speak, posting a transcript | `client/src/components/common/BotChat/BotChat.jsx` |
| The two calls | `client/src/api/voice.js`, `http.postJson` |
| What this deployment may do, read from the bootstrap | `client/src/selectors/common.js` → `selectVoiceChatCapability` |
| Transcription endpoint | `server/api/controllers/voice/transcribe.js` |
| Speech endpoint | `server/api/controllers/voice/speak.js` |
| Deepgram / Cartesia | `server/api/helpers/voice/{transcribe,synthesize}.js` |
| Allowlist, voice map, length rules | `server/utils/voice.js` |
| Markdown → speakable text, table narration | `server/utils/voice-speech-text.js` |
| Config resolution and the feature gate | `server/api/helpers/voice/get-config.js` |
| Capability reported to the client | `server/api/helpers/bootstrap/present-one.js` |

## What was ported, and what was not

The ticket asked for the Setlfi assistant's own TTS and STT logic, and this is
what came across:

- **Endpointing** — `vadStep`, the noise-floor tracker, the gap rule, the speech
  credit and the whole tuning, from setl-web's `lib/assistant/voice_chat.ts`.
- **Recording** — the container candidates and the "can this browser record at
  all" test, from setl-web's `lib/assistant/stt.ts`.
- **The Deepgram call** — the query it builds and the fields it reads back, from
  setl's `data/core/stt/deepgram.go`; the upload allowlist and the error
  classification from `data/core/stt/stt.go`.
- **The Cartesia call** — the request shape, the mandatory `Cartesia-Version`
  header, both credential headers and the refusal to follow redirects, from
  setl's `data/core/tts/cartesia.go`.
- **Markdown → speech** — the strip and the table narration, verbatim, from
  setl's `data/core/tts/markdown.go` and `table.go`. The cases in
  `server/test/utils/voice-speech-text.test.js` are the same inputs and the same
  expectations as `TestNarrateTable` there, so a table is read out the same way
  by both products. **Change one side and change the other.**

Three things were deliberately left behind, each with its reason recorded beside
the code:

- **Barge-in and echo suppression** (setl-web's `suppressEchoedSpeech`) — see
  "half-duplex" above.
- **The number pass** (setl's `data/core/tts/numbers.go`, "1.2M" → "1.2
  million") — it is gated on the message being English and it rewrites the
  author's own characters, where being wrong about the locale changes a figure's
  value. A board comment is not the per-merchant financial table it was written
  for.
- **Streaming synthesis** — the assistant streams its answer and speaks it in
  parts. A planka_bot reply arrives complete, minutes later, so the whole clip is
  synthesized in one request. The voice/language pin the assistant needs for
  multi-part replies is still carried, so a conversation keeps one voice.
