/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * @swagger
 * /board-memberships/{id}:
 *   patch:
 *     summary: Update board membership
 *     description: Updates a board membership. Requires project manager permissions, except when the membership's own user updates only preference fields (e.g. hiddenListIds).
 *     tags:
 *       - Board Memberships
 *     operationId: updateBoardMembership
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: ID of the board membership to update
 *         schema:
 *           type: string
 *           example: "1357158568008091264"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [editor, viewer]
 *                 description: Role of the user in the board
 *                 example: editor
 *               canComment:
 *                 type: boolean
 *                 nullable: true
 *                 description: Whether the user can comment on cards (applies only to viewers)
 *                 example: true
 *               hiddenListIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: IDs of the lists the user has hidden on the board (own preference)
 *                 example: ["1357158568008091268"]
 *     responses:
 *       200:
 *         description: Board membership updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - item
 *               properties:
 *                 item:
 *                   $ref: '#/components/schemas/BoardMembership'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

const { isIdArray } = require('../../../utils/validators');
const { idInput } = require('../../../utils/inputs');

const Errors = {
  BOARD_MEMBERSHIP_NOT_FOUND: {
    boardMembershipNotFound: 'Board membership not found',
  },
  INVALID_HIDDEN_LIST_IDS: {
    invalidHiddenListIds: 'Invalid hidden list ids',
  },
};

module.exports = {
  inputs: {
    id: {
      ...idInput,
      required: true,
    },
    role: {
      type: 'string',
      isIn: Object.values(BoardMembership.Roles),
    },
    canComment: {
      type: 'boolean',
      allowNull: true,
    },
    hiddenListIds: {
      type: 'json',
      custom: isIdArray,
    },
  },

  exits: {
    boardMembershipNotFound: {
      responseType: 'notFound',
    },
    invalidHiddenListIds: {
      responseType: 'badRequest',
    },
  },

  async fn(inputs) {
    const { currentUser } = this.req;

    // rttc's `json` type accepts `null` and machine skips `custom` validation
    // for `null`, so it must be rejected here (the column is NOT NULL)
    if (_.isNull(inputs.hiddenListIds)) {
      throw Errors.INVALID_HIDDEN_LIST_IDS;
    }

    const pathToProject = await sails.helpers.boardMemberships
      .getPathToProjectById(inputs.id)
      .intercept('pathNotFound', () => Errors.BOARD_MEMBERSHIP_NOT_FOUND);

    let { boardMembership } = pathToProject;
    const { board, project } = pathToProject;

    const isProjectManager = await sails.helpers.users.isProjectManager(currentUser.id, project.id);

    if (!isProjectManager) {
      const isOwnPreferenceUpdate =
        boardMembership.userId === currentUser.id &&
        _.difference(Object.keys(_.omit(inputs, ['id'])), BoardMembership.PREFERENCE_FIELD_NAMES)
          .length === 0;

      if (!isOwnPreferenceUpdate) {
        throw Errors.BOARD_MEMBERSHIP_NOT_FOUND; // Forbidden
      }
    }

    const values = _.pick(inputs, ['role', 'canComment', 'hiddenListIds']);

    boardMembership = await sails.helpers.boardMemberships.updateOne.with({
      values,
      project,
      board,
      record: boardMembership,
      actorUser: currentUser,
      request: this.req,
    });

    if (!boardMembership) {
      throw Errors.BOARD_MEMBERSHIP_NOT_FOUND;
    }

    return {
      item: boardMembership,
    };
  },
};
