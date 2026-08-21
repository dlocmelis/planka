/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import { call, put, select } from 'redux-saga/effects';

import request from '../request';
import selectors from '../../../selectors';
import actions from '../../../actions';
import api from '../../../api';

export function* createCardDependency(cardId, dependsOnCardId) {
  yield put(actions.createCardDependency(cardId, dependsOnCardId));

  let cardDependency;
  try {
    ({ item: cardDependency } = yield call(request, api.createCardDependency, cardId, {
      dependsOnCardId,
    }));
  } catch (error) {
    yield put(actions.createCardDependency.failure(cardId, dependsOnCardId, error));
    return;
  }

  yield put(actions.createCardDependency.success(cardDependency));
}

export function* createCardDependencyInCurrentCard(dependsOnCardId) {
  const { cardId } = yield select(selectors.selectPath);

  yield call(createCardDependency, cardId, dependsOnCardId);
}

export function* handleCardDependencyCreate(cardDependency) {
  yield put(actions.handleCardDependencyCreate(cardDependency));
}

export function* deleteCardDependency(cardId, dependsOnCardId) {
  yield put(actions.deleteCardDependency(cardId, dependsOnCardId));

  let cardDependency;
  try {
    ({ item: cardDependency } = yield call(
      request,
      api.deleteCardDependency,
      cardId,
      dependsOnCardId,
    ));
  } catch (error) {
    yield put(actions.deleteCardDependency.failure(cardId, dependsOnCardId, error));
    return;
  }

  yield put(actions.deleteCardDependency.success(cardDependency));
}

export function* handleCardDependencyDelete(cardDependency) {
  yield put(actions.handleCardDependencyDelete(cardDependency));
}

export default {
  createCardDependency,
  createCardDependencyInCurrentCard,
  handleCardDependencyCreate,
  deleteCardDependency,
  handleCardDependencyDelete,
};
