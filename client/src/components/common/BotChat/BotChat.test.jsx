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
import { MessageAuthors } from '../../../utils/bot-chat';
import BotChat from './BotChat';

const BOT = { id: 'user-bot', username: 'planka_bot', name: 'Orchestrator Bot' };

let mockBot;
let mockPath;
let mockCards;
let mockLists;
let mockMembership;
let mockMemberships;
let mockMessagesByCardId;
let mockChatCards;
const mockNoMessages = [];

jest.mock('react-i18next', () => ({
  useTranslation: () => [(key) => key],
}));

jest.mock('../../../selectors', () => ({
  __esModule: true,
  default: {
    selectPath: () => mockPath,
    selectBotUserForCurrentBoard: () => mockBot,
    selectChatCardsForCurrentBoard: () => mockChatCards,
    selectMembershipsForCurrentBoard: () => mockMemberships,
    selectCurrentUserMembershipForCurrentBoard: () => mockMembership,
    makeSelectCardById: () => (_, id) => mockCards.find((card) => card.id === id) || null,
    makeSelectListById: () => (_, id) => mockLists.find((list) => list.id === id) || null,
    // A stable empty array, the way the memoized selector behind it answers an
    // unfetched thread — a fresh [] every render is a re-render loop.
    makeSelectChatMessagesForCard: () => (_, id) => mockMessagesByCardId[id] || mockNoMessages,
  },
}));

// The real one runs @diplodoc/transform over every bubble; the panel only
// needs to be shown to render the text it was given.
jest.mock(
  '../Markdown',
  () =>
    ({ children }) =>
      children,
);
jest.mock('../TimeAgo', () => () => null);
jest.mock('../../users/UserAvatar', () => () => null);

let container;
let root;
let store;
let dispatchedActions;

window.IS_REACT_ACT_ENVIRONMENT = true;

const render = () => {
  act(() => {
    root.render(
      <Provider store={store}>
        <BotChat />
      </Provider>,
    );
  });
};

const click = (element) => {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

const type = (element, value) => {
  const setValue = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  ).set;

  act(() => {
    setValue.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const findByLabel = (label) => container.querySelector(`[aria-label="${label}"]`);

const launcher = () => findByLabel('common.chatWithBot');

/**
 * A thread element that answers the three scroll numbers, since jsdom lays
 * nothing out and reports zeroes for all of them. `scrollTop` is a real
 * property here rather than jsdom's no-op setter, so what the panel writes to
 * it can be read back.
 */
const stubScroller = (element, { scrollHeight, clientHeight, scrollTop }) => {
  let position = scrollTop;

  Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => clientHeight });
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => position,
    set: (value) => {
      position = value;
    },
  });
};

/** A message landing in an open panel, the way the bot's answer does: the
 * selector starts returning a longer thread and the store wakes the
 * subscription that re-reads it. */
const receiveMessage = (cardId, message) => {
  act(() => {
    mockMessagesByCardId[cardId] = [...(mockMessagesByCardId[cardId] || []), message];
    store.dispatch({ type: 'MESSAGE_ARRIVED' });
  });
};

const actionsOfType = (type_) => dispatchedActions.filter((action) => action.type === type_);

beforeEach(() => {
  window.localStorage.clear();

  mockBot = BOT;
  mockPath = { boardId: 'board-1', cardId: null };

  mockLists = [{ id: 'list-1', type: ListTypes.ACTIVE, name: 'In Development' }];

  mockCards = [
    {
      id: 'card-1',
      boardId: 'board-1',
      listId: 'list-1',
      name: 'Introduce chat with planka_bot',
      isCommentsFetching: false,
      isAllCommentsFetched: true,
    },
  ];

  mockMembership = { id: 'membership-1', role: BoardMembershipRoles.EDITOR };
  mockMemberships = [{ id: 'membership-1', user: { id: 'user-me', username: 'deniss' } }];

  mockMessagesByCardId = {};
  mockChatCards = [{ id: 'card-1', name: 'Introduce chat with planka_bot', hasBotComment: true }];

  dispatchedActions = [];
  // A fresh state object per action, because react-redux 9 memoizes a
  // selection against the state REFERENCE: a reducer that answers the same
  // object never re-runs the selectors, and the panel would never see the
  // comment the socket just put in the store.
  store = createStore((state, action) => {
    dispatchedActions.push(action);
    return { revision: (state ? state.revision : 0) + 1 };
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

test('renders nothing when planka_bot is not a member of the board', () => {
  mockBot = null;
  render();

  expect(container.innerHTML).toBe('');
});

test('renders nothing outside a board', () => {
  mockPath = { boardId: null, cardId: null };
  render();

  expect(container.innerHTML).toBe('');
});

test('the floating button is there, and the panel is not until it is pressed', () => {
  render();

  expect(launcher()).not.toBeNull();
  expect(container.querySelector('[role="dialog"]')).toBeNull();

  click(launcher());

  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
});

test('the floating button is the toggle its aria-expanded says it is', () => {
  render();

  expect(launcher().getAttribute('aria-expanded')).toBe('false');

  click(launcher());

  expect(launcher().getAttribute('aria-expanded')).toBe('true');

  // The launcher stays visible under the open panel, so a second press has to
  // put it away again.
  click(launcher());

  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(launcher().getAttribute('aria-expanded')).toBe('false');
});

test('opening the chat puts the keyboard in the message box, and Escape closes it', () => {
  mockPath = { boardId: 'board-1', cardId: 'card-1' };

  render();
  click(launcher());

  const field = container.querySelector('textarea');
  expect(document.activeElement).toBe(field);

  // Which is the whole reason it matters: the launcher is a sibling of the
  // dialog, so nothing would deliver Escape to the panel otherwise.
  act(() => {
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });

  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

test('the conversation follows the card that is open', () => {
  mockPath = { boardId: 'board-1', cardId: 'card-1' };
  mockMessagesByCardId['card-1'] = [
    {
      id: 'comment-1',
      userId: BOT.id,
      author: MessageAuthors.BOT,
      text: 'It is in review.',
      createdAt: new Date('2026-08-08T10:00:00Z'),
      isPersisted: true,
    },
  ];

  render();
  click(launcher());

  expect(container.textContent).toContain('Introduce chat with planka_bot');
  expect(container.textContent).toContain('It is in review.');
});

test('a message is posted as a comment addressed to the bot on the conversation card', () => {
  mockPath = { boardId: 'board-1', cardId: 'card-1' };

  render();
  click(launcher());

  const field = container.querySelector('textarea');
  type(field, 'what is blocking this?');
  click(findByLabel('action.sendMessage'));

  expect(actionsOfType(EntryActionTypes.COMMENT_FOR_CARD_CREATE)).toEqual([
    {
      type: EntryActionTypes.COMMENT_FOR_CARD_CREATE,
      payload: {
        cardId: 'card-1',
        data: { text: '@[planka_bot](user-bot) what is blocking this?' },
      },
    },
  ]);
});

test('pressing Enter sends, and the field is emptied afterwards', () => {
  mockPath = { boardId: 'board-1', cardId: 'card-1' };

  render();
  click(launcher());

  const field = container.querySelector('textarea');
  type(field, 'status?');

  act(() => {
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });

  expect(actionsOfType(EntryActionTypes.COMMENT_FOR_CARD_CREATE)).toHaveLength(1);
  expect(container.querySelector('textarea').value).toBe('');
});

test('a member who may not comment gets the thread but no composer', () => {
  mockPath = { boardId: 'board-1', cardId: 'card-1' };
  mockMembership = { id: 'membership-1', role: BoardMembershipRoles.VIEWER, canComment: false };

  render();
  click(launcher());

  expect(container.querySelector('textarea').disabled).toBe(true);
  expect(container.textContent).toContain('common.youCannotCommentOnThisBoard');
});

test("the card's comments are fetched once when the thread has never been loaded", () => {
  mockPath = { boardId: 'board-1', cardId: 'card-1' };
  mockCards[0].isAllCommentsFetched = null;
  mockCards[0].isCommentsFetching = false;

  render();

  expect(actionsOfType(EntryActionTypes.COMMENTS_FOR_CARD_FETCH)).toEqual([
    {
      type: EntryActionTypes.COMMENTS_FOR_CARD_FETCH,
      payload: { cardId: 'card-1' },
    },
  ]);
});

test('an already loaded thread is not fetched again — the service paginates backwards', () => {
  mockPath = { boardId: 'board-1', cardId: 'card-1' };

  render();

  expect(actionsOfType(EntryActionTypes.COMMENTS_FOR_CARD_FETCH)).toHaveLength(0);
});

test('with no card in context the panel asks which one to chat on, and picking one opens it', () => {
  render();
  click(launcher());

  expect(container.textContent).toContain('common.chooseACardToChatOn');

  click(container.querySelector('[data-id="card-1"]'));

  expect(container.textContent).toContain('Introduce chat with planka_bot');
  expect(container.querySelector('textarea')).not.toBeNull();
});

test("a card of another board is not shown as this board's conversation", () => {
  window.localStorage.setItem('planka-bot-chat-card-id', 'card-elsewhere');
  mockCards.push({
    id: 'card-elsewhere',
    boardId: 'board-2',
    listId: 'list-1',
    name: 'Some other board',
    isCommentsFetching: false,
    isAllCommentsFetched: true,
  });

  render();
  click(launcher());

  expect(container.textContent).not.toContain('Some other board');
  expect(container.textContent).toContain('common.chooseACardToChatOn');
});

test('the launcher badges what arrived while the panel was closed', () => {
  mockPath = { boardId: 'board-1', cardId: 'card-1' };
  // Later than the mount, which is what "arrived while you were not looking"
  // means to the widget.
  mockMessagesByCardId['card-1'] = [
    {
      id: 'comment-1',
      userId: BOT.id,
      author: MessageAuthors.BOT,
      text: 'Done.',
      createdAt: new Date(Date.now() + 60 * 1000),
      isPersisted: true,
    },
  ];

  render();

  const button = findByLabel('common.chatWithBotWithUnread');
  expect(button).not.toBeNull();
  expect(button.textContent).toContain('1');

  click(button);

  // Reading them clears the badge.
  expect(findByLabel('common.chatWithBotWithUnread')).toBeNull();
  expect(launcher()).not.toBeNull();
});

test('the panel says the bot is thinking while your message is the last one', () => {
  mockPath = { boardId: 'board-1', cardId: 'card-1' };
  mockMessagesByCardId['card-1'] = [
    {
      id: 'comment-1',
      userId: 'user-me',
      author: MessageAuthors.SELF,
      text: 'status?',
      createdAt: new Date(),
      isPersisted: true,
    },
  ];

  render();
  click(launcher());

  expect(container.textContent).toContain('common.botIsThinking');
});

test('an arriving message scrolls the thread down while it is parked at the bottom', () => {
  mockPath = { boardId: 'board-1', cardId: 'card-1' };
  mockMessagesByCardId['card-1'] = [
    {
      id: 'comment-1',
      userId: 'user-me',
      author: MessageAuthors.SELF,
      text: 'status?',
      createdAt: new Date('2026-08-08T10:00:00Z'),
      isPersisted: true,
    },
  ];

  render();
  click(launcher());

  const thread = container.querySelector('.thread');
  // 1000 - 700 - 300 = 0 away from the bottom: where a reader who has not
  // scrolled anywhere sits.
  stubScroller(thread, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });

  act(() => {
    thread.dispatchEvent(new Event('scroll', { bubbles: true }));
  });

  receiveMessage('card-1', {
    id: 'comment-2',
    userId: BOT.id,
    author: MessageAuthors.BOT,
    text: 'In review.',
    createdAt: new Date('2026-08-08T10:05:00Z'),
    isPersisted: true,
  });

  expect(container.textContent).toContain('In review.');
  expect(thread.scrollTop).toBe(1000);
});

test('...and leaves someone who has scrolled up to read where they put themselves', () => {
  mockPath = { boardId: 'board-1', cardId: 'card-1' };
  mockMessagesByCardId['card-1'] = [
    {
      id: 'comment-1',
      userId: 'user-me',
      author: MessageAuthors.SELF,
      text: 'status?',
      createdAt: new Date('2026-08-08T10:00:00Z'),
      isPersisted: true,
    },
  ];

  render();
  click(launcher());

  const thread = container.querySelector('.thread');
  // 1000 - 120 - 300 = 580px above the bottom, which is somebody reading back
  // through the card's history — and a bot answer lands minutes later, so this
  // is exactly when it arrives.
  stubScroller(thread, { scrollHeight: 1000, clientHeight: 300, scrollTop: 120 });

  act(() => {
    thread.dispatchEvent(new Event('scroll', { bubbles: true }));
  });

  receiveMessage('card-1', {
    id: 'comment-2',
    userId: BOT.id,
    author: MessageAuthors.BOT,
    text: 'In review.',
    createdAt: new Date('2026-08-08T10:05:00Z'),
    isPersisted: true,
  });

  expect(container.textContent).toContain('In review.');
  expect(thread.scrollTop).toBe(120);
});

test('switching conversation starts the new thread at its latest message', () => {
  mockPath = { boardId: 'board-1', cardId: 'card-1' };
  mockCards.push({
    id: 'card-2',
    boardId: 'board-1',
    listId: 'list-1',
    name: 'Another conversation',
    isCommentsFetching: false,
    isAllCommentsFetched: true,
  });
  mockChatCards.push({ id: 'card-2', name: 'Another conversation', hasBotComment: false });

  render();
  click(launcher());

  const thread = container.querySelector('.thread');
  stubScroller(thread, { scrollHeight: 1000, clientHeight: 300, scrollTop: 120 });

  act(() => {
    thread.dispatchEvent(new Event('scroll', { bubbles: true }));
  });

  // Away to the picker and into the other card. The panel itself stays
  // mounted across that, so without a reset it would carry card-1's "the user
  // is reading history" into a conversation they have not scrolled at all.
  click(findByLabel('common.chooseACardToChatOn'));
  click(container.querySelector('[data-id="card-2"]'));

  const nextThread = container.querySelector('.thread');
  stubScroller(nextThread, { scrollHeight: 1000, clientHeight: 300, scrollTop: 120 });

  receiveMessage('card-2', {
    id: 'comment-9',
    userId: BOT.id,
    author: MessageAuthors.BOT,
    text: 'Over here now.',
    createdAt: new Date('2026-08-08T11:00:00Z'),
    isPersisted: true,
  });

  expect(container.textContent).toContain('Over here now.');
  expect(nextThread.scrollTop).toBe(1000);
});

test('the panel width can be resized from the keyboard, and is remembered', () => {
  mockPath = { boardId: 'board-1', cardId: 'card-1' };

  render();
  click(launcher());

  const handle = container.querySelector('[role="separator"]');
  expect(handle.getAttribute('aria-valuenow')).toBe('400');

  act(() => {
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  });

  expect(container.querySelector('[role="separator"]').getAttribute('aria-valuenow')).toBe('424');
  expect(window.localStorage.getItem('planka-bot-chat-panel-width')).toBe('424');
});

test('the conversation from the last visit is resumed, and stays remembered', () => {
  window.localStorage.setItem('planka-bot-chat-card-id', 'card-1');

  render();
  click(launcher());

  expect(container.textContent).toContain('Introduce chat with planka_bot');
  expect(container.textContent).not.toContain('common.chooseACardToChatOn');
  // Mounting must not erase what it just read.
  expect(window.localStorage.getItem('planka-bot-chat-card-id')).toBe('card-1');
});

test('the panel is capped against the two viewport edges it grows towards', () => {
  mockPath = { boardId: 'board-1', cardId: 'card-1' };

  render();
  click(launcher());

  // The default corner: 24px in, a 56px launcher, a 12px gap, and 16px of
  // breathing room at the far edge.
  const panel = container.querySelector('[role="separator"]').parentElement;
  expect(panel.style.maxHeight).toBe('calc(100dvh - 108px)');
  expect(panel.style.maxWidth).toBe('calc(100vw - 40px)');
});
