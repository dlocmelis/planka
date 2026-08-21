/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

// A dependency graph with a cycle in it can never be satisfied: every card in
// the cycle waits for another card in the same cycle, so none of them is ever
// unblocked. Refusing the edge that would close a cycle is the only moment the
// graph can be kept acyclic, so the walk happens here rather than being left
// for the automation to trip over later.
//
// The walk is breadth-first over "what does this card wait for", starting at
// the proposed blocker: if the dependent card is reachable from it, the new
// edge closes a loop. Boards are deliberately not a boundary — a dependency may
// cross boards, and so may a cycle.
//
// This is the FAST path and the one that produces a sentence a person can read.
// It is not the whole guard: it reads and then writes, so two requests can each
// walk a graph with no loop in it and then both insert, and the row-level
// trigger added in db/migrations/20260821180000_add_card_dependency_cycle_guard
// is what catches that. See the migration for why the rule lives in two places.

// The walk visits a card at most once, so it is already bounded by the number
// of cards that have dependencies at all — but "all of them" is not a bound
// anyone should have to discover from a slow request. Past this many the answer
// is refused rather than guessed: a cycle cannot be cleared from the UI, so on
// a graph this walk cannot finish cheaply the safe direction is to say no.
const MAX_WALKED_CARDS = 5000;

// Must match the tag the trigger raises (see the migration named above).
const CYCLE_GUARD_TAG = 'card_dependency_cycle';

const wouldCreateCycle = async (cardId, dependsOnCardId) => {
  const seen = new Set([dependsOnCardId]);
  let frontier = [dependsOnCardId];

  while (frontier.length > 0) {
    if (frontier.includes(cardId)) {
      return true;
    }

    if (seen.size > MAX_WALKED_CARDS) {
      sails.log.warn(
        `Dependency cycle check gave up after ${seen.size} cards (card ${cardId} -> ${dependsOnCardId}); refusing the link`,
      );

      return true;
    }

    // eslint-disable-next-line no-await-in-loop
    const cardDependencies = await CardDependency.qm.getByCardIds(frontier);

    frontier = cardDependencies
      .map((cardDependency) => cardDependency.dependsOnCardId)
      .filter((nextCardId) => {
        if (seen.has(nextCardId)) {
          return false;
        }

        seen.add(nextCardId);
        return true;
      });
  }

  return false;
};

// The trigger's refusal, recognised wherever the adapter chose to put it. The
// alternative to matching it is a 500 on a request the server refused on
// purpose, which the client renders as "something went wrong" instead of "that
// would create a loop".
const isCycleGuardViolation = (error) => {
  const texts = [
    error && error.message,
    error && error.raw && error.raw.message,
    error && error.cause && error.cause.message,
  ];

  return texts.some((text) => typeof text === 'string' && text.includes(CYCLE_GUARD_TAG));
};

module.exports = {
  inputs: {
    values: {
      type: 'ref',
      required: true,
    },
    project: {
      type: 'ref',
      required: true,
    },
    board: {
      type: 'ref',
      required: true,
    },
    list: {
      type: 'ref',
      required: true,
    },
    dependsOnBoard: {
      type: 'ref',
      required: true,
    },
    actorUser: {
      type: 'ref',
      required: true,
    },
    request: {
      type: 'ref',
    },
  },

  exits: {
    dependencyAlreadyInCard: {},
    cardDependsOnItself: {},
    dependencyWouldCreateCycle: {},
  },

  async fn(inputs) {
    const { values } = inputs;

    if (values.card.id === values.dependsOnCard.id) {
      throw 'cardDependsOnItself';
    }

    // Asked first rather than left to the unique index below, because the two
    // do not answer in the same places: the index lives in the migration and
    // the test datastore (sails-disk) has none, so a re-add would quietly
    // become a second row there and a duplicate "Dependent on" line on the
    // card. The E_UNIQUE catch stays as the race-safe backstop.
    const existing = await CardDependency.qm.getOneByCardIdAndDependsOnCardId(
      values.card.id,
      values.dependsOnCard.id,
    );

    if (existing) {
      throw 'dependencyAlreadyInCard';
    }

    if (await wouldCreateCycle(values.card.id, values.dependsOnCard.id)) {
      throw 'dependencyWouldCreateCycle';
    }

    let cardDependency;
    try {
      cardDependency = await CardDependency.qm.createOne({
        cardId: values.card.id,
        dependsOnCardId: values.dependsOnCard.id,
      });
    } catch (error) {
      if (error.code === 'E_UNIQUE') {
        throw 'dependencyAlreadyInCard';
      }

      // The row-level guard refused it: another request closed the loop while
      // this one was walking. Same answer as the walk above would have given,
      // one moment later.
      if (isCycleGuardViolation(error)) {
        throw 'dependencyWouldCreateCycle';
      }

      throw error;
    }

    // BOTH boards hear about it, because a dependency is one fact about two
    // cards. A client watching only the blocker's board still has to redraw it
    // — it has just become something another card is waiting for — and until
    // the two rooms are the same room, telling only one of them leaves the
    // other showing a card with no dependents on it until the next full fetch.
    const boardIds = _.uniq([inputs.board.id, inputs.dependsOnBoard.id]);

    boardIds.forEach((boardId) => {
      sails.sockets.broadcast(
        `board:${boardId}`,
        'cardDependencyCreate',
        {
          item: cardDependency,
        },
        inputs.request,
      );
    });

    const webhooks = await Webhook.qm.getAll();

    sails.helpers.utils.sendWebhooks.with({
      webhooks,
      event: Webhook.Events.CARD_DEPENDENCY_CREATE,
      buildData: () => ({
        item: cardDependency,
        included: {
          projects: [inputs.project],
          boards: [inputs.board],
          lists: [inputs.list],
          cards: [values.card, values.dependsOnCard],
        },
      }),
      user: inputs.actorUser,
    });

    return cardDependency;
  },
};
