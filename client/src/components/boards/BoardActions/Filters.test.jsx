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
import enGB from '../../../locales/en-GB/core';
import enUS from '../../../locales/en-US/core';
import ruRU from '../../../locales/ru-RU/core';
import Filters from './Filters';

const CURRENT_USER_ID = 'user-1';

let mockUserIds;
let mockCreatorUserIds;
let mockLabelIds;
const mockUserAvatarPropsList = [];
const mockPopupPropsList = [];

jest.mock('react-i18next', () => ({
  useTranslation: () => [(key) => key],
}));

// Every selector must be referentially stable, otherwise react-redux warns on re-render.
jest.mock('../../../selectors', () => {
  const board = {
    id: 'board-1',
    search: '',
  };

  const hiddenListIds = [];
  const kanbanLists = [];

  return {
    __esModule: true,
    default: {
      selectCurrentBoard: () => board,
      selectFilterUserIdsForCurrentBoard: () => mockUserIds,
      selectFilterCreatorUserIdsForCurrentBoard: () => mockCreatorUserIds,
      selectFilterLabelIdsForCurrentBoard: () => mockLabelIds,
      selectHiddenListIdsForCurrentBoard: () => hiddenListIds,
      selectKanbanListsForCurrentBoard: () => kanbanLists,
      selectCurrentUserId: () => 'user-1',
      selectCurrentUserMembershipForCurrentBoard: () => null,
    },
  };
});

// The real popup only renders its step once opened; here the trigger is rendered
// inline and the props the step would receive are captured instead.
jest.mock('../../../lib/popup', () => ({
  usePopup: () => (props) => {
    mockPopupPropsList.push(props);
    return props.children;
  },
}));

jest.mock('../../users/UserAvatar', () => (props) => {
  mockUserAvatarPropsList.push(props);
  return null;
});

jest.mock('../../board-memberships/BoardMembershipsStep', () => () => null);
jest.mock('../../labels/LabelChip', () => () => null);
jest.mock('../../labels/LabelsStep', () => () => null);
jest.mock('../../lists/ListsFilterStep', () => () => null);

let container;
let root;
let store;
let dispatchedActions;

window.IS_REACT_ACT_ENVIRONMENT = true;

const renderFilters = () => {
  act(() => {
    root.render(
      <Provider store={store}>
        <Filters />
      </Provider>,
    );
  });
};

const click = (element) => {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

const entryActionsOfType = (type) => dispatchedActions.filter((action) => action.type === type);

// The creator group is the one whose trigger is titled `common.creator`.
const findCreatorGroup = () =>
  [...container.querySelectorAll('.filter')].find((element) =>
    element.textContent.startsWith('common.creator:'),
  );

const findCreatorShortcutButton = () =>
  [...findCreatorGroup().querySelectorAll('button')].find((element) =>
    element.querySelector('i.target.icon'),
  );

const creatorPopupProps = () =>
  mockPopupPropsList.filter(({ title }) => title === 'common.filterByCardCreator').pop();

beforeEach(() => {
  mockUserIds = [];
  mockCreatorUserIds = [];
  mockLabelIds = [];

  mockUserAvatarPropsList.length = 0;
  mockPopupPropsList.length = 0;

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

test('renders the creator group showing all when nothing is selected', () => {
  renderFilters();

  const group = findCreatorGroup();
  expect(group).toBeDefined();
  expect(group.textContent).toContain('common.creator:');
  expect(group.textContent).toContain('common.all');
  expect(group.querySelectorAll('.filterItem')).toHaveLength(0);
});

test('renders the creator group between the labels and lists groups', () => {
  renderFilters();

  const titles = [...container.querySelectorAll('.filterTitle')].map(
    (element) => element.textContent,
  );

  expect(titles).toEqual(['common.members:', 'common.labels:', 'common.creator:', 'common.lists:']);
});

test('passes the selected creators and the popup title to the memberships step', () => {
  mockCreatorUserIds = ['user-2'];

  renderFilters();

  const props = creatorPopupProps();
  expect(props.currentUserIds).toEqual(['user-2']);
  expect(props.title).toBe('common.filterByCardCreator');
});

test('the creator popup select and deselect handlers dispatch the creator filter actions', () => {
  renderFilters();

  const props = creatorPopupProps();

  act(() => {
    props.onUserSelect('user-2');
    props.onUserDeselect('user-3');
  });

  expect(entryActionsOfType(EntryActionTypes.CREATOR_USER_TO_FILTER_IN_CURRENT_BOARD_ADD)).toEqual([
    {
      type: EntryActionTypes.CREATOR_USER_TO_FILTER_IN_CURRENT_BOARD_ADD,
      payload: {
        id: 'user-2',
      },
    },
  ]);

  expect(
    entryActionsOfType(EntryActionTypes.CREATOR_USER_FROM_FILTER_IN_CURRENT_BOARD_REMOVE),
  ).toEqual([
    {
      type: EntryActionTypes.CREATOR_USER_FROM_FILTER_IN_CURRENT_BOARD_REMOVE,
      payload: {
        id: 'user-3',
      },
    },
  ]);
});

test('the shortcut dispatches adding the current user as creator without a board membership', () => {
  renderFilters();

  const shortcutButton = findCreatorShortcutButton();
  expect(shortcutButton).toBeDefined();

  click(shortcutButton);

  expect(entryActionsOfType(EntryActionTypes.CREATOR_USER_TO_FILTER_IN_CURRENT_BOARD_ADD)).toEqual([
    {
      type: EntryActionTypes.CREATOR_USER_TO_FILTER_IN_CURRENT_BOARD_ADD,
      payload: {
        id: CURRENT_USER_ID,
      },
    },
  ]);
});

test('hides the shortcut and renders a removable chip once a creator is selected', () => {
  mockCreatorUserIds = ['user-2'];

  renderFilters();

  expect(findCreatorShortcutButton()).toBeUndefined();

  const group = findCreatorGroup();
  expect(group.querySelectorAll('.filterItem')).toHaveLength(1);

  const avatarProps = mockUserAvatarPropsList.find(({ id }) => id === 'user-2');
  expect(avatarProps).toBeDefined();

  // UserAvatar renders the click target as a button carrying `data-id`.
  act(() => {
    avatarProps.onClick({
      currentTarget: {
        dataset: {
          id: 'user-2',
        },
      },
    });
  });

  expect(
    entryActionsOfType(EntryActionTypes.CREATOR_USER_FROM_FILTER_IN_CURRENT_BOARD_REMOVE),
  ).toEqual([
    {
      type: EntryActionTypes.CREATOR_USER_FROM_FILTER_IN_CURRENT_BOARD_REMOVE,
      payload: {
        id: 'user-2',
      },
    },
  ]);
});

test('the creator popup title key is translated in every locale that defines the others', () => {
  [enUS, enGB, ruRU].forEach((locale) => {
    expect(locale.translation.common.filterByCardCreator_title).toBeTruthy();
  });
});
