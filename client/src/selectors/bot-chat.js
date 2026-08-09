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
 * The board's general-chat card — the conversation with the bot that is not
 * about any ticket — or null when the board has none.
 *
 * It is found by its COLUMN (`BotChat.CHAT_LIST_NAME`), which is the one
 * contract this client shares with devteam-orchestrator: the orchestrator
 * creates that column and its card at startup, and treats every card in it as
 * a conversation rather than a ticket. Identifying it by the card's name
 * instead would mean two strings to keep in step, and a card a human renamed
 * would silently stop being the chat.
 *
 * The FIRST card of the column wins, in the column's own order. The
 * orchestrator only ever keeps one there; a board that has somehow collected
 * several offers the first rather than guessing, and every one of them is
 * still answered as a chat on the other side.
 *
 * Null — not a placeholder — when there is no such column or it is empty: the
 * panel then simply does not offer a general chat, exactly as it offers no
 * chat at all on a board the bot is not a member of. A conversation nobody is
 * listening to is worse than no entry.
 */
export const selectGeneralChatCardForCurrentBoard = createSelector(
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

    const listModel = boardModel
      .getListsQuerySet()
      .toModelArray()
      .find(
        (model) => (model.name || '').trim().toLowerCase() === BotChat.CHAT_LIST_NAME.toLowerCase(),
      );

    if (!listModel) {
      return null;
    }

    const cardModel = listModel.getCardsQuerySet().first();

    return cardModel ? { id: cardModel.id, name: cardModel.name } : null;
  },
);

/**
 * The cards of the current board the panel offers as conversations, newest
 * first: every card the user can see, with the ones planka_bot has already
 * said something on first — those are the threads that are already
 * conversations.
 *
 * The general-chat card is deliberately NOT among them: it is not a ticket,
 * and the panel offers it as its own entry above the list. Leaving it in
 * would give the same conversation two names in one picker.
 */
export const selectChatCardsForCurrentBoard = createSelector(
  orm,
  (state) => selectPath(state).boardId,
  (state) => selectBotUserForCurrentBoard(state),
  (state) => selectGeneralChatCardForCurrentBoard(state),
  ({ Board }, id, bot, generalChatCard) => {
    if (!id) {
      return [];
    }

    const boardModel = Board.withId(id);

    if (!boardModel) {
      return [];
    }

    const generalChatCardId = generalChatCard ? generalChatCard.id : null;

    const cards = boardModel
      .getCardsModelArray()
      .filter((cardModel) => cardModel.id !== generalChatCardId)
      .map((cardModel) => {
        const hasBotComment =
          !!bot &&
          cardModel
            .getCommentsQuerySet()
            .toRefArray()
            .some((comment) => comment.userId === bot.id);

        // Only what the picker draws. A selector that answers with more than
        // its caller reads is a contract nobody is checking: the extra fields
        // are free to go stale, and the next reader takes them for supported.
        return {
          id: cardModel.id,
          name: cardModel.name,
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
  selectGeneralChatCardForCurrentBoard,
};
