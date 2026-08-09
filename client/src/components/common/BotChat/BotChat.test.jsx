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
import {
  LAUNCHER_SIZE,
  MIN_PANEL_HEIGHT,
  MIN_PANEL_WIDTH,
  MessageAuthors,
} from '../../../utils/bot-chat';
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
let mockGeneralChatCard;
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
    selectGeneralChatCardForCurrentBoard: () => mockGeneralChatCard,
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
  let height = scrollHeight;

  Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => height });
  Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => clientHeight });
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => position,
    set: (value) => {
      position = value;
    },
  });

  // A page of older messages arriving makes the scroller taller, which is the
  // whole of what the panel has to react to.
  return {
    grow: (by) => {
      height += by;
    },
  };
};

/** A pointer event jsdom will carry: it has no `PointerEvent`, and React only
 * ever reads the properties off whatever native event arrives. */
const pointer = (element, type_, { clientX = 0, clientY = 0 } = {}) => {
  act(() => {
    element.dispatchEvent(
      new MouseEvent(type_, { bubbles: true, cancelable: true, button: 0, clientX, clientY }),
    );
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
  // The board's general chat: a real card in the orchestrator's "Chat"
  // service column, which is why it is a card here too — under the widget it
  // is an ordinary card conversation, and only its NAME and the fact that
  // nothing drags the user out of it differ.
  mockGeneralChatCard = { id: 'card-chat', name: '💬 General chat' };

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

test('a press held past the drag threshold that never moved still opens the panel', () => {
  jest.useFakeTimers();

  try {
    render();

    const button = launcher();
    pointer(button, 'pointerdown', { clientX: 100, clientY: 100 });

    // Long enough for the hold to arm the drag — which a deliberate, slow
    // press with a mouse does all the time.
    act(() => {
      jest.advanceTimersByTime(600);
    });

    pointer(button, 'pointerup', { clientX: 100, clientY: 100 });
    click(button);

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    // Nothing moved, so nothing was remembered either.
    expect(window.localStorage.getItem('planka-bot-chat-launcher-position')).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test('...and a hold that DID move the button repositions it instead of opening it', () => {
  jest.useFakeTimers();

  try {
    render();

    const button = launcher();
    pointer(button, 'pointerdown', { clientX: 100, clientY: 100 });

    act(() => {
      jest.advanceTimersByTime(600);
    });

    // Up and to the left: the position is measured from the bottom-right
    // corner, so both offsets grow.
    pointer(button, 'pointermove', { clientX: 60, clientY: 70 });
    pointer(button, 'pointerup', { clientX: 60, clientY: 70 });
    click(button);

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(launcher().style.right).toBe('64px');
    expect(launcher().style.bottom).toBe('54px');
    expect(window.localStorage.getItem('planka-bot-chat-launcher-position')).toBe(
      '{"right":64,"bottom":54}',
    );
  } finally {
    jest.useRealTimers();
  }
});

test('opening the chat with nothing chosen puts the keyboard in the card search', () => {
  render();
  click(launcher());

  const field = container.querySelector('.searchWrapper input');
  expect(field).not.toBeNull();
  // Same reason the composer takes it once a card IS chosen: the launcher is a
  // sibling of the dialog, so Escape reaches the panel from nowhere else.
  expect(document.activeElement).toBe(field);

  act(() => {
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });

  expect(container.querySelector('[role="dialog"]')).toBeNull();
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

test('...and Escape still closes it after a click on the thread moves focus off the box', () => {
  mockPath = { boardId: 'board-1', cardId: 'card-1' };

  render();
  click(launcher());

  const dialog = container.querySelector('[role="dialog"]');

  // Clicking the text of a message takes focus off the composer, and a browser
  // then gives it to the nearest focusable ANCESTOR — which has to be the
  // panel itself, or focus goes to the body, outside the React tree the
  // synthetic keydown travels up, and Escape is dead for the rest of the
  // session. jsdom refuses to focus an element that is not a focusable area,
  // so this fails outright on a panel without its tabIndex.
  act(() => {
    dialog.focus();
  });

  expect(document.activeElement).toBe(dialog);

  act(() => {
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });

  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

test('...and closing it hands the keyboard back to the button that opened it', () => {
  mockPath = { boardId: 'board-1', cardId: 'card-1' };

  render();
  click(launcher());

  const field = container.querySelector('textarea');
  expect(document.activeElement).toBe(field);

  act(() => {
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });

  expect(container.querySelector('[role="dialog"]')).toBeNull();
  // Everything focusable inside the panel goes away with it, and the browser
  // drops focus on the body — so without this the reward for pressing Escape
  // is a Tab sequence that starts again at the top of the board. The launcher
  // is still on screen and is the control that opened it, which is where the
  // disclosure pattern says focus belongs.
  expect(document.activeElement).toBe(launcher());

  // The close button is the same door, and closes the same way.
  click(launcher());
  click(findByLabel('action.close'));

  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(launcher());
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

  expect(container.textContent).toContain('common.chooseAConversation');

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
  expect(container.textContent).toContain('common.chooseAConversation');
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

  // ...out loud. An answer is minutes away and nothing moves the focus when it
  // starts or when it times out, so a spinner alone tells a screen-reader user
  // nothing at all — this row is the one part of the panel that has to announce
  // itself, which is what the Setlfi assistant marks its own turn status with.
  const status = container.querySelector('[role="status"]');
  expect(status).not.toBeNull();
  expect(status.textContent).toContain('common.botIsThinking');
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
  click(findByLabel('common.chooseAConversation'));
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

test('a conversation longer than one page can be walked back, keeping the read position', () => {
  mockPath = { boardId: 'board-1', cardId: 'card-1' };
  // A full page came back, so there is more of this conversation behind it —
  // which is what `isAllCommentsFetched === false` means in the store.
  mockCards[0].isAllCommentsFetched = false;
  mockMessagesByCardId['card-1'] = [
    {
      id: 'comment-50',
      userId: BOT.id,
      author: MessageAuthors.BOT,
      text: 'The newest page.',
      createdAt: new Date('2026-08-08T10:00:00Z'),
      isPersisted: true,
    },
  ];

  render();
  click(launcher());

  const thread = container.querySelector('.thread');
  const scroller = stubScroller(thread, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 });

  // At the top of what is loaded, which is where the button is and where
  // somebody reaching for the older half of the thread is standing.
  act(() => {
    thread.dispatchEvent(new Event('scroll', { bubbles: true }));
  });

  const loadEarlier = [...container.querySelectorAll('button')].find((element) =>
    element.textContent.includes('action.loadEarlierMessages'),
  );
  expect(loadEarlier).toBeDefined();

  click(loadEarlier);

  // The same service the panel opens with: it paginates backwards from
  // `lastCommentId`, so asking again IS asking for the earlier page.
  expect(actionsOfType(EntryActionTypes.COMMENTS_FOR_CARD_FETCH)).toEqual([
    { type: EntryActionTypes.COMMENTS_FOR_CARD_FETCH, payload: { cardId: 'card-1' } },
  ]);

  // The page lands: older messages are PREPENDED and the scroller gets taller.
  act(() => {
    scroller.grow(800);
    mockMessagesByCardId['card-1'] = [
      {
        id: 'comment-1',
        userId: 'user-me',
        author: MessageAuthors.SELF,
        text: 'The older page.',
        createdAt: new Date('2026-08-07T10:00:00Z'),
        isPersisted: true,
      },
      ...mockMessagesByCardId['card-1'],
    ];
    store.dispatch({ type: 'EARLIER_PAGE_ARRIVED' });
  });

  expect(container.textContent).toContain('The older page.');
  // 1000px above the bottom is where the reader was; 1800 - 1000 is where that
  // same message now is. Leaving scrollTop at 0 would have buried it.
  expect(thread.scrollTop).toBe(800);
});

test('there is nothing to walk back to once the whole conversation is loaded', () => {
  mockPath = { boardId: 'board-1', cardId: 'card-1' };

  render();
  click(launcher());

  expect(container.textContent).not.toContain('action.loadEarlierMessages');
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
  expect(container.textContent).not.toContain('common.chooseAConversation');
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

/** What a `calc(100dvh - Npx)` cap leaves the panel to occupy. */
const roomLeftBy = (cap, viewportPx) => viewportPx - Number(/- (\d+)px\)$/.exec(cap)[1]);

test('a launcher parked in the far corner still opens a panel worth reading', () => {
  mockPath = { boardId: 'board-1', cardId: 'card-1' };
  // Dragged up the screen and across to the left — which is exactly what the
  // drag is FOR, and what used to drive both caps negative. A negative
  // `calc()` is clamped to zero rather than ignored, so the panel opened with
  // no size at all and the button looked broken.
  window.localStorage.setItem(
    'planka-bot-chat-launcher-position',
    JSON.stringify({ right: 900, bottom: 700 }),
  );

  render();
  click(launcher());

  const panel = container.querySelector('[role="separator"]').parentElement;
  expect(roomLeftBy(panel.style.maxHeight, window.innerHeight)).toBeGreaterThanOrEqual(
    MIN_PANEL_HEIGHT,
  );
  expect(roomLeftBy(panel.style.maxWidth, window.innerWidth)).toBeGreaterThanOrEqual(
    MIN_PANEL_WIDTH,
  );
});

test('the floating button is a circle of the size the drag arithmetic clamps against', () => {
  render();

  // A `button` is shrink-to-fit, and a `position: fixed` box with only `right`
  // set doubly so: left to the stylesheet the width is the avatar's, the
  // circle comes out an ellipse, and every clamp that reasons in
  // LAUNCHER_SIZE is reasoning about a button that is not that size.
  expect(launcher().style.width).toBe(`${LAUNCHER_SIZE}px`);
  expect(launcher().style.height).toBe(`${LAUNCHER_SIZE}px`);
});

test('the Enter an input method presses to confirm a candidate does not send', () => {
  mockPath = { boardId: 'board-1', cardId: 'card-1' };

  render();
  click(launcher());

  const field = container.querySelector('textarea');
  type(field, '進捗');

  act(() => {
    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }),
    );
  });

  // ...and the legacy signal from browsers that leave `isComposing` false.
  act(() => {
    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, keyCode: 229 }),
    );
  });

  expect(actionsOfType(EntryActionTypes.COMMENT_FOR_CARD_CREATE)).toHaveLength(0);
  expect(container.querySelector('textarea').value).toBe('進捗');

  // The Enter that ends the composition still sends.
  act(() => {
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });

  expect(actionsOfType(EntryActionTypes.COMMENT_FOR_CARD_CREATE)).toHaveLength(1);
});

test('a card in the archive says so instead of blaming your board membership', () => {
  mockPath = { boardId: 'board-1', cardId: 'card-1' };
  mockLists = [{ id: 'list-1', type: ListTypes.ARCHIVE, name: 'Archive' }];

  render();
  click(launcher());

  expect(container.querySelector('textarea').disabled).toBe(true);
  expect(container.textContent).toContain('common.youCannotCommentOnACardInTheArchiveOrTrash');
  expect(container.textContent).not.toContain('common.youCannotCommentOnThisBoard');
});

/* The general chat: a conversation with the bot that is not about a ticket.
 *
 * Under this widget it is an ordinary card conversation — the transport is
 * still a card's comment thread, because that is the only channel the
 * orchestrator hears — so what is worth testing here is exactly what differs:
 * it is offered, it is named for what it is, and it is not taken away from the
 * user the moment they open a card. */

/** The picker's general-chat entry. The SCSS module mock maps
 * `styles.generalItem` to the literal class name, so this finds exactly that
 * button and nothing else. */
const generalChatEntry = () => container.querySelector('button.generalItem');

const generalChatCard = () => {
  // Add the chat card to the store the way the board fetch does, so the panel
  // can resolve it once it is chosen.
  mockCards.push({
    id: 'card-chat',
    boardId: 'board-1',
    listId: 'list-chat',
    name: '💬 General chat',
    isCommentsFetching: false,
    isAllCommentsFetched: true,
  });
  mockLists.push({ id: 'list-chat', type: ListTypes.ACTIVE, name: 'Chat' });
};

test('the picker offers a general chat, and choosing it opens a conversation that is not a card', () => {
  generalChatCard();
  render();
  click(launcher());

  expect(container.textContent).toContain('common.generalChat');
  expect(container.textContent).toContain('common.notAboutAnyCard');

  expect(generalChatEntry()).not.toBeNull();
  click(generalChatEntry());

  // Named for what it is, not for the card that carries it: reading "💬
  // General chat" here would suggest the conversation is ABOUT that card.
  expect(container.textContent).toContain('common.generalChat');
  expect(container.textContent).not.toContain('💬 General chat');
  // ...and it is a real conversation: the composer is there.
  expect(container.querySelector('textarea')).not.toBeNull();
});

test('a message in the general chat is posted on the chat card', () => {
  generalChatCard();
  render();
  click(launcher());
  click(generalChatEntry());

  const field = container.querySelector('textarea');
  type(field, 'what is in development right now?');
  act(() => {
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });

  const created = actionsOfType(EntryActionTypes.COMMENT_FOR_CARD_CREATE);
  expect(created).toHaveLength(1);
  expect(created[0].payload.cardId).toBe('card-chat');
  // The mention is what makes the intent legible on the card and what the
  // orchestrator's mention-only bootstrap path looks for.
  expect(created[0].payload.data.text).toContain('@[planka_bot](user-bot)');
  expect(created[0].payload.data.text).toContain('what is in development right now?');
});

test('opening a card does not drag the user out of the general chat', () => {
  generalChatCard();
  render();
  click(launcher());
  click(generalChatEntry());

  // The user opens a card to look something up while asking about the board,
  // which is most of what you do in a conversation like this.
  act(() => {
    mockPath = { boardId: 'board-1', cardId: 'card-1' };
    store.dispatch({ type: 'CARD_OPENED' });
  });

  expect(container.textContent).toContain('common.generalChat');
  expect(container.textContent).not.toContain('Introduce chat with planka_bot');
});

test('opening a card still switches a CARD conversation, as it always did', () => {
  generalChatCard();
  mockCards.push({
    id: 'card-2',
    boardId: 'board-1',
    listId: 'list-1',
    name: 'Another conversation',
    isCommentsFetching: false,
    isAllCommentsFetched: true,
  });

  render();
  click(launcher());
  click(container.querySelector('[data-id="card-1"]'));

  act(() => {
    mockPath = { boardId: 'board-1', cardId: 'card-2' };
    store.dispatch({ type: 'CARD_OPENED' });
  });

  expect(container.textContent).toContain('Another conversation');
});

test('the switch button leaves the general chat for a card', () => {
  generalChatCard();
  render();
  click(launcher());
  click(generalChatEntry());
  expect(container.textContent).toContain('common.generalChat');

  click(findByLabel('common.chooseAConversation'));
  click(container.querySelector('[data-id="card-1"]'));

  expect(container.textContent).toContain('Introduce chat with planka_bot');
});

test('the general chat is resumed from the last visit like any other conversation', () => {
  generalChatCard();
  // Remembered as the CONVERSATION, not as the card that carries it — see the
  // reload test below for why that distinction is load-bearing.
  window.localStorage.setItem('planka-bot-chat-card-id', 'general');

  render();
  click(launcher());

  expect(container.textContent).toContain('common.generalChat');
  expect(container.textContent).not.toContain('common.chooseAConversation');
});

test('choosing the general chat remembers it as a conversation, not as a card id', () => {
  generalChatCard();
  render();
  click(launcher());
  click(generalChatEntry());

  expect(window.localStorage.getItem('planka-bot-chat-card-id')).toBe('general');
});

test('a board with no general chat offers none — the entry would open a conversation nobody hears', () => {
  mockGeneralChatCard = null;
  render();
  click(launcher());

  expect(container.textContent).not.toContain('common.generalChat');
  expect(container.textContent).not.toContain('common.notAboutAnyCard');
  // The card conversations are untouched.
  expect(container.querySelector('[data-id="card-1"]')).not.toBeNull();
});

test('the general chat says what it is for when it is empty, not what a card chat says', () => {
  generalChatCard();
  render();
  click(launcher());
  click(generalChatEntry());

  expect(container.textContent).toContain('common.chatWithBotGeneralIntro');
  expect(container.textContent).not.toContain('common.chatWithBotIntro');
});

test('a remembered general chat survives a reload with a card already open', () => {
  // The hard ordering case: the effect that restores the remembered
  // conversation and the effect that follows the opened card both run on the
  // same mount. Without the general-chat guard the second overwrites the
  // first, and the conversation the user was in is gone on every reload.
  generalChatCard();
  window.localStorage.setItem('planka-bot-chat-card-id', 'general');
  mockPath = { boardId: 'board-1', cardId: 'card-1' };

  render();
  click(launcher());

  expect(container.textContent).toContain('common.generalChat');
  expect(container.textContent).not.toContain('Introduce chat with planka_bot');
});

test('a remembered general chat survives a reload that renders before the board loads', () => {
  // The same reload, one step earlier: the widget's effects run on the very
  // first render, and on a real page load that happens before the board's
  // lists and cards are in the store. If the remembered conversation were the
  // chat CARD's id, this render could not tell it from a card that has not
  // arrived yet — and the card in the URL would take the conversation, on
  // every single reload.
  window.localStorage.setItem('planka-bot-chat-card-id', 'general');
  mockPath = { boardId: 'board-1', cardId: 'card-1' };
  mockGeneralChatCard = null;

  render();

  // ...the board arrives.
  act(() => {
    generalChatCard();
    mockGeneralChatCard = { id: 'card-chat', name: '💬 General chat' };
    store.dispatch({ type: 'BOARD_FETCHED' });
  });
  click(launcher());

  expect(container.textContent).toContain('common.generalChat');
  expect(container.textContent).not.toContain('Introduce chat with planka_bot');
});
