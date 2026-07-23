/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

// The notificationEvents contract changed from per-group notification type arrays
// ({ card: ['moveCard', ...] }) to per-group scope flags
// ({ comments: { all: true, ... } }). The old shape was only ever a column default —
// the settings UI payload was rejected by the previous validator — so resetting every
// row to the new all-scopes default preserves the effective behavior (receive
// everything) and lets the settings UI render the stored value truthfully.

const SCOPED_DEFAULT = JSON.stringify({
  comments: { all: true, mentions: true, own: true, user: true, dev: true },
  cardMovement: { all: true, own: true, user: true, dev: true },
  labels: { all: true, own: true, user: true, dev: true },
  fields: { all: true, own: true, user: true, dev: true },
});

const LEGACY_DEFAULT = JSON.stringify({
  card: ['moveCard', 'addMemberToCard'],
  comment: ['commentCard', 'mentionInComment'],
});

// Query/schema builders go through knexfile's wrapIdentifier snake_case hook, so
// camelCase identifiers map to the real notification_events column; the default is
// set via the schema builder because Postgres rejects bind parameters in DDL.
const convertNotificationEventsDefault = (knex, defaultValue) =>
  knex('user_account')
    .update({ notificationEvents: defaultValue })
    .then(() =>
      knex.schema.alterTable('user_account', (table) => {
        table.jsonb('notificationEvents').defaultTo(defaultValue).alter();
      }),
    );

module.exports.up = (knex) => convertNotificationEventsDefault(knex, SCOPED_DEFAULT);

module.exports.down = (knex) => convertNotificationEventsDefault(knex, LEGACY_DEFAULT);
