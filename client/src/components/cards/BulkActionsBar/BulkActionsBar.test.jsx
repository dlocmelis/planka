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
import { BoardMembershipRoles, ListTypes } from '../../../constants/Enums';
import BulkActionsBar from './BulkActionsBar';

let mockCards;
let mockSelectedCardIds;
let mockLists;
let mockMembership;
const mockConfirmationStepPropsList = [];

jest.mock('react-i18next', () => ({
  useTranslation: () => [(key) => key],
}));

jest.mock('../../../selectors', () => ({
  __esModule: true,
  default: {
    makeSelectCardById: () => (_, id) => mockCards.find((card) => card.id === id) || null,
    makeSelectListById: () => (_, id) => mockLists.find((list) => list.id === id) || null,
    makeSelectUserIdsByCardId: () => (_, id) =>
      (mockCards.find((card) => card.id === id) || {}).userIds || [],
    makeSelectLabelIdsByCardId: () => (_, id) =>
      (mockCards.find((card) => card.id === id) || {}).labelIds || [],
    selectSelectedCardIds: () => mockSelectedCardIds,
    selectCurrentUserMembershipForCurrentBoard: () => mockMembership,
    selectAvailableListsForCurrentBoard: () => mockLists,
  },
}));

jest.mock('../../labels/LabelsStep', () => () => null);

jest.mock('../../board-memberships/BoardMembershipsStep', () => () => null);

jest.mock('../../common/ConfirmationStep', () => (props) => {
  mockConfirmationStepPropsList.push(props);
  return null;
});

let container;
let root;
let store;
let dispatchedActions;

window.IS_REACT_ACT_ENVIRONMENT = true;

const renderBar = () => {
  act(() => {
    root.render(
      <Provider store={store}>
        <BulkActionsBar />
      </Provider>,
    );
  });
};

const click = (element) => {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

const findButton = (text) =>
  [...container.querySelectorAll('button')].find((element) => element.textContent === text);

const entryActionsOfType = (type) => dispatchedActions.filter((action) => action.type === type);

const lastConfirmationStepProps = () =>
  mockConfirmationStepPropsList[mockConfirmationStepPropsList.length - 1];

beforeEach(() => {
  mockLists = [
    {
      id: 'list-active',
      type: ListTypes.ACTIVE,
      name: 'Active',
    },
    {
      id: 'list-closed',
      type: ListTypes.CLOSED,
      name: 'Closed',
    },
  ];

  mockCards = [
    {
      id: 'card-1',
      listId: 'list-active',
      userIds: [],
      labelIds: [],
    },
    {
      id: 'card-2',
      listId: 'list-active',
      userIds: [],
      labelIds: [],
    },
  ];

  mockSelectedCardIds = mockCards.map((card) => card.id);

  mockMembership = {
    id: 'membership-1',
    role: BoardMembershipRoles.EDITOR,
  };

  mockConfirmationStepPropsList.length = 0;

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

test('archive button is enabled when every selected card is in an active list', () => {
  renderBar();

  const archiveButton = findButton('action.archive');
  expect(archiveButton).toBeDefined();
  expect(archiveButton.disabled).toBe(false);
});

test('confirming archives every selected card and clears the selection', () => {
  renderBar();
  click(findButton('action.archive'));

  const props = lastConfirmationStepProps();
  expect(props.title).toBe('common.archiveCards');
  expect(props.content).toBe('common.areYouSureYouWantToArchiveCards');
  expect(props.buttonContent).toBe('action.archiveCards');

  act(() => {
    props.onConfirm();
  });

  expect(entryActionsOfType(EntryActionTypes.CARD_TO_ARCHIVE_MOVE)).toEqual([
    {
      type: EntryActionTypes.CARD_TO_ARCHIVE_MOVE,
      payload: {
        id: 'card-1',
      },
    },
    {
      type: EntryActionTypes.CARD_TO_ARCHIVE_MOVE,
      payload: {
        id: 'card-2',
      },
    },
  ]);

  expect(entryActionsOfType(EntryActionTypes.CARD_SELECTION_CLEAR)).toHaveLength(1);
});

test('confirming archives cards from both active and closed lists', () => {
  mockCards[1].listId = 'list-closed';

  renderBar();
  click(findButton('action.archive'));

  act(() => {
    lastConfirmationStepProps().onConfirm();
  });

  expect(
    entryActionsOfType(EntryActionTypes.CARD_TO_ARCHIVE_MOVE).map(({ payload }) => payload.id),
  ).toEqual(['card-1', 'card-2']);
});

test('clicking archive without confirming dispatches nothing', () => {
  renderBar();
  click(findButton('action.archive'));

  expect(entryActionsOfType(EntryActionTypes.CARD_TO_ARCHIVE_MOVE)).toHaveLength(0);
  expect(entryActionsOfType(EntryActionTypes.CARD_SELECTION_CLEAR)).toHaveLength(0);
});

test('viewers do not see the archive button', () => {
  mockMembership = {
    id: 'membership-1',
    role: BoardMembershipRoles.VIEWER,
  };

  renderBar();

  expect(findButton('action.archive')).toBeUndefined();
});
