/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import { call, put } from 'redux-saga/effects';

import request from '../request';
import actions from '../../../actions';
import api from '../../../api';
import {
  isPushSupported,
  registerServiceWorker,
  serializePushSubscription,
} from '../../../utils/web-push';

export function* createPushSubscription(data) {
  yield put(actions.createPushSubscription(data));

  let pushSubscription;
  try {
    ({ item: pushSubscription } = yield call(request, api.createPushSubscription, data));
  } catch (error) {
    yield put(actions.createPushSubscription.failure(error));
    return;
  }

  yield put(actions.createPushSubscription.success(pushSubscription));
}

export function* deletePushSubscription(endpoint) {
  yield put(actions.deletePushSubscription(endpoint));

  try {
    yield call(request, api.deletePushSubscription, {
      endpoint,
    });
  } catch (error) {
    yield put(actions.deletePushSubscription.failure(error));
    return;
  }

  yield put(actions.deletePushSubscription.success());
}

export function* testPushSubscription() {
  yield put(actions.testPushSubscription());

  try {
    yield call(request, api.testPushSubscription);
  } catch (error) {
    yield put(actions.testPushSubscription.failure(error));
    return;
  }

  yield put(actions.testPushSubscription.success());
}

export function* syncPushSubscription() {
  if (!isPushSupported() || Notification.permission !== 'granted') {
    return;
  }

  let registration;
  try {
    registration = yield call(registerServiceWorker);
  } catch {
    return;
  }

  const subscription = yield call([registration.pushManager, 'getSubscription']);

  if (!subscription) {
    return;
  }

  try {
    yield call(request, api.createPushSubscription, serializePushSubscription(subscription));
  } catch {
    /* empty */
  }
}

export default {
  createPushSubscription,
  deletePushSubscription,
  testPushSubscription,
  syncPushSubscription,
};
