/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

const defaultFind = (criteria) => ListCollapse.find(criteria).sort('id');

/* Query methods */

const createOne = (values) => ListCollapse.create({ ...values }).fetch();

const getByListIdsAndUserId = (listIds, userId) =>
  defaultFind({
    userId,
    listId: listIds,
  });

const getOneByListIdAndUserId = (listId, userId) =>
  ListCollapse.findOne({
    listId,
    userId,
  });

// eslint-disable-next-line no-underscore-dangle
const delete_ = (criteria) => ListCollapse.destroy(criteria).fetch();

const deleteOne = (criteria) => ListCollapse.destroyOne(criteria);

module.exports = {
  createOne,
  getByListIdsAndUserId,
  getOneByListIdAndUserId,
  deleteOne,
  delete: delete_,
};
