/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

exports.up = (knex) =>
  knex.schema.createTable('push_subscription', (table) => {
    /* Columns */

    table.bigInteger('id').primary().defaultTo(knex.raw('next_id()'));

    table.bigInteger('user_id').notNullable();

    table.text('endpoint').notNullable();
    table.text('keys_p256dh').notNullable();
    table.text('keys_auth').notNullable();
    table.text('user_agent');

    table.timestamp('created_at', true);
    table.timestamp('updated_at', true);
    table.timestamp('last_used_at', true);
    table.timestamp('disabled_at', true);

    /* Indexes */

    table.index('user_id');
    table.unique('endpoint');
  });

exports.down = (knex) => knex.schema.dropTable('push_subscription');
