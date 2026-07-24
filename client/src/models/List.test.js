import { createReducer } from 'redux-orm';

import orm from '../orm';
import actions from '../actions';
import { selectIsFilterActiveByListId } from '../selectors/lists';
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
    lastCard: {
      listChangedAt: '2026-01-01T00:00:00.000Z',
      id: 'card-1',
    },
    isCardsFetching: true,
    isAllCardsFetched: false,
  });

  session.User.create({ id: 'user-1' });
  session.Label.create({ id: 'label-1', boardId: 'board-1', position: 1 });

  session.Card.create({
    id: 'card-1',
    boardId: 'board-1',
    listId: 'list-1',
    position: 1,
    name: 'Card 1',
  });
  session.Card.create({
    id: 'card-2',
    boardId: 'board-1',
    listId: 'list-1',
    position: 2,
    name: 'Card 2',
  });

  session.Card.withId('card-1').users.add('user-1');
  session.Card.withId('card-1').labels.add('label-1');

  session.CustomField.create({
    id: 'custom-field-1',
    customFieldGroupId: 'custom-field-group-1',
    position: 1,
    name: 'Priority',
  });
  session.CustomFieldValue.create({
    id: 'custom-field-value-1',
    cardId: 'card-2',
    customFieldGroupId: 'custom-field-group-1',
    customFieldId: 'custom-field-1',
    content: 'High',
  });

  return session.state;
};

const getFilteredCardIds = (ormState) =>
  orm
    .session(ormState)
    .List.withId('list-1')
    .getFilteredCardsModelArray()
    .map((cardModel) => cardModel.id);

const getListRef = (ormState) => orm.session(ormState).List.withId('list-1').ref;

describe('List per-list filters', () => {
  test('user filter keeps only cards with the member and resets pagination', () => {
    const ormState = reducer(buildOrmState(), actions.addUserToListFilter('user-1', 'list-1'));

    expect(getFilteredCardIds(ormState)).toEqual(['card-1']);
    expect(getListRef(ormState)).toMatchObject({
      lastCard: null,
      isCardsFetching: false,
      isAllCardsFetched: null,
    });

    const nextOrmState = reducer(ormState, actions.removeUserFromListFilter('user-1', 'list-1'));
    expect(getFilteredCardIds(nextOrmState)).toEqual(['card-1', 'card-2']);
  });

  test('label filter keeps only cards with the label', () => {
    const ormState = reducer(buildOrmState(), actions.addLabelToListFilter('label-1', 'list-1'));

    expect(getFilteredCardIds(ormState)).toEqual(['card-1']);

    const nextOrmState = reducer(ormState, actions.removeLabelFromListFilter('label-1', 'list-1'));
    expect(getFilteredCardIds(nextOrmState)).toEqual(['card-1', 'card-2']);
  });

  test('custom field filter matches field name case-insensitively', () => {
    const ormState = reducer(
      buildOrmState(),
      actions.updateCustomFieldFilterInList('list-1', [{ name: 'priority', content: '' }]),
    );

    expect(getFilteredCardIds(ormState)).toEqual(['card-2']);
    expect(getListRef(ormState)).toMatchObject({
      lastCard: null,
      isCardsFetching: false,
      isAllCardsFetched: null,
    });
  });

  test('custom field filter matches content substring case-insensitively', () => {
    const matchingState = reducer(
      buildOrmState(),
      actions.updateCustomFieldFilterInList('list-1', [{ name: 'Priority', content: 'hig' }]),
    );
    expect(getFilteredCardIds(matchingState)).toEqual(['card-2']);

    const nonMatchingState = reducer(
      buildOrmState(),
      actions.updateCustomFieldFilterInList('list-1', [{ name: 'Priority', content: 'low' }]),
    );
    expect(getFilteredCardIds(nonMatchingState)).toEqual([]);
  });

  test('clearListFilter empties all filter sources', () => {
    let ormState = buildOrmState();
    ormState = reducer(ormState, actions.addUserToListFilter('user-1', 'list-1'));
    ormState = reducer(ormState, actions.addLabelToListFilter('label-1', 'list-1'));
    ormState = reducer(
      ormState,
      actions.updateCustomFieldFilterInList('list-1', [{ name: 'Priority', content: '' }]),
    );

    expect(selectIsFilterActiveByListId({ orm: ormState }, 'list-1')).toBe(true);

    ormState = reducer(ormState, actions.clearListFilter('list-1'));

    expect(getFilteredCardIds(ormState)).toEqual(['card-1', 'card-2']);
    expect(selectIsFilterActiveByListId({ orm: ormState }, 'list-1')).toBe(false);
    expect(getListRef(ormState).filterCustomFields).toEqual([]);
  });
});
