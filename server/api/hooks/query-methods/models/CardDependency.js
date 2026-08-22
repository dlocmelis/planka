/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

const defaultFind = (criteria) => CardDependency.find(criteria).sort('id');

/* Query methods */

const createOne = (values) => CardDependency.create({ ...values }).fetch();

const getByIds = (ids) => defaultFind(ids);

const getByCardId = (cardId) =>
  defaultFind({
    cardId,
  });

const getByCardIds = (cardIds) =>
  defaultFind({
    cardId: cardIds,
  });

const getByDependsOnCardId = (dependsOnCardId) =>
  defaultFind({
    dependsOnCardId,
  });

const getByDependsOnCardIds = (dependsOnCardIds) =>
  defaultFind({
    dependsOnCardId: dependsOnCardIds,
  });

// Both directions in one read: the rows where the given cards WAIT and the
// rows where they are waited FOR. Every payload that carries dependencies
// (boards/show, lists/show, cards/show) needs both, because a dependency may
// point at a card on another board — a link the caller would otherwise only
// ever see one half of.
const getByCardIdsOrDependsOnCardIds = async (cardIds) => {
  const [dependencies, dependents] = await Promise.all([
    getByCardIds(cardIds),
    getByDependsOnCardIds(cardIds),
  ]);

  return _.uniqBy([...dependencies, ...dependents], 'id');
};

const getOneById = (id) => CardDependency.findOne(id);

const getOneByCardIdAndDependsOnCardId = (cardId, dependsOnCardId) =>
  CardDependency.findOne({
    cardId,
    dependsOnCardId,
  });

// eslint-disable-next-line no-underscore-dangle
const delete_ = (criteria) => CardDependency.destroy(criteria).fetch();

const deleteOne = (criteria) => CardDependency.destroyOne(criteria);

module.exports = {
  createOne,
  getByIds,
  getByCardId,
  getByCardIds,
  getByDependsOnCardId,
  getByDependsOnCardIds,
  getByCardIdsOrDependsOnCardIds,
  getOneById,
  getOneByCardIdAndDependsOnCardId,
  deleteOne,
  delete: delete_,
};
