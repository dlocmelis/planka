/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

const defaultFind = (criteria) => PushSubscription.find(criteria).sort('id');

/* Query methods */

const createOne = (values) => PushSubscription.create({ ...values }).fetch();

const getByUserId = (userId) =>
  defaultFind({
    userId,
  });

const getActiveByUserIds = (userIds) =>
  defaultFind({
    userId: userIds,
    disabledAt: null,
  });

const getOneByEndpoint = (endpoint) => PushSubscription.findOne({ endpoint });

const updateOne = (criteria, values) => PushSubscription.updateOne(criteria).set({ ...values });

const deleteOne = (criteria) => PushSubscription.destroyOne(criteria);

module.exports = {
  createOne,
  getByUserId,
  getActiveByUserIds,
  getOneByEndpoint,
  updateOne,
  deleteOne,
};
