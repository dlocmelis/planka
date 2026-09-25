/**
 * @jest-environment jsdom
 */

/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { createStore } from 'redux';

import { CardDragContext } from '../../../contexts';
import DraggableCard from './DraggableCard';

let mockSelectedCardIds;

const mockBoardMembership = { role: 'editor' };

jest.mock('react-beautiful-dnd', () => ({
  Draggable: (props) =>
    props.children({
      innerRef: () => {},
      draggableProps: {},
      dragHandleProps: {},
    }),
}));

jest.mock('../../../selectors', () => ({
  __esModule: true,
  default: {
    makeSelectCardById: () => {
      const cards = {};

      return (_, id) => {
        cards[id] = cards[id] || { id, isPersisted: true };
        return cards[id];
      };
    },
    makeSelectIsCardSelected: () => (_, id) => mockSelectedCardIds.includes(id),
    selectCurrentUserMembershipForCurrentBoard: () => mockBoardMembership,
  },
}));

jest.mock('../Card', () => () => null);

let container;
let root;

window.IS_REACT_ACT_ENVIRONMENT = true;

const store = createStore((state = {}) => state);

// Renders the cards of one list under the given drag context and reads back, per card,
// its wrapper classes (the style mock maps each class to its own name) and its badge text
const renderCards = (cardIds, cardDrag) => {
  act(() => {
    root.render(
      <Provider store={store}>
        <CardDragContext.Provider value={cardDrag}>
          {cardIds.map((id, index) => (
            <DraggableCard key={id} id={id} index={index} />
          ))}
        </CardDragContext.Provider>
      </Provider>,
    );
  });

  return Array.from(container.children).map((node, index) => ({
    id: cardIds[index],
    isFaded: node.classList.contains('wrapperFaded'),
    badge: node.querySelector('.groupBadge')?.textContent ?? null,
  }));
};

beforeEach(() => {
  mockSelectedCardIds = [];

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

test('the dragged card shows the count and the other selected cards fade', () => {
  mockSelectedCardIds = ['card-1', 'card-2', 'card-4'];

  expect(
    renderCards(['card-1', 'card-2', 'card-3', 'card-4'], {
      draggingCardId: 'card-2',
      groupSize: 3,
    }),
  ).toEqual([
    { id: 'card-1', isFaded: true, badge: null },
    { id: 'card-2', isFaded: false, badge: '3' },
    { id: 'card-3', isFaded: false, badge: null },
    { id: 'card-4', isFaded: true, badge: null },
  ]);
});

test('no badge and no fade while a card that carries no group is dragged', () => {
  mockSelectedCardIds = ['card-1', 'card-2'];

  expect(
    renderCards(['card-1', 'card-2', 'card-3'], { draggingCardId: 'card-3', groupSize: 0 }),
  ).toEqual([
    { id: 'card-1', isFaded: false, badge: null },
    { id: 'card-2', isFaded: false, badge: null },
    { id: 'card-3', isFaded: false, badge: null },
  ]);
});

test('no badge and no fade when nothing is being dragged', () => {
  mockSelectedCardIds = ['card-1', 'card-2'];

  expect(renderCards(['card-1', 'card-2'], { draggingCardId: null, groupSize: 0 })).toEqual([
    { id: 'card-1', isFaded: false, badge: null },
    { id: 'card-2', isFaded: false, badge: null },
  ]);
});
