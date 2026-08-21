/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import { call, put, select } from 'redux-saga/effects';
import toast from 'react-hot-toast';

import request from '../request';
import selectors from '../../../selectors';
import actions from '../../../actions';
import api from '../../../api';
import ToastTypes from '../../../constants/ToastTypes';
import ErrorCodes from '../../../constants/ErrorCodes';

// A REFUSED DEPENDENCY IS SAID OUT LOUD. Every one of these answers is reachable
// from the picker — a link to a card on a board this account may not read (404),
// and one that would close a cycle (422) — and the failure action alone is
// reduced by nothing and rendered by nothing, so the button did nothing and said
// nothing. The message is chosen from the code rather than from Planka's English
// text, because the toast is localised and the response is not.
const refusalReason = (error) => {
  switch (error && error.code) {
    case ErrorCodes.NOT_FOUND:
      return 'cardDependencyCardNotFound';
    case ErrorCodes.UNPROCESSABLE_ENTITY:
      return 'cardDependencyWouldCreateCycle';
    default:
      return null;
  }
};

function* reportRefusal(error) {
  const reason = refusalReason(error);

  if (!reason) {
    return; // an outage or a lost connection: the generic offline handling has it
  }

  yield call(toast, {
    type: ToastTypes.CARD_DEPENDENCY_REFUSED,
    params: { reason },
  });
}

export function* createCardDependency(cardId, dependsOnCardId) {
  yield put(actions.createCardDependency(cardId, dependsOnCardId));

  let cardDependency;
  try {
    ({ item: cardDependency } = yield call(request, api.createCardDependency, cardId, {
      dependsOnCardId,
    }));
  } catch (error) {
    yield put(actions.createCardDependency.failure(cardId, dependsOnCardId, error));
    yield call(reportRefusal, error);
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
    yield call(reportRefusal, error);
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
