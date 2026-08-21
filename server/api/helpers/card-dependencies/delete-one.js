/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

module.exports = {
  inputs: {
    record: {
      type: 'ref',
      required: true,
    },
    project: {
      type: 'ref',
      required: true,
    },
    board: {
      type: 'ref',
      required: true,
    },
    list: {
      type: 'ref',
      required: true,
    },
    card: {
      type: 'ref',
      required: true,
    },
    dependsOnCard: {
      type: 'ref',
      required: true,
    },
    dependsOnBoard: {
      type: 'ref',
      required: true,
    },
    actorUser: {
      type: 'ref',
      required: true,
    },
    request: {
      type: 'ref',
    },
  },

  async fn(inputs) {
    // Deleted by the pair rather than by the row id, because the pair is the
    // table's real key (the unique index in the migration) and it is the one
    // the caller named. It also sidesteps the in-memory test datastore, which
    // mints numeric ids for a column the models declare as a string and so
    // never matches a destroyOne() by primary key.
    const cardDependency = await CardDependency.qm.deleteOne({
      cardId: inputs.record.cardId,
      dependsOnCardId: inputs.record.dependsOnCardId,
    });

    if (cardDependency) {
      const boardIds = _.uniq([inputs.board.id, inputs.dependsOnBoard.id]);

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

      const webhooks = await Webhook.qm.getAll();

      sails.helpers.utils.sendWebhooks.with({
        webhooks,
        event: Webhook.Events.CARD_DEPENDENCY_DELETE,
        buildData: () => ({
          item: cardDependency,
          included: {
            projects: [inputs.project],
            boards: [inputs.board],
            lists: [inputs.list],
            cards: [inputs.card, inputs.dependsOnCard],
          },
        }),
        user: inputs.actorUser,
      });
    }

    return cardDependency;
  },
};
