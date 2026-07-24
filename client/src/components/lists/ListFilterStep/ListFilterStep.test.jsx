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
import ListFilterStep from './ListFilterStep';

let mockFilterUserIds;
let mockFilterLabelIds;
let mockFilterCustomFields;
const mockUserAvatarPropsList = [];
const mockLabelChipPropsList = [];
const mockBoardMembershipsStepPropsList = [];
const mockLabelsStepPropsList = [];
const mockFieldsStepPropsList = [];

jest.mock('react-i18next', () => ({
  useTranslation: () => [(key) => key],
}));

jest.mock('../../../selectors', () => ({
  __esModule: true,
  default: {
    makeSelectFilterUserIdsByListId: () => () => mockFilterUserIds,
    makeSelectFilterLabelIdsByListId: () => () => mockFilterLabelIds,
    makeSelectFilterCustomFieldsByListId: () => () => mockFilterCustomFields,
    makeSelectIsFilterActiveByListId: () => () =>
      mockFilterUserIds.length > 0 ||
      mockFilterLabelIds.length > 0 ||
      mockFilterCustomFields.length > 0,
  },
}));

jest.mock('../../users/UserAvatar', () => (props) => {
  mockUserAvatarPropsList.push(props);
  return null;
});

jest.mock('../../labels/LabelChip', () => (props) => {
  mockLabelChipPropsList.push(props);
  return null;
});

jest.mock('../../board-memberships/BoardMembershipsStep', () => (props) => {
  mockBoardMembershipsStepPropsList.push(props);
  return null;
});

jest.mock('../../labels/LabelsStep', () => (props) => {
  mockLabelsStepPropsList.push(props);
  return null;
});

jest.mock('./FieldsStep', () => (props) => {
  mockFieldsStepPropsList.push(props);
  return null;
});

let container;
let root;
let store;
let dispatchedActions;

window.IS_REACT_ACT_ENVIRONMENT = true;

const renderStep = () => {
  act(() => {
    root.render(
      <Provider store={store}>
        <ListFilterStep listId="list-1" />
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

const lastBoardMembershipsStepProps = () =>
  mockBoardMembershipsStepPropsList[mockBoardMembershipsStepPropsList.length - 1];

const lastLabelsStepProps = () => mockLabelsStepPropsList[mockLabelsStepPropsList.length - 1];

beforeEach(() => {
  mockFilterUserIds = [];
  mockFilterLabelIds = [];
  mockFilterCustomFields = [];

  mockUserAvatarPropsList.length = 0;
  mockLabelChipPropsList.length = 0;
  mockBoardMembershipsStepPropsList.length = 0;
  mockLabelsStepPropsList.length = 0;
  mockFieldsStepPropsList.length = 0;

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

test('renders root menu without clear filter when no filter is active', () => {
  renderStep();

  expect(container.textContent).toContain('common.filterList');
  expect(findMenuItem('common.members')).toBeDefined();
  expect(findMenuItem('common.labels')).toBeDefined();
  expect(findMenuItem('common.fields')).toBeDefined();
  expect(findMenuItem('action.clearFilter')).toBeUndefined();
});

test('renders current selections as chips and shows clear filter', () => {
  mockFilterUserIds = ['user-1'];
  mockFilterLabelIds = ['label-1'];
  mockFilterCustomFields = [
    {
      name: 'Points',
      content: '3',
    },
  ];

  renderStep();

  expect(mockUserAvatarPropsList.map(({ id }) => id)).toContain('user-1');
  expect(mockLabelChipPropsList.map(({ id }) => id)).toContain('label-1');
  expect(container.textContent).toContain('Points: 3');
  expect(findMenuItem('action.clearFilter')).toBeDefined();
});

test('members sub-step dispatches per-list filter actions with the list id', () => {
  mockFilterUserIds = ['user-1'];

  renderStep();
  click(findMenuItem('common.members'));

  const props = lastBoardMembershipsStepProps();
  expect(props.currentUserIds).toEqual(['user-1']);
  expect(props.title).toBe('common.filterByMembers');

  act(() => {
    props.onUserSelect('user-2');
    props.onUserDeselect('user-1');
  });

  expect(entryActionsOfType(EntryActionTypes.USER_TO_LIST_FILTER_ADD)).toEqual([
    {
      type: EntryActionTypes.USER_TO_LIST_FILTER_ADD,
      payload: {
        id: 'user-2',
        listId: 'list-1',
      },
    },
  ]);

  expect(entryActionsOfType(EntryActionTypes.USER_FROM_LIST_FILTER_REMOVE)).toEqual([
    {
      type: EntryActionTypes.USER_FROM_LIST_FILTER_REMOVE,
      payload: {
        id: 'user-1',
        listId: 'list-1',
      },
    },
  ]);
});

test('labels sub-step dispatches per-list filter actions with the list id', () => {
  mockFilterLabelIds = ['label-1'];

  renderStep();
  click(findMenuItem('common.labels'));

  const props = lastLabelsStepProps();
  expect(props.currentIds).toEqual(['label-1']);
  expect(props.title).toBe('common.filterByLabels');

  act(() => {
    props.onSelect('label-2');
    props.onDeselect('label-1');
  });

  expect(entryActionsOfType(EntryActionTypes.LABEL_TO_LIST_FILTER_ADD)).toEqual([
    {
      type: EntryActionTypes.LABEL_TO_LIST_FILTER_ADD,
      payload: {
        id: 'label-2',
        listId: 'list-1',
      },
    },
  ]);

  expect(entryActionsOfType(EntryActionTypes.LABEL_FROM_LIST_FILTER_REMOVE)).toEqual([
    {
      type: EntryActionTypes.LABEL_FROM_LIST_FILTER_REMOVE,
      payload: {
        id: 'label-1',
        listId: 'list-1',
      },
    },
  ]);
});

test('fields sub-step receives the list id', () => {
  renderStep();
  click(findMenuItem('common.fields'));

  expect(mockFieldsStepPropsList.length).toBeGreaterThan(0);
  expect(mockFieldsStepPropsList[mockFieldsStepPropsList.length - 1].listId).toBe('list-1');
});

test('removing a field chip dispatches an update without that field', () => {
  mockFilterCustomFields = [
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
  click(container.querySelector('button[data-name="Points"]'));

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

test('clear filter dispatches a single list filter clear action', () => {
  mockFilterUserIds = ['user-1'];
  mockFilterLabelIds = ['label-1'];
  mockFilterCustomFields = [
    {
      name: 'Points',
      content: '3',
    },
  ];

  renderStep();
  click(findMenuItem('action.clearFilter'));

  expect(entryActionsOfType(EntryActionTypes.LIST_FILTER_CLEAR)).toEqual([
    {
      type: EntryActionTypes.LIST_FILTER_CLEAR,
      payload: {
        id: 'list-1',
      },
    },
  ]);
});
