/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

// Notification type strings mirror Notification.Types (api/models/Notification.js) and the
// client's NotificationTypes; they are duplicated here to keep this module free of Sails
// globals so it stays unit-testable. Group and scope names mirror the sections and
// checkboxes of the client's notification events settings
// (client/src/components/users/UserSettingsModal/NotificationEvents.jsx).

const Groups = {
  COMMENTS: 'comments',
  CARD_MOVEMENT: 'cardMovement',
  LABELS: 'labels',
  FIELDS: 'fields',
};

const Scopes = {
  ALL: 'all',
  MENTIONS: 'mentions',
  OWN: 'own',
  USER: 'user',
  DEV: 'dev',
};

// Notification events a user can subscribe to, grouped for presentation. Stored
// preferences hold per-scope boolean flags within each group.
const SCOPES_BY_GROUP = {
  [Groups.COMMENTS]: [Scopes.ALL, Scopes.MENTIONS, Scopes.OWN, Scopes.USER, Scopes.DEV],
  [Groups.CARD_MOVEMENT]: [Scopes.ALL, Scopes.OWN, Scopes.USER, Scopes.DEV],
  [Groups.LABELS]: [Scopes.ALL, Scopes.OWN, Scopes.USER, Scopes.DEV],
  [Groups.FIELDS]: [Scopes.ALL, Scopes.OWN, Scopes.USER, Scopes.DEV],
};

// By default the user receives everything: every scope of every group is enabled
const DEFAULT_NOTIFICATION_EVENTS = Object.fromEntries(
  Object.entries(SCOPES_BY_GROUP).map(([group, scopes]) => [
    group,
    Object.fromEntries(scopes.map((scope) => [scope, true])),
  ]),
);

const MENTION_IN_COMMENT_TYPE = 'mentionInComment';

const GROUP_BY_NOTIFICATION_TYPE = {
  commentCard: Groups.COMMENTS,
  [MENTION_IN_COMMENT_TYPE]: Groups.COMMENTS,
  moveCard: Groups.CARD_MOVEMENT,
  addLabelToCard: Groups.LABELS,
  setCustomFieldValue: Groups.FIELDS,
};

const groupForNotificationType = (type) => GROUP_BY_NOTIFICATION_TYPE[type] || null;

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Resolves the `own` predicate for `matchesPreferences`: `true` when the user is the
 * creator of the card or one of its members.
 *
 * `cardMemberships` are CardMembership records; only their `userId` attribute identifies
 * a member. Record `id`s come from the same sequence as user ids and must never be
 * compared to a user id.
 *
 * @param {Object[]} cardMemberships CardMembership records of the card
 * @param {string} creatorUserId `creatorUserId` of the card
 * @param {string} userId User the predicate is resolved for
 * @returns {boolean} `true` when the card is the user's own
 */
const resolveOwnPredicate = (cardMemberships, creatorUserId, userId) =>
  userId === creatorUserId || cardMemberships.some((membership) => membership.userId === userId);

/**
 * Checks whether a notification of the given type should be delivered to a recipient with
 * the given stored `notificationEvents` preferences.
 *
 * Preferences are grouped by event section (see `Groups`) with per-scope flags: `all` (any
 * event in the group), `own` (events on cards the recipient belongs to), `user` (events
 * caused by a human actor), `dev` (events caused by a bot actor) and, for comments,
 * `mentions` (direct mentions). Enabled scopes combine with OR semantics, while a section
 * present without any enabled scope mutes the whole group.
 *
 * Notification types outside the group map are never filtered, and missing or malformed
 * preferences fail open (default behavior: deliver everything).
 *
 * @param {any} notificationEvents Stored per-user preferences (may be missing or malformed)
 * @param {string} type Notification type (see Notification.Types)
 * @param {Object} [predicates] Context predicates for the recipient and the actor
 * @param {boolean} [predicates.own=false] Recipient is a member or the creator of the card
 * @param {boolean} [predicates.dev=false] Actor is a bot (`isBot`)
 * @returns {boolean} `true` when the notification should be delivered
 */
const matchesPreferences = (notificationEvents, type, { own = false, dev = false } = {}) => {
  const group = groupForNotificationType(type);

  if (!group) {
    return true;
  }

  if (!isPlainObject(notificationEvents)) {
    return true;
  }

  const section = notificationEvents[group];

  if (!isPlainObject(section)) {
    return true;
  }

  return !!(
    section.all ||
    (type === MENTION_IN_COMMENT_TYPE && section.mentions) ||
    (own && section.own) ||
    (dev && section.dev) ||
    (!dev && section.user)
  );
};

module.exports = {
  Groups,
  Scopes,
  SCOPES_BY_GROUP,
  DEFAULT_NOTIFICATION_EVENTS,
  groupForNotificationType,
  resolveOwnPredicate,
  matchesPreferences,
};
