/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import EntryActionTypes from '../../../constants/EntryActionTypes';
import commentsWatchers from './comments';

jest.mock('../services', () => ({
  __esModule: true,
  default: {
    fetchCommentsInCurrentCard: jest.fn(),
    createCommentInCurrentCard: jest.fn(),
    fetchComments: jest.fn(),
    createComment: jest.fn(),
    handleCommentCreate: jest.fn(),
    updateComment: jest.fn(),
    handleCommentUpdate: jest.fn(),
    deleteComment: jest.fn(),
    handleCommentDelete: jest.fn(),
  },
}));

// eslint-disable-next-line import/first
import services from '../services';

// The watcher yields `all([takeEvery(pattern, worker), …])`; each takeEvery is
// a FORK effect whose args are the pattern and the worker. Reading them back is
// what proves an entry action is actually wired to a service — an action type
// nothing takes is dispatched into silence, and the components that dispatch it
// look perfectly correct while doing nothing at all.
const watchers = () => {
  const { value } = commentsWatchers().next();

  return value.payload.map((effect) => ({
    pattern: effect.payload.args[0],
    worker: effect.payload.args[1],
  }));
};

const watcherFor = (pattern) => watchers().find((watcher) => watcher.pattern === pattern);

beforeEach(() => {
  jest.clearAllMocks();
});

test('the floating chat fetches the comments of the card it was pointed at', () => {
  const watcher = watcherFor(EntryActionTypes.COMMENTS_FOR_CARD_FETCH);

  expect(watcher).toBeDefined();

  watcher.worker({ payload: { cardId: 'card-1' } });

  expect(services.fetchComments).toHaveBeenCalledWith('card-1');
});

test('the floating chat posts its message on the card it was pointed at', () => {
  const watcher = watcherFor(EntryActionTypes.COMMENT_FOR_CARD_CREATE);

  expect(watcher).toBeDefined();

  watcher.worker({ payload: { cardId: 'card-1', data: { text: 'hello' } } });

  expect(services.createComment).toHaveBeenCalledWith('card-1', { text: 'hello' });
});

test('the card modal keeps its own current-card watchers', () => {
  const patterns = watchers().map((watcher) => watcher.pattern);

  expect(patterns).toEqual(
    expect.arrayContaining([
      EntryActionTypes.COMMENTS_IN_CURRENT_CARD_FETCH,
      EntryActionTypes.COMMENT_IN_CURRENT_CARD_CREATE,
      EntryActionTypes.COMMENT_CREATE_HANDLE,
    ]),
  );
});
