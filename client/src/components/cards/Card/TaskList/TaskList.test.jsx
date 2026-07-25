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

import TaskList from './TaskList';

let mockTaskList;
let mockTasks;
let mockCardsById;
let mockListsById;
let mockBoardMembership;

jest.mock('react-router', () => ({
  Link: ({ children }) => children,
}));

jest.mock(
  '../../../common/Linkify',
  () =>
    ({ children }) =>
      children,
);

jest.mock('../../../../selectors', () => ({
  __esModule: true,
  default: {
    makeSelectTaskListById: () => () => mockTaskList,
    makeSelectTasksByTaskListId: () => () => mockTasks,
    makeSelectTaskById: () => (_, id) => mockTasks.find((task) => task.id === id),
    makeSelectCardById: () => (_, id) => mockCardsById[id] || null,
    makeSelectListById: () => (_, id) => mockListsById[id] || null,
    selectCurrentBoard: () => ({ expandTaskListsByDefault: true }),
    selectCurrentUserMembershipForCurrentBoard: () => mockBoardMembership,
  },
}));

jest.mock('../../../../entry-actions', () => ({
  __esModule: true,
  default: {
    updateTask: (id, data) => ({ type: 'task-update', payload: { id, data } }),
  },
}));

let container;
let root;
let store;
let dispatchedActions;
let handleCardClick;

window.IS_REACT_ACT_ENVIRONMENT = true;

const renderTaskList = () => {
  act(() => {
    root.render(
      <Provider store={store}>
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events,
                                     jsx-a11y/no-static-element-interactions */}
        <div onClick={handleCardClick}>
          <TaskList id="task-list-1" />
        </div>
      </Provider>,
    );
  });
};

const checkboxes = () => [...container.querySelectorAll('input[type="checkbox"]')];

const click = (element) => {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

const mouseDown = (element) => {
  act(() => {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
};

const taskUpdateActions = () => dispatchedActions.filter((action) => action.type === 'task-update');

beforeEach(() => {
  mockTaskList = {
    id: 'task-list-1',
    name: 'Checklist',
    cardId: 'card-1',
    hideCompletedTasks: false,
    isPersisted: true,
  };
  mockTasks = [
    {
      id: 'task-1',
      name: 'Drain for restart',
      taskListId: 'task-list-1',
      linkedCardId: null,
      isCompleted: false,
      isPersisted: true,
    },
    {
      id: 'task-2',
      name: 'Deploy',
      taskListId: 'task-list-1',
      linkedCardId: null,
      isCompleted: true,
      isPersisted: true,
    },
  ];
  mockCardsById = {
    'card-1': { id: 'card-1', name: 'Pipeline', listId: 'list-1' },
    'card-2': { id: 'card-2', name: 'Linked card', listId: 'list-1' },
  };
  mockListsById = {
    'list-1': { id: 'list-1', name: 'Todo', type: 'active' },
  };
  mockBoardMembership = { role: 'editor' };

  dispatchedActions = [];
  store = createStore((state, action) => {
    dispatchedActions.push(action);
    return state;
  }, {});

  handleCardClick = jest.fn();

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

describe('front-of-card task checkbox', () => {
  test('renders a checkbox per task reflecting its completion', () => {
    renderTaskList();

    expect(checkboxes()).toHaveLength(2);
    expect(checkboxes()[0].checked).toBe(false);
    expect(checkboxes()[1].checked).toBe(true);
  });

  test('clicking an unchecked task dispatches the negated completion', () => {
    renderTaskList();

    click(checkboxes()[0]);

    expect(taskUpdateActions()).toContainEqual({
      type: 'task-update',
      payload: { id: 'task-1', data: { isCompleted: true } },
    });
  });

  test('clicking a checked task dispatches the negated completion', () => {
    renderTaskList();

    click(checkboxes()[1]);

    expect(taskUpdateActions()).toContainEqual({
      type: 'task-update',
      payload: { id: 'task-2', data: { isCompleted: false } },
    });
  });

  test('the click does not bubble into the card, so the card modal stays closed', () => {
    renderTaskList();

    click(checkboxes()[0]);

    expect(taskUpdateActions()).toHaveLength(1);
    expect(handleCardClick).not.toHaveBeenCalled();
  });

  test('the mousedown does not bubble into the card, so no card drag starts', () => {
    const handleDragSensorMouseDown = jest.fn();
    document.addEventListener('mousedown', handleDragSensorMouseDown);

    renderTaskList();

    mouseDown(checkboxes()[0]);

    // Stands in for the drag sensor of react-beautiful-dnd, which listens for
    // mousedown above the React root container
    expect(handleDragSensorMouseDown).not.toHaveBeenCalled();

    document.removeEventListener('mousedown', handleDragSensorMouseDown);
  });

  test('leaves the progress row untouched', () => {
    renderTaskList();

    expect(container.querySelector('.progressRow')).not.toBeNull();
    expect(container.querySelector('.progressRow input[type="checkbox"]')).toBeNull();
    expect(container.querySelector('.count').textContent).toBe('1/2');
  });
});

describe('front-of-card task checkbox permissions', () => {
  const expectAllDisabled = () => {
    expect(checkboxes()).not.toHaveLength(0);

    checkboxes().forEach((checkbox) => {
      expect(checkbox.disabled).toBe(true);
    });
  };

  test('is disabled for a viewer membership', () => {
    mockBoardMembership = { role: 'viewer' };

    renderTaskList();

    expectAllDisabled();

    click(checkboxes()[0]);

    expect(taskUpdateActions()).toHaveLength(0);
  });

  test('is disabled without a board membership', () => {
    mockBoardMembership = null;

    renderTaskList();

    expectAllDisabled();
  });

  test('is disabled when the card is in the archive list', () => {
    mockListsById['list-1'] = { id: 'list-1', name: null, type: 'archive' };

    renderTaskList();

    expectAllDisabled();
  });

  test('is disabled when the card is in the trash list', () => {
    mockListsById['list-1'] = { id: 'list-1', name: null, type: 'trash' };

    renderTaskList();

    expectAllDisabled();
  });

  test('is disabled for a linked-card task', () => {
    mockTasks = [
      {
        id: 'task-1',
        name: 'Linked task',
        taskListId: 'task-list-1',
        linkedCardId: 'card-2',
        isCompleted: false,
        isPersisted: true,
      },
    ];

    renderTaskList();

    expect(checkboxes()[0].disabled).toBe(true);

    click(checkboxes()[0]);

    expect(taskUpdateActions()).toHaveLength(0);
  });

  test('is disabled for a task that is not persisted yet', () => {
    mockTasks = [
      {
        id: 'task-1',
        name: 'Just added',
        taskListId: 'task-list-1',
        linkedCardId: null,
        isCompleted: false,
        isPersisted: false,
      },
    ];

    renderTaskList();

    expect(checkboxes()[0].disabled).toBe(true);
  });
});
