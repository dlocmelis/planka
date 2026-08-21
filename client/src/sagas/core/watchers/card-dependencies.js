/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import { all, takeEvery } from 'redux-saga/effects';

import services from '../services';
import EntryActionTypes from '../../../constants/EntryActionTypes';

export default function* cardDependenciesWatchers() {
  yield all([
    takeEvery(EntryActionTypes.CARD_DEPENDENCY_CREATE, ({ payload: { cardId, dependsOnCardId } }) =>
      services.createCardDependency(cardId, dependsOnCardId),
    ),
    takeEvery(
      EntryActionTypes.CARD_DEPENDENCY_IN_CURRENT_CARD_CREATE,
      ({ payload: { dependsOnCardId } }) =>
        services.createCardDependencyInCurrentCard(dependsOnCardId),
    ),
    takeEvery(EntryActionTypes.CARD_DEPENDENCY_CREATE_HANDLE, ({ payload: { cardDependency } }) =>
      services.handleCardDependencyCreate(cardDependency),
    ),
    takeEvery(EntryActionTypes.CARD_DEPENDENCY_DELETE, ({ payload: { cardId, dependsOnCardId } }) =>
      services.deleteCardDependency(cardId, dependsOnCardId),
    ),
    takeEvery(EntryActionTypes.CARD_DEPENDENCY_DELETE_HANDLE, ({ payload: { cardDependency } }) =>
      services.handleCardDependencyDelete(cardDependency),
    ),
  ]);
}
