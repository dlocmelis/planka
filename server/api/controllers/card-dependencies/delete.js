/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * @swagger
 * /cards/{cardId}/card-dependencies/dependsOnCardId:{dependsOnCardId}:
 *   delete:
 *     summary: Remove a dependency from a card
 *     description: Removes a card dependency. Requires board editor permissions.
 *     tags:
 *       - Card Dependencies
 *     operationId: deleteCardDependency
 *     parameters:
 *       - name: cardId
 *         in: path
 *         required: true
 *         description: ID of the card that waits (the dependent card)
 *         schema:
 *           type: string
 *           example: "1357158568008091264"
 *       - name: dependsOnCardId
 *         in: path
 *         required: true
 *         description: ID of the card it no longer has to wait for
 *         schema:
 *           type: string
 *           example: "1357158568008091265"
 *     responses:
 *       200:
 *         description: Dependency removed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - item
 *               properties:
 *                 item:
 *                   $ref: '#/components/schemas/CardDependency'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

const { idInput } = require('../../../utils/inputs');

const Errors = {
  NOT_ENOUGH_RIGHTS: {
    notEnoughRights: 'Not enough rights',
  },
  CARD_NOT_FOUND: {
    cardNotFound: 'Card not found',
  },
  DEPENDENCY_NOT_IN_CARD: {
    dependencyNotInCard: 'Dependency not in card',
  },
};

module.exports = {
  inputs: {
    cardId: {
      ...idInput,
      required: true,
    },
    dependsOnCardId: {
      ...idInput,
      required: true,
    },
  },

  exits: {
    notEnoughRights: {
      responseType: 'forbidden',
    },
    cardNotFound: {
      responseType: 'notFound',
    },
    dependencyNotInCard: {
      responseType: 'notFound',
    },
  },

  async fn(inputs) {
    const { currentUser } = this.req;

    const { card, list, board, project } = await sails.helpers.cards
      .getPathToProjectById(inputs.cardId)
      .intercept('pathNotFound', () => Errors.CARD_NOT_FOUND);

    const boardMembership = await BoardMembership.qm.getOneByBoardIdAndUserId(
      board.id,
      currentUser.id,
    );

    if (!boardMembership) {
      throw Errors.CARD_NOT_FOUND; // Forbidden
    }

    if (boardMembership.role !== BoardMembership.Roles.EDITOR) {
      throw Errors.NOT_ENOUGH_RIGHTS;
    }

    let cardDependency = await CardDependency.qm.getOneByCardIdAndDependsOnCardId(
      card.id,
      inputs.dependsOnCardId,
    );

    if (!cardDependency) {
      throw Errors.DEPENDENCY_NOT_IN_CARD;
    }

    // The blocker may have been deleted out from under the link (the row goes
    // with it, so this is the racing case rather than the normal one) or may
    // live on a board this request never touched. Either way the broadcast
    // needs its board, so it is resolved rather than assumed to be this one.
    const dependsOnPath = await sails.helpers.cards
      .getPathToProjectById(cardDependency.dependsOnCardId)
      .tolerate('pathNotFound', () => ({}));

    cardDependency = await sails.helpers.cardDependencies.deleteOne.with({
      project,
      board,
      list,
      card,
      record: cardDependency,
      dependsOnCard: dependsOnPath.card || { id: cardDependency.dependsOnCardId },
      dependsOnBoard: dependsOnPath.board || board,
      actorUser: currentUser,
      request: this.req,
    });

    if (!cardDependency) {
      throw Errors.DEPENDENCY_NOT_IN_CARD;
    }

    return {
      item: cardDependency,
    };
  },
};
