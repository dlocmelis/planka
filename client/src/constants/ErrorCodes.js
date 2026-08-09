/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

const UNAUTHORIZED = 'E_UNAUTHORIZED';
const NOT_FOUND = 'E_NOT_FOUND';
const CONFLICT = 'E_CONFLICT';
const UNPROCESSABLE_ENTITY = 'E_UNPROCESSABLE_ENTITY';
const BAD_GATEWAY = 'E_BAD_GATEWAY';
// The one error code the voice chat mode branches on rather than just showing:
// it means the feature is not configured on this server, so the controls are
// withdrawn instead of the user being told to try again.
const SERVICE_UNAVAILABLE = 'E_SERVICE_UNAVAILABLE';

export default {
  UNAUTHORIZED,
  NOT_FOUND,
  CONFLICT,
  UNPROCESSABLE_ENTITY,
  BAD_GATEWAY,
  SERVICE_UNAVAILABLE,
};
