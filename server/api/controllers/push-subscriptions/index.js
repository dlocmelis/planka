/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * @swagger
 * /push-subscriptions:
 *   get:
 *     summary: Get push subscriptions
 *     description: Retrieves all push subscriptions of the current user.
 *     tags:
 *       - Push Subscriptions
 *     operationId: getPushSubscriptions
 *     responses:
 *       200:
 *         description: Push subscriptions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - items
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PushSubscription'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

module.exports = {
  async fn() {
    const { currentUser } = this.req;

    const pushSubscriptions = await PushSubscription.qm.getByUserId(currentUser.id);

    return {
      items: pushSubscriptions,
    };
  },
};
