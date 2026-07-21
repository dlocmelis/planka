/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import EntryActionTypes from '../constants/EntryActionTypes';

const createPushSubscription = (data) => ({
  type: EntryActionTypes.PUSH_SUBSCRIPTION_CREATE,
  payload: {
    data,
  },
});

const deletePushSubscription = (endpoint) => ({
  type: EntryActionTypes.PUSH_SUBSCRIPTION_DELETE,
  payload: {
    endpoint,
  },
});

const testPushSubscription = () => ({
  type: EntryActionTypes.PUSH_SUBSCRIPTION_TEST,
  payload: {},
});

export default {
  createPushSubscription,
  deletePushSubscription,
  testPushSubscription,
};
