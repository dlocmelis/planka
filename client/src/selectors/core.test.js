import orm from '../orm';
import { ListTypes } from '../constants/Enums';
import { selectSelectedCardIds } from './core';

const buildState = (selectedCardIds) => {
  const session = orm.session(orm.getEmptyState());

  session.List.create({
    id: 'list-active',
    boardId: 'board-1',
    type: ListTypes.ACTIVE,
    position: 1,
  });
  session.List.create({
    id: 'list-closed',
    boardId: 'board-1',
    type: ListTypes.CLOSED,
    position: 2,
  });
  session.List.create({ id: 'list-archive', boardId: 'board-1', type: ListTypes.ARCHIVE });
  session.List.create({ id: 'list-trash', boardId: 'board-1', type: ListTypes.TRASH });
  session.List.create({
    id: 'list-other-board',
    boardId: 'board-2',
    type: ListTypes.ACTIVE,
    position: 1,
  });

  session.Card.create({
    id: 'card-active',
    boardId: 'board-1',
    listId: 'list-active',
    position: 1,
  });
  session.Card.create({
    id: 'card-closed',
    boardId: 'board-1',
    listId: 'list-closed',
    position: 2,
  });
  session.Card.create({ id: 'card-archived', boardId: 'board-1', listId: 'list-archive' });
  session.Card.create({ id: 'card-trashed', boardId: 'board-1', listId: 'list-trash' });
  session.Card.create({
    id: 'card-other-board',
    boardId: 'board-2',
    listId: 'list-other-board',
    position: 1,
  });

  return {
    core: { boardId: 'board-1', selectedCardIds },
    orm: session.state,
  };
};

describe('selectSelectedCardIds', () => {
  test('keeps selected cards in kanban lists of the current board', () => {
    const state = buildState(['card-active', 'card-closed']);

    expect(selectSelectedCardIds(state)).toEqual(['card-active', 'card-closed']);
  });

  test('prunes cards that no longer exist', () => {
    const state = buildState(['card-active', 'card-deleted']);

    expect(selectSelectedCardIds(state)).toEqual(['card-active']);
  });

  test('prunes cards moved to another board', () => {
    const state = buildState(['card-active', 'card-other-board']);

    expect(selectSelectedCardIds(state)).toEqual(['card-active']);
  });

  test('prunes cards moved to the archive', () => {
    const state = buildState(['card-active', 'card-archived']);

    expect(selectSelectedCardIds(state)).toEqual(['card-active']);
  });

  test('prunes cards moved to the trash', () => {
    const state = buildState(['card-active', 'card-trashed']);

    expect(selectSelectedCardIds(state)).toEqual(['card-active']);
  });
});
