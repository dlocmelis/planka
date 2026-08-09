# Chat with planka_bot (floating button)

A floating button in the bottom-right corner of every board opens a chat panel
with **planka_bot** — the devteam-orchestrator's board user. It mirrors the
Setlfi web assistant's launcher and docked panel.

Fork-specific: upstream PLANKA has no such widget.

## How it works

There is no new service, endpoint or credential behind this. The bot already
talks on the board, and the widget talks the same way:

- A message you type is posted as an ordinary **comment on a card**, addressed
  to the bot (`@[planka_bot](<id>)` — the mention markup the server stores).
- devteam-orchestrator triages every human comment on any card in any column
  and **always** posts a reply comment
  (`internal/fsm/fsm.go` → `internal/techlead/triage.go`).
- That reply reaches the open panel over the WebSocket the board is already
  subscribed to: the server broadcasts `commentCreate` to the whole
  `board:<id>` room, so the panel updates live without polling and without the
  card being open.

Because the transport is a card's comment thread, a conversation is always
*on a card*: it is where the bot reads the context from, and the exchange stays
visible to the rest of the board instead of living in a side channel. The panel
follows the card you have open; with none open it offers the board's cards to
pick from, the ones the bot has already spoken on first, and remembers the last
one you chose.

Comments arrive one page at a time (`Config.COMMENTS_LIMIT`, 50), so a long
conversation opens on its newest page with **Load earlier messages** above it —
the same backwards pagination the card's own comment list uses. Loading a page
keeps you looking at the message you were reading rather than dropping you at
the top of the new one.

The launcher only appears on a board that planka_bot is a **member** of — a
chat nobody is listening to is worse than no launcher — and only comments if
the current user's board membership allows it (editor, or `canComment`), which
is the same rule the server enforces on `POST /cards/:id/comments`.

## Setup

**Nothing to provision.** No environment variable, no migration, no new host,
no firewall rule, no credential. Deploying the client is the whole of it.

The one thing to keep true is the membership: **planka_bot must be a member of
each board the chat should be available on**, which it already is on any board
the orchestrator drives.

### Optional: a differently named bot

The username is read from `window.PLANKA_BOT_USERNAME` and falls back to
`planka_bot` (`client/src/constants/BotChat.js`), the same escape hatch
`Config.js` uses for `BASE_PATH`. To point the widget at a differently named
bot user, set it before the app bundle loads:

```html
<script>
  window.PLANKA_BOT_USERNAME = 'my_bot';
</script>
```

In development that goes in `client/index.html`. There is no checked-in
production template to edit: `client/vite.config.js` (`createEjsTemplate`)
GENERATES `client/dist/index.ejs` from the built `index.html` when the build
runs with `INDEX_FORMAT=ejs`, and that is also what injects the
`window.BASE_PATH` line; the `Dockerfile` copies `client/dist` into the
server's `public/`. So an override for a packaged install belongs in
`client/index.html` before the image is built, not in a file on the running
host.

Leave it unset for `planka_bot`.

## What a message costs

Every message is a comment, and every human comment on a card starts a triage
job in devteam-orchestrator — a whole agent session. So an answer takes
minutes rather than seconds, and it queues behind whatever else the pipeline
is running. The panel says `planka_bot is thinking…` while your message is the
last thing in the thread, and after ten minutes says so plainly instead of
spinning forever.

This is the cost the board already paid for commenting; the widget adds no new
one. It does make it much easier to spend, which is worth knowing.

## Where the code is

| Piece | File |
| --- | --- |
| Launcher position and panel width arithmetic, mention handling, comments → thread | `client/src/utils/bot-chat.js` |
| The bot as a board member, a card's thread, the cards offered as conversations | `client/src/selectors/bot-chat.js` |
| Launcher, panel, thread, composer, card picker | `client/src/components/common/BotChat/` |
| Mounted app-wide | `client/src/components/common/Core/Core.jsx` |
| Fetch/post comments for a card that is not the open one | `COMMENTS_FOR_CARD_FETCH` / `COMMENT_FOR_CARD_CREATE` (`client/src/entry-actions/comments.js`, `client/src/sagas/core/watchers/comments.js`) |

`client/src/utils/bot-chat.js` carries the parts ported from the Setlfi web
repo — the panel-width bounds, drag arithmetic and storage rules from
`lib/assistant/widget_width.ts`, the hold-then-drag launcher reposition from
`components/assistant/AssistantWidget.tsx`, and the transcript's
stick-to-the-bottom rule from `lib/assistant/transcript_scroll.ts` (the thread
follows new messages until you scroll up, and then leaves you where you put
yourself — a bot answer arrives minutes later, which is exactly the gap in
which you went back to read something). The provenance is recorded in the file.

What could not come across is the rendering: setl-web is Next.js + MUI and
planka's client is React 18 + redux-orm + semantic-ui + SCSS modules, so the
components are rebuilt on this app's own primitives rather than imported.
