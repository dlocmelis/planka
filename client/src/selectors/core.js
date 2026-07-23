/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import { createSelector } from 'redux-orm';
import { createSelector as createReselectSelector } from 'reselect';

import orm from '../orm';
import { isListKanban } from '../utils/record-helpers';

export const selectIsContentFetching = ({ core: { isContentFetching } }) => isContentFetching;

export const selectIsLogouting = ({ core: { isLogouting } }) => isLogouting;

export const selectIsFavoritesEnabled = ({ core: { isFavoritesEnabled } }) => isFavoritesEnabled;

export const selectIsEditModeEnabled = ({ core: { isEditModeEnabled } }) => isEditModeEnabled;

export const selectClipboard = ({ core: { clipboard } }) => clipboard;

export const selectSelectedCardIds = createSelector(
  orm,
  (state) => state.core.boardId,
  (state) => state.core.selectedCardIds,
  ({ Card }, boardId, selectedCardIds) =>
    selectedCardIds.filter((id) => {
      const cardModel = Card.withId(id);

      if (!cardModel || cardModel.boardId !== boardId) {
        return false;
      }

      const listModel = cardModel.list;

      return !!listModel && isListKanban(listModel.ref);
    }),
);

export const makeSelectIsCardSelected = () =>
  createReselectSelector(
    (state) => selectSelectedCardIds(state),
    (_, id) => id,
    (selectedCardIds, id) => selectedCardIds.includes(id),
  );

export const selectConfig = ({ core: { config } }) => config;

export const selectRecentCardId = ({ core: { recentCardId } }) => recentCardId;

export const selectPrevCardId = ({ core: { prevCardIds } }) => prevCardIds.at(-1);

export const selectHomeView = ({ core: { homeView } }) => homeView;

export const selectProjectsSearch = ({ core: { projectsSearch } }) => projectsSearch;

export const selectProjectsOrder = ({ core: { projectsOrder } }) => projectsOrder;

export const selectIsHiddenProjectsVisible = ({ core: { isHiddenProjectsVisible } }) =>
  isHiddenProjectsVisible;

export default {
  selectIsContentFetching,
  selectIsLogouting,
  selectIsFavoritesEnabled,
  selectIsEditModeEnabled,
  selectClipboard,
  selectSelectedCardIds,
  makeSelectIsCardSelected,
  selectConfig,
  selectRecentCardId,
  selectPrevCardId,
  selectHomeView,
  selectProjectsSearch,
  selectProjectsOrder,
  selectIsHiddenProjectsVisible,
};
