/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

const UNAUTHORIZED = 'E_UNAUTHORIZED';
// A request this account is authenticated for and not allowed to make — a board
// role downgraded while the page was open, which is reachable with a card modal
// still on screen (see the card-dependencies saga).
const FORBIDDEN = 'E_FORBIDDEN';
const NOT_FOUND = 'E_NOT_FOUND';
const CONFLICT = 'E_CONFLICT';
const UNPROCESSABLE_ENTITY = 'E_UNPROCESSABLE_ENTITY';
// Sent by the two metered voice endpoints when this user has had their share of
// what the deployment pays a speech provider for. Like a 422 it refuses ONE
// turn and leaves the mode alone — unlike one, it also says when to come back.
const TOO_MANY_REQUESTS = 'E_TOO_MANY_REQUESTS';
const BAD_GATEWAY = 'E_BAD_GATEWAY';
// The one error code the voice chat mode branches on rather than just showing:
// it means the feature is not configured on this server, so the controls are
// withdrawn instead of the user being told to try again.
const SERVICE_UNAVAILABLE = 'E_SERVICE_UNAVAILABLE';

export default {
  UNAUTHORIZED,
  FORBIDDEN,
  NOT_FOUND,
  CONFLICT,
  UNPROCESSABLE_ENTITY,
  TOO_MANY_REQUESTS,
  BAD_GATEWAY,
  SERVICE_UNAVAILABLE,
};
