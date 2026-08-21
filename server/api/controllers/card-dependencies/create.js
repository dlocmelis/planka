/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * @swagger
 * /cards/{cardId}/card-dependencies:
 *   post:
 *     summary: Make a card depend on another card
 *     description: >
 *       Marks the card as dependent on another card ("card A is dependent on card B").
 *       Requires editor permissions on the dependent card's board and read access to the
 *       card being depended on; the two may live on different boards.
 *     tags:
 *       - Card Dependencies
 *     operationId: createCardDependency
 *     parameters:
 *       - name: cardId
 *         in: path
 *         required: true
 *         description: ID of the card that waits (the dependent card)
 *         schema:
 *           type: string
 *           example: "1357158568008091264"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - dependsOnCardId
 *             properties:
 *               dependsOnCardId:
 *                 type: string
 *                 description: ID of the card that has to be finished first
 *                 example: "1357158568008091265"
 *     responses:
 *       200:
 *         description: Dependency added successfully
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
 *       409:
 *         $ref: '#/components/responses/Conflict'
 *       422:
 *         $ref: '#/components/responses/UnprocessableEntity'
 */

const { idInput } = require('../../../utils/inputs');

const Errors = {
  NOT_ENOUGH_RIGHTS: {
    notEnoughRights: 'Not enough rights',
  },
  CARD_NOT_FOUND: {
    cardNotFound: 'Card not found',
  },
  DEPENDENCY_CARD_NOT_FOUND: {
    dependencyCardNotFound: 'Dependency card not found',
  },
  CARD_DEPENDS_ON_ITSELF: {
    cardDependsOnItself: 'Card depends on itself',
  },
  DEPENDENCY_WOULD_CREATE_CYCLE: {
    dependencyWouldCreateCycle: 'Dependency would create cycle',
  },
  DEPENDENCY_ALREADY_IN_CARD: {
    dependencyAlreadyInCard: 'Dependency already in card',
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
    dependencyCardNotFound: {
      responseType: 'notFound',
    },
    cardDependsOnItself: {
      responseType: 'unprocessableEntity',
    },
    dependencyWouldCreateCycle: {
      responseType: 'unprocessableEntity',
    },
    dependencyAlreadyInCard: {
      responseType: 'conflict',
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

    const {
      card: dependsOnCard,
      board: dependsOnBoard,
      project: dependsOnProject,
    } = await sails.helpers.cards
      .getPathToProjectById(inputs.dependsOnCardId)
      .intercept('pathNotFound', () => Errors.DEPENDENCY_CARD_NOT_FOUND);

    const isReadable = await sails.helpers.cards.isReadableBy.with({
      card: dependsOnCard,
      project: dependsOnProject,
      user: currentUser,
    });

    if (!isReadable) {
      throw Errors.DEPENDENCY_CARD_NOT_FOUND; // Forbidden
    }

    const cardDependency = await sails.helpers.cardDependencies.createOne
      .with({
        project,
        board,
        list,
        dependsOnBoard,
        values: {
          card,
          dependsOnCard,
        },
        actorUser: currentUser,
        request: this.req,
      })
      .intercept('cardDependsOnItself', () => Errors.CARD_DEPENDS_ON_ITSELF)
      .intercept('dependencyWouldCreateCycle', () => Errors.DEPENDENCY_WOULD_CREATE_CYCLE)
      .intercept('dependencyAlreadyInCard', () => Errors.DEPENDENCY_ALREADY_IN_CARD);

    return {
      item: cardDependency,
    };
  },
};
