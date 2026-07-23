/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

module.exports.up = (knex) =>
  knex.schema.alterTable('board_membership', (table) => {
    table.jsonb('hiddenListIds').notNullable().defaultTo(JSON.stringify([]));
  });

module.exports.down = (knex) =>
  knex.schema.alterTable('board_membership', (table) => {
    table.dropColumn('hiddenListIds');
  });
