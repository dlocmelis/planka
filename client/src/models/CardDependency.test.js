import { createReducer } from 'redux-orm';

import orm from '../orm';
import actions from '../actions';
import { selectDependenciesByCardId, selectDependentsByCardId } from '../selectors/cards';
import { ListTypes } from '../constants/Enums';

const reducer = createReducer(orm);

const buildOrmState = () => {
  const session = orm.session(orm.getEmptyState());

  session.Board.create({ id: 'board-1', search: '' });

  session.List.create({
    id: 'list-active',
    boardId: 'board-1',
    type: ListTypes.ACTIVE,
    position: 1,
    name: 'Ready for Development',
  });
  session.List.create({
    id: 'list-done',
    boardId: 'board-1',
    type: ListTypes.CLOSED,
    position: 2,
    name: 'Done',
  });

  session.Card.create({
    id: 'card-a',
    boardId: 'board-1',
    listId: 'list-active',
    position: 1,
    name: 'Card A',
  });
  session.Card.create({
    id: 'card-b',
    boardId: 'board-1',
    listId: 'list-done',
    position: 2,
    name: 'Card B',
  });

  return session.state;
};

// The by-id selectors are what the "current card" ones are built from, and they
// need nothing but the ORM slice — the current-card pair adds only the router
// path lookup on top.
const dependenciesOf = (ormState, cardId) => selectDependenciesByCardId({ orm: ormState }, cardId);
const dependentsOf = (ormState, cardId) => selectDependentsByCardId({ orm: ormState }, cardId);

const dependency = (cardId, dependsOnCardId) => ({
  id: `dep-${cardId}-${dependsOnCardId}`,
  cardId,
  dependsOnCardId,
});

describe('CardDependency', () => {
  test('a created dependency is readable from both ends', () => {
    const ormState = reducer(
      buildOrmState(),
      actions.createCardDependency.success(dependency('card-a', 'card-b')),
    );

    const dependencies = dependenciesOf(ormState, 'card-a');
    expect(dependencies).toHaveLength(1);
    expect(dependencies[0].card.name).toBe('Card B');
    expect(dependencies[0].listName).toBe('Done');

    const dependents = dependentsOf(ormState, 'card-b');
    expect(dependents).toHaveLength(1);
    expect(dependents[0].card.name).toBe('Card A');
  });

  test('a blocker in a closed list reads as done, one in an active list does not', () => {
    let ormState = reducer(
      buildOrmState(),
      actions.createCardDependency.success(dependency('card-a', 'card-b')),
    );
    expect(dependenciesOf(ormState, 'card-a')[0].isDone).toBe(true);

    ormState = reducer(
      buildOrmState(),
      actions.createCardDependency.success(dependency('card-b', 'card-a')),
    );
    expect(dependenciesOf(ormState, 'card-b')[0].isDone).toBe(false);
  });

  test('a dependency on a card this client has not loaded renders without a name', () => {
    const ormState = reducer(
      buildOrmState(),
      actions.handleCardDependencyCreate(dependency('card-a', 'card-on-another-board')),
    );

    const dependencies = dependenciesOf(ormState, 'card-a');
    expect(dependencies).toHaveLength(1);
    expect(dependencies[0].card).toBeNull();
    expect(dependencies[0].listName).toBeNull();
    expect(dependencies[0].isDone).toBe(false);
  });

  test('a deleted dependency is matched on the pair, not on the row id', () => {
    let ormState = reducer(
      buildOrmState(),
      actions.createCardDependency.success(dependency('card-a', 'card-b')),
    );

    ormState = reducer(
      ormState,
      actions.handleCardDependencyDelete({
        id: 'a-row-id-this-client-never-saw',
        cardId: 'card-a',
        dependsOnCardId: 'card-b',
      }),
    );

    expect(dependenciesOf(ormState, 'card-a')).toHaveLength(0);
    expect(dependentsOf(ormState, 'card-b')).toHaveLength(0);
  });

  test('deleting a card takes both directions of its dependencies with it', () => {
    let ormState = reducer(
      buildOrmState(),
      actions.createCardDependency.success(dependency('card-a', 'card-b')),
    );
    ormState = reducer(
      ormState,
      actions.createCardDependency.success(dependency('card-b', 'card-c')),
    );

    ormState = reducer(ormState, actions.handleCardDelete({ id: 'card-b' }));

    const session = orm.session(ormState);
    expect(session.CardDependency.all().toRefArray()).toHaveLength(0);
  });
});
