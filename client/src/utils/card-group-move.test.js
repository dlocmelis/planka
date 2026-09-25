/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import Config from '../constants/Config';
import { getGroupMovePositions, orderGroupCards } from './card-group-move';

const GAP = Config.POSITION_GAP;

// Three lists, left to right: A, B, C
const LIST_IDS = ['list-a', 'list-b', 'list-c'];

const card = (id, listId, position) => ({ id, listId, position });

const LIST_A = [
  card('a1', 'list-a', 1000),
  card('a2', 'list-a', 2000),
  card('a3', 'list-a', 3000),
  card('a4', 'list-a', 4000),
];

const LIST_B = [card('b1', 'list-b', 1000), card('b2', 'list-b', 2000)];

const LIST_C = [card('c1', 'list-c', 1000)];

const ALL_CARDS = [...LIST_A, ...LIST_B, ...LIST_C];

const selected = (...ids) => ALL_CARDS.filter(({ id }) => ids.includes(id));

// What the board renders after the move: the destination list's staying cards plus the
// moved ones, ordered by the new positions
const renderedAfter = (listCards, positions) => {
  const movedIds = positions.map(({ id }) => id);

  return [...listCards.filter(({ id }) => !movedIds.includes(id)), ...positions]
    .sort((a, b) => a.position - b.position)
    .map(({ id }) => id);
};

describe('orderGroupCards', () => {
  test('orders by list left to right, then top to bottom', () => {
    const cards = [
      card('c1', 'list-c', 1000),
      card('a3', 'list-a', 3000),
      card('b1', 'list-b', 1000),
      card('a1', 'list-a', 1000),
    ];

    expect(orderGroupCards(cards, LIST_IDS).map(({ id }) => id)).toEqual(['a1', 'a3', 'b1', 'c1']);
  });

  test('puts cards of a list that is not on the board after the rest, keeping their order', () => {
    const cards = [
      card('x2', 'list-x', 2000),
      card('b1', 'list-b', 1000),
      card('x1', 'list-x', 1000),
    ];

    expect(orderGroupCards(cards, LIST_IDS).map(({ id }) => id)).toEqual(['b1', 'x1', 'x2']);
  });
});

describe('getGroupMovePositions', () => {
  test('same list, moving down: a1 and a2 dragged between a3 and a4', () => {
    // Dragging a1: rbd counts over [a2, a3, a4], and index 2 is the slot above a4
    const movingIds = orderGroupCards(selected('a2', 'a1'), LIST_IDS).map(({ id }) => id);
    const positions = getGroupMovePositions(LIST_A, movingIds, 'a1', 2);

    expect(positions).toEqual([
      { id: 'a1', position: 3000 + 1000 / 3 },
      { id: 'a2', position: 3000 + (2 * 1000) / 3 },
    ]);
    expect(renderedAfter(LIST_A, positions)).toEqual(['a3', 'a1', 'a2', 'a4']);
  });

  test('same list, moving up: a3 and a4 dragged between a1 and a2', () => {
    // Dragging a4: rbd counts over [a1, a2, a3], and index 1 is the slot above a2
    const positions = getGroupMovePositions(LIST_A, ['a3', 'a4'], 'a4', 1);

    expect(positions).toEqual([
      { id: 'a3', position: 1000 + 1000 / 3 },
      { id: 'a4', position: 1000 + (2 * 1000) / 3 },
    ]);
    expect(renderedAfter(LIST_A, positions)).toEqual(['a1', 'a3', 'a4', 'a2']);
  });

  test('same list, moving down past selected cards above the drop point keeps the block whole', () => {
    // The rejected per-card approach (moveCard at index, index+1, ...) lands this block in
    // the wrong place, because every move shifts the indexes of the cards after it
    const positions = getGroupMovePositions(LIST_A, ['a1', 'a2', 'a3'], 'a2', 3);

    expect(renderedAfter(LIST_A, positions)).toEqual(['a4', 'a1', 'a2', 'a3']);
  });

  test('across lists: a2 and c1 dragged between b1 and b2', () => {
    const movingIds = orderGroupCards(selected('c1', 'a2'), LIST_IDS).map(({ id }) => id);
    const positions = getGroupMovePositions(LIST_B, movingIds, 'a2', 1);

    expect(positions).toEqual([
      { id: 'a2', position: 1000 + 1000 / 3 },
      { id: 'c1', position: 1000 + (2 * 1000) / 3 },
    ]);
    expect(renderedAfter(LIST_B, positions)).toEqual(['b1', 'a2', 'c1', 'b2']);
  });

  test('dropping at the top of a list spreads the block between 0 and the first card', () => {
    const positions = getGroupMovePositions(LIST_B, ['a1', 'a2'], 'a1', 0);

    expect(positions).toEqual([
      { id: 'a1', position: 1000 / 3 },
      { id: 'a2', position: (2 * 1000) / 3 },
    ]);
    expect(renderedAfter(LIST_B, positions)).toEqual(['a1', 'a2', 'b1', 'b2']);
  });

  test('dropping at the bottom of a list stacks the block one gap apart after the last card', () => {
    const positions = getGroupMovePositions(LIST_B, ['a1', 'a2'], 'a1', LIST_B.length);

    expect(positions).toEqual([
      { id: 'a1', position: 2000 + GAP },
      { id: 'a2', position: 2000 + 2 * GAP },
    ]);
    expect(renderedAfter(LIST_B, positions)).toEqual(['b1', 'b2', 'a1', 'a2']);
  });

  test('no index means the bottom of the list', () => {
    expect(getGroupMovePositions(LIST_B, ['a1', 'a2'], 'a1')).toEqual(
      getGroupMovePositions(LIST_B, ['a1', 'a2'], 'a1', LIST_B.length),
    );
  });

  test('dropping next to another selected card skips it when picking the card above', () => {
    // Dragging a2 with a3 also selected, dropped just below a3 (above a4): a3 is moving too,
    // so the card above the block is a1, not a3
    const positions = getGroupMovePositions(LIST_A, ['a2', 'a3'], 'a2', 2);

    expect(positions).toEqual([
      { id: 'a2', position: 2000 },
      { id: 'a3', position: 3000 },
    ]);
    expect(renderedAfter(LIST_A, positions)).toEqual(['a1', 'a2', 'a3', 'a4']);
  });

  test('dropping next to another selected card skips it when picking the card below', () => {
    // Dragging b1 into list A just above a4, with a4 also selected: nothing staying is below
    // the drop point, so the block goes after a3 one gap apart
    const movingIds = orderGroupCards(selected('b1', 'a4'), LIST_IDS).map(({ id }) => id);
    const positions = getGroupMovePositions(LIST_A, movingIds, 'b1', 3);

    expect(positions).toEqual([
      { id: 'a4', position: 3000 + GAP },
      { id: 'b1', position: 3000 + 2 * GAP },
    ]);
    expect(renderedAfter(LIST_A, positions)).toEqual(['a1', 'a2', 'a3', 'a4', 'b1']);
  });

  test('an empty destination list gets the block from the first gap', () => {
    const positions = getGroupMovePositions([], ['a1', 'b1', 'c1'], 'b1', 0);

    expect(positions).toEqual([
      { id: 'a1', position: GAP },
      { id: 'b1', position: 2 * GAP },
      { id: 'c1', position: 3 * GAP },
    ]);
  });
});
