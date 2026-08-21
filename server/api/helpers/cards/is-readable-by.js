/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

// "May this user see this card at all?" — the same three-way test cards/show
// makes, lifted out because card dependencies are the first thing that reads
// TWO cards in one request.
//
// A dependency may cross boards on purpose (a request on one board waiting for
// a sprint card on another), so the second card cannot be authorised by the
// first card's board membership. It gets its own check, and without one a
// member of any board could confirm the existence of any card id on the
// installation by trying to depend on it.
module.exports = {
  inputs: {
    card: {
      type: 'ref',
      required: true,
    },
    project: {
      type: 'ref',
      required: true,
    },
    user: {
      type: 'ref',
      required: true,
    },
  },

  async fn(inputs) {
    const { card, project, user } = inputs;

    if (user.role === User.Roles.ADMIN && !project.ownerProjectManagerId) {
      return true;
    }

    const isProjectManager = await sails.helpers.users.isProjectManager(user.id, project.id);

    if (isProjectManager) {
      return true;
    }

    const boardMembership = await BoardMembership.qm.getOneByBoardIdAndUserId(
      card.boardId,
      user.id,
    );

    return Boolean(boardMembership);
  },
};
