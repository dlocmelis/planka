/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import ActionTypes from '../constants/ActionTypes';

const createPushSubscription = (data) => ({
  type: ActionTypes.PUSH_SUBSCRIPTION_CREATE,
  payload: {
    data,
  },
});

createPushSubscription.success = (pushSubscription) => ({
  type: ActionTypes.PUSH_SUBSCRIPTION_CREATE__SUCCESS,
  payload: {
    pushSubscription,
  },
});

createPushSubscription.failure = (error) => ({
  type: ActionTypes.PUSH_SUBSCRIPTION_CREATE__FAILURE,
  payload: {
    error,
  },
});

const deletePushSubscription = (endpoint) => ({
  type: ActionTypes.PUSH_SUBSCRIPTION_DELETE,
  payload: {
    endpoint,
  },
});

deletePushSubscription.success = () => ({
  type: ActionTypes.PUSH_SUBSCRIPTION_DELETE__SUCCESS,
  payload: {},
});

deletePushSubscription.failure = (error) => ({
  type: ActionTypes.PUSH_SUBSCRIPTION_DELETE__FAILURE,
  payload: {
    error,
  },
});

const testPushSubscription = () => ({
  type: ActionTypes.PUSH_SUBSCRIPTION_TEST,
  payload: {},
});

testPushSubscription.success = () => ({
  type: ActionTypes.PUSH_SUBSCRIPTION_TEST__SUCCESS,
  payload: {},
});

testPushSubscription.failure = (error) => ({
  type: ActionTypes.PUSH_SUBSCRIPTION_TEST__FAILURE,
  payload: {
    error,
  },
});

export default {
  createPushSubscription,
  deletePushSubscription,
  testPushSubscription,
};
