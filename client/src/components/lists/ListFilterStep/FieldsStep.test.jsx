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
import FieldsStep from './FieldsStep';

let mockFieldNames;
let mockStoredFilterCustomFields;

jest.mock('react-i18next', () => ({
  useTranslation: () => [(key) => key],
}));

jest.mock('redux-orm', () => ({
  ...jest.requireActual('redux-orm'),
  createSelector: () => () => mockFieldNames,
}));

jest.mock('../../../orm', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../../../selectors', () => ({
  __esModule: true,
  default: {
    makeSelectFilterCustomFieldsByListId: () => () => mockStoredFilterCustomFields,
  },
}));

let container;
let root;
let store;
let dispatchedActions;

window.IS_REACT_ACT_ENVIRONMENT = true;

const renderStep = () => {
  act(() => {
    root.render(
      <Provider store={store}>
        <FieldsStep listId="list-1" />
      </Provider>,
    );
  });
};

const click = (element) => {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

const findMenuItem = (text) =>
  [...container.querySelectorAll('a.item')].find((element) => element.textContent === text);

const entryActionsOfType = (type) => dispatchedActions.filter((action) => action.type === type);

beforeEach(() => {
  mockFieldNames = ['Points', 'Priority'];
  mockStoredFilterCustomFields = [];

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
  jest.useRealTimers();
});

test('shows an empty message when there are no fields', () => {
  mockFieldNames = [];

  renderStep();

  expect(container.textContent).toContain('common.noFieldsToFilterBy');
});

test('toggling a field on dispatches an update with an array of name/content entries', () => {
  renderStep();
  click(findMenuItem('Points'));

  expect(entryActionsOfType(EntryActionTypes.CUSTOM_FIELD_FILTER_IN_LIST_UPDATE)).toEqual([
    {
      type: EntryActionTypes.CUSTOM_FIELD_FILTER_IN_LIST_UPDATE,
      payload: {
        id: 'list-1',
        filterCustomFields: [
          {
            name: 'Points',
            content: '',
          },
        ],
      },
    },
  ]);
});

test('toggling a field off dispatches an update without that entry', () => {
  mockStoredFilterCustomFields = [
    {
      name: 'Points',
      content: '3',
    },
    {
      name: 'Priority',
      content: '',
    },
  ];

  renderStep();
  click(findMenuItem('Points'));

  expect(entryActionsOfType(EntryActionTypes.CUSTOM_FIELD_FILTER_IN_LIST_UPDATE)).toEqual([
    {
      type: EntryActionTypes.CUSTOM_FIELD_FILTER_IN_LIST_UPDATE,
      payload: {
        id: 'list-1',
        filterCustomFields: [
          {
            name: 'Priority',
            content: '',
          },
        ],
      },
    },
  ]);
});

test('typing a value dispatches a debounced update with the entry content', () => {
  jest.useFakeTimers();

  mockStoredFilterCustomFields = [
    {
      name: 'Points',
      content: '',
    },
  ];

  renderStep();

  const input = container.querySelector('input[name="Points"]');
  expect(input).not.toBeNull();

  act(() => {
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    ).set;
    setValue.call(input, '3');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  expect(entryActionsOfType(EntryActionTypes.CUSTOM_FIELD_FILTER_IN_LIST_UPDATE)).toHaveLength(0);

  act(() => {
    jest.advanceTimersByTime(400);
  });

  expect(entryActionsOfType(EntryActionTypes.CUSTOM_FIELD_FILTER_IN_LIST_UPDATE)).toEqual([
    {
      type: EntryActionTypes.CUSTOM_FIELD_FILTER_IN_LIST_UPDATE,
      payload: {
        id: 'list-1',
        filterCustomFields: [
          {
            name: 'Points',
            content: '3',
          },
        ],
      },
    },
  ]);
});
