const { expect } = require('chai');

const { isNotificationEvents } = require('../../utils/validators');
const {
  GROUPS,
  SCOPES_BY_GROUP,
  DEFAULT_NOTIFICATION_EVENTS,
} = require('../../utils/notification-preferences');

describe('notification-preferences', () => {
  describe('DEFAULT_NOTIFICATION_EVENTS', () => {
    it('should contain every scope of every group', () => {
      expect(Object.keys(DEFAULT_NOTIFICATION_EVENTS)).to.have.members(Object.values(GROUPS));

      Object.entries(SCOPES_BY_GROUP).forEach(([group, scopes]) => {
        expect(DEFAULT_NOTIFICATION_EVENTS[group]).to.have.members(scopes);
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

    it('should accept a partial selection and an empty object', () => {
      expect(isNotificationEvents({ card: ['moveCard'] })).to.equal(true);
      expect(isNotificationEvents({ card: [] })).to.equal(true);
      expect(isNotificationEvents({})).to.equal(true);
    });

    it('should reject an unknown group', () => {
      expect(isNotificationEvents({ board: ['moveCard'] })).to.equal(false);
    });

    it('should reject an unknown scope value', () => {
      expect(isNotificationEvents({ card: ['deleteCard'] })).to.equal(false);
    });

    it('should reject a scope belonging to another group', () => {
      expect(isNotificationEvents({ card: ['commentCard'] })).to.equal(false);
    });

    it('should reject non-object values', () => {
      expect(isNotificationEvents(null)).to.equal(false);
      expect(isNotificationEvents('card')).to.equal(false);
      expect(isNotificationEvents(['card'])).to.equal(false);
    });

    it('should reject non-array scopes', () => {
      expect(isNotificationEvents({ card: 'moveCard' })).to.equal(false);
    });
  });
});
