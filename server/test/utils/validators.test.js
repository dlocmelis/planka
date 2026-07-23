const { expect } = require('chai');

const { MAX_ID_ARRAY_LENGTH, isIdArray } = require('../../utils/validators');

describe('validators', () => {
  describe('#isIdArray(value)', () => {
    it('should accept an empty array', () => {
      expect(isIdArray([])).to.equal(true);
    });

    it('should accept an array of valid IDs', () => {
      expect(isIdArray(['1', '1357158568008091264', '9223372036854775807'])).to.equal(true);
    });

    it(`should accept an array of exactly ${MAX_ID_ARRAY_LENGTH} IDs`, () => {
      expect(isIdArray(new Array(MAX_ID_ARRAY_LENGTH).fill('1'))).to.equal(true);
    });

    it(`should reject an array of ${MAX_ID_ARRAY_LENGTH + 1} IDs`, () => {
      expect(isIdArray(new Array(MAX_ID_ARRAY_LENGTH + 1).fill('1'))).to.equal(false);
    });

    it('should reject non-array values', () => {
      expect(isIdArray(undefined)).to.equal(false);
      expect(isIdArray(null)).to.equal(false);
      expect(isIdArray('1357158568008091264')).to.equal(false);
      expect(isIdArray(42)).to.equal(false);
      expect(isIdArray(true)).to.equal(false);
      expect(isIdArray({ 0: '1' })).to.equal(false);
    });

    it('should reject non-string items', () => {
      expect(isIdArray([42])).to.equal(false);
      expect(isIdArray([null])).to.equal(false);
      expect(isIdArray([undefined])).to.equal(false);
      expect(isIdArray([{}])).to.equal(false);
      expect(isIdArray([['1']])).to.equal(false);
    });

    it('should reject malformed IDs', () => {
      expect(isIdArray([''])).to.equal(false);
      expect(isIdArray(['0'])).to.equal(false);
      expect(isIdArray(['01'])).to.equal(false);
      expect(isIdArray(['abc'])).to.equal(false);
      expect(isIdArray(['1.5'])).to.equal(false);
      expect(isIdArray(['-1'])).to.equal(false);
      expect(isIdArray([' 1'])).to.equal(false);
      expect(isIdArray(['9223372036854775808'])).to.equal(false);
    });

    it('should reject a mix of valid and invalid IDs', () => {
      expect(isIdArray(['1357158568008091264', 'abc'])).to.equal(false);
    });
  });
});
