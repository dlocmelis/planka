const { expect } = require('chai');

const { isNotificationEvents } = require('../../utils/validators');
const {
  Groups,
  SCOPES_BY_GROUP,
  DEFAULT_NOTIFICATION_EVENTS,
  groupForNotificationType,
  resolveOwnPredicate,
  matchesPreferences,
} = require('../../utils/notification-preferences');

const SAMPLE_TYPE_BY_GROUP = [
  { group: Groups.COMMENTS, type: 'commentCard' },
  { group: Groups.CARD_MOVEMENT, type: 'moveCard' },
  { group: Groups.LABELS, type: 'addLabelToCard' },
  { group: Groups.FIELDS, type: 'setCustomFieldValue' },
];

const MUTING_PREFS = {
  comments: {},
  cardMovement: { all: false, own: false, user: false, dev: false },
  labels: { all: false },
  fields: { all: false },
};

describe('notification-preferences', () => {
  describe('DEFAULT_NOTIFICATION_EVENTS', () => {
    it('should enable every scope of every group', () => {
      expect(Object.keys(DEFAULT_NOTIFICATION_EVENTS)).to.have.members(
        Object.keys(SCOPES_BY_GROUP),
      );

      Object.entries(SCOPES_BY_GROUP).forEach(([group, scopes]) => {
        expect(Object.keys(DEFAULT_NOTIFICATION_EVENTS[group])).to.have.members(scopes);
        expect(Object.values(DEFAULT_NOTIFICATION_EVENTS[group])).to.not.include(false);
      });
    });

    it('should deliver every mapped notification type for any predicates', () => {
      const defaultPrefs = JSON.parse(JSON.stringify(DEFAULT_NOTIFICATION_EVENTS));

      SAMPLE_TYPE_BY_GROUP.forEach(({ type }) => {
        expect(matchesPreferences(defaultPrefs, type, { own: false, dev: false })).to.equal(true);
        expect(matchesPreferences(defaultPrefs, type, { own: true, dev: true })).to.equal(true);
      });
      expect(
        matchesPreferences(defaultPrefs, 'mentionInComment', { own: false, dev: false }),
      ).to.equal(true);
    });
  });

  describe('#groupForNotificationType(type)', () => {
    it('should map commentCard to the comments group', () => {
      expect(groupForNotificationType('commentCard')).to.equal(Groups.COMMENTS);
    });

    it('should map mentionInComment to the comments group', () => {
      expect(groupForNotificationType('mentionInComment')).to.equal(Groups.COMMENTS);
    });

    it('should map moveCard to the cardMovement group', () => {
      expect(groupForNotificationType('moveCard')).to.equal(Groups.CARD_MOVEMENT);
    });

    it('should map addLabelToCard to the labels group', () => {
      expect(groupForNotificationType('addLabelToCard')).to.equal(Groups.LABELS);
    });

    it('should map setCustomFieldValue to the fields group', () => {
      expect(groupForNotificationType('setCustomFieldValue')).to.equal(Groups.FIELDS);
    });

    it('should return null for an unmapped notification type', () => {
      expect(groupForNotificationType('addMemberToCard')).to.equal(null);
    });

    it('should return null for an unknown type string', () => {
      expect(groupForNotificationType('notARealNotificationType')).to.equal(null);
    });
  });

  describe('#resolveOwnPredicate(cardMemberships, creatorUserId, userId)', () => {
    it('should return true when the user is the card creator but not a member', () => {
      expect(resolveOwnPredicate([], '100', '100')).to.equal(true);
      expect(resolveOwnPredicate([{ id: '300', userId: '200' }], '100', '100')).to.equal(true);
    });

    it('should return true when the user is a card member but not the creator', () => {
      const cardMemberships = [
        { id: '300', cardId: '10', userId: '200' },
        { id: '301', cardId: '10', userId: '201' },
      ];

      expect(resolveOwnPredicate(cardMemberships, '100', '200')).to.equal(true);
    });

    it('should return true when the user is both a member and the creator', () => {
      expect(
        resolveOwnPredicate([{ id: '300', cardId: '10', userId: '100' }], '100', '100'),
      ).to.equal(true);
    });

    it('should return false when the user is neither a member nor the creator', () => {
      const cardMemberships = [
        { id: '300', cardId: '10', userId: '200' },
        { id: '301', cardId: '10', userId: '201' },
      ];

      expect(resolveOwnPredicate(cardMemberships, '100', '202')).to.equal(false);
      expect(resolveOwnPredicate([], '100', '202')).to.equal(false);
    });

    it('should match members by the userId attribute, never by the membership record id', () => {
      // Regression: record ids and user ids come from the same sequence, so mapping
      // membership records by `id` instead of `userId` silently breaks the own predicate
      const cardMemberships = [{ id: '202', cardId: '10', userId: '200' }];

      expect(resolveOwnPredicate(cardMemberships, '100', '202')).to.equal(false);
      expect(resolveOwnPredicate(cardMemberships, '100', '200')).to.equal(true);
    });
  });

  describe('#matchesPreferences(notificationEvents, type, predicates)', () => {
    SAMPLE_TYPE_BY_GROUP.forEach(({ group, type }) => {
      describe(`${group} group (${type})`, () => {
        it('should allow when the all scope is enabled, regardless of own/dev flags', () => {
          const prefs = { [group]: { all: true } };

          expect(matchesPreferences(prefs, type, { own: false, dev: false })).to.equal(true);
          expect(matchesPreferences(prefs, type, { own: true, dev: false })).to.equal(true);
          expect(matchesPreferences(prefs, type, { own: false, dev: true })).to.equal(true);
          expect(matchesPreferences(prefs, type, { own: true, dev: true })).to.equal(true);
        });

        it('should allow via the own scope if and only if own=true', () => {
          const prefs = { [group]: { own: true } };

          expect(matchesPreferences(prefs, type, { own: true, dev: false })).to.equal(true);
          expect(matchesPreferences(prefs, type, { own: true, dev: true })).to.equal(true);
          expect(matchesPreferences(prefs, type, { own: false, dev: false })).to.equal(false);
          expect(matchesPreferences(prefs, type, { own: false, dev: true })).to.equal(false);
        });

        it('should allow via the user scope if and only if dev=false', () => {
          const prefs = { [group]: { user: true } };

          expect(matchesPreferences(prefs, type, { own: false, dev: false })).to.equal(true);
          expect(matchesPreferences(prefs, type, { own: true, dev: false })).to.equal(true);
          expect(matchesPreferences(prefs, type, { own: false, dev: true })).to.equal(false);
          expect(matchesPreferences(prefs, type, { own: true, dev: true })).to.equal(false);
        });

        it('should allow via the dev scope if and only if dev=true', () => {
          const prefs = { [group]: { dev: true } };

          expect(matchesPreferences(prefs, type, { own: false, dev: true })).to.equal(true);
          expect(matchesPreferences(prefs, type, { own: true, dev: true })).to.equal(true);
          expect(matchesPreferences(prefs, type, { own: false, dev: false })).to.equal(false);
          expect(matchesPreferences(prefs, type, { own: true, dev: false })).to.equal(false);
        });

        it('should mute when the section is an empty object', () => {
          const prefs = { [group]: {} };

          expect(matchesPreferences(prefs, type, { own: false, dev: false })).to.equal(false);
          expect(matchesPreferences(prefs, type, { own: true, dev: true })).to.equal(false);
        });

        it('should mute when every scope in the section is disabled', () => {
          const prefs = {
            [group]: { all: false, mentions: false, own: false, user: false, dev: false },
          };

          expect(matchesPreferences(prefs, type, { own: true, dev: false })).to.equal(false);
          expect(matchesPreferences(prefs, type, { own: false, dev: true })).to.equal(false);
        });

        it('should allow when at least one enabled scope matches', () => {
          const prefs = { [group]: { own: true, user: true } };

          expect(matchesPreferences(prefs, type, { own: true, dev: true })).to.equal(true);
          expect(matchesPreferences(prefs, type, { own: false, dev: false })).to.equal(true);
          expect(matchesPreferences(prefs, type, { own: true, dev: false })).to.equal(true);
        });

        it('should deny when no enabled scope matches', () => {
          const prefs = { [group]: { own: true, user: true } };

          expect(matchesPreferences(prefs, type, { own: false, dev: true })).to.equal(false);
        });
      });
    });

    describe('comments group mentions', () => {
      it('should allow mentionInComment via the mentions scope', () => {
        const prefs = { comments: { mentions: true } };

        expect(matchesPreferences(prefs, 'mentionInComment', { own: false, dev: false })).to.equal(
          true,
        );
        expect(matchesPreferences(prefs, 'mentionInComment', { own: true, dev: true })).to.equal(
          true,
        );
      });

      it('should not allow commentCard via the mentions scope alone', () => {
        const prefs = { comments: { mentions: true } };

        expect(matchesPreferences(prefs, 'commentCard', { own: false, dev: false })).to.equal(
          false,
        );
        expect(matchesPreferences(prefs, 'commentCard', { own: true, dev: true })).to.equal(false);
      });

      it('should allow mentionInComment via the all scope', () => {
        const prefs = { comments: { all: true } };

        expect(matchesPreferences(prefs, 'mentionInComment', { own: false, dev: true })).to.equal(
          true,
        );
      });

      it('should allow mentionInComment via the own scope if and only if own=true', () => {
        const prefs = { comments: { own: true } };

        expect(matchesPreferences(prefs, 'mentionInComment', { own: true, dev: false })).to.equal(
          true,
        );
        expect(matchesPreferences(prefs, 'mentionInComment', { own: false, dev: false })).to.equal(
          false,
        );
      });

      it('should allow mentionInComment via the user scope if and only if dev=false', () => {
        const prefs = { comments: { user: true } };

        expect(matchesPreferences(prefs, 'mentionInComment', { own: false, dev: false })).to.equal(
          true,
        );
        expect(matchesPreferences(prefs, 'mentionInComment', { own: false, dev: true })).to.equal(
          false,
        );
      });

      it('should allow mentionInComment via the dev scope if and only if dev=true', () => {
        const prefs = { comments: { dev: true } };

        expect(matchesPreferences(prefs, 'mentionInComment', { own: false, dev: true })).to.equal(
          true,
        );
        expect(matchesPreferences(prefs, 'mentionInComment', { own: false, dev: false })).to.equal(
          false,
        );
      });
    });

    describe('unmapped types', () => {
      it('should always allow unmapped types, even when every section mutes', () => {
        expect(
          matchesPreferences(MUTING_PREFS, 'addMemberToCard', { own: false, dev: false }),
        ).to.equal(true);
        expect(
          matchesPreferences(MUTING_PREFS, 'totallyUnknownType', { own: true, dev: true }),
        ).to.equal(true);
      });
    });

    describe('missing or malformed preferences', () => {
      it('should allow when preferences are undefined or null', () => {
        expect(matchesPreferences(undefined, 'commentCard', { own: false, dev: false })).to.equal(
          true,
        );
        expect(matchesPreferences(null, 'commentCard', { own: false, dev: false })).to.equal(true);
      });

      it('should allow when preferences are not a plain object', () => {
        expect(matchesPreferences('garbage', 'commentCard')).to.equal(true);
        expect(matchesPreferences(42, 'commentCard')).to.equal(true);
        expect(matchesPreferences(['comments'], 'commentCard')).to.equal(true);
        expect(matchesPreferences(true, 'commentCard')).to.equal(true);
      });

      it('should allow when preferences use the legacy array shape', () => {
        const legacyPrefs = { card: ['moveCard'], comment: [] };

        expect(matchesPreferences(legacyPrefs, 'commentCard', { own: true, dev: false })).to.equal(
          true,
        );
        expect(matchesPreferences(legacyPrefs, 'moveCard', { own: false, dev: false })).to.equal(
          true,
        );
      });

      it('should allow when the matching section is not a plain object', () => {
        expect(matchesPreferences({ comments: 'x' }, 'commentCard')).to.equal(true);
        expect(matchesPreferences({ comments: null }, 'commentCard')).to.equal(true);
        expect(matchesPreferences({ comments: ['x'] }, 'commentCard')).to.equal(true);
        expect(matchesPreferences({ comments: 42 }, 'commentCard')).to.equal(true);
      });

      it('should allow when the preferences object has no matching section', () => {
        expect(matchesPreferences({}, 'commentCard', { own: true, dev: false })).to.equal(true);
        expect(matchesPreferences({ labels: {} }, 'commentCard')).to.equal(true);
      });
    });

    describe('default predicates', () => {
      it('should treat omitted predicates as own=false and dev=false', () => {
        expect(matchesPreferences({ comments: { user: true } }, 'commentCard')).to.equal(true);
        expect(matchesPreferences({ comments: { own: true } }, 'commentCard')).to.equal(false);
        expect(matchesPreferences({ comments: { dev: true } }, 'commentCard')).to.equal(false);
      });
    });
  });
});

describe('validators', () => {
  describe('#isNotificationEvents(value)', () => {
    it('should accept the default all-scopes value', () => {
      const value = JSON.parse(JSON.stringify(DEFAULT_NOTIFICATION_EVENTS));

      expect(isNotificationEvents(value)).to.equal(true);
    });

    it('should accept a partial selection, an all-disabled section and an empty object', () => {
      expect(isNotificationEvents({ comments: { own: true } })).to.equal(true);
      expect(isNotificationEvents({ comments: {} })).to.equal(true);
      expect(isNotificationEvents({ comments: { all: false, own: false } })).to.equal(true);
      expect(isNotificationEvents({})).to.equal(true);
    });

    it('should reject an unknown group', () => {
      expect(isNotificationEvents({ board: { all: true } })).to.equal(false);
      expect(isNotificationEvents({ card: ['moveCard'] })).to.equal(false);
    });

    it('should reject an unknown scope', () => {
      expect(isNotificationEvents({ comments: { everything: true } })).to.equal(false);
    });

    it('should reject a scope belonging to another group', () => {
      expect(isNotificationEvents({ labels: { mentions: true } })).to.equal(false);
    });

    it('should reject non-object values', () => {
      expect(isNotificationEvents(null)).to.equal(false);
      expect(isNotificationEvents('comments')).to.equal(false);
      expect(isNotificationEvents(['comments'])).to.equal(false);
    });

    it('should reject non-object sections', () => {
      expect(isNotificationEvents({ comments: 'own' })).to.equal(false);
      expect(isNotificationEvents({ comments: ['own'] })).to.equal(false);
      expect(isNotificationEvents({ comments: null })).to.equal(false);
    });

    it('should reject non-boolean scope values', () => {
      expect(isNotificationEvents({ comments: { own: 'yes' } })).to.equal(false);
      expect(isNotificationEvents({ comments: { own: 1 } })).to.equal(false);
    });
  });
});
