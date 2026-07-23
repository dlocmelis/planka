import orm from '../orm';
import { ListTypes } from '../constants/Enums';
import Config from '../constants/Config';
import { selectNextListPosition } from './positioning';

// Lists A, B, C, D at gap-spaced positions; B is hidden for the current user.
// The board renders only the visible subset (A, C, D), so drag-and-drop
// destination indexes are in visible-subset coordinates.
const buildState = (hiddenListIds) => {
  const session = orm.session(orm.getEmptyState());

  session.Board.create({ id: 'board-1' });

  session.BoardMembership.create({
    id: 'membership-1',
    boardId: 'board-1',
    userId: 'user-1',
    hiddenListIds,
  });

  session.List.create({ id: 'list-a', boardId: 'board-1', type: ListTypes.ACTIVE, position: 1000 });
  session.List.create({ id: 'list-b', boardId: 'board-1', type: ListTypes.ACTIVE, position: 2000 });
  session.List.create({ id: 'list-c', boardId: 'board-1', type: ListTypes.ACTIVE, position: 3000 });
  session.List.create({ id: 'list-d', boardId: 'board-1', type: ListTypes.ACTIVE, position: 4000 });
  // Archive lists are never kanban lists and must be ignored either way.
  session.List.create({ id: 'list-archive', boardId: 'board-1', type: ListTypes.ARCHIVE });

  return {
    auth: { userId: 'user-1' },
    orm: session.state,
  };
};

describe('selectNextListPosition', () => {
  describe('when a list is hidden', () => {
    const hiddenListIds = ['list-b'];

    test('drops a list between two visible neighbors using visible-subset coordinates', () => {
      const state = buildState(hiddenListIds);

      // Drag A to visible index 1 (between C and D visually -> order C, A, D).
      // The buggy full-array computation would land it at 2500 (between hidden
      // B and C), silently no-opping the move.
      expect(selectNextListPosition(state, 'board-1', 1, 'list-a')).toBe(3500);
    });

    test('appends a list after the last visible list', () => {
      const state = buildState(hiddenListIds);

      // Drag A to visible index 2 (after D). Visible-without-A is [C, D], so the
      // position lands after D. The buggy computation would land it before D.
      expect(selectNextListPosition(state, 'board-1', 2, 'list-a')).toBe(
        4000 + Config.POSITION_GAP,
      );
    });

    test('drops a list before the first visible list', () => {
      const state = buildState(hiddenListIds);

      // Drag D to visible index 0 (before A). Visible-without-D is [A, C].
      expect(selectNextListPosition(state, 'board-1', 0, 'list-d')).toBe(500);
    });

    test('appends after the very last list (including hidden ones) when no index is given', () => {
      const state = buildState(hiddenListIds);

      // List creation has no index and must append after the true last list (D),
      // regardless of visibility.
      expect(selectNextListPosition(state, 'board-1')).toBe(4000 + Config.POSITION_GAP);
    });
  });

  describe('when no list is hidden', () => {
    test('computes the position over the full kanban array', () => {
      const state = buildState([]);

      // Drag A to index 1. Full-without-A is [B, C, D]; between B and C -> 2500.
      expect(selectNextListPosition(state, 'board-1', 1, 'list-a')).toBe(2500);
    });

    test('appends after the last list when no index is given', () => {
      const state = buildState([]);

      expect(selectNextListPosition(state, 'board-1')).toBe(4000 + Config.POSITION_GAP);
    });
  });
});
