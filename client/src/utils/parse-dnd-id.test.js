import parseDndId, { isCardDndId } from './parse-dnd-id';

describe('isCardDndId', () => {
  test('is a card dnd id', () => {
    expect(isCardDndId('card:1234567890')).toBeTruthy();
  });

  test('is a list dnd id', () => {
    expect(isCardDndId('list:1234567890')).toBeFalsy();
  });

  test('is malformed', () => {
    expect(isCardDndId('1234567890')).toBeFalsy();
    expect(isCardDndId('')).toBeFalsy();
    expect(isCardDndId(undefined)).toBeFalsy();
    expect(isCardDndId(null)).toBeFalsy();
  });
});

describe('parseDndId', () => {
  test('extracts the id', () => {
    expect(parseDndId('card:1234567890')).toBe('1234567890');
    expect(parseDndId('list:1234567890')).toBe('1234567890');
  });
});
