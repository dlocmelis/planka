/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import ActionTypes from '../constants/ActionTypes';

const createCardDependency = (cardId, dependsOnCardId) => ({
  type: ActionTypes.CARD_DEPENDENCY_CREATE,
  payload: {
    cardId,
    dependsOnCardId,
  },
});

createCardDependency.success = (cardDependency) => ({
  type: ActionTypes.CARD_DEPENDENCY_CREATE__SUCCESS,
  payload: {
    cardDependency,
  },
});

createCardDependency.failure = (cardId, dependsOnCardId, error) => ({
  type: ActionTypes.CARD_DEPENDENCY_CREATE__FAILURE,
  payload: {
    cardId,
    dependsOnCardId,
    error,
  },
});

const handleCardDependencyCreate = (cardDependency) => ({
  type: ActionTypes.CARD_DEPENDENCY_CREATE_HANDLE,
  payload: {
    cardDependency,
  },
});

const deleteCardDependency = (cardId, dependsOnCardId) => ({
  type: ActionTypes.CARD_DEPENDENCY_DELETE,
  payload: {
    cardId,
    dependsOnCardId,
  },
});

deleteCardDependency.success = (cardDependency) => ({
  type: ActionTypes.CARD_DEPENDENCY_DELETE__SUCCESS,
  payload: {
    cardDependency,
  },
});

deleteCardDependency.failure = (cardId, dependsOnCardId, error) => ({
  type: ActionTypes.CARD_DEPENDENCY_DELETE__FAILURE,
  payload: {
    cardId,
    dependsOnCardId,
    error,
  },
});

const handleCardDependencyDelete = (cardDependency) => ({
  type: ActionTypes.CARD_DEPENDENCY_DELETE_HANDLE,
  payload: {
    cardDependency,
  },
});

export default {
  createCardDependency,
  handleCardDependencyCreate,
  deleteCardDependency,
  handleCardDependencyDelete,
};
