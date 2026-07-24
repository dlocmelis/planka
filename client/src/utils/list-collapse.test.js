import { shouldRenderListCollapsed } from './list-collapse';

describe('shouldRenderListCollapsed', () => {
  const expanded = {
    isCollapsed: false,
    totalCardsCount: 0,
    isCardsFetching: false,
    isDragActive: false,
    isPeek: false,
  };

  test('persisted-collapsed list is always collapsed', () => {
    expect(
      shouldRenderListCollapsed({
        ...expanded,
        isCollapsed: true,
      }),
    ).toBe(true);

    expect(
      shouldRenderListCollapsed({
        ...expanded,
        isCollapsed: true,
        totalCardsCount: 5,
        isCardsFetching: true,
        isDragActive: true,
        isPeek: true,
      }),
    ).toBe(true);
  });

  test('expanded list with no cards is auto-collapsed', () => {
    expect(shouldRenderListCollapsed(expanded)).toBe(true);
  });

  test('expanded list with cards stays expanded', () => {
    expect(
      shouldRenderListCollapsed({
        ...expanded,
        totalCardsCount: 3,
      }),
    ).toBe(false);
  });

  test('fetching cards keeps an empty expanded list expanded', () => {
    expect(
      shouldRenderListCollapsed({
        ...expanded,
        isCardsFetching: true,
      }),
    ).toBe(false);
  });

  test('active drag keeps an empty expanded list expanded', () => {
    expect(
      shouldRenderListCollapsed({
        ...expanded,
        isDragActive: true,
      }),
    ).toBe(false);
  });

  test('peek keeps an empty expanded list expanded', () => {
    expect(
      shouldRenderListCollapsed({
        ...expanded,
        isPeek: true,
      }),
    ).toBe(false);
  });
});
