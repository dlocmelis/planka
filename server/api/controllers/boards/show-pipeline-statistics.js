/*!
 * Copyright (c) 2026 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * @swagger
 * /boards/{id}/pipeline-statistics:
 *   get:
 *     summary: Get board pipeline statistics
 *     description: Read-only board-flow figures for the Pipeline strip's Statistics tab, computed from the board's action history — cards entered, completed, deployed and reopened, and user-testing sends, acceptances and rejections — for the last 24 hours, 7 days and 30 days, each with the previous period of the same length. Optional query parameters narrow it to some of the board's cards (any of the labels, a keyword, any of the creators, time to done, cost; different filters combine with AND) and replace the three periods with one custom period. Only people who can read the board's actions may read them.
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
 *       - name: labelIds
 *         in: query
 *         description: Comma-separated label ids; a card counts if it has any of them
 *         schema:
 *           type: string
 *       - name: search
 *         in: query
 *         description: Case-insensitive substring of the card's name or description
 *         schema:
 *           type: string
 *       - name: creators
 *         in: query
 *         description: Comma-separated creator keys (filterOptions.creators[].key); a card counts if its creator is any of them
 *         schema:
 *           type: string
 *       - name: durationMin
 *         in: query
 *         description: Least seconds from the card entering the board to its first completion; cards not done drop out
 *         schema:
 *           type: string
 *       - name: durationMax
 *         in: query
 *         description: Most seconds from the card entering the board to its first completion; cards not done drop out
 *         schema:
 *           type: string
 *       - name: costMin
 *         in: query
 *         description: Least USD in the card's "Est. Cost (USD)" field; cards with no cost drop out
 *         schema:
 *           type: string
 *       - name: costMax
 *         in: query
 *         description: Most USD in the card's "Est. Cost (USD)" field; cards with no cost drop out
 *         schema:
 *           type: string
 *       - name: from
 *         in: query
 *         description: With `to`, one custom period [from, to) in place of 24h, 7d and 30d, at most 366 days long
 *         schema:
 *           type: string
 *           format: date-time
 *       - name: to
 *         in: query
 *         description: End (exclusive) of the custom period
 *         schema:
 *           type: string
 *           format: date-time
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
 *                     - filterOptions
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
 *                       description: 24h, 7d and 30d — or the one custom period — each with its current and previous window
 *                       items:
 *                         type: object
 *                     filterOptions:
 *                       type: object
 *                       properties:
 *                         creators:
 *                           type: array
 *                           description: Who created this board's cards — the description's Reporter, else the Planka user — busiest first
 *                           items:
 *                             type: object
 *                             properties:
 *                               key:
 *                                 type: string
 *                               name:
 *                                 type: string
 *                               cards:
 *                                 type: integer
 *       400:
 *         description: A filter parameter is not understood, or the custom period is longer than 366 days
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

const FILTER_INPUT_NAMES = [
  'labelIds',
  'search',
  'creators',
  'durationMin',
  'durationMax',
  'costMin',
  'costMax',
  'from',
  'to',
];

// The board's cards as matchCards reads them. What a filter is not set for is
// not read: the creator of every card is, for the dropdown's options.
const describeCards = async (board, filters, windowCardIds) => {
  const cards = await Card.find({ boardId: board.id });

  const creatorUserIds = _.uniq(cards.map((card) => card.creatorUserId).filter(Boolean));
  const users = creatorUserIds.length === 0 ? [] : await User.find({ id: creatorUserIds });
  const userById = _.keyBy(users, 'id');

  const described = cards.map((card) => ({
    ...card,
    creator: pipelineStatistics.creatorOf(card, userById[card.creatorUserId]),
  }));

  if (filters.labelIds) {
    const cardLabels = await CardLabel.find({ labelId: filters.labelIds });
    const labelIdsByCardId = _.groupBy(cardLabels, 'cardId');

    described.forEach((card) => {
      // eslint-disable-next-line no-param-reassign
      card.labelIds = (labelIdsByCardId[card.id] || []).map(({ labelId }) => labelId);
    });
  }

  if (filters.cost) {
    const fields = await CustomField.find({ name: pipelineStatistics.COST_FIELD_NAME });
    const values =
      fields.length === 0 || cards.length === 0
        ? []
        : await CustomFieldValue.find({
            customFieldId: sails.helpers.utils.mapRecords(fields),
            cardId: sails.helpers.utils.mapRecords(cards),
          });
    const costByCardId = {};

    values.forEach(({ cardId, content }) => {
      const cost = pipelineStatistics.parseCost(content);

      if (cost !== null && costByCardId[cardId] === undefined) {
        costByCardId[cardId] = cost;
      }
    });

    described.forEach((card) => {
      // eslint-disable-next-line no-param-reassign
      card.costUsd = costByCardId[card.id] === undefined ? null : costByCardId[card.id];
    });
  }

  // Time to done needs each card's WHOLE history — its first completion may
  // lie before the read — but only of the cards that have something in it.
  if (filters.duration) {
    const boardCardIds = new Set(cards.map((card) => String(card.id)));
    const cardIds = [...windowCardIds].filter((cardId) => boardCardIds.has(cardId));
    const history =
      cardIds.length === 0
        ? []
        : await Action.find({
            boardId: board.id,
            cardId: cardIds,
            type: [Action.Types.CREATE_CARD, Action.Types.MOVE_CARD],
          });
    const secondsByCardId = pipelineStatistics.secondsToDoneByCardId(history);

    described.forEach((card) => {
      const seconds = secondsByCardId.get(String(card.id));

      // eslint-disable-next-line no-param-reassign
      card.secondsToDone = seconds === undefined ? null : seconds;
    });
  }

  return described;
};

module.exports = {
  inputs: {
    id: {
      ...idInput,
      required: true,
    },
    // Read and checked by pipelineStatistics.parseFilters, which answers a
    // parameter it does not understand with a 400.
    ...FILTER_INPUT_NAMES.reduce(
      (inputs, name) => ({
        ...inputs,
        [name]: {
          type: 'string',
        },
      }),
      {},
    ),
  },

  exits: {
    boardNotFound: {
      responseType: 'notFound',
    },
    invalidFilter: {
      responseType: 'badRequest',
    },
  },

  async fn(inputs) {
    const { currentUser } = this.req;

    let parsed;

    try {
      parsed = pipelineStatistics.parseFilters(_.pick(inputs, FILTER_INPUT_NAMES));
    } catch (error) {
      if (error instanceof pipelineStatistics.FilterError) {
        // The shape of Sails' own E_MISSING_OR_INVALID_PARAMS answer, whose
        // `message` the tab shows (getJson in the client's PipelineStrip/api.js).
        throw { invalidFilter: { code: 'E_INVALID_FILTER', message: error.message } };
      }

      throw error;
    }

    const { filters, range } = parsed;

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
    const reach = pipelineStatistics.reachOf(now, range);

    const actions = await Action.find({
      boardId: board.id,
      type: [Action.Types.CREATE_CARD, Action.Types.MOVE_CARD],
      createdAt: {
        '>=': reach.from.toISOString(),
        ...(reach.to && { '<': reach.to.toISOString() }),
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

    const cards = await describeCards(
      board,
      filters,
      new Set(actions.map((action) => String(action.cardId))),
    );

    // With a card filter, only the actions on the cards that pass it count. A
    // card deleted since has no record to pass it, so it drops out.
    const cardIds = pipelineStatistics.hasCardFilter(filters)
      ? pipelineStatistics.matchCards(cards, filters)
      : null;

    return {
      item: {
        boardId: board.id,
        ...pipelineStatistics.compute({
          actions,
          creations,
          now,
          since: first ? first.createdAt : null,
          range,
          cardIds,
        }),
        filterOptions: {
          creators: pipelineStatistics.creatorOptions(cards.map((card) => card.creator)),
        },
      },
    };
  },
};
