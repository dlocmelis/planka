const { expect } = require('chai');
const {
  SECRET_CONTENT_SENTINEL,
  maskCustomFieldValue,
  maskCustomFieldValues,
} = require('../../api/utils/secret-custom-fields');

describe('secret-custom-fields', () => {
  describe('SECRET_CONTENT_SENTINEL', () => {
    it('should equal eight bullet characters', () => {
      expect(SECRET_CONTENT_SENTINEL).to.be.equal('••••••••');
    });
  });

  describe('#maskCustomFieldValue(customFieldValue, customField)', () => {
    it('should replace content with the sentinel when the custom field is secret', () => {
      const customFieldValue = {
        id: '1',
        cardId: '10',
        customFieldGroupId: '20',
        customFieldId: '30',
        content: 'super-secret',
      };
      const customField = { id: '30', name: 'Override Voting', isSecret: true };

      const maskedValue = maskCustomFieldValue(customFieldValue, customField);

      expect(maskedValue).to.not.be.equal(customFieldValue);
      expect(maskedValue.content).to.be.equal(SECRET_CONTENT_SENTINEL);
      expect(maskedValue.id).to.be.equal('1');
      expect(maskedValue.customFieldId).to.be.equal('30');
    });

    it('should not mutate the input value when masking a secret one', () => {
      const customFieldValue = {
        id: '1',
        cardId: '10',
        customFieldGroupId: '20',
        customFieldId: '30',
        content: 'super-secret',
      };
      const customField = { id: '30', name: 'Override Voting', isSecret: true };

      maskCustomFieldValue(customFieldValue, customField);

      expect(customFieldValue.content).to.be.equal('super-secret');
    });

    it('should return the same reference when the custom field is not secret', () => {
      const customFieldValue = { id: '1', customFieldId: '30', content: 'visible' };
      const customField = { id: '30', name: 'Override Voting', isSecret: false };

      expect(maskCustomFieldValue(customFieldValue, customField)).to.be.equal(customFieldValue);
    });

    it('should return the same reference when the custom field has no isSecret flag', () => {
      const customFieldValue = { id: '1', customFieldId: '30', content: 'visible' };
      const customField = { id: '30', name: 'Override Voting' };

      expect(maskCustomFieldValue(customFieldValue, customField)).to.be.equal(customFieldValue);
    });

    it('should return the same reference when the custom field is undefined', () => {
      const customFieldValue = { id: '1', customFieldId: '30', content: 'visible' };

      expect(maskCustomFieldValue(customFieldValue, undefined)).to.be.equal(customFieldValue);
    });

    it('should return the value unchanged when the value is undefined', () => {
      const customField = { id: '30', name: 'Override Voting', isSecret: true };

      expect(maskCustomFieldValue(undefined, customField)).to.be.equal(undefined);
    });
  });

  describe('#maskCustomFieldValues(customFieldValues, customFields)', () => {
    it('should mask only values whose custom field is secret', () => {
      const customFieldValues = [
        {
          id: '1',
          cardId: '10',
          customFieldGroupId: '20',
          customFieldId: '30',
          content: 'super-secret',
        },
        {
          id: '2',
          cardId: '10',
          customFieldGroupId: '20',
          customFieldId: '31',
          content: 'visible',
        },
        { id: '3', cardId: '10', customFieldGroupId: '20', customFieldId: '32', content: 'orphan' },
      ];
      const customFields = [
        { id: '30', name: 'Override Voting', isSecret: true },
        { id: '31', name: 'Estimation', isSecret: false },
      ];

      const maskedValues = maskCustomFieldValues(customFieldValues, customFields);

      expect(maskedValues).to.be.an('array').with.lengthOf(3);
      expect(maskedValues).to.not.be.equal(customFieldValues);
      expect(maskedValues[0].content).to.be.equal(SECRET_CONTENT_SENTINEL);
      expect(maskedValues[1].content).to.be.equal('visible');
      expect(maskedValues[1]).to.be.equal(customFieldValues[1]);
      expect(maskedValues[2].content).to.be.equal('orphan');
      expect(maskedValues[2]).to.be.equal(customFieldValues[2]);
    });

    it('should not mutate the input array or its items', () => {
      const secretValue = {
        id: '1',
        cardId: '10',
        customFieldGroupId: '20',
        customFieldId: '30',
        content: 'super-secret',
      };
      const plainValue = {
        id: '2',
        cardId: '10',
        customFieldGroupId: '20',
        customFieldId: '31',
        content: 'visible',
      };
      const customFieldValues = [secretValue, plainValue];
      const customFields = [
        { id: '30', name: 'Override Voting', isSecret: true },
        { id: '31', name: 'Estimation', isSecret: false },
      ];

      maskCustomFieldValues(customFieldValues, customFields);

      expect(customFieldValues[0]).to.be.equal(secretValue);
      expect(customFieldValues[0].content).to.be.equal('super-secret');
      expect(customFieldValues[1]).to.be.equal(plainValue);
      expect(customFieldValues[1].content).to.be.equal('visible');
    });
  });
});
