/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import { attr, fk } from 'redux-orm';

import BaseModel from './BaseModel';
import ActionTypes from '../constants/ActionTypes';

// One "card A is dependent on card B" link.
//
// A model of its own rather than a many-to-many on Card, because the link is
// directional and BOTH directions are drawn: a card shows what it waits for,
// and it also has to know whether anything waits for IT. Two foreign keys onto
// the same model give both sides a name — `dependencies` (the links where this
// card waits) and `dependents` (the links where it is waited for) — which a
// self-referencing many() cannot.
//
// The link may cross boards on purpose: a request on the User Requests board
// can wait for a card on the Sprint Board. So a dependency's OTHER card is not
// guaranteed to be loaded in the client at all, and everything that renders one
// has to cope with `Card.withId(...)` coming back null.
export default class extends BaseModel {
  static modelName = 'CardDependency';

  static fields = {
    id: attr(),
    cardId: fk({
      to: 'Card',
      as: 'card',
      relatedName: 'dependencies',
    }),
    dependsOnCardId: fk({
      to: 'Card',
      as: 'dependsOnCard',
      relatedName: 'dependents',
    }),
  };

  static reducer({ type, payload }, CardDependency) {
    switch (type) {
      case ActionTypes.LOCATION_CHANGE_HANDLE:
      case ActionTypes.CORE_INITIALIZE:
      case ActionTypes.USER_UPDATE_HANDLE:
      case ActionTypes.PROJECT_UPDATE_HANDLE:
      case ActionTypes.PROJECT_MANAGER_CREATE_HANDLE:
      case ActionTypes.BOARD_MEMBERSHIP_CREATE_HANDLE:
      case ActionTypes.LIST_UPDATE_HANDLE:
      case ActionTypes.BOARD_FETCH__SUCCESS:
      case ActionTypes.CARDS_FETCH__SUCCESS:
      case ActionTypes.CARD_CREATE_HANDLE:
      case ActionTypes.CARD_UPDATE_HANDLE:
      case ActionTypes.CARD_TRANSFER__SUCCESS:
      case ActionTypes.CARD_TRANSFER__FAILURE:
      case ActionTypes.CARD_DUPLICATE__SUCCESS:
        if (payload.cardDependencies) {
          payload.cardDependencies.forEach((cardDependency) => {
            CardDependency.upsert(cardDependency);
          });
        }

        break;
      case ActionTypes.SOCKET_RECONNECT_HANDLE:
        // A reconnect re-reads the world, so what is in the store is only what
        // the fresh payload says. Dropping the old rows first is what removes a
        // dependency somebody deleted while this client was offline.
        CardDependency.all().delete();

        if (payload.cardDependencies) {
          payload.cardDependencies.forEach((cardDependency) => {
            CardDependency.upsert(cardDependency);
          });
        }

        break;
      case ActionTypes.CARD_DEPENDENCY_CREATE__SUCCESS:
      case ActionTypes.CARD_DEPENDENCY_CREATE_HANDLE:
        CardDependency.upsert(payload.cardDependency);

        break;
      case ActionTypes.CARD_DEPENDENCY_DELETE__SUCCESS:
      case ActionTypes.CARD_DEPENDENCY_DELETE_HANDLE: {
        // Matched on the PAIR rather than on the row id. The id is the server's
        // and a client that added the link optimistically has never seen it;
        // the pair is what both sides always agree on.
        const cardDependencyModel = CardDependency.filter({
          cardId: payload.cardDependency.cardId,
          dependsOnCardId: payload.cardDependency.dependsOnCardId,
        }).first();

        if (cardDependencyModel) {
          cardDependencyModel.delete();
        }

        break;
      }
      default:
    }
  }
}
