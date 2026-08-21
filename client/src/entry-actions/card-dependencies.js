/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import EntryActionTypes from '../constants/EntryActionTypes';

const createCardDependency = (cardId, dependsOnCardId) => ({
  type: EntryActionTypes.CARD_DEPENDENCY_CREATE,
  payload: {
    cardId,
    dependsOnCardId,
  },
});

const createCardDependencyInCurrentCard = (dependsOnCardId) => ({
  type: EntryActionTypes.CARD_DEPENDENCY_IN_CURRENT_CARD_CREATE,
  payload: {
    dependsOnCardId,
  },
});

const handleCardDependencyCreate = (cardDependency) => ({
  type: EntryActionTypes.CARD_DEPENDENCY_CREATE_HANDLE,
  payload: {
    cardDependency,
  },
});

const deleteCardDependency = (cardId, dependsOnCardId) => ({
  type: EntryActionTypes.CARD_DEPENDENCY_DELETE,
  payload: {
    cardId,
    dependsOnCardId,
  },
});

const handleCardDependencyDelete = (cardDependency) => ({
  type: EntryActionTypes.CARD_DEPENDENCY_DELETE_HANDLE,
  payload: {
    cardDependency,
  },
});

export default {
  createCardDependency,
  createCardDependencyInCurrentCard,
  handleCardDependencyCreate,
  deleteCardDependency,
  handleCardDependencyDelete,
};
