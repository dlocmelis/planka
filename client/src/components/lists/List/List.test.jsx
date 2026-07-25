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
const mockDroppableRenderProps = [];
const mockDroppableInnerRefNodes = [];
const mockEmptySelectedCardIds = [];

let mockIsDraggingOver = false;

let mockList;
let mockAllCardIds;
let mockCardIds;
let mockIsFilterActive;
let mockBoardMembershipRole;

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
  Droppable: (props) => {
    mockDroppableRenderProps.push(props);

    return props.children(
      {
        // Records the node the droppable is mounted on; the marker attribute tracks
        // droppableProps landing on that very same node
        innerRef: (node) => {
          mockDroppableInnerRefNodes.push(node);
        },
        droppableProps: { 'data-mock-droppable-props': '' },
        placeholder: 'RBD_PLACEHOLDER',
      },
      { isDraggingOver: mockIsDraggingOver },
    );
  },
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
    selectCurrentUserMembershipForCurrentBoard: () => ({ role: mockBoardMembershipRole }),
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

const renderList = ({ isDragActive = false } = {}) => {
  act(() => {
    root.render(
      <Provider store={store}>
        <BoardShortcutsContext.Provider value={[handleListMouseEnter, handleListMouseLeave]}>
          <List id="list-1" index={0} isDragActive={isDragActive} />
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

const lastDroppableProps = () => mockDroppableRenderProps[mockDroppableRenderProps.length - 1];

// React calls the previous ref callback with null before the new one with the node,
// so only the mounted nodes are of interest
const lastDroppableInnerRefNode = () => {
  const nodes = mockDroppableInnerRefNodes.filter(Boolean);

  return nodes[nodes.length - 1] || null;
};

// Forces a re-render through the store after mutating mock values (List is memoized,
// so re-calling root.render with identical props would be skipped)
const rerender = () => {
  mockList = { ...mockList };
  syncSelectors();
};

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
  mockBoardMembershipRole = 'editor';
  mockDraggableRenderProps.length = 0;
  mockDroppableRenderProps.length = 0;
  mockDroppableInnerRefNodes.length = 0;
  mockIsDraggingOver = false;

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

describe('collapsed strip card droppable', () => {
  test('renders a single card droppable with the same id as the expanded list', () => {
    mockList = { ...mockList, isCollapsed: true };

    renderList();

    expect(mockDroppableRenderProps).toHaveLength(1);
    expect(lastDroppableProps().droppableId).toBe('list:list-1');
    expect(lastDroppableProps().type).toBe('CARD');
  });

  test('accepts drops on a user-collapsed list', () => {
    mockList = { ...mockList, isCollapsed: true };

    renderList();

    expect(lastDroppableProps().isDropDisabled).toBe(false);
  });

  test('accepts drops on a user-collapsed empty list', () => {
    mockList = { ...mockList, isCollapsed: true };
    mockAllCardIds = [];
    mockCardIds = [];

    renderList();

    expect(lastDroppableProps().isDropDisabled).toBe(false);
  });

  test('is drop-disabled for a collapsed list the user cannot drop cards into', () => {
    mockList = { ...mockList, isCollapsed: true };
    mockBoardMembershipRole = 'viewer';

    renderList();

    expect(lastDroppableProps().isDropDisabled).toBe(true);
  });

  test('is drop-disabled for a collapsed list that is not persisted', () => {
    mockList = { ...mockList, isCollapsed: true, isPersisted: false };

    renderList();

    expect(lastDroppableProps().isDropDisabled).toBe(true);
  });

  test('accepts drops on an auto-collapsed empty list', () => {
    mockAllCardIds = [];
    mockCardIds = [];

    renderList();

    // Empty and user-expanded, so the list renders as an auto-collapsed strip
    expect(container.querySelector('.headerNameCollapsed')).not.toBeNull();
    expect(lastDroppableProps().isDropDisabled).toBe(false);
  });

  test('shows the expansion overlay only while a card is dragged over the strip', () => {
    mockAllCardIds = [];
    mockCardIds = [];

    renderList();

    expect(container.querySelector('.collapsedDropExpansion')).toBeNull();
    expect(container.querySelector('.collapsedDropZoneActive')).toBeNull();

    mockIsDraggingOver = true;
    rerender();

    const expansion = container.querySelector('.collapsedDropExpansion');
    expect(expansion).not.toBeNull();
    expect(expansion.textContent).toContain('Todo');
    expect(expansion.querySelector('.collapsedDropExpansionSlot')).not.toBeNull();
    expect(container.querySelector('.collapsedDropZoneActive')).not.toBeNull();

    mockIsDraggingOver = false;
    rerender();

    expect(container.querySelector('.collapsedDropExpansion')).toBeNull();
    expect(container.querySelector('.collapsedDropZoneActive')).toBeNull();
  });

  test('shows the expansion overlay over a user-collapsed non-empty strip', () => {
    mockList = { ...mockList, isCollapsed: true };

    renderList();

    expect(container.querySelector('.collapsedDropExpansion')).toBeNull();
    expect(container.querySelector('.collapsedDropZoneActive')).toBeNull();

    mockIsDraggingOver = true;
    rerender();

    const expansion = container.querySelector('.collapsedDropExpansion');
    expect(expansion).not.toBeNull();
    expect(expansion.textContent).toContain('Todo');
    expect(expansion.querySelector('.collapsedDropExpansionSlot')).not.toBeNull();
    expect(container.querySelector('.collapsedDropZoneActive')).not.toBeNull();

    mockIsDraggingOver = false;
    rerender();

    expect(container.querySelector('.collapsedDropExpansion')).toBeNull();
    expect(container.querySelector('.collapsedDropZoneActive')).toBeNull();
  });

  test('expansion overlay shows the total card count, not the filtered one', () => {
    mockList = { ...mockList, isCollapsed: true };
    mockIsFilterActive = true;
    mockCardIds = ['card-1', 'card-2'];
    mockIsDraggingOver = true;

    renderList();

    const expansion = container.querySelector('.collapsedDropExpansion');
    expect(expansion.textContent).toContain('Todo');
    expect(expansion.textContent).toContain('(3)');
    expect(expansion.textContent).not.toContain('common.of');
  });

  test('renders the rbd placeholder inside the zero-size hidden container', () => {
    mockList = { ...mockList, isCollapsed: true };

    renderList();

    expect(container.querySelector('.collapsedDropPlaceholder').textContent).toBe(
      'RBD_PLACEHOLDER',
    );
  });

  test('expanded branch keeps its single cards droppable without the strip drop zone', () => {
    renderList();

    expect(mockDroppableRenderProps).toHaveLength(1);
    expect(lastDroppableProps().droppableId).toBe('list:list-1');
    expect(lastDroppableProps().type).toBe('CARD');
    expect(lastDroppableProps().isDropDisabled).toBe(false);
    expect(container.querySelector('.collapsedDropZone')).toBeNull();
  });
});

describe('collapsed strip drag-over stacking', () => {
  // An empty list renders as an auto-collapsed strip, the only collapsed state accepting drops
  const renderStrip = () => {
    mockAllCardIds = [];
    mockCardIds = [];

    renderList();
  };

  test('leaves the strip wrapper unraised while no card is dragged over it', () => {
    renderStrip();

    expect(container.querySelector('.innerWrapperCollapsed')).not.toBeNull();
    expect(container.querySelector('.innerWrapperCollapsedDropTarget')).toBeNull();
  });

  test('raises the strip wrapper itself while a card is dragged over it', () => {
    renderStrip();

    mockIsDraggingOver = true;
    rerender();

    const wrapper = container.querySelector('.innerWrapperCollapsedDropTarget');
    expect(wrapper).not.toBeNull();

    // The modifier has to sit on the strip wrapper: that is the stacking context the
    // expansion overlay must escape to paint over the following strips
    expect(wrapper.classList.contains('innerWrapperCollapsed')).toBe(true);
    expect(wrapper.querySelector('.collapsedDropExpansion')).not.toBeNull();

    mockIsDraggingOver = false;
    rerender();

    expect(container.querySelector('.innerWrapperCollapsedDropTarget')).toBeNull();
    expect(container.querySelector('.innerWrapperCollapsed')).not.toBeNull();
  });

  test('keeps the droppable mounted on the absolutely-positioned drop zone', () => {
    mockIsDraggingOver = true;

    renderStrip();

    // The measured rect must stay the drop zone's, not the strip wrapper's
    const dropZone = container.querySelector('.collapsedDropZone');
    expect(dropZone).not.toBeNull();
    expect(lastDroppableInnerRefNode()).toBe(dropZone);
    expect(dropZone.hasAttribute('data-mock-droppable-props')).toBe(true);
    expect(dropZone.parentElement).toBe(
      container.querySelector('.innerWrapperCollapsedDropTarget'),
    );
  });

  test('keeps the rbd placeholder inside the hidden placeholder container', () => {
    mockIsDraggingOver = true;

    renderStrip();

    expect(
      container.querySelector('.collapsedDropZone .collapsedDropPlaceholder').textContent,
    ).toBe('RBD_PLACEHOLDER');
  });

  test('still registers exactly one droppable and one draggable for the list', () => {
    mockIsDraggingOver = true;

    renderStrip();

    expect(mockDroppableRenderProps).toHaveLength(1);
    expect(lastDroppableProps().droppableId).toBe('list:list-1');
    expect(mockDraggableRenderProps).toHaveLength(1);
    expect(lastDraggableProps().draggableId).toBe('list:list-1');
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

describe('card-drag freeze latch', () => {
  test('keeps the auto-collapsed strip when the last card count goes 0->1 mid-drag', () => {
    mockAllCardIds = [];
    mockCardIds = [];

    renderList();
    expect(container.querySelector('.cardsInnerWrapper')).toBeNull();

    // Arms the latch at the pre-drag (collapsed) value
    renderList({ isDragActive: true });

    // Simulates a socket event adding the list's first card mid-drag
    mockAllCardIds = ['card-1'];
    mockCardIds = ['card-1'];
    syncSelectors();

    expect(container.querySelector('.cardsInnerWrapper')).toBeNull();

    renderList({ isDragActive: false });

    // The drag ended, so the branch may catch up with the new card count
    expect(container.querySelector('.cardsInnerWrapper')).not.toBeNull();
  });

  test('keeps the expanded column when the last card count goes 1->0 mid-drag', () => {
    mockAllCardIds = ['card-1'];
    mockCardIds = ['card-1'];

    renderList();
    expect(container.querySelector('.cardsInnerWrapper')).not.toBeNull();

    // Arms the latch at the pre-drag (expanded) value
    renderList({ isDragActive: true });

    // Simulates a socket event removing the list's last card mid-drag
    mockAllCardIds = [];
    mockCardIds = [];
    syncSelectors();

    expect(container.querySelector('.cardsInnerWrapper')).not.toBeNull();

    renderList({ isDragActive: false });

    expect(container.querySelector('.cardsInnerWrapper')).toBeNull();
  });

  test('follows the card count immediately while no drag is active', () => {
    mockAllCardIds = [];
    mockCardIds = [];

    renderList();
    expect(container.querySelector('.cardsInnerWrapper')).toBeNull();

    mockAllCardIds = ['card-1'];
    mockCardIds = ['card-1'];
    syncSelectors();

    expect(container.querySelector('.cardsInnerWrapper')).not.toBeNull();

    mockAllCardIds = [];
    mockCardIds = [];
    syncSelectors();

    expect(container.querySelector('.cardsInnerWrapper')).toBeNull();
  });

  test('re-arms the latch for each successive drag', () => {
    mockAllCardIds = [];
    mockCardIds = [];

    renderList();

    // Drag #1 latches the auto-collapsed strip
    renderList({ isDragActive: true });

    mockAllCardIds = ['card-1'];
    mockCardIds = ['card-1'];
    syncSelectors();

    expect(container.querySelector('.cardsInnerWrapper')).toBeNull();

    // Ending the drag releases the latch and the list expands
    renderList({ isDragActive: false });
    expect(container.querySelector('.cardsInnerWrapper')).not.toBeNull();

    // Drag #2 latches the expanded column
    renderList({ isDragActive: true });

    mockAllCardIds = [];
    mockCardIds = [];
    syncSelectors();

    expect(container.querySelector('.cardsInnerWrapper')).not.toBeNull();

    renderList({ isDragActive: false });
    expect(container.querySelector('.cardsInnerWrapper')).toBeNull();
  });
});
