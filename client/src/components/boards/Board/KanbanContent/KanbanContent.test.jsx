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
    selectIsEditModeEnabled: () => false,
    selectCurrentUserMembershipForCurrentBoard: () => null,
  },
}));

jest.mock('../../../../entry-actions', () => ({
  __esModule: true,
  default: {
    moveList: (id, index) => ({ type: 'list-move', payload: { id, index } }),
    moveCard: (id, listId, index) => ({ type: 'card-move', payload: { id, listId, index } }),
    clearCardSelection: () => ({ type: 'card-selection-clear' }),
  },
}));

jest.mock('../../../lists/List', () => (props) => {
  mockListPropsList.push(props);
  return null;
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
  dispatchedActions.filter((action) => ['card-move', 'list-move'].includes(action.type));

beforeEach(() => {
  mockListIds = ['list-1', 'list-2'];
  mockDragDropContextPropsList.length = 0;
  mockListPropsList.length = 0;

  dispatchedActions = [];
  store = createStore((state, action) => {
    dispatchedActions.push(action);
    return state;
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
