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

import KanbanContent from './KanbanContent';

const mockDragDropContextPropsList = [];
const mockListPropsList = [];

let mockListIds;
let mockSelectedCardIds;

jest.mock('react-i18next', () => ({
  useTranslation: () => [(key) => key],
}));

jest.mock('react-beautiful-dnd', () => ({
  DragDropContext: (props) => {
    mockDragDropContextPropsList.push(props);

    return props.children;
  },
  Droppable: (props) =>
    props.children(
      {
        innerRef: () => {},
        droppableProps: {},
        placeholder: null,
      },
      { isDraggingOver: false },
    ),
}));

jest.mock('../../../../lib/popup', () => ({
  closePopup: () => {},
}));

jest.mock('../../../../selectors', () => ({
  __esModule: true,
  default: {
    selectKanbanListIdsForCurrentBoard: () => mockListIds,
    selectSelectedCardIds: () => mockSelectedCardIds,
    selectIsEditModeEnabled: () => false,
    selectCurrentUserMembershipForCurrentBoard: () => null,
  },
}));

jest.mock('../../../../entry-actions', () => ({
  __esModule: true,
  default: {
    moveList: (id, index) => ({ type: 'list-move', payload: { id, index } }),
    moveCard: (id, listId, index) => ({ type: 'card-move', payload: { id, listId, index } }),
    moveCards: (ids, listId, index, draggedId) => ({
      type: 'cards-move',
      payload: { ids, listId, index, draggedId },
    }),
    clearCardSelection: () => ({ type: 'card-selection-clear' }),
  },
}));

jest.mock('../../../lists/List', () => {
  const { useContext } = jest.requireActual('react');
  const { CardDragContext } = jest.requireActual('../../../../contexts');

  return (props) => {
    mockListPropsList.push({ ...props, cardDrag: useContext(CardDragContext) });
    return null;
  };
});

jest.mock('../../../cards/BulkActionsBar', () => () => null);
jest.mock('./AddList', () => () => null);

let container;
let root;
let store;
let dispatchedActions;

window.IS_REACT_ACT_ENVIRONMENT = true;

const renderContent = () => {
  act(() => {
    root.render(
      <Provider store={store}>
        <KanbanContent />
      </Provider>,
    );
  });
};

const dndProps = () => mockDragDropContextPropsList[mockDragDropContextPropsList.length - 1];

const beforeCapture = (draggableId) => {
  act(() => {
    dndProps().onBeforeCapture({ draggableId });
  });
};

const dragEnd = (result) => {
  act(() => {
    dndProps().onDragEnd(result);
  });
};

// The last List rendered carries the current value, since every state change re-renders them all
const lastIsDragActive = () => mockListPropsList[mockListPropsList.length - 1].isDragActive;

const moveActions = () =>
  dispatchedActions.filter((action) =>
    ['card-move', 'cards-move', 'list-move', 'card-selection-clear'].includes(action.type),
  );

// What DraggableCard reads from the drag context, as the last List render saw it
const lastCardDrag = () => mockListPropsList[mockListPropsList.length - 1].cardDrag;

beforeEach(() => {
  mockListIds = ['list-1', 'list-2'];
  mockSelectedCardIds = [];
  mockDragDropContextPropsList.length = 0;
  mockListPropsList.length = 0;

  dispatchedActions = [];
  store = createStore((state, action) => {
    dispatchedActions.push(action);
    // A fresh state makes useSelector re-run, the way a Card or List table change does
    return action.type === 'store-change' ? { ...state } : state;
  }, {});

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

describe('dropping a card onto a collapsed list strip', () => {
  // The collapsed strip renders a droppable with the same `list:<id>` id as the expanded
  // column, holding no Draggables - so react-beautiful-dnd always reports index 0
  test('dispatches a move to the strip list at index 0', () => {
    renderContent();

    beforeCapture('card:card-1');
    dragEnd({
      draggableId: 'card:card-1',
      type: 'CARD',
      source: { droppableId: 'list:list-1', index: 2 },
      destination: { droppableId: 'list:list-2', index: 0 },
    });

    expect(moveActions()).toEqual([
      { type: 'card-move', payload: { id: 'card-1', listId: 'list-2', index: 0 } },
    ]);
  });

  test('dispatches nothing when the card is dropped outside any list', () => {
    renderContent();

    beforeCapture('card:card-1');
    dragEnd({
      draggableId: 'card:card-1',
      type: 'CARD',
      source: { droppableId: 'list:list-1', index: 2 },
      destination: null,
    });

    expect(moveActions()).toEqual([]);
  });
});

describe('card drag latch passed to lists', () => {
  test('is not armed for a list drag', () => {
    renderContent();

    beforeCapture('list:list-1');

    expect(lastIsDragActive()).toBe(false);
  });

  test('is armed on capture and released when the drop has no destination', () => {
    renderContent();

    beforeCapture('card:card-1');
    expect(lastIsDragActive()).toBe(true);

    dragEnd({
      draggableId: 'card:card-1',
      type: 'CARD',
      source: { droppableId: 'list:list-1', index: 2 },
      destination: null,
    });

    expect(lastIsDragActive()).toBe(false);
  });

  test('is armed on capture and released when the card lands back where it started', () => {
    renderContent();

    beforeCapture('card:card-1');
    expect(lastIsDragActive()).toBe(true);

    dragEnd({
      draggableId: 'card:card-1',
      type: 'CARD',
      source: { droppableId: 'list:list-1', index: 2 },
      destination: { droppableId: 'list:list-1', index: 2 },
    });

    expect(lastIsDragActive()).toBe(false);
    expect(moveActions()).toEqual([]);
  });

  test('is armed on capture and released after a real move', () => {
    renderContent();

    beforeCapture('card:card-1');
    expect(lastIsDragActive()).toBe(true);

    dragEnd({
      draggableId: 'card:card-1',
      type: 'CARD',
      source: { droppableId: 'list:list-1', index: 2 },
      destination: { droppableId: 'list:list-2', index: 0 },
    });

    expect(lastIsDragActive()).toBe(false);
  });
});

describe('dragging a card while several cards are selected', () => {
  test('moves every selected card to the drop point and clears the selection', () => {
    mockSelectedCardIds = ['card-3', 'card-1', 'card-7'];
    renderContent();

    beforeCapture('card:card-1');
    dragEnd({
      draggableId: 'card:card-1',
      type: 'CARD',
      source: { droppableId: 'list:list-1', index: 0 },
      destination: { droppableId: 'list:list-2', index: 2 },
    });

    expect(moveActions()).toEqual([
      {
        type: 'cards-move',
        payload: {
          ids: ['card-3', 'card-1', 'card-7'],
          listId: 'list-2',
          index: 2,
          draggedId: 'card-1',
        },
      },
      { type: 'card-selection-clear' },
    ]);
  });

  test('gathers the selection even when the dragged card lands back where it started', () => {
    mockSelectedCardIds = ['card-1', 'card-2'];
    renderContent();

    beforeCapture('card:card-1');
    dragEnd({
      draggableId: 'card:card-1',
      type: 'CARD',
      source: { droppableId: 'list:list-1', index: 0 },
      destination: { droppableId: 'list:list-1', index: 0 },
    });

    expect(moveActions().map(({ type }) => type)).toEqual(['cards-move', 'card-selection-clear']);
  });

  test('moves only the dragged card, and keeps the selection, when it is not selected', () => {
    mockSelectedCardIds = ['card-3', 'card-7'];
    renderContent();

    beforeCapture('card:card-1');
    dragEnd({
      draggableId: 'card:card-1',
      type: 'CARD',
      source: { droppableId: 'list:list-1', index: 0 },
      destination: { droppableId: 'list:list-2', index: 2 },
    });

    expect(moveActions()).toEqual([
      { type: 'card-move', payload: { id: 'card-1', listId: 'list-2', index: 2 } },
    ]);
  });

  test('moves only the dragged card when it is the only one selected', () => {
    mockSelectedCardIds = ['card-1'];
    renderContent();

    beforeCapture('card:card-1');
    dragEnd({
      draggableId: 'card:card-1',
      type: 'CARD',
      source: { droppableId: 'list:list-1', index: 0 },
      destination: { droppableId: 'list:list-2', index: 2 },
    });

    expect(moveActions()).toEqual([
      { type: 'card-move', payload: { id: 'card-1', listId: 'list-2', index: 2 } },
    ]);
  });

  test('moves nothing and keeps the selection when the drop has no destination', () => {
    mockSelectedCardIds = ['card-1', 'card-2'];
    renderContent();

    beforeCapture('card:card-1');
    dragEnd({
      draggableId: 'card:card-1',
      type: 'CARD',
      source: { droppableId: 'list:list-1', index: 0 },
      destination: null,
    });

    expect(moveActions()).toEqual([]);
  });
});

describe('card drag context read by the cards', () => {
  test('carries the dragged card and the selection size while a selected card is dragged', () => {
    mockSelectedCardIds = ['card-1', 'card-2', 'card-3'];
    renderContent();

    expect(lastCardDrag()).toEqual({ draggingCardId: null, groupSize: 0 });

    beforeCapture('card:card-2');
    expect(lastCardDrag()).toEqual({ draggingCardId: 'card-2', groupSize: 3 });

    dragEnd({
      draggableId: 'card:card-2',
      type: 'CARD',
      source: { droppableId: 'list:list-1', index: 1 },
      destination: null,
    });
    expect(lastCardDrag()).toEqual({ draggingCardId: null, groupSize: 0 });
  });

  test('has no group while a card that is not selected is dragged', () => {
    mockSelectedCardIds = ['card-1', 'card-2'];
    renderContent();

    beforeCapture('card:card-9');
    expect(lastCardDrag()).toEqual({ draggingCardId: 'card-9', groupSize: 0 });
  });

  test('is not set for a list drag', () => {
    mockSelectedCardIds = ['card-1', 'card-2'];
    renderContent();

    beforeCapture('list:list-1');
    expect(lastCardDrag()).toEqual({ draggingCardId: null, groupSize: 0 });
  });
});

describe('card drag context identity', () => {
  // selectSelectedCardIds is a redux-orm selector: it hands back a new array whenever the Card
  // or List tables change, so these simulate that with a new array and a new store state
  const changeStore = (selectedCardIds) => {
    mockSelectedCardIds = selectedCardIds;
    const rendersBefore = mockListPropsList.length;

    act(() => {
      store.dispatch({ type: 'store-change' });
    });

    // Guards the tests below against passing only because nothing re-rendered
    expect(mockListPropsList.length).toBeGreaterThan(rendersBefore);
  };

  test('stays the same object across store changes while nothing is dragged', () => {
    mockSelectedCardIds = ['card-1', 'card-2'];
    renderContent();
    const before = lastCardDrag();

    changeStore(['card-1', 'card-2']);
    expect(lastCardDrag()).toBe(before);

    changeStore(['card-1', 'card-2', 'card-3']);
    expect(lastCardDrag()).toBe(before);
  });

  test('stays the same object during a drag while the group size is unchanged', () => {
    mockSelectedCardIds = ['card-1', 'card-2'];
    renderContent();

    beforeCapture('card:card-1');
    const during = lastCardDrag();

    changeStore(['card-1', 'card-2']);
    expect(lastCardDrag()).toBe(during);
  });

  test('changes when the group size changes during a drag', () => {
    mockSelectedCardIds = ['card-1', 'card-2'];
    renderContent();

    beforeCapture('card:card-1');
    changeStore(['card-1', 'card-2', 'card-3']);

    expect(lastCardDrag()).toEqual({ draggingCardId: 'card-1', groupSize: 3 });
  });
});
