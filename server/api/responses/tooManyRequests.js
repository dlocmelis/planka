/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * tooManyRequests.js
 *
 * A custom response.
 *
 * Used by the voice endpoints when a caller has spent their share of what the
 * deployment is willing to pay a speech provider for in one window. It is the
 * fourth of the four things those two routes can say that no other route in
 * PLANKA needs to, and like the other three it is deliberately distinct: a 503
 * makes the client withdraw the feature and a 502 makes it stop the mode, while
 * this one means the mode is fine and this one turn came too soon.
 *
 * `retryAfterSec` is answered in the body as well as in the `Retry-After`
 * header, because the browser half of voice chat does not go through the saga
 * layer and reads only the JSON body of a failed request — it uses it to hold
 * the microphone shut for that long rather than uploading a recording it
 * already knows will be refused.
 *
 * Example usage:
 * ```
 *     return res.tooManyRequests();
 *     // -or-
 *     return res.tooManyRequests({ message, retryAfterSec });
 * ```
 *
 * Or with actions2:
 * ```
 *     exits: {
 *       somethingHappened: {
 *         responseType: 'tooManyRequests'
 *       }
 *     }
 * ```
 *
 * ```
 *     throw 'somethingHappened';
 *     // -or-
 *     throw { somethingHappened: optionalData }
 * ```
 */

/**
 * @swagger
 * components:
 *   responses:
 *     TooManyRequests:
 *       description: The caller has used their share of the metered feature for now
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *               - message
 *             properties:
 *               code:
 *                 type: string
 *                 description: Error code
 *                 example: E_TOO_MANY_REQUESTS
 *               message:
 *                 type: string
 *                 description: Error message
 *                 example: Too many voice turns just now; try again in a moment
 *               retryAfterSec:
 *                 type: integer
 *                 description: How long until the next turn would be accepted
 *                 example: 12
 */

module.exports = function tooManyRequests(data) {
  const { res } = this;

  // A bare string is accepted so this reads like every other error response in
  // the app; the object form is what the voice routes send, because they know
  // when the budget comes back.
  const { message, retryAfterSec } = typeof data === 'string' ? { message: data } : data || {};

  if (retryAfterSec > 0) {
    res.set('Retry-After', String(Math.ceil(retryAfterSec)));
  }

  return res.status(429).json({
    code: 'E_TOO_MANY_REQUESTS',
    message,
    ...(retryAfterSec > 0 && { retryAfterSec: Math.ceil(retryAfterSec) }),
  });
};
