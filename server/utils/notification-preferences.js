/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

// Notification events a user can subscribe to, grouped for presentation.
// Scope values mirror Notification.Types so stored preferences can be
// matched against notification types directly.

const GROUPS = {
  CARD: 'card',
  COMMENT: 'comment',
};

const SCOPES_BY_GROUP = {
  [GROUPS.CARD]: ['moveCard', 'addMemberToCard'],
  [GROUPS.COMMENT]: ['commentCard', 'mentionInComment'],
};

const DEFAULT_NOTIFICATION_EVENTS = Object.fromEntries(
  Object.entries(SCOPES_BY_GROUP).map(([group, scopes]) => [group, [...scopes]]),
);

module.exports = {
  GROUPS,
  SCOPES_BY_GROUP,
  DEFAULT_NOTIFICATION_EVENTS,
};
