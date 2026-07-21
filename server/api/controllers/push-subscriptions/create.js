/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * @swagger
 * /push-subscriptions:
 *   post:
 *     summary: Create push subscription
 *     description: Creates a push subscription for the current user. If a subscription with the same endpoint already exists, it is updated and reassigned to the current user (idempotent).
 *     tags:
 *       - Push Subscriptions
 *     operationId: createPushSubscription
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - endpoint
 *               - keys
 *             properties:
 *               endpoint:
 *                 type: string
 *                 maxLength: 512
 *                 description: Push service endpoint URL
 *                 example: https://push.service.example.com/subscription/abc123
 *               keys:
 *                 type: object
 *                 required:
 *                   - p256dh
 *                   - auth
 *                 properties:
 *                   p256dh:
 *                     type: string
 *                     description: P-256 ECDH public key used for payload encryption
 *                     example: BOr4lZv5y0lZHZ5ZzN6fQ3F0dW...
 *                   auth:
 *                     type: string
 *                     description: Auth secret used for payload encryption
 *                     example: dGVzdGF1dGhzZWNyZXQ...
 *               userAgent:
 *                 type: string
 *                 maxLength: 512
 *                 description: User agent of the browser creating the subscription
 *                 example: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36
 *     responses:
 *       200:
 *         description: Push subscription created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - item
 *               properties:
 *                 item:
 *                   $ref: '#/components/schemas/PushSubscription'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

module.exports = {
  inputs: {
    endpoint: {
      type: 'string',
      maxLength: 512,
      required: true,
    },
    keys: {
      type: 'json',
      custom: (value) =>
        _.isPlainObject(value) && _.isString(value.p256dh) && _.isString(value.auth),
      required: true,
    },
    userAgent: {
      type: 'string',
      maxLength: 512,
    },
  },

  async fn(inputs) {
    const { currentUser } = this.req;

    const values = {
      endpoint: inputs.endpoint,
      keysP256dh: inputs.keys.p256dh,
      keysAuth: inputs.keys.auth,
      userAgent: inputs.userAgent || null,
    };

    let pushSubscription = await PushSubscription.qm.getOneByEndpoint(inputs.endpoint);

    if (pushSubscription) {
      pushSubscription = await PushSubscription.qm.updateOne(
        { id: pushSubscription.id },
        {
          ...values,
          userId: currentUser.id,
          disabledAt: null,
        },
      );
    } else {
      pushSubscription = await PushSubscription.qm.createOne({
        ...values,
        userId: currentUser.id,
      });
    }

    return {
      item: pushSubscription,
    };
  },
};
