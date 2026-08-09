/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import BotChat from './BotChat';

/* Both of these values are contracts with devteam-orchestrator, which lives in
 * another repository — nothing here can import from it, and nothing there can
 * import from here. So they are pinned: changing one has to be a deliberate
 * edit on both sides, in the same deployment, rather than a rename that leaves
 * every test in both repositories green and the widget talking to nobody.
 *
 * The failure is silent in the worst way. A wrong column name does not throw:
 * the picker simply stops offering the general chat (there is no such column),
 * or offers a conversation the orchestrator answers as a ticket comment. */

test('the bot username matches the account devteam-orchestrator posts as', () => {
  // devteam-orchestrator: BOT_USERNAME in its .env; the client's default is
  // what an install without `window.PLANKA_BOT_USERNAME` uses.
  expect(BotChat.BOT_USERNAME).toBe('planka_bot');
});

test('the general chat column matches the one the orchestrator creates', () => {
  // devteam-orchestrator: internal/fsm/fsm.go `ListChat`, created by
  // internal/setup on every startup along with the single card in it. Cards in
  // that column are answered as a conversation instead of being triaged as a
  // request about a ticket, which is the whole of this feature.
  expect(BotChat.CHAT_LIST_NAME).toBe('Chat');
});
