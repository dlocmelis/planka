/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * @swagger
 * /push-subscriptions:
 *   delete:
 *     summary: Delete push subscription
 *     description: Deletes the push subscription with the given endpoint belonging to the current user. Succeeds even if no matching subscription exists (idempotent).
 *     tags:
 *       - Push Subscriptions
 *     operationId: deletePushSubscription
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - endpoint
 *             properties:
 *               endpoint:
 *                 type: string
 *                 maxLength: 512
 *                 description: Push service endpoint URL
 *                 example: https://push.service.example.com/subscription/abc123
 *     responses:
 *       200:
 *         description: Push subscription deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - item
 *               properties:
 *                 item:
 *                   nullable: true
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
  },

  async fn(inputs) {
    const { currentUser } = this.req;

    const pushSubscription = await PushSubscription.qm.deleteOne({
      endpoint: inputs.endpoint,
      userId: currentUser.id,
    });

    return {
      item: pushSubscription || null,
    };
  },
};
