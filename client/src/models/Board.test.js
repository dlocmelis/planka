import { createReducer } from 'redux-orm';

import orm from '../orm';
import actions from '../actions';
import { ListTypes } from '../constants/Enums';

const reducer = createReducer(orm);

const buildOrmState = () => {
  const session = orm.session(orm.getEmptyState());

  session.Board.create({
    id: 'board-1',
    search: '',
  });

  session.List.create({
    id: 'list-1',
    boardId: 'board-1',
    type: ListTypes.ACTIVE,
    position: 1,
  });

  session.User.create({ id: 'user-1' });
  session.User.create({ id: 'user-2' });

  session.Card.create({
    id: 'card-1',
    boardId: 'board-1',
    listId: 'list-1',
    position: 1,
    name: 'Card 1',
    creatorUserId: 'user-1',
  });
  session.Card.create({
    id: 'card-2',
    boardId: 'board-1',
    listId: 'list-1',
    position: 2,
    name: 'Card 2',
    creatorUserId: 'user-2',
  });
  session.Card.create({
    id: 'card-3',
    boardId: 'board-1',
    listId: 'list-1',
    position: 3,
    name: 'Card 3',
  });

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

describe('Board creator filter', () => {
  test('keeps only the cards created by the filtered users', () => {
    const ormState = reducer(
      buildOrmState(),
      actions.addCreatorUserToBoardFilter('user-1', 'board-1'),
    );

    expect(getBoardFilteredCardIds(ormState)).toEqual(['card-1']);
    expect(getListFilteredCardIds(ormState)).toEqual(['card-1']);
  });

  test('accumulates several creators and drops cards without a creator', () => {
    let ormState = reducer(
      buildOrmState(),
      actions.addCreatorUserToBoardFilter('user-1', 'board-1'),
    );
    ormState = reducer(ormState, actions.addCreatorUserToBoardFilter('user-2', 'board-1'));

    expect(getBoardFilteredCardIds(ormState)).toEqual(['card-1', 'card-2']);
  });

  test('restores every card once the last creator is removed', () => {
    let ormState = reducer(
      buildOrmState(),
      actions.addCreatorUserToBoardFilter('user-1', 'board-1'),
    );
    ormState = reducer(ormState, actions.removeCreatorUserFromBoardFilter('user-1', 'board-1'));

    expect(getBoardFilteredCardIds(ormState)).toEqual(['card-1', 'card-2', 'card-3']);
    expect(getListFilteredCardIds(ormState)).toEqual(['card-1', 'card-2', 'card-3']);
  });
});
