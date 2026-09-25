/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import { runSaga } from 'redux-saga';

import ActionTypes from '../../../constants/ActionTypes';
import { ListTypes } from '../../../constants/Enums';
import { moveCards } from './cards';

let mockState;

// The service module's UI-side imports; moveCards reaches none of them
jest.mock('react-hot-toast', () => ({ __esModule: true, default: () => {} }));
jest.mock('../../../lib/redux-router', () => ({
  LOCATION_CHANGE_HANDLE: 'LOCATION_CHANGE_HANDLE',
}));
jest.mock('./router', () => ({ goToBoard: () => {}, goToCard: () => {} }));
jest.mock('../../../i18n', () => ({ __esModule: true, default: { t: (key) => key } }));

jest.mock('../../../selectors', () => ({
  __esModule: true,
  default: {
    selectCardById: (_, id) => mockState.cards[id],
    selectListById: (_, id) => mockState.lists[id],
    selectKanbanListIdsForCurrentBoard: () => mockState.listIds,
    selectFilteredCardIdsByListId: (_, id) => mockState.listCardIds[id],
  },
}));

jest.mock('../request', () => ({
  __esModule: true,
  default: jest.fn((method, id, data) => ({ item: { id, ...data } })),
}));

jest.mock('../../../api', () => ({
  __esModule: true,
  default: { updateCard: 'api.updateCard' },
}));

// eslint-disable-next-line import/first
import request from '../request';

const list = (id, type = ListTypes.ACTIVE) => ({ id, type });
const card = (id, listId, position, isClosed = false) => ({ id, listId, position, isClosed });

beforeEach(() => {
  jest.clearAllMocks();

  // Lists left to right: A, B, Done (closed). Card b1 is filtered out of B's view
  mockState = {
    listIds: ['list-a', 'list-b', 'list-done'],
    lists: {
      'list-a': list('list-a'),
      'list-b': list('list-b'),
      'list-done': list('list-done', ListTypes.CLOSED),
    },
    cards: {
      a1: card('a1', 'list-a', 1000),
      a2: card('a2', 'list-a', 2000),
      a3: card('a3', 'list-a', 3000),
      b1: card('b1', 'list-b', 1000),
      b2: card('b2', 'list-b', 2000),
      b3: card('b3', 'list-b', 3000),
      d1: card('d1', 'list-done', 1000, true),
    },
    listCardIds: {
      'list-a': ['a1', 'a2', 'a3'],
      'list-b': ['b2', 'b3'],
      'list-done': ['d1'],
    },
  };
});

const run = (...args) => {
  const dispatched = [];

  return runSaga(
    {
      dispatch: (action) => dispatched.push(action),
      getState: () => ({}),
    },
    moveCards,
    ...args,
  )
    .toPromise()
    .then(() => dispatched);
};

const cardUpdates = (dispatched) =>
  dispatched.filter(({ type }) => type === ActionTypes.CARD_UPDATE).map(({ payload }) => payload);

test('moves every card through updateCard, in board order, as one block at the drop point', async () => {
  // Selection handed over in click order; dragging b3 into list B's view [b2, (b3)] above b2
  const dispatched = await run(['b3', 'a3', 'a1'], 'list-b', 0, 'b3');

  expect(cardUpdates(dispatched)).toEqual([
    { id: 'a1', data: { listId: 'list-b', position: 500 } },
    { id: 'a3', data: { listId: 'list-b', position: 1000 } },
    { id: 'b3', data: { listId: 'list-b', position: 1500 } },
  ]);

  expect(request.mock.calls).toEqual([
    ['api.updateCard', 'a1', { listId: 'list-b', position: 500 }],
    ['api.updateCard', 'a3', { listId: 'list-b', position: 1000 }],
    ['api.updateCard', 'b3', { listId: 'list-b', position: 1500 }],
  ]);
});

test('applies the same list-type rules as a single-card move: moving into a closed list closes', async () => {
  const dispatched = await run(['a1', 'a2'], 'list-done', 1, 'a1');

  expect(cardUpdates(dispatched)).toEqual([
    { id: 'a1', data: { listId: 'list-done', position: 1000 + 65536, isClosed: true } },
    { id: 'a2', data: { listId: 'list-done', position: 1000 + 2 * 65536, isClosed: true } },
  ]);
});

test('skips cards that no longer exist', async () => {
  const dispatched = await run(['gone', 'a2'], 'list-b', 2, 'a2');

  expect(cardUpdates(dispatched)).toEqual([
    { id: 'a2', data: { listId: 'list-b', position: 3000 + 65536 } },
  ]);
});

test('does nothing when the destination list is gone', async () => {
  const dispatched = await run(['a1', 'a2'], 'list-gone', 0, 'a1');

  expect(dispatched).toEqual([]);
  expect(request).not.toHaveBeenCalled();
});
