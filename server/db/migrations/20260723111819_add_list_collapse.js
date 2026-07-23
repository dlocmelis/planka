/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

exports.up = async (knex) => {
  await knex.schema.createTable('list_collapse', (table) => {
    /* Columns */

    table.bigInteger('id').primary().defaultTo(knex.raw('next_id()'));

    table.bigInteger('list_id').notNullable();
    table.bigInteger('user_id').notNullable();

    table.timestamp('created_at', true);
    table.timestamp('updated_at', true);

    /* Indexes */

    table.unique(['list_id', 'user_id']);
    table.index('user_id');

    /* Foreign keys */

    table.foreign('list_id').references('list.id').onDelete('CASCADE');
    table.foreign('user_id').references('user_account.id').onDelete('CASCADE');
  });
};

exports.down = (knex) => knex.schema.dropTable('list_collapse');
