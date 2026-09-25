/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import EntryActionTypes from '../../../constants/EntryActionTypes';
import entryActions from '../../../entry-actions';
import cardsWatchers from './cards';

jest.mock('../services', () => ({
  __esModule: true,
  default: {
    moveCard: jest.fn(),
    moveCards: jest.fn(),
  },
}));

// eslint-disable-next-line import/first
import services from '../services';

// Same reading as comments.test.js: each takeEvery FORK effect carries the pattern and the
// worker, which is what proves an entry action is wired to a service at all
const watcherFor = (pattern) => {
  const { value } = cardsWatchers().next();

  return value.payload
    .map((effect) => ({ pattern: effect.payload.args[0], worker: effect.payload.args[1] }))
    .find((watcher) => watcher.pattern === pattern);
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('dragging a selection moves the whole selection through moveCards', () => {
  const action = entryActions.moveCards(['card-1', 'card-2'], 'list-2', 3, 'card-2');
  const watcher = watcherFor(action.type);

  expect(action.type).toBe(EntryActionTypes.CARDS_MOVE);
  expect(watcher).toBeDefined();

  watcher.worker(action);

  expect(services.moveCards).toHaveBeenCalledWith(['card-1', 'card-2'], 'list-2', 3, 'card-2');
  expect(services.moveCard).not.toHaveBeenCalled();
});
