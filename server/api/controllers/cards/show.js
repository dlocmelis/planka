/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * @swagger
 * /cards/{id}:
 *   get:
 *     summary: Get card details
 *     description: Retrieves comprehensive card information, including tasks, attachments, and other related data.
 *     tags:
 *       - Cards
 *     operationId: getCard
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: ID of the card to retrieve
 *         schema:
 *           type: string
 *           example: "1357158568008091264"
 *     responses:
 *       200:
 *         description: Card details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - item
 *                 - included
 *               properties:
 *                 item:
 *                   allOf:
 *                     - $ref: '#/components/schemas/Card'
 *                     - type: object
 *                       properties:
 *                         isSubscribed:
 *                           type: boolean
 *                           description: Whether the current user is subscribed to the card
 *                           example: true
 *                 included:
 *                   type: object
 *                   required:
 *                     - users
 *                     - cardMemberships
 *                     - cardLabels
 *                     - cardDependencies
 *                     - taskLists
 *                     - tasks
 *                     - attachments
 *                     - customFieldGroups
 *                     - customFields
 *                     - customFieldValues
 *                   properties:
 *                     users:
 *                       type: array
 *                       description: Related users
 *                       items:
 *                         $ref: '#/components/schemas/User'
 *                     cardMemberships:
 *                       type: array
 *                       description: Related card-membership associations
 *                       items:
 *                         $ref: '#/components/schemas/CardMembership'
 *                     cardLabels:
 *                       type: array
 *                       description: Related card-label associations
 *                       items:
 *                         $ref: '#/components/schemas/CardLabel'
 *                     cardDependencies:
 *                       type: array
 *                       description: >
 *                         Related card dependencies, in both directions. A row may name a card on a
 *                         board the reader cannot open, and it is returned anyway: the id alone is
 *                         what lets a client draw "waiting for a card you cannot see from here"
 *                         instead of silently dropping the link. Deliberate, and the same decision
 *                         GET /cards/{cardId}/card-dependencies documents at length — `included.cards`
 *                         there carries only the cards the reader may read, and these payloads carry
 *                         no cards for the far end at all.
 *                       items:
 *                         $ref: '#/components/schemas/CardDependency'
 *                     taskLists:
 *                       type: array
 *                       description: Related task lists
 *                       items:
 *                         $ref: '#/components/schemas/TaskList'
 *                     tasks:
 *                       type: array
 *                       description: Related tasks
 *                       items:
 *                         $ref: '#/components/schemas/Task'
 *                     attachments:
 *                       type: array
 *                       description: Related attachments
 *                       items:
 *                         $ref: '#/components/schemas/Attachment'
 *                     customFieldGroups:
 *                       type: array
 *                       description: Related custom field groups
 *                       items:
 *                         $ref: '#/components/schemas/CustomFieldGroup'
 *                     customFields:
 *                       type: array
 *                       description: Related custom fields
 *                       items:
 *                         $ref: '#/components/schemas/CustomField'
 *                     customFieldValues:
 *                       type: array
 *                       description: Related custom field values
 *                       items:
 *                         $ref: '#/components/schemas/CustomFieldValue'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */

const { idInput } = require('../../../utils/inputs');
const { maskCustomFieldValues } = require('../../utils/secret-custom-fields');

const Errors = {
  CARD_NOT_FOUND: {
    cardNotFound: 'Card not found',
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
    cardNotFound: {
      responseType: 'notFound',
    },
  },

  async fn(inputs) {
    const { currentUser } = this.req;

    const { card, project } = await sails.helpers.cards
      .getPathToProjectById(inputs.id)
      .intercept('pathNotFound', () => Errors.CARD_NOT_FOUND);

    if (currentUser.role !== User.Roles.ADMIN || project.ownerProjectManagerId) {
      const isProjectManager = await sails.helpers.users.isProjectManager(
        currentUser.id,
        project.id,
      );

      if (!isProjectManager) {
        const boardMembership = await BoardMembership.qm.getOneByBoardIdAndUserId(
          card.boardId,
          currentUser.id,
        );

        if (!boardMembership) {
          throw Errors.CARD_NOT_FOUND; // Forbidden
        }
      }
    }

    card.isSubscribed = await sails.helpers.users.isCardSubscriber(currentUser.id, card.id);

    const users = card.creatorUserId ? await User.qm.getByIds([card.creatorUserId]) : [];
    const cardMemberships = await CardMembership.qm.getByCardId(card.id);
    const cardLabels = await CardLabel.qm.getByCardId(card.id);
    const cardDependencies = await CardDependency.qm.getByCardIdsOrDependsOnCardIds([card.id]);

    const taskLists = await TaskList.qm.getByCardId(card.id);
    const taskListIds = sails.helpers.utils.mapRecords(taskLists);

    const tasks = await Task.qm.getByTaskListIds(taskListIds);
    const attachments = await Attachment.qm.getByCardId(card.id);

    const boardCustomFieldGroups = await CustomFieldGroup.qm.getByBoardId(card.boardId);
    const cardCustomFieldGroups = await CustomFieldGroup.qm.getByCardId(card.id);

    const customFieldGroups = [...boardCustomFieldGroups, ...cardCustomFieldGroups];
    const customFieldGroupIds = sails.helpers.utils.mapRecords(customFieldGroups);
    const baseCustomFieldGroupIds = sails.helpers.utils.mapRecords(
      customFieldGroups,
      'baseCustomFieldGroupId',
      true,
      true,
    );

    const customFields = [
      ...(await CustomField.qm.getByCustomFieldGroupIds(customFieldGroupIds)),
      ...(await CustomField.qm.getByBaseCustomFieldGroupIds(baseCustomFieldGroupIds)),
    ];
    let customFieldValues = await CustomFieldValue.qm.getByCardId(card.id);

    if (currentUser.role !== User.Roles.ADMIN) {
      customFieldValues = maskCustomFieldValues(customFieldValues, customFields);
    }

    return {
      item: card,
      included: {
        cardMemberships,
        cardLabels,
        cardDependencies,
        taskLists,
        tasks,
        customFieldGroups,
        customFields,
        customFieldValues,
        users: sails.helpers.users.presentMany(users, currentUser),
        attachments: sails.helpers.attachments.presentMany(attachments),
      },
    };
  },
};
