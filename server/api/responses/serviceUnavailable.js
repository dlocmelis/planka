/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * serviceUnavailable.js
 *
 * A custom response.
 *
 * Used by the voice endpoints for the one thing they can say about themselves
 * that is neither the caller's fault nor a failure: the feature is not
 * configured on this server. The client treats it as exactly that — it
 * re-reads the bootstrap and stops offering the control — so it must not be
 * answered for a rate limit or a provider outage, which would remove the
 * feature from the user's screen until they reloaded the app.
 *
 * Example usage:
 * ```
 *     return res.serviceUnavailable();
 *     // -or-
 *     return res.serviceUnavailable(optionalData);
 * ```
 *
 * Or with actions2:
 * ```
 *     exits: {
 *       somethingHappened: {
 *         responseType: 'serviceUnavailable'
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
 *     ServiceUnavailable:
 *       description: The requested feature is not configured on this server
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
 *                 example: E_SERVICE_UNAVAILABLE
 *               message:
 *                 type: string
 *                 description: Error message
 *                 example: Voice chat is not configured on this server
 */

module.exports = function serviceUnavailable(message) {
  const { res } = this;

  return res.status(503).json({
    code: 'E_SERVICE_UNAVAILABLE',
    message,
  });
};
