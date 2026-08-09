/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * Who the floating chat talks to.
 *
 * The bot is an ordinary Planka user — devteam-orchestrator posts as it and
 * answers every human comment on a card — so the client needs nothing but its
 * username to find it among the board's members.
 *
 * `window.PLANKA_BOT_USERNAME` overrides it at runtime, the same escape hatch
 * `Config.js` uses for `BASE_PATH`: a renamed bot then needs no rebuild, and
 * an install without the override still gets the name this board actually
 * uses. Nothing has to be provisioned for the default to work.
 */
const BOT_USERNAME = (typeof window !== 'undefined' && window.PLANKA_BOT_USERNAME) || 'planka_bot';

/**
 * The board column holding the general chat — the conversation with the bot
 * that is not about a ticket.
 *
 * A chat has to live somewhere the bot can hear it and answer, and the only
 * channel between this board and devteam-orchestrator is a card's comment
 * thread. So the general chat is a card too, in a service column of its own:
 * the orchestrator creates the column and the card at startup
 * (`internal/setup`, `fsm.ListChat`), treats every card in that column as a
 * conversation rather than a ticket, and answers its comments with a chat
 * flow instead of the triage that acts on a card.
 *
 * The LIST is the contract between the two sides, not the card's name — so a
 * card somebody renames is still the general chat, and this client needs to
 * know one string rather than two. `window.PLANKA_BOT_CHAT_LIST` overrides
 * it at runtime exactly like `PLANKA_BOT_USERNAME` above, for a board that
 * spells the column differently.
 */
const CHAT_LIST_NAME = (typeof window !== 'undefined' && window.PLANKA_BOT_CHAT_LIST) || 'Chat';

export default {
  BOT_USERNAME,
  CHAT_LIST_NAME,
};
