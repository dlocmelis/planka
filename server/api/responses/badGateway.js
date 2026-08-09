/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * badGateway.js
 *
 * A custom response.
 *
 * Used by the voice endpoints when an upstream speech provider failed or
 * refused the request for a reason that is not the caller's fault. It is
 * deliberately distinct from `serviceUnavailable`: a 503 on those routes means
 * the feature is not configured and makes the client stop offering it, so
 * answering it for a rate limit or a provider outage would take the feature off
 * the user's screen until they reloaded the app.
 *
 * Example usage:
 * ```
 *     return res.badGateway();
 *     // -or-
 *     return res.badGateway(optionalData);
 * ```
 *
 * Or with actions2:
 * ```
 *     exits: {
 *       somethingHappened: {
 *         responseType: 'badGateway'
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
 *     BadGateway:
 *       description: An upstream service failed or refused the request
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
 *                 example: E_BAD_GATEWAY
 *               message:
 *                 type: string
 *                 description: Error message
 *                 example: The transcription service rejected the request
 */

module.exports = function badGateway(message) {
  const { res } = this;

  return res.status(502).json({
    code: 'E_BAD_GATEWAY',
    message,
  });
};
