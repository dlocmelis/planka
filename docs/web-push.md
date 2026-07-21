# Web Push Notifications

Standards-based Web Push (Push API + Notifications API + service worker) for
PLANKA, delivered in foreground, background, and app-closed states.

Reference: <https://github.com/plankanban/planka/discussions/1461>

## How it works

- The server exposes its VAPID **public** key in `GET /api/bootstrap`
  (`webPush.vapidPublicKey`) when the feature is enabled.
- The client registers a plain, unbundled service worker (`/sw.js`), subscribes
  via `pushManager.subscribe()`, and POSTs the subscription to
  `POST /api/push-subscriptions`.
- When a notification is created for a user (the same pipeline that feeds the
  in-app WebSocket delivery and Apprise), the server also sends a Web Push
  message to every active subscription of that user. Per-user event selection
  and preferences are inherited unchanged from the existing notification
  pipeline.
- Push delivery is fire-and-forget: failures are logged, never thrown — board
  operations are unaffected. Dead subscriptions (HTTP 404/410 from the push
  service) are marked `disabled_at`; transient 5xx/network errors are retried
  once after 1 s.

## Setup

### 1. Generate VAPID keys

```sh
cd server
npx web-push generate-vapid-keys
```

### 2. Configure environment

```sh
WEB_PUSH_ENABLED=true
WEB_PUSH_VAPID_PUBLIC_KEY=<public key from step 1>
WEB_PUSH_VAPID_PRIVATE_KEY=<private key from step 1>
WEB_PUSH_VAPID_SUBJECT=mailto:you@example.com
```

`WEB_PUSH_ENABLED` defaults to off; with it unset the instance behaves exactly
like upstream (no bootstrap field, no delivery, settings UI section hidden).

The migration `20260721000000_add_push_subscriptions.js` runs automatically on
startup (`db/init.js`) or via `npm run db:migrate` in `server/`.

### 3. docker-compose snippet

```yaml
services:
  planka:
    image: ghcr.io/plankanban/planka:latest # or your fork build
    environment:
      - WEB_PUSH_ENABLED=true
      - WEB_PUSH_VAPID_PUBLIC_KEY=your_public_key
      - WEB_PUSH_VAPID_PRIVATE_KEY=your_private_key
      - WEB_PUSH_VAPID_SUBJECT=mailto:you@example.com
```

### HTTPS requirement

Web Push requires a secure context. Serve PLANKA over HTTPS in production;
`localhost` is exempt for development.

## User instructions per platform

- **Chrome/Edge/Firefox desktop** — User Settings → Notifications → enable
  "Push notifications". Allow the browser permission prompt. Use "Send test
  notification" to verify.
- **Chrome/Edge on Android** — same as desktop. Background and closed-app
  delivery works, including screen-off.
- **Safari on macOS (16+, macOS 13+)** — same as desktop; requires HTTPS.
  Works with Safari fully closed (APNs via the Web Push protocol).
- **iOS / iPadOS 16.4+** — push is only available for installed PWAs. Tap
  Share → "Add to Home Screen", open the installed app, then enable the toggle
  in Settings → Notifications. When the app is not installed, the settings
  pane shows an "Add to Home Screen" hint instead of the toggle.
- **Permission denied** — if notifications were previously blocked, the
  settings pane shows guidance; the user must reset the permission in the
  browser's site settings.

Clicking a notification focuses an open PLANKA window on the triggering card,
or opens a new window on that card.

## API

All endpoints require authentication and operate on the current user only.

- `POST /api/push-subscriptions` — `{ endpoint, keys: { p256dh, auth }, userAgent? }`.
  Idempotent on `endpoint` (re-subscribing updates keys and re-enables).
- `DELETE /api/push-subscriptions` — `{ endpoint }`. Idempotent.
- `GET /api/push-subscriptions` — the current user's subscriptions.
- `POST /api/push-subscriptions/test` — sends a test push to the current
  user's active subscriptions.

## Test matrix results

Automated (all passing):

- `server`: `npm run lint`, `npm test` (11 tests, incl. 7 new: payload shape,
  disabled no-op, `lastUsedAt` on success, `disabled_at` on 404/410, no throw
  on other client errors).
- `client`: `npm run lint`, `npm run build`, `npm test`.
- Sails lift with `WEB_PUSH_ENABLED=true` + VAPID keys: OK; bootstrap contains
  `webPush.vapidPublicKey` (public key only); all 4 routes registered.
- Sails lift with defaults: OK; `bootstrap.webPush` absent — upstream
  behaviour unchanged (acceptance criterion 8).

Manual device matrix — **not yet executed** (requires a public HTTPS instance
and physical devices). Steps for each row: run an instance with the feature
enabled, create users A and B, subscribe A to a card, enable push for A, then:

1. A enables push in settings → test button delivers a notification.
2. B moves the card → A receives a notification with the tab in foreground,
   in background, and with the browser/PWA fully closed.
3. Clicking the notification opens/focuses PLANKA on that card.
4. iOS Safari: A2HS hint shown before install; steps 1–3 pass after install
   with the PWA closed.
5. Android Chrome: steps 1–3 pass, including screen-off delivery.
6. Delete the subscription server-side → next event produces no push and no
   errors.
7. Simulate 410 (e.g. unsubscribe via browser devtools) → subscription is
   disabled, board ops unaffected.

## Known limitations

- iOS in-browser (non-installed) push is impossible by platform design — the
  UI shows the Add-to-Home-Screen hint instead.
- Push payloads reuse the in-app notification title/body builders; card
  content shown is the same as in-app notifications.
- New UI strings are English-only for now (other locales fall back to en-US).
- `pushsubscriptionchange` re-subscription is not handled; the client re-POSTs
  an existing subscription on every app start instead.
- No SQL-level foreign keys, matching upstream migration conventions.

## Files touched (upstream-merge review)

### Modified — server

- `server/config/custom.js` — 4 `webPush*` env settings.
- `server/config/routes.js` — 4 push-subscription routes.
- `server/api/helpers/bootstrap/present-one.js` — expose public VAPID key when
  enabled.
- `server/api/helpers/notifications/create-one.js` — fire-and-forget push
  delivery next to the Apprise/email block.
- `server/api/helpers/notifications/create-many.js` — same hook.
- `server/.env.sample` — documented env vars.
- `server/package.json` / `server/package-lock.json` — `web-push` dependency
  (the only new dependency).

### Modified — client

- `client/src/components/users/UserSettingsModal/NotificationsPane.jsx` —
  push section (toggle, test button, iOS/unsupported/denied states).
- `client/src/components/users/UserSettingsModal/NotificationsPane.module.scss`
  — styles for the above.
- `client/src/selectors/common.js` — `selectWebPushBootstrap`,
  `selectWebPushState`.
- `client/src/sagas/core/services/core.js` — re-sync existing subscription on
  app start when web push is enabled.
- `client/src/constants/ActionTypes.js` / `EntryActionTypes.js` — new action
  types.
- `client/src/actions/index.js`, `client/src/api/index.js`,
  `client/src/entry-actions/index.js`,
  `client/src/sagas/core/services/index.js`,
  `client/src/sagas/core/watchers/index.js`,
  `client/src/reducers/ui/index.js` — wiring (one import + registration each).
- `client/src/locales/en-US/core.js` — 9 new strings under `common`.

### Added — server

- `server/db/migrations/20260721000000_add_push_subscriptions.js`
- `server/api/models/PushSubscription.js`
- `server/api/hooks/query-methods/models/PushSubscription.js`
- `server/api/controllers/push-subscriptions/{create,delete,index,test}.js`
- `server/api/helpers/utils/send-web-push.js`
- `server/utils/web-push.js` (payload builder)
- `server/test/utils/web-push.test.js`

### Added — client

- `client/public/sw.js` — service worker (push + notificationclick).
- `client/src/utils/web-push.js` — support/iOS detection, SW registration,
  subscribe/unsubscribe helpers.
- `client/src/api/push-subscriptions.js`
- `client/src/actions/push-subscriptions.js`
- `client/src/entry-actions/push-subscriptions.js`
- `client/src/sagas/core/services/push-subscriptions.js`
- `client/src/sagas/core/watchers/push-subscriptions.js`
- `client/src/reducers/ui/web-push-state.js`
