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

export default {
  BOT_USERNAME,
};
