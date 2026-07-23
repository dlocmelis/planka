const { expect } = require('chai');
const NotificationModel = require('../../../api/models/Notification');

describe('Notification (model)', () => {
  describe('Types', () => {
    it('should include addLabelToCard and setCustomFieldValue', () => {
      expect(NotificationModel.Types).to.include({
        ADD_LABEL_TO_CARD: 'addLabelToCard',
        SET_CUSTOM_FIELD_VALUE: 'setCustomFieldValue',
      });
    });

    it('should allow every type in the type attribute isIn list', () => {
      expect(NotificationModel.attributes.type.isIn).to.have.members(
        Object.values(NotificationModel.Types),
      );
    });
  });
});
