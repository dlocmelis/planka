/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * @swagger
 * /push-subscriptions/test:
 *   post:
 *     summary: Test push subscriptions
 *     description: Sends a test push notification to all active push subscriptions of the current user.
 *     tags:
 *       - Push Subscriptions
 *     operationId: testPushSubscriptions
 *     responses:
 *       200:
 *         description: Test push notification sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - item
 *               properties:
 *                 item:
 *                   nullable: true
 *                   example: null
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */

module.exports = {
  async fn() {
    const { currentUser } = this.req;

    const pushSubscriptions = await PushSubscription.qm.getActiveByUserIds([currentUser.id]);

    if (pushSubscriptions.length > 0) {
      const t = sails.helpers.utils.makeTranslator(currentUser.language);

      await sails.helpers.utils.sendWebPush.with({
        subscriptions: pushSubscriptions,
        title: t('Test Title'),
        body: t('This is a test text message!'),
        url: sails.config.custom.baseUrl,
      });
    }

    return {
      item: null,
    };
  },
};
