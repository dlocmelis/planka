const { expect } = require('chai');
const webpush = require('web-push');

const { buildWebPushPayload } = require('../../utils/web-push');
const sendWebPush = require('../../api/helpers/utils/send-web-push');

const SUBSCRIPTION = {
  id: '1357158568008091264',
  endpoint: 'https://push.service.example.com/subscription/abc123',
  keysP256dh: 'BOr4lZv5y0lZHZ5ZzN6fQ3F0dW',
  keysAuth: 'dGVzdGF1dGhzZWNyZXQ',
};

const INPUTS = {
  subscriptions: [SUBSCRIPTION],
  title: 'Test Title',
  body: 'Test body',
  url: 'https://example.com/cards/1',
};

describe('web-push', () => {
  describe('#buildWebPushPayload()', () => {
    it('should build payload with title, body, icon, badge and url', () => {
      const payload = JSON.parse(buildWebPushPayload(INPUTS));

      expect(payload).to.deep.equal({
        title: INPUTS.title,
        body: INPUTS.body,
        icon: '/logo192.png',
        badge: '/favicon.ico',
        data: {
          url: INPUTS.url,
        },
      });
    });
  });

  describe('send-web-push helper', () => {
    const originalSendNotification = webpush.sendNotification;

    let sendNotificationCalls;
    let sendNotificationError;
    let updateOneCalls;

    before(() => {
      const vapidKeys = webpush.generateVAPIDKeys();

      global.sails = {
        config: {
          custom: {
            webPushEnabled: true,
            webPushVapidPublicKey: vapidKeys.publicKey,
            webPushVapidPrivateKey: vapidKeys.privateKey,
          },
        },
        log: {
          error: () => {},
        },
      };

      global.PushSubscription = {
        qm: {
          updateOne: (criteria, values) => {
            updateOneCalls.push({ criteria, values });

            return Promise.resolve(null);
          },
        },
      };

      webpush.sendNotification = () => {
        sendNotificationCalls.push({});

        return sendNotificationError ? Promise.reject(sendNotificationError) : Promise.resolve({});
      };
    });

    after(() => {
      webpush.sendNotification = originalSendNotification;

      delete global.sails;
      delete global.PushSubscription;
    });

    beforeEach(() => {
      sails.config.custom.webPushEnabled = true;

      sendNotificationCalls = [];
      sendNotificationError = null;
      updateOneCalls = [];
    });

    it('should no-op when web push is disabled', async () => {
      sails.config.custom.webPushEnabled = false;

      await sendWebPush.fn(INPUTS);

      expect(sendNotificationCalls).to.have.lengthOf(0);
      expect(updateOneCalls).to.have.lengthOf(0);
    });

    it('should no-op when VAPID keys are missing', async () => {
      const { webPushVapidPublicKey } = sails.config.custom;
      sails.config.custom.webPushVapidPublicKey = undefined;

      await sendWebPush.fn(INPUTS);

      expect(sendNotificationCalls).to.have.lengthOf(0);
      expect(updateOneCalls).to.have.lengthOf(0);

      sails.config.custom.webPushVapidPublicKey = webPushVapidPublicKey;
    });

    it('should not throw when VAPID keys are malformed', async () => {
      const { webPushVapidPrivateKey } = sails.config.custom;
      sails.config.custom.webPushVapidPrivateKey = 'invalid';

      await sendWebPush.fn(INPUTS);

      expect(sendNotificationCalls).to.have.lengthOf(0);
      expect(updateOneCalls).to.have.lengthOf(0);

      sails.config.custom.webPushVapidPrivateKey = webPushVapidPrivateKey;
    });

    it('should update lastUsedAt on successful send', async () => {
      await sendWebPush.fn(INPUTS);

      expect(sendNotificationCalls).to.have.lengthOf(1);
      expect(updateOneCalls).to.have.lengthOf(1);
      expect(updateOneCalls[0].criteria).to.deep.equal({ id: SUBSCRIPTION.id });
      expect(updateOneCalls[0].values).to.have.property('lastUsedAt');
    });

    it('should disable subscription on 404 without throwing', async () => {
      sendNotificationError = { statusCode: 404 };

      await sendWebPush.fn(INPUTS);

      expect(updateOneCalls).to.have.lengthOf(1);
      expect(updateOneCalls[0].criteria).to.deep.equal({ id: SUBSCRIPTION.id });
      expect(updateOneCalls[0].values).to.have.property('disabledAt');
    });

    it('should disable subscription on 410 without throwing', async () => {
      sendNotificationError = { statusCode: 410 };

      await sendWebPush.fn(INPUTS);

      expect(updateOneCalls).to.have.lengthOf(1);
      expect(updateOneCalls[0].values).to.have.property('disabledAt');
    });

    it('should not throw and not disable on other client errors', async () => {
      sendNotificationError = { statusCode: 400 };

      await sendWebPush.fn(INPUTS);

      expect(sendNotificationCalls).to.have.lengthOf(1);
      expect(updateOneCalls).to.have.lengthOf(0);
    });

    it('should retry once on server error without throwing when retry also fails', async () => {
      sendNotificationError = { statusCode: 500 };

      await sendWebPush.fn(INPUTS);

      expect(sendNotificationCalls).to.have.lengthOf(2);
      expect(updateOneCalls).to.have.lengthOf(0);
    });

    it('should update lastUsedAt when retry succeeds', async () => {
      sendNotificationError = { statusCode: 500 };

      const promise = sendWebPush.fn(INPUTS);

      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
      sendNotificationError = null;

      await promise;

      expect(sendNotificationCalls).to.have.lengthOf(2);
      expect(updateOneCalls).to.have.lengthOf(1);
      expect(updateOneCalls[0].criteria).to.deep.equal({ id: SUBSCRIPTION.id });
      expect(updateOneCalls[0].values).to.have.property('lastUsedAt');
    });

    it('should disable subscription when retry fails with 410', async () => {
      sendNotificationError = { statusCode: 500 };

      const promise = sendWebPush.fn(INPUTS);

      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
      sendNotificationError = { statusCode: 410 };

      await promise;

      expect(sendNotificationCalls).to.have.lengthOf(2);
      expect(updateOneCalls).to.have.lengthOf(1);
      expect(updateOneCalls[0].criteria).to.deep.equal({ id: SUBSCRIPTION.id });
      expect(updateOneCalls[0].values).to.have.property('disabledAt');
    });
  });
});
