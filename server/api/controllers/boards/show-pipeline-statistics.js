/*!
 * Copyright (c) 2026 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * @swagger
 * /boards/{id}/pipeline-statistics:
 *   get:
 *     summary: Get board pipeline statistics
 *     description: Read-only board-flow figures for the Pipeline strip's Statistics tab, computed from the board's action history — cards entered, completed, deployed and reopened, and user-testing sends, acceptances and rejections — for the last 24 hours, 7 days and 30 days, each with the previous period of the same length. Only people who can read the board's actions may read them.
 *     tags:
 *       - Boards
 *     operationId: getBoardPipelineStatistics
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: ID of the board
 *         schema:
 *           type: string
 *           example: "1357158568008091264"
 *     responses:
 *       200:
 *         description: Statistics computed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - item
 *               properties:
 *                 item:
 *                   type: object
 *                   required:
 *                     - boardId
 *                     - now
 *                     - periods
 *                   properties:
 *                     boardId:
 *                       type: string
 *                     now:
 *                       type: string
 *                       format: date-time
 *                     since:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                       description: When the board's action history begins
 *                     periods:
 *                       type: array
 *                       description: 24h, 7d and 30d, each with its current and previous window
 *                       items:
 *                         type: object
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

const { idInput } = require('../../../utils/inputs');
const pipelineStatistics = require('../../../utils/pipeline-statistics');

const Errors = {
  BOARD_NOT_FOUND: {
    boardNotFound: 'Board not found',
  },
};

module.exports = {
  inputs: {
    id: {
      ...idInput,
      required: true,
    },
  },

  exits: {
    boardNotFound: {
      responseType: 'notFound',
    },
  },

  async fn(inputs) {
    const { currentUser } = this.req;

    const { board, project } = await sails.helpers.boards
      .getPathToProjectById(inputs.id)
      .intercept('pathNotFound', () => Errors.BOARD_NOT_FOUND);

    // The same rule as the board's own action history (actions/index-in-board):
    // these figures are nothing but a count over it, so whoever may read that
    // may read this, and nobody else — a non-member is told the board does not
    // exist.
    const boardMembership = await BoardMembership.qm.getOneByBoardIdAndUserId(
      board.id,
      currentUser.id,
    );

    if (!boardMembership) {
      if (currentUser.role !== User.Roles.ADMIN || project.ownerProjectManagerId) {
        const isProjectManager = await sails.helpers.users.isProjectManager(
          currentUser.id,
          project.id,
        );

        if (!isProjectManager) {
          throw Errors.BOARD_NOT_FOUND; // Forbidden
        }
      }
    }

    const now = new Date();
    const reachStart = new Date(now.getTime() - pipelineStatistics.REACH_SECONDS * 1000);

    const actions = await Action.find({
      boardId: board.id,
      type: [Action.Types.CREATE_CARD, Action.Types.MOVE_CARD],
      createdAt: {
        '>=': reachStart.toISOString(),
      },
    });

    // A card completed in the window but created before it: its creation is
    // read separately, for the median time from entering the board to done.
    const missing = pipelineStatistics.missingCreations(actions);

    const creations =
      missing.length === 0
        ? []
        : await Action.find({
            boardId: board.id,
            cardId: missing,
            type: Action.Types.CREATE_CARD,
          });

    // When the board's history begins, so the tab can say "since 21 Jul"
    // rather than let a period older than the history read as a quiet one.
    const [first] = await Action.find({
      boardId: board.id,
    })
      .sort('createdAt ASC')
      .limit(1);

    return {
      item: {
        boardId: board.id,
        ...pipelineStatistics.compute({
          actions,
          creations,
          now,
          since: first ? first.createdAt : null,
        }),
      },
    };
  },
};
