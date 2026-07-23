import orm from '../orm';
import ActionTypes from '../constants/ActionTypes';
import reducer from './core';
import { selectSelectedCardIds, makeSelectIsCardSelected } from '../selectors/core';

jest.mock('../lib/redux-router', () => ({
  LOCATION_CHANGE_HANDLE: 'LOCATION_CHANGE_HANDLE',
}));

jest.mock('../assets/images/deleted-user.png', () => 'deleted-user.png');

jest.mock('../constants/Config', () => ({
  __esModule: true,
  default: {
    BASE_PATH: '',
    ACCESS_TOKEN_KEY: 'accessToken',
    ACCESS_TOKEN_VERSION_KEY: 'accessTokenVersion',
    ACCESS_TOKEN_VERSION: '1',
    POSITION_GAP: 65536,
    CARDS_LIMIT: 50,
    COMMENTS_LIMIT: 50,
    ACTIVITIES_LIMIT: 50,
    MAX_SIZE_TO_DISPLAY_CONTENT: 256 * 1024,
    IS_MAC: false,
  },
}));

const BOARD_ID = 'board-1';
const OTHER_BOARD_ID = 'board-2';

const buildOrmState = () => {
  const state = orm.getEmptyState();
  const session = orm.mutableSession(state);

  session.Board.create({ id: BOARD_ID });
  session.Board.create({ id: OTHER_BOARD_ID });
  session.List.create({ id: 'list-1', boardId: BOARD_ID });
  session.List.create({ id: 'list-2', boardId: OTHER_BOARD_ID });
  session.Card.create({ id: 'card-1', boardId: BOARD_ID, listId: 'list-1' });
  session.Card.create({ id: 'card-2', boardId: BOARD_ID, listId: 'list-1' });
  session.Card.create({ id: 'card-3', boardId: OTHER_BOARD_ID, listId: 'list-2' });

  return state;
};

const buildState = (selectedCardIds) => {
  const core = reducer(undefined, {});
  const coreWithBoard = { ...core, boardId: BOARD_ID };
  const coreWithSelection = reducer(coreWithBoard, {
    type: ActionTypes.CARD_SELECTION_SET,
    payload: {
      ids: selectedCardIds,
    },
  });

  return {
    orm: buildOrmState(),
    core: coreWithSelection,
  };
};

describe('core reducer card selection', () => {
  test('has empty selection in initial state', () => {
    const state = reducer(undefined, {});

    expect(state.selectedCardIds).toEqual([]);
  });

  test('toggle adds an unselected card id', () => {
    const state = reducer(undefined, {
      type: ActionTypes.CARD_SELECTION_TOGGLE,
      payload: {
        id: 'card-1',
      },
    });

    expect(state.selectedCardIds).toEqual(['card-1']);
  });

  test('toggle removes an already selected card id', () => {
    let state = reducer(undefined, {
      type: ActionTypes.CARD_SELECTION_SET,
      payload: {
        ids: ['card-1', 'card-2'],
      },
    });

    state = reducer(state, {
      type: ActionTypes.CARD_SELECTION_TOGGLE,
      payload: {
        id: 'card-1',
      },
    });

    expect(state.selectedCardIds).toEqual(['card-2']);
  });

  test('set replaces the selection', () => {
    let state = reducer(undefined, {
      type: ActionTypes.CARD_SELECTION_TOGGLE,
      payload: {
        id: 'card-1',
      },
    });

    state = reducer(state, {
      type: ActionTypes.CARD_SELECTION_SET,
      payload: {
        ids: ['card-2', 'card-3'],
      },
    });

    expect(state.selectedCardIds).toEqual(['card-2', 'card-3']);
  });

  test('clear empties the selection', () => {
    let state = reducer(undefined, {
      type: ActionTypes.CARD_SELECTION_SET,
      payload: {
        ids: ['card-1', 'card-2'],
      },
    });

    state = reducer(state, {
      type: ActionTypes.CARD_SELECTION_CLEAR,
      payload: {},
    });

    expect(state.selectedCardIds).toEqual([]);
  });
});

describe('selectSelectedCardIds', () => {
  test('returns selected card ids of the current board', () => {
    const state = buildState(['card-1', 'card-2']);

    expect(selectSelectedCardIds(state)).toEqual(['card-1', 'card-2']);
  });

  test('prunes ids whose card no longer exists', () => {
    const state = buildState(['card-1', 'card-missing']);

    expect(selectSelectedCardIds(state)).toEqual(['card-1']);
  });

  test('prunes ids whose card is on another board', () => {
    const state = buildState(['card-1', 'card-3']);

    expect(selectSelectedCardIds(state)).toEqual(['card-1']);
  });
});

describe('makeSelectIsCardSelected', () => {
  test('returns true for a selected card on the current board', () => {
    const state = buildState(['card-1', 'card-2']);
    const selectIsCardSelected = makeSelectIsCardSelected();

    expect(selectIsCardSelected(state, 'card-1')).toBeTruthy();
  });

  test('returns false for an unselected card', () => {
    const state = buildState(['card-1']);
    const selectIsCardSelected = makeSelectIsCardSelected();

    expect(selectIsCardSelected(state, 'card-2')).toBeFalsy();
  });

  test('returns false for a stale card id', () => {
    const state = buildState(['card-3', 'card-missing']);
    const selectIsCardSelected = makeSelectIsCardSelected();

    expect(selectIsCardSelected(state, 'card-3')).toBeFalsy();
    expect(selectIsCardSelected(state, 'card-missing')).toBeFalsy();
  });
});
