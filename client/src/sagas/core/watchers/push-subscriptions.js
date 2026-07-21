/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import { all, takeEvery } from 'redux-saga/effects';

import services from '../services';
import EntryActionTypes from '../../../constants/EntryActionTypes';

export default function* pushSubscriptionsWatchers() {
  yield all([
    takeEvery(EntryActionTypes.PUSH_SUBSCRIPTION_CREATE, ({ payload: { data } }) =>
      services.createPushSubscription(data),
    ),
    takeEvery(EntryActionTypes.PUSH_SUBSCRIPTION_DELETE, ({ payload: { endpoint } }) =>
      services.deletePushSubscription(endpoint),
    ),
    takeEvery(EntryActionTypes.PUSH_SUBSCRIPTION_TEST, () => services.testPushSubscription()),
  ]);
}
