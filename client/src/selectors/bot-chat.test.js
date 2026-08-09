/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import orm from '../orm';
import selectors from '.';
import Paths from '../constants/Paths';
import { ListTypes, UserRoles } from '../constants/Enums';
import { MessageAuthors } from '../utils/bot-chat';
import {
  selectBotUserForCurrentBoard,
  selectChatCardsForCurrentBoard,
  selectChatMessagesForCard,
} from './bot-chat';

// The state these selectors run against in the app — the store as a board that
// has been opened leaves it. Nothing here is a stand-in: the widget's whole
// contract with Planka is that the bot is a board member and the conversation
// is a card's comments, and that is what this fixture is.
const buildOrmState = ({ withBotMembership = true } = {}) => {
  const session = orm.session(orm.getEmptyState());

  session.Project.create({ id: 'project-1', name: 'Project 1' });
  session.Board.create({ id: 'board-1', projectId: 'project-1' });
  session.Board.create({ id: 'board-2', projectId: 'project-1' });
  session.List.create({ id: 'list-1', boardId: 'board-1', type: ListTypes.ACTIVE, position: 1 });

  session.User.create({ id: 'user-me', username: 'deniss', role: UserRoles.ADMIN });
  session.User.create({ id: 'user-bot', username: 'planka_bot', name: 'Orchestrator Bot' });
  session.User.create({ id: 'user-other', username: 'someone' });

  session.BoardMembership.create({ id: 'membership-1', boardId: 'board-1', userId: 'user-me' });
  session.BoardMembership.create({ id: 'membership-3', boardId: 'board-1', userId: 'user-other' });

  if (withBotMembership) {
    session.BoardMembership.create({ id: 'membership-2', boardId: 'board-1', userId: 'user-bot' });
  }

  session.Card.create({
    id: 'card-1',
    boardId: 'board-1',
    listId: 'list-1',
    position: 1,
    name: 'Alpha card',
    isAllCommentsFetched: true,
  });
  session.Card.create({
    id: 'card-2',
    boardId: 'board-1',
    listId: 'list-1',
    position: 2,
    name: 'Beta card',
    isAllCommentsFetched: true,
  });
  // Never fetched: the panel must read it as an empty conversation.
  session.Card.create({
    id: 'card-3',
    boardId: 'board-1',
    listId: 'list-1',
    position: 3,
    name: 'Gamma card',
  });

  session.Comment.create({
    id: '10',
    cardId: 'card-1',
    userId: 'user-other',
    text: 'looks good',
    createdAt: new Date('2026-08-08T10:00:00Z'),
  });
  session.Comment.create({
    id: '20',
    cardId: 'card-1',
    userId: 'user-me',
    text: '@[planka_bot](user-bot) what is the status?',
    createdAt: new Date('2026-08-08T10:01:00Z'),
  });
  session.Comment.create({
    id: '30',
    cardId: 'card-1',
    userId: 'user-bot',
    text: '@deniss It is in review.',
    createdAt: new Date('2026-08-08T10:02:00Z'),
  });

  return session.state;
};

const buildState = (options) => ({
  auth: { userId: 'user-me' },
  router: { location: { pathname: Paths.BOARDS.replace(':id', 'board-1') } },
  orm: buildOrmState(options),
});

describe('selectBotUserForCurrentBoard', () => {
  test('finds the bot among the board members by username', () => {
    expect(selectBotUserForCurrentBoard(buildState())).toMatchObject({
      id: 'user-bot',
      username: 'planka_bot',
    });
  });

  test('answers null when the bot is not a member of the board', () => {
    expect(selectBotUserForCurrentBoard(buildState({ withBotMembership: false }))).toBeNull();
  });

  test('answers null off a board', () => {
    const state = {
      ...buildState(),
      router: { location: { pathname: Paths.ROOT } },
    };

    expect(selectBotUserForCurrentBoard(state)).toBeNull();
  });
});

describe('selectChatMessagesForCard', () => {
  test("reads a card's comments as a thread, oldest first, tagged by author", () => {
    const messages = selectChatMessagesForCard(buildState(), 'card-1');

    expect(messages.map((message) => message.id)).toEqual(['10', '20', '30']);
    expect(messages.map((message) => message.author)).toEqual([
      MessageAuthors.OTHER,
      MessageAuthors.SELF,
      MessageAuthors.BOT,
    ]);
    // The mention the composer added is not shown back to its author, and the
    // bot's reply does not repeat the asker's name on every bubble.
    expect(messages[1].text).toBe('what is the status?');
    expect(messages[2].text).toBe('It is in review.');
  });

  test('a thread that has never been fetched reads as empty, not as broken', () => {
    expect(selectChatMessagesForCard(buildState(), 'card-3')).toEqual([]);
  });

  test('answers an empty thread for no card and for an unknown one', () => {
    expect(selectChatMessagesForCard(buildState(), null)).toEqual([]);
    expect(selectChatMessagesForCard(buildState(), 'card-missing')).toEqual([]);
  });

  test('returns the same array for the same state, so the panel does not re-render forever', () => {
    const state = buildState();

    expect(selectChatMessagesForCard(state, 'card-1')).toBe(
      selectChatMessagesForCard(state, 'card-1'),
    );
  });
});

describe('selectChatCardsForCurrentBoard', () => {
  test("offers the board's cards with the ones the bot has spoken on first", () => {
    const cards = selectChatCardsForCurrentBoard(buildState());

    expect(cards[0]).toMatchObject({ id: 'card-1', name: 'Alpha card', hasBotComment: true });
    expect(cards.map((card) => card.id)).toEqual(['card-1', 'card-3', 'card-2']);
  });

  test('is empty off a board', () => {
    const state = {
      ...buildState(),
      router: { location: { pathname: Paths.ROOT } },
    };

    expect(selectChatCardsForCurrentBoard(state)).toEqual([]);
  });
});

// The widget reaches these through the barrel (`selectors.selectBotUserFor…`),
// and its component test mocks that module wholesale — so nothing else in the
// suite would notice the barrel losing them. A missing name there is a
// component that renders nothing at runtime and a green test run.
test('the chat selectors are reachable from the selectors barrel', () => {
  expect(typeof selectors.selectBotUserForCurrentBoard).toBe('function');
  expect(typeof selectors.selectChatCardsForCurrentBoard).toBe('function');
  expect(typeof selectors.makeSelectChatMessagesForCard).toBe('function');
  expect(selectors.selectBotUserForCurrentBoard(buildState())).toMatchObject({
    id: 'user-bot',
    username: 'planka_bot',
  });
});
