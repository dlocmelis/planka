/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * @swagger
 * /cards/{cardId}/card-dependencies:
 *   get:
 *     summary: List a card's dependencies
 *     description: >
 *       Returns both directions of the card's dependency links: the cards it waits for and
 *       the cards waiting for it. The related cards are included with the list they are in,
 *       so a caller can tell a finished blocker from an unfinished one without a second
 *       request. Cards the caller may not read are named by id only.
 *
 *       Note for maintainers: the web client does NOT call this — it reads its rows from
 *       the `cardDependencies` block of `GET /boards/{id}` and `GET /lists/{id}/cards`.
 *       The consumers are the devteam orchestrator (which acts on dependencies and needs
 *       the far end resolved across boards) and the Setlfi support backend. It is a route
 *       with no in-repo caller and it is not dead.
 *     tags:
 *       - Card Dependencies
 *     operationId: getCardDependencies
 *     parameters:
 *       - name: cardId
 *         in: path
 *         required: true
 *         description: ID of the card
 *         schema:
 *           type: string
 *           example: "1357158568008091264"
 *     responses:
 *       200:
 *         description: Dependencies returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - items
 *                 - included
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CardDependency'
 *                 included:
 *                   type: object
 *                   required:
 *                     - cards
 *                     - lists
 *                   properties:
 *                     cards:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Card'
 *                     lists:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/List'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

const { idInput } = require('../../../utils/inputs');

const Errors = {
  CARD_NOT_FOUND: {
    cardNotFound: 'Card not found',
  },
};

module.exports = {
  inputs: {
    cardId: {
      ...idInput,
      required: true,
    },
  },

  exits: {
    cardNotFound: {
      responseType: 'notFound',
    },
  },

  async fn(inputs) {
    const { currentUser } = this.req;

    const { card, project } = await sails.helpers.cards
      .getPathToProjectById(inputs.cardId)
      .intercept('pathNotFound', () => Errors.CARD_NOT_FOUND);

    const isReadable = await sails.helpers.cards.isReadableBy.with({
      card,
      project,
      user: currentUser,
    });

    if (!isReadable) {
      throw Errors.CARD_NOT_FOUND; // Forbidden
    }

    const cardDependencies = await CardDependency.qm.getByCardIdsOrDependsOnCardIds([card.id]);

    const relatedCardIds = _.without(
      _.uniq(
        _.flatten(
          cardDependencies.map((cardDependency) => [
            cardDependency.cardId,
            cardDependency.dependsOnCardId,
          ]),
        ),
      ),
      card.id,
    );

    const relatedCards = await Card.qm.getByIds(relatedCardIds);

    const readability = await Promise.all(
      relatedCards.map(async (relatedCard) => {
        const relatedPath = await sails.helpers.lists
          .getPathToProjectById(relatedCard.listId)
          .tolerate('pathNotFound', () => ({}));

        if (!relatedPath.project) {
          return false;
        }

        return sails.helpers.cards.isReadableBy.with({
          card: relatedCard,
          project: relatedPath.project,
          user: currentUser,
        });
      }),
    );

    const readableCards = relatedCards.filter((relatedCard, index) => readability[index]);

    const lists = await List.qm.getByIds(
      _.uniq(readableCards.map((readableCard) => readableCard.listId)),
    );

    return {
      items: cardDependencies,
      included: {
        cards: readableCards,
        lists,
      },
    };
  },
};
