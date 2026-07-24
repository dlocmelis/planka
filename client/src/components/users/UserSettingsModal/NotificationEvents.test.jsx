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

import EntryActionTypes from '../../../constants/EntryActionTypes';
import NotificationEvents from './NotificationEvents';

let mockCurrentUser;

jest.mock('react-i18next', () => ({
  useTranslation: () => [(key) => key],
}));

jest.mock('../../../selectors', () => ({
  __esModule: true,
  default: {
    selectCurrentUser: () => mockCurrentUser,
  },
}));

let container;
let root;
let store;
let dispatchedActions;

window.IS_REACT_ACT_ENVIRONMENT = true;

const renderComponent = () => {
  act(() => {
    root.render(
      <Provider store={store}>
        <NotificationEvents />
      </Provider>,
    );
  });
};

const findCheckbox = (name) => container.querySelector(`input[name="${name}"]`);

const click = (element) => {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

const currentUserUpdates = () =>
  dispatchedActions.filter((action) => action.type === EntryActionTypes.CURRENT_USER_UPDATE);

beforeEach(() => {
  mockCurrentUser = {
    notificationEvents: {
      comments: { mentions: true, own: true, user: true, dev: true, all: true },
      cardMovement: { own: true, user: true, dev: true, all: true },
      labels: { own: true, user: true, dev: true, all: true },
      fields: { own: true, user: true, dev: true, all: true },
    },
  };

  dispatchedActions = [];
  store = createStore((state, action) => {
    dispatchedActions.push(action);
    return state || {};
  });

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

test('checking an individual scope only changes that scope', () => {
  mockCurrentUser = {
    notificationEvents: {
      comments: { mentions: true, own: false, user: false, dev: false, all: false },
      cardMovement: { own: true, user: true, dev: true, all: true },
      labels: { own: true, user: true, dev: true, all: true },
      fields: { own: true, user: true, dev: true, all: true },
    },
  };

  renderComponent();
  click(findCheckbox('comments.own'));

  expect(currentUserUpdates()).toEqual([
    {
      type: EntryActionTypes.CURRENT_USER_UPDATE,
      payload: {
        data: {
          notificationEvents: {
            ...mockCurrentUser.notificationEvents,
            comments: { mentions: true, own: true, user: false, dev: false, all: false },
          },
        },
      },
    },
  ]);
});

test('unchecking a sibling scope while "all" is checked also unchecks "all"', () => {
  renderComponent();
  click(findCheckbox('comments.own'));

  expect(currentUserUpdates()).toEqual([
    {
      type: EntryActionTypes.CURRENT_USER_UPDATE,
      payload: {
        data: {
          notificationEvents: {
            ...mockCurrentUser.notificationEvents,
            comments: { mentions: true, own: false, user: true, dev: true, all: false },
          },
        },
      },
    },
  ]);
});

test('unchecking a sibling scope while "all" is unchecked keeps the single-key update', () => {
  mockCurrentUser = {
    notificationEvents: {
      comments: { mentions: true, own: true, user: true, dev: true, all: true },
      cardMovement: { own: true, user: true, dev: false, all: false },
      labels: { own: true, user: true, dev: true, all: true },
      fields: { own: true, user: true, dev: true, all: true },
    },
  };

  renderComponent();
  click(findCheckbox('cardMovement.own'));

  expect(currentUserUpdates()).toEqual([
    {
      type: EntryActionTypes.CURRENT_USER_UPDATE,
      payload: {
        data: {
          notificationEvents: {
            ...mockCurrentUser.notificationEvents,
            cardMovement: { own: false, user: true, dev: false, all: false },
          },
        },
      },
    },
  ]);
});

test('unchecking "all" deselects every scope in the group', () => {
  renderComponent();
  click(findCheckbox('comments.all'));

  expect(currentUserUpdates()).toEqual([
    {
      type: EntryActionTypes.CURRENT_USER_UPDATE,
      payload: {
        data: {
          notificationEvents: {
            ...mockCurrentUser.notificationEvents,
            comments: { mentions: false, own: false, user: false, dev: false, all: false },
          },
        },
      },
    },
  ]);
});

test('checking "all" selects every scope in the group without touching other groups', () => {
  mockCurrentUser = {
    notificationEvents: {
      comments: { mentions: true, own: true, user: true, dev: true, all: true },
      cardMovement: { own: false, user: true, dev: false, all: false },
      labels: { own: false, user: false, dev: false, all: false },
      fields: { own: true, user: true, dev: true, all: true },
    },
  };

  renderComponent();
  click(findCheckbox('cardMovement.all'));

  expect(currentUserUpdates()).toEqual([
    {
      type: EntryActionTypes.CURRENT_USER_UPDATE,
      payload: {
        data: {
          notificationEvents: {
            ...mockCurrentUser.notificationEvents,
            cardMovement: { own: true, user: true, dev: true, all: true },
          },
        },
      },
    },
  ]);
});
