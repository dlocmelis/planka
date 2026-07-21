/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import socket from './socket';

/* Actions */

const createPushSubscription = (data, headers) => socket.post('/push-subscriptions', data, headers);

const deletePushSubscription = (data, headers) =>
  socket.delete('/push-subscriptions', data, headers);

const testPushSubscription = (headers) =>
  socket.post('/push-subscriptions/test', undefined, headers);

export default {
  createPushSubscription,
  deletePushSubscription,
  testPushSubscription,
};
