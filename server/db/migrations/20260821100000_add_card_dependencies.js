/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

exports.up = async (knex) => {
  await knex.schema.createTable('card_dependency', (table) => {
    /* Columns */

    table.bigInteger('id').primary().defaultTo(knex.raw('next_id()'));

    // The card that WAITS ("card A is dependent on card B").
    table.bigInteger('card_id').notNullable();
    // The card that has to finish first (card B).
    table.bigInteger('depends_on_card_id').notNullable();

    table.timestamp('created_at', true);
    table.timestamp('updated_at', true);

    /* Indexes */

    // One link per ordered pair: adding the same dependency twice is a
    // conflict rather than a second row (helpers/card-dependencies/create-one
    // turns the E_UNIQUE into `dependencyAlreadyInCard`).
    table.unique(['card_id', 'depends_on_card_id']);
    // The reverse lookup — "who is waiting for this card?" — is the one the
    // automation runs on every move into Done, so it gets its own index.
    table.index('depends_on_card_id');

    /* Foreign keys */

    table.foreign('card_id').references('card.id').onDelete('CASCADE');
    table.foreign('depends_on_card_id').references('card.id').onDelete('CASCADE');
  });
};

exports.down = (knex) => knex.schema.dropTable('card_dependency');
