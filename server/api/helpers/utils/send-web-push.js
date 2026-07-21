/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

const webpush = require('web-push');

const { buildWebPushPayload } = require('../../../utils/web-push');

const RETRY_DELAY = 1000; // In milliseconds

let vapidDetailsSet = false;

const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

module.exports = {
  inputs: {
    subscriptions: {
      type: 'ref',
      required: true,
    },
    title: {
      type: 'string',
      required: true,
    },
    body: {
      type: 'string',
      required: true,
    },
    url: {
      type: 'string',
    },
  },

  async fn(inputs) {
    const { webPushEnabled, webPushVapidPublicKey, webPushVapidPrivateKey, webPushVapidSubject } =
      sails.config.custom;

    if (!webPushEnabled || !webPushVapidPublicKey || !webPushVapidPrivateKey) {
      return;
    }

    if (!vapidDetailsSet) {
      webpush.setVapidDetails(
        webPushVapidSubject || 'mailto:admin@example.com',
        webPushVapidPublicKey,
        webPushVapidPrivateKey,
      );

      vapidDetailsSet = true;
    }

    const payload = buildWebPushPayload({
      title: inputs.title,
      body: inputs.body,
      url: inputs.url,
    });

    await Promise.all(
      inputs.subscriptions.map(async (subscription) => {
        const webPushSubscription = {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.keysP256dh,
            auth: subscription.keysAuth,
          },
        };

        const updateLastUsedAt = () =>
          PushSubscription.qm.updateOne(
            { id: subscription.id },
            { lastUsedAt: new Date().toISOString() },
          );

        try {
          await webpush.sendNotification(webPushSubscription, payload);
        } catch (error) {
          if (error.statusCode === 404 || error.statusCode === 410) {
            try {
              await PushSubscription.qm.updateOne(
                { id: subscription.id },
                { disabledAt: new Date().toISOString() },
              );
            } catch (updateError) {
              sails.log.error(`Error disabling push subscription:\n${updateError}`);
            }

            return;
          }

          if (!error.statusCode || error.statusCode >= 500) {
            await delay(RETRY_DELAY);

            try {
              await webpush.sendNotification(webPushSubscription, payload);

              updateLastUsedAt(); // Fire-and-forget
            } catch (retryError) {
              sails.log.error(`Error sending web push notification (retry):\n${retryError}`);
            }

            return;
          }

          sails.log.error(`Error sending web push notification:\n${error}`);

          return;
        }

        updateLastUsedAt(); // Fire-and-forget
      }),
    );
  },
};
