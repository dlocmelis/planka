import { createReducer } from 'redux-orm';

import orm from '../orm';
import actions from '../actions';
import { selectFilterCreatorUserIdsForCurrentBoard } from '../selectors/boards';
import Paths from '../constants/Paths';
import { ListTypes, UserRoles } from '../constants/Enums';

const reducer = createReducer(orm);

const buildOrmState = () => {
  const session = orm.session(orm.getEmptyState());

  session.Project.create({ id: 'project-1', name: 'Project 1' });

  session.Board.create({
    id: 'board-1',
    projectId: 'project-1',
    search: '',
  });

  session.List.create({
    id: 'list-1',
    boardId: 'board-1',
    type: ListTypes.ACTIVE,
    position: 1,
    lastCard: {
      listChangedAt: '2026-01-01T00:00:00.000Z',
      id: 'card-1',
    },
    isCardsFetching: true,
    isAllCardsFetched: false,
  });

  session.User.create({ id: 'user-1', role: UserRoles.ADMIN });
  session.User.create({ id: 'user-2', role: UserRoles.BOARD_USER });

  session.BoardMembership.create({
    id: 'membership-1',
    boardId: 'board-1',
    userId: 'user-1',
  });
  session.BoardMembership.create({
    id: 'membership-2',
    boardId: 'board-1',
    userId: 'user-2',
  });

  session.Label.create({ id: 'label-1', boardId: 'board-1', position: 1 });

  session.Card.create({
    id: 'card-1',
    boardId: 'board-1',
    listId: 'list-1',
    creatorUserId: 'user-1',
    position: 1,
    name: 'Alpha card',
  });
  session.Card.create({
    id: 'card-2',
    boardId: 'board-1',
    listId: 'list-1',
    creatorUserId: 'user-2',
    position: 2,
    name: 'Beta card',
  });
  session.Card.create({
    id: 'card-3',
    boardId: 'board-1',
    listId: 'list-1',
    creatorUserId: 'user-1',
    position: 3,
    name: 'Gamma card',
  });
  // A card with no creator at all — it must never survive a non-empty creator filter.
  session.Card.create({
    id: 'card-4',
    boardId: 'board-1',
    listId: 'list-1',
    position: 4,
    name: 'Delta card',
  });

  // Every other filter dimension matches more than one card, and matches cards with different
  // creators, so a test that combines it with the creator filter only passes if the creator
  // filter actually narrows the result.
  session.Card.withId('card-1').users.add('user-2');
  session.Card.withId('card-2').users.add('user-2');
  session.Card.withId('card-1').labels.add('label-1');
  session.Card.withId('card-2').labels.add('label-1');

  return session.state;
};

const getBoardFilteredCardIds = (ormState) =>
  orm
    .session(ormState)
    .Board.withId('board-1')
    .getFilteredCardsModelArray()
    .map((cardModel) => cardModel.id);

const getListFilteredCardIds = (ormState) =>
  orm
    .session(ormState)
    .List.withId('list-1')
    .getFilteredCardsModelArray()
    .map((cardModel) => cardModel.id);

const getListRef = (ormState) => orm.session(ormState).List.withId('list-1').ref;

const getFilterCreatorUserIds = (ormState) =>
  orm
    .session(ormState)
    .Board.withId('board-1')
    .filterCreatorUsers.toRefArray()
    .map((user) => user.id);

describe('Board creator filter', () => {
  test('keeps only cards created by the selected users', () => {
    const emptyFilterState = buildOrmState();
    expect(getBoardFilteredCardIds(emptyFilterState)).toEqual([
      'card-1',
      'card-2',
      'card-3',
      'card-4',
    ]);

    const ormState = reducer(
      emptyFilterState,
      actions.addCreatorUserToBoardFilter('user-1', 'board-1'),
    );
    expect(getBoardFilteredCardIds(ormState)).toEqual(['card-1', 'card-3']);
    expect(getListFilteredCardIds(ormState)).toEqual(['card-1', 'card-3']);
  });

  test('restores every card once the last creator is removed', () => {
    let ormState = reducer(
      buildOrmState(),
      actions.addCreatorUserToBoardFilter('user-1', 'board-1'),
    );
    ormState = reducer(ormState, actions.removeCreatorUserFromBoardFilter('user-1', 'board-1'));

    expect(getBoardFilteredCardIds(ormState)).toEqual(['card-1', 'card-2', 'card-3', 'card-4']);
    expect(getListFilteredCardIds(ormState)).toEqual(['card-1', 'card-2', 'card-3', 'card-4']);
  });

  test('accumulates several creators and drops cards without a creator', () => {
    let ormState = reducer(
      buildOrmState(),
      actions.addCreatorUserToBoardFilter('user-1', 'board-1'),
    );
    ormState = reducer(ormState, actions.addCreatorUserToBoardFilter('user-2', 'board-1'));

    expect(getFilterCreatorUserIds(ormState)).toEqual(['user-1', 'user-2']);
    expect(getBoardFilteredCardIds(ormState)).toEqual(['card-1', 'card-2', 'card-3']);
    expect(getListFilteredCardIds(ormState)).toEqual(['card-1', 'card-2', 'card-3']);
  });

  test('replace empties the previously selected creators', () => {
    let ormState = reducer(
      buildOrmState(),
      actions.addCreatorUserToBoardFilter('user-1', 'board-1'),
    );
    ormState = reducer(ormState, actions.addCreatorUserToBoardFilter('user-2', 'board-1', true));

    expect(getFilterCreatorUserIds(ormState)).toEqual(['user-2']);
    expect(getBoardFilteredCardIds(ormState)).toEqual(['card-2']);
  });

  test('combines with the member filter', () => {
    const memberFilterState = reducer(
      buildOrmState(),
      actions.addUserToBoardFilter('user-2', 'board-1'),
    );
    expect(getBoardFilteredCardIds(memberFilterState)).toEqual(['card-1', 'card-2']);
    expect(getListFilteredCardIds(memberFilterState)).toEqual(['card-1', 'card-2']);

    const ormState = reducer(
      memberFilterState,
      actions.addCreatorUserToBoardFilter('user-1', 'board-1'),
    );

    expect(getBoardFilteredCardIds(ormState)).toEqual(['card-1']);
    expect(getListFilteredCardIds(ormState)).toEqual(['card-1']);
  });

  test('combines with the label filter', () => {
    const labelFilterState = reducer(
      buildOrmState(),
      actions.addLabelToBoardFilter('label-1', 'board-1'),
    );
    expect(getBoardFilteredCardIds(labelFilterState)).toEqual(['card-1', 'card-2']);
    expect(getListFilteredCardIds(labelFilterState)).toEqual(['card-1', 'card-2']);

    const ormState = reducer(
      labelFilterState,
      actions.addCreatorUserToBoardFilter('user-1', 'board-1'),
    );

    expect(getBoardFilteredCardIds(ormState)).toEqual(['card-1']);
    expect(getListFilteredCardIds(ormState)).toEqual(['card-1']);
  });

  test('combines with search', () => {
    const searchState = reducer(buildOrmState(), actions.searchInBoard('board-1', 'card'));
    expect(getBoardFilteredCardIds(searchState)).toEqual(['card-1', 'card-2', 'card-3', 'card-4']);
    expect(getListFilteredCardIds(searchState)).toEqual(['card-1', 'card-2', 'card-3', 'card-4']);

    const ormState = reducer(searchState, actions.addCreatorUserToBoardFilter('user-1', 'board-1'));

    expect(getBoardFilteredCardIds(ormState)).toEqual(['card-1', 'card-3']);
    expect(getListFilteredCardIds(ormState)).toEqual(['card-1', 'card-3']);
  });

  test('resets the pagination of the current list', () => {
    const ormState = reducer(
      buildOrmState(),
      actions.addCreatorUserToBoardFilter('user-1', 'board-1', false, 'list-1'),
    );

    expect(getListRef(ormState)).toMatchObject({
      lastCard: null,
      isCardsFetching: false,
      isAllCardsFetched: null,
    });

    const nextOrmState = reducer(
      reducer(buildOrmState(), actions.addCreatorUserToBoardFilter('user-1', 'board-1')),
      actions.removeCreatorUserFromBoardFilter('user-1', 'board-1', 'list-1'),
    );

    expect(getListRef(nextOrmState)).toMatchObject({
      lastCard: null,
      isCardsFetching: false,
      isAllCardsFetched: null,
    });
  });

  test('drops the user from the filter when the membership is deleted', () => {
    let ormState = reducer(
      buildOrmState(),
      actions.addCreatorUserToBoardFilter('user-2', 'board-1'),
    );
    expect(getFilterCreatorUserIds(ormState)).toEqual(['user-2']);

    ormState = reducer(ormState, actions.deleteBoardMembership('membership-2'));

    expect(getFilterCreatorUserIds(ormState)).toEqual([]);
  });

  test('deleteClearable empties the filter', () => {
    const ormState = reducer(
      buildOrmState(),
      actions.addCreatorUserToBoardFilter('user-1', 'board-1'),
    );

    const session = orm.mutableSession(ormState);
    session.Board.withId('board-1').deleteClearable();

    expect(getFilterCreatorUserIds(session.state)).toEqual([]);
  });

  test('selectFilterCreatorUserIdsForCurrentBoard returns the selected creators', () => {
    const ormState = reducer(
      buildOrmState(),
      actions.addCreatorUserToBoardFilter('user-1', 'board-1'),
    );

    const state = {
      auth: { userId: 'user-1' },
      router: {
        location: { pathname: Paths.BOARDS.replace(':id', 'board-1') },
      },
      orm: ormState,
    };

    expect(selectFilterCreatorUserIdsForCurrentBoard(state)).toEqual(['user-1']);
  });
});
