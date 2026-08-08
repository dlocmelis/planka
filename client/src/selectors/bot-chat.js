/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import { createSelector } from 'redux-orm';

import orm from '../orm';
import { isLocalId } from '../utils/local-id';
import { selectPath } from './router';
import { selectCurrentUser } from './users';
import { buildChatMessages } from '../utils/bot-chat';
import BotChat from '../constants/BotChat';

/**
 * The bot user on the board being viewed, or null when it is not a member of
 * it.
 *
 * Membership is the gate the whole widget hangs on: a board planka_bot cannot
 * see is a board it cannot be asked anything about, and a launcher that opens
 * a chat nobody will ever answer is worse than no launcher at all. Looking it
 * up through the memberships (rather than through every User in the store)
 * is what makes that check the same question as "is it here to talk to".
 */
export const selectBotUserForCurrentBoard = createSelector(
  orm,
  (state) => selectPath(state).boardId,
  ({ Board }, id) => {
    if (!id) {
      return null;
    }

    const boardModel = Board.withId(id);

    if (!boardModel) {
      return null;
    }

    const membershipModel = boardModel
      .getMembershipsQuerySet()
      .toModelArray()
      .find(
        (boardMembershipModel) =>
          boardMembershipModel.user &&
          boardMembershipModel.user.username &&
          boardMembershipModel.user.username.toLowerCase() === BotChat.BOT_USERNAME.toLowerCase(),
      );

    return membershipModel ? membershipModel.user.ref : null;
  },
);

/**
 * The chat thread for one card: its comments, oldest first, each tagged with
 * who wrote it.
 *
 * Empty until the card's comments have been fetched — `getCommentsModelArray`
 * answers `[]` while `isAllCommentsFetched` is null, so an unfetched card
 * reads as an empty conversation rather than as a broken one, and the panel
 * fetches on open.
 */
export const makeSelectChatMessagesForCard = () =>
  createSelector(
    orm,
    (_, id) => id,
    (state) => selectCurrentUser(state),
    (state) => selectBotUserForCurrentBoard(state),
    ({ Card }, id, currentUser, bot) => {
      if (!id) {
        return [];
      }

      const cardModel = Card.withId(id);

      if (!cardModel) {
        return [];
      }

      const comments = cardModel.getCommentsModelArray().map((commentModel) => ({
        ...commentModel.ref,
        isPersisted: !isLocalId(commentModel.id),
      }));

      return buildChatMessages(comments, { bot, currentUser });
    },
  );

export const selectChatMessagesForCard = makeSelectChatMessagesForCard();

/**
 * The cards of the current board the panel offers as conversations, newest
 * first: every card the user can see, with the ones planka_bot has already
 * said something on first — those are the threads that are already
 * conversations.
 */
export const selectChatCardsForCurrentBoard = createSelector(
  orm,
  (state) => selectPath(state).boardId,
  (state) => selectBotUserForCurrentBoard(state),
  ({ Board }, id, bot) => {
    if (!id) {
      return [];
    }

    const boardModel = Board.withId(id);

    if (!boardModel) {
      return [];
    }

    const cards = boardModel.getCardsModelArray().map((cardModel) => {
      const hasBotComment =
        !!bot &&
        cardModel
          .getCommentsQuerySet()
          .toRefArray()
          .some((comment) => comment.userId === bot.id);

      return {
        id: cardModel.id,
        name: cardModel.name,
        listId: cardModel.listId,
        commentsTotal: cardModel.commentsTotal,
        hasBotComment,
      };
    });

    // Planka ids are monotonic, so "newest first" is the id order — the same
    // comparison the card model itself uses for comments and activities.
    return cards.sort((a, b) => {
      if (a.hasBotComment !== b.hasBotComment) {
        return a.hasBotComment ? -1 : 1;
      }

      return b.id.length - a.id.length || b.id.localeCompare(a.id);
    });
  },
);

export default {
  selectBotUserForCurrentBoard,
  makeSelectChatMessagesForCard,
  selectChatMessagesForCard,
  selectChatCardsForCurrentBoard,
};
