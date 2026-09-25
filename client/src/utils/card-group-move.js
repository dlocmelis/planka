/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import isUndefined from 'lodash/isUndefined';

import Config from '../constants/Config';

// Orders the cards of a group move the way they already sit on the board: by list
// left to right (`listIds` order), then top to bottom within a list. Cards whose list
// is not in `listIds` keep their relative order after the rest.
export const orderGroupCards = (cards, listIds) => {
  const listIndex = (listId) => {
    const index = listIds.indexOf(listId);
    return index === -1 ? Infinity : index;
  };

  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => {
      const byList = listIndex(a.card.listId) - listIndex(b.card.listId);

      if (byList !== 0 && !Number.isNaN(byList)) {
        return byList;
      }

      if (a.card.listId === b.card.listId && a.card.position !== b.card.position) {
        return a.card.position - b.card.position;
      }

      return a.index - b.index;
    })
    .map(({ card }) => card);
};

// Works out, once, where every card of a group move lands.
//
// `listCards` are the destination list's cards as the board renders them (in order,
// each with `id` and `position`). `index` is the drop index react-beautiful-dnd reports,
// which counts over that list with the dragged card taken out. The other moving cards
// are still in the list while dragging, so they are skipped when picking the neighbours:
// the block goes between the nearest staying card above the drop point and the nearest
// staying card below it, spread evenly, in `movingIds` order.
export const getGroupMovePositions = (listCards, movingIds, draggedId, index) => {
  const movingIdsSet = new Set(movingIds);
  const dropCards = listCards.filter((card) => card.id !== draggedId);
  const dropIndex = isUndefined(index) ? dropCards.length : index;

  const isStaying = (card) => !movingIdsSet.has(card.id);
  const prevCard = dropCards.slice(0, dropIndex).filter(isStaying).at(-1);
  const nextCard = dropCards.slice(dropIndex).find(isStaying);

  const prevPosition = prevCard ? prevCard.position : 0;

  const step = nextCard
    ? (nextCard.position - prevPosition) / (movingIds.length + 1)
    : Config.POSITION_GAP;

  return movingIds.map((id, i) => ({
    id,
    position: prevPosition + step * (i + 1),
  }));
};
