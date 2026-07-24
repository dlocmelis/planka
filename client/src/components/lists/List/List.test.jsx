/**
 * @jest-environment jsdom
 */

/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { createStore } from 'redux';

import { BoardShortcutsContext } from '../../../contexts';
import List from './List';

const mockDraggableRenderProps = [];
const mockEmptySelectedCardIds = [];

let mockList;
let mockAllCardIds;
let mockCardIds;
let mockIsFilterActive;

jest.mock('react-i18next', () => ({
  useTranslation: () => [(key) => key],
}));

jest.mock('react-beautiful-dnd', () => ({
  Draggable: (props) => {
    mockDraggableRenderProps.push(props);

    return props.children({
      innerRef: () => {},
      draggableProps: {},
      dragHandleProps: {},
    });
  },
  Droppable: (props) =>
    props.children({
      innerRef: () => {},
      droppableProps: {},
      placeholder: null,
    }),
}));

jest.mock('../../../lib/popup', () => ({
  usePopup: () => () => null,
}));

jest.mock('../../../selectors', () => ({
  __esModule: true,
  default: {
    makeSelectListById: () => () => mockList,
    makeSelectCardIdsByListId: () => () => mockAllCardIds,
    makeSelectFilteredCardIdsByListId: () => () => mockCardIds,
    makeSelectIsFilterActiveByListId: () => () => mockIsFilterActive,
    selectClipboard: () => null,
    selectIsFavoritesActiveForCurrentUser: () => false,
    selectSelectedCardIds: () => mockEmptySelectedCardIds,
    selectIsEditModeEnabled: () => true,
    selectCurrentUserMembershipForCurrentBoard: () => ({ role: 'editor' }),
  },
}));

jest.mock('../../../entry-actions', () => ({
  __esModule: true,
  default: {
    updateList: (id, data) => ({ type: 'list-update', payload: { id, data } }),
    pasteCard: (id) => ({ type: 'card-paste', payload: { id } }),
    createCard: () => ({ type: 'card-create' }),
    setCardSelection: (cardIds) => ({ type: 'card-selection-set', payload: { cardIds } }),
    clearListFilter: (id) => ({ type: 'list-filter-clear', payload: { id } }),
  },
}));

jest.mock('./EditName', () => () => null);
jest.mock('./ActionsStep', () => () => null);
jest.mock('../ListFilterStep', () => () => null);
jest.mock('../../cards/DraggableCard', () => () => null);
jest.mock('../../cards/AddCard', () => () => null);
jest.mock('../../cards/ArchiveCardsStep', () => () => null);

let container;
let root;
let store;
let dispatchedActions;
let handleListMouseEnter;
let handleListMouseLeave;

window.IS_REACT_ACT_ENVIRONMENT = true;

const renderList = () => {
  act(() => {
    root.render(
      <Provider store={store}>
        <BoardShortcutsContext.Provider value={[handleListMouseEnter, handleListMouseLeave]}>
          <List id="list-1" index={0} />
        </BoardShortcutsContext.Provider>
      </Provider>,
    );
  });
};

// Forces useSelector hooks to re-run after the mocked selector results change
const syncSelectors = () => {
  act(() => {
    store.dispatch({ type: '@@test/sync-selectors' });
  });
};

const click = (element) => {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

const collapse = () => {
  click(container.querySelector('button[title="action.collapseList"]'));
  mockList = { ...mockList, isCollapsed: true };
  syncSelectors();
};

const expand = () => {
  click(container.querySelector('button[title="action.expandList"]'));
  mockList = { ...mockList, isCollapsed: false };
  syncSelectors();
};

const lastDraggableProps = () => mockDraggableRenderProps[mockDraggableRenderProps.length - 1];

beforeEach(() => {
  mockList = {
    id: 'list-1',
    name: 'Todo',
    type: 'active',
    color: null,
    isPersisted: true,
    isCollapsed: false,
  };
  mockAllCardIds = ['card-1', 'card-2', 'card-3'];
  mockCardIds = ['card-1', 'card-2', 'card-3'];
  mockIsFilterActive = false;
  mockDraggableRenderProps.length = 0;

  dispatchedActions = [];
  store = createStore((state, action) => {
    dispatchedActions.push(action);
    // react-redux v9 only re-runs selectors when the state reference changes
    return action.type === '@@test/sync-selectors' ? { ...state } : state;
  }, {});

  handleListMouseEnter = jest.fn();
  handleListMouseLeave = jest.fn();

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('collapsed strip', () => {
  test('renders chevron, vertical name and unfiltered card count', () => {
    mockList = { ...mockList, isCollapsed: true };

    renderList();

    expect(container.querySelector('button[title="action.expandList"]')).not.toBeNull();
    expect(container.querySelector('.headerNameCollapsed').textContent).toBe('Todo');
    expect(container.querySelector('.headerCardsCountCollapsed').textContent).toBe('(3)');
    expect(container.querySelector('.cardsInnerWrapper')).toBeNull();
  });

  test('keeps the same draggable id and stays draggable', () => {
    mockList = { ...mockList, isCollapsed: true };

    renderList();

    expect(lastDraggableProps().draggableId).toBe('list:list-1');
    expect(lastDraggableProps().isDragDisabled).toBe(false);
  });

  test('expanding restores the normal column', () => {
    mockList = { ...mockList, isCollapsed: true };
    renderList();

    expand();

    expect(dispatchedActions).toContainEqual({
      type: 'list-update',
      payload: { id: 'list-1', data: { isCollapsed: false } },
    });
    expect(container.querySelector('.cardsInnerWrapper')).not.toBeNull();
    expect(container.querySelector('.headerName').textContent).toContain('Todo');
  });
});

describe('list filter header controls', () => {
  test('shows no filter indicator or clear button when the filter is inactive', () => {
    renderList();

    expect(container.querySelector('.headerFilterIcon')).toBeNull();
    expect(container.querySelector('button[title="action.clearFilter"]')).toBeNull();
  });

  test('shows the always-visible indicator and quick clear button when the filter is active', () => {
    mockIsFilterActive = true;
    mockCardIds = ['card-1', 'card-2'];

    renderList();

    expect(container.querySelector('.headerFilterIcon')).not.toBeNull();
    expect(container.querySelector('button[title="action.clearFilter"]')).not.toBeNull();
    expect(container.querySelector('.headerFiltered')).not.toBeNull();
  });

  test('quick clear button dispatches the clear-list-filter entry action', () => {
    mockIsFilterActive = true;

    renderList();

    click(container.querySelector('button[title="action.clearFilter"]'));

    expect(dispatchedActions).toContainEqual({
      type: 'list-filter-clear',
      payload: { id: 'list-1' },
    });
    // The click must not bubble into the header and open the name editor
    expect(container.querySelector('.headerName')).not.toBeNull();
  });

  test('cards count shows "N of M" while filtered', () => {
    mockIsFilterActive = true;
    mockCardIds = ['card-1', 'card-2'];

    renderList();

    expect(container.querySelector('.headerCardsCount').textContent).toBe(
      '2 common.of 3 common.cards',
    );
  });

  test('collapsed strip shows the indicator and its clear button dispatches too', () => {
    mockIsFilterActive = true;
    mockList = { ...mockList, isCollapsed: true };

    renderList();

    expect(container.querySelector('.headerFilterIconCollapsed')).not.toBeNull();

    click(container.querySelector('button[title="action.clearFilter"]'));

    expect(dispatchedActions).toContainEqual({
      type: 'list-filter-clear',
      payload: { id: 'list-1' },
    });
  });

  test('renders no filter controls for a non-persisted list', () => {
    mockIsFilterActive = true;
    mockList = { ...mockList, isPersisted: false };

    renderList();

    expect(container.querySelector('.headerFilterIcon')).toBeNull();
    expect(container.querySelector('button[title="action.clearFilter"]')).toBeNull();
  });
});

describe('collapse interaction regressions', () => {
  test('clears the shortcuts hover entry and ignores the stale paste scroll callback', () => {
    renderList();

    act(() => {
      container
        .querySelector('.innerWrapper')
        .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    expect(handleListMouseEnter).toHaveBeenCalledWith('list-1', expect.any(Function));
    const staleOnPaste = handleListMouseEnter.mock.calls[0][1];

    collapse();

    expect(handleListMouseLeave).toHaveBeenCalled();
    expect(dispatchedActions).toContainEqual({
      type: 'list-update',
      payload: { id: 'list-1', data: { isCollapsed: true } },
    });

    // Simulates ShortcutsProvider invoking the stale hover entry on Ctrl+V:
    // the cards wrapper is unmounted, so scrolling to bottom must be a no-op
    expect(() => act(() => staleOnPaste())).not.toThrow();
  });

  test('closes the add-card form so later card updates do not touch the unmounted wrapper', () => {
    renderList();

    click(container.querySelector('.addCardButton'));
    expect(container.querySelector('.addCardButtonWrapper')).toBeNull();

    collapse();

    mockCardIds = [...mockCardIds, 'card-4'];
    syncSelectors();

    expand();

    // The add-card form was closed on collapse instead of lingering in state
    expect(container.querySelector('.addCardButtonWrapper')).not.toBeNull();
  });

  test('resets the name editor so the collapsed strip stays draggable', () => {
    renderList();

    click(container.querySelector('.header'));

    expect(lastDraggableProps().isDragDisabled).toBe(true);

    collapse();

    expect(lastDraggableProps().isDragDisabled).toBe(false);

    expand();

    // The name editor was closed on collapse instead of lingering in state
    expect(container.querySelector('.headerName')).not.toBeNull();
  });
});
