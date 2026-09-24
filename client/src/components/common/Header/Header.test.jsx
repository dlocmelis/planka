/**
 * @jest-environment jsdom
 */

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { createStore } from 'redux';

import Header from './Header';

const mockUser = { id: 'user-1', name: 'User', role: 'admin' };
const mockProject = { id: 'project-1', name: 'Devteam', ownerProjectManagerId: 'manager-1' };
const mockEmptyIds = [];
const mockFavoriteProjectIds = ['project-1'];

let mockPath;
let mockIsHomePage;

jest.mock('react-router', () => ({
  Link: ({ children }) => children,
}));

jest.mock('../../../lib/popup', () => ({
  usePopup: () => () => null,
}));

jest.mock('../../../selectors', () => ({
  __esModule: true,
  default: {
    selectCurrentUser: () => mockUser,
    selectCurrentProject: () => (mockPath.projectId ? mockProject : undefined),
    selectCurrentBoard: () => undefined,
    selectNotificationIdsForCurrentUser: () => mockEmptyIds,
    selectIsFavoritesEnabled: () => true,
    selectIsEditModeEnabled: () => false,
    selectIsHomePage: () => mockIsHomePage,
    selectFavoriteProjectIdsForCurrentUser: () => mockFavoriteProjectIds,
    selectIsCurrentUserManagerForCurrentProject: () => false,
  },
}));

jest.mock('../../users/UserAvatar', () => () => null);
jest.mock('../../users/UserActionsStep', () => () => null);
jest.mock('../../notifications/NotificationsStep', () => () => null);

window.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

const renderHeader = () => {
  act(() => {
    root.render(
      <Provider store={createStore(() => ({}))}>
        <Header />
      </Provider>,
    );
  });
};

const findFavoritesToggler = () => container.querySelector('i.star.icon');

beforeEach(() => {
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

describe('Header favorites toggler', () => {
  test('is shown on the home page', () => {
    mockPath = {};
    mockIsHomePage = true;
    renderHeader();

    expect(findFavoritesToggler()).not.toBeNull();
  });

  test('is hidden on a board page, where the favorites bar is not shown', () => {
    mockPath = { projectId: 'project-1', boardId: 'board-1' };
    mockIsHomePage = false;
    renderHeader();

    expect(findFavoritesToggler()).toBeNull();
  });
});
