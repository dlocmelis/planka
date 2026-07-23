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

const convertNotificationEventsDefault = (knex, defaultValue) =>
  knex
    .raw('UPDATE user_account SET "notificationEvents" = ?::jsonb', [defaultValue])
    .then(() =>
      knex.raw('ALTER TABLE user_account ALTER COLUMN "notificationEvents" SET DEFAULT ?::jsonb', [
        defaultValue,
      ]),
    );

module.exports.up = (knex) => convertNotificationEventsDefault(knex, SCOPED_DEFAULT);

module.exports.down = (knex) => convertNotificationEventsDefault(knex, LEGACY_DEFAULT);
