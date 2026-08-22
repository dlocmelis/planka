/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

// Drops every dependency row that touches a card being deleted, in BOTH
// directions, and tells the boards on the far end of each one.
//
// The far end is the point of the helper. A dependency is one fact about two
// cards that may live on two different boards, and the cardDelete broadcast
// only reaches the room of the board the deleted card was on: models/Card.js
// clears the dependency rows of a card it hears about, so a client on the SAME
// board recovers, but a client watching the OTHER board is in a different room
// and would go on drawing a "Blocking" row for a card that no longer exists
// until it reloaded.
//
// Rooms already covered by the cardDelete broadcast are skipped rather than
// told twice.
//
// Only the socket rooms are told, not the webhook subscribers: a webhook
// consumer is given the card's own CARD_DELETE (from cards/delete-one.js) and
// Planka's contract is that a deleted card takes its links with it, so the
// consumer's next read of the card's dependencies is already correct. Emitting
// CARD_DEPENDENCY_DELETE here would mean resolving a project, a list and an
// actor for every far end on the card-delete path, which is a lot of reads on
// a common path for something the consumer does not need.
module.exports = {
  inputs: {
    recordOrRecords: {
      type: 'ref',
      required: true,
    },
    request: {
      type: 'ref',
    },
  },

  async fn(inputs) {
    const records = (
      _.isPlainObject(inputs.recordOrRecords) ? [inputs.recordOrRecords] : inputs.recordOrRecords
    ).filter(_.isPlainObject);

    if (_.isEmpty(records)) {
      return [];
    }

    const cardIds = _.map(records, 'id');
    const deletedBoardIds = _.uniq(_.compact(_.map(records, 'boardId')));

    // Sequential rather than in parallel: when BOTH ends of a link are being
    // deleted (a list going away takes all its cards with it) the same row is
    // matched by both criteria, and running them together would race for it.
    const dependencies = await CardDependency.qm.delete({
      cardId: cardIds,
    });

    const dependents = await CardDependency.qm.delete({
      dependsOnCardId: cardIds,
    });

    const cardDependencies = _.uniqBy([...dependencies, ...dependents], 'id');

    if (_.isEmpty(cardDependencies)) {
      return cardDependencies;
    }

    const farCardIds = _.uniq(
      _.flatMap(cardDependencies, ({ cardId, dependsOnCardId }) => [cardId, dependsOnCardId]),
    ).filter((cardId) => !cardIds.includes(cardId));

    if (_.isEmpty(farCardIds)) {
      return cardDependencies;
    }

    const farCards = await Card.qm.getByIds(farCardIds);
    const boardIdByCardId = _.fromPairs(farCards.map((card) => [card.id, card.boardId]));

    cardDependencies.forEach((cardDependency) => {
      const boardIds = _.uniq(
        _.compact([
          boardIdByCardId[cardDependency.cardId],
          boardIdByCardId[cardDependency.dependsOnCardId],
        ]),
      ).filter((boardId) => !deletedBoardIds.includes(boardId));

      boardIds.forEach((boardId) => {
        sails.sockets.broadcast(
          `board:${boardId}`,
          'cardDependencyDelete',
          {
            item: cardDependency,
          },
          inputs.request,
        );
      });
    });

    return cardDependencies;
  },
};
