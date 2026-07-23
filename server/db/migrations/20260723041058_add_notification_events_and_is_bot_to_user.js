/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

module.exports.up = (knex) =>
  knex.schema.alterTable('user_account', (table) => {
    table
      .jsonb('notificationEvents')
      .notNullable()
      .defaultTo(
        JSON.stringify({
          card: ['moveCard', 'addMemberToCard'],
          comment: ['commentCard', 'mentionInComment'],
        }),
      );
    table.boolean('isBot').notNullable().defaultTo(false);
  });

module.exports.down = (knex) =>
  knex.schema.alterTable('user_account', (table) => {
    table.dropColumn('notificationEvents');
    table.dropColumn('isBot');
  });
