/*!
 * Copyright (c) 2026 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

// The board-flow half of the Pipeline strip's Statistics tab
// (client/src/components/boards/PipelineStrip/StatisticsTab.jsx): how many
// cards entered the board, were completed, deployed and reopened, and how the
// user-testing column decided — over the last 24 hours, 7 days and 30 days,
// each beside the period of the same length before it.
//
// It is read from this board's own `action` table, which holds every card
// creation and move since the board went live (21 July 2026 on setlfi-build),
// so a 30-day comparison works from the first day. The orchestrator's own
// column history only starts on 18 September.
//
// A move is read by the NAMES of its columns, exactly as the orchestrator
// reads the board (devteam-orchestrator, internal/fsm/fsm.go): these are its
// column names, and a board that does not use them simply counts zero. The
// names are compared trimmed and case-insensitively, as the orchestrator's
// equalList does.

const DAY_SECONDS = 24 * 60 * 60;

const PERIODS = [
  { key: '24h', seconds: DAY_SECONDS },
  { key: '7d', seconds: 7 * DAY_SECONDS },
  { key: '30d', seconds: 30 * DAY_SECONDS },
];

// How far back a read must go: the longest period and the one before it.
const REACH_SECONDS = 2 * PERIODS[PERIODS.length - 1].seconds;

const normalize = (name) => (name || '').trim().toLowerCase();
const nameSet = (names) => new Set(names.map(normalize));

const Lists = {
  IN_DEPLOYMENT: 'In Deployment',
  DEPLOYMENT_DONE: 'Deployment Done',
  READY_FOR_TESTING: 'Ready for Testing',
  REOPENED: 'Reopened',
};

// Done on the Sprint Board, "Tested by User" on the User Requests board
// (fsm.DoneColumn).
const DONE_LISTS = nameSet(['Done', 'Tested by User']);

// A deploy lands a card in Deployment Done, or takes it from In Deployment
// straight to user testing or done.
const PAST_DEPLOYMENT_LISTS = nameSet([Lists.READY_FOR_TESTING, 'Done', 'Tested by User']);

// Where a card sent back from user testing goes: reopened, or back to the
// development line.
const REJECTED_TO_LISTS = nameSet([
  Lists.REOPENED,
  'Backlog',
  'Voting',
  'Ready for Tech Design',
  'In Tech Design',
  'Ready for Development',
  'In Development',
]);

// The orchestrator's service columns on the Sprint Board: a card created there
// is a thread, a chat or a work item, not a ticket entering the board.
const SERVICE_LISTS = nameSet(['Threads', 'Chat', 'Item Queue']);

const ACTIVE_LIST_TYPES = new Set(['active', 'closed', undefined, null, '']);

const is = (list, name) => normalize(list && list.name) === normalize(name);
const isIn = (list, names) => names.has(normalize(list && list.name));
// An archive or trash list has no name; moving a card there is putting it
// away, not moving it along the board.
const isActive = (list) => !!list && ACTIVE_LIST_TYPES.has(list.type) && !!normalize(list.name);

const timeOf = (value) => {
  const at = value instanceof Date ? value.getTime() : Date.parse(value);

  return Number.isNaN(at) ? null : at;
};

// What one action says about the board's flow, as the facts it counts.
const classify = (action) => {
  const data = action.data || {};

  if (action.type === 'createCard') {
    const { list } = data;

    return {
      entered: !!list && isActive(list) && !isIn(list, SERVICE_LISTS),
    };
  }

  if (action.type !== 'moveCard') {
    return {};
  }

  const { fromList, toList } = data;
  const fromTesting = is(fromList, Lists.READY_FOR_TESTING);

  return {
    completed: isIn(toList, DONE_LISTS),
    deployed:
      is(toList, Lists.DEPLOYMENT_DONE) ||
      (is(fromList, Lists.IN_DEPLOYMENT) && isIn(toList, PAST_DEPLOYMENT_LISTS)),
    reopened:
      is(toList, Lists.REOPENED) ||
      (isIn(fromList, DONE_LISTS) && isActive(toList) && !isIn(toList, DONE_LISTS)),
    testingSent: is(toList, Lists.READY_FOR_TESTING) && !fromTesting,
    testingAccepted: fromTesting && isIn(toList, DONE_LISTS),
    testingRejected: fromTesting && isIn(toList, REJECTED_TO_LISTS),
  };
};

const median = (values) => {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// Everything counted in [fromMs, toMs).
//
// Cards entered, completed, deployed and reopened are DISTINCT cards: a card
// bounced twice between two columns in a day is one card completed, not two.
// User testing counts DECISIONS: a card sent to testing twice and rejected
// once before being accepted is two sends, one rejection and one acceptance,
// which is what an acceptance rate is about.
const windowOf = (facts, createdAtByCardId, fromMs, toMs) => {
  const cards = {
    entered: new Set(),
    completed: new Set(),
    deployed: new Set(),
    reopened: new Set(),
  };
  const testing = { testingSent: 0, testingAccepted: 0, testingRejected: 0 };
  // The first completion of each card in the window, for the time to done.
  const firstDoneAt = new Map();

  facts.forEach(({ at, cardId, fact }) => {
    if (at < fromMs || at >= toMs) {
      return;
    }

    Object.keys(cards).forEach((key) => {
      if (fact[key]) {
        cards[key].add(cardId);
      }
    });

    Object.keys(testing).forEach((key) => {
      if (fact[key]) {
        testing[key] += 1;
      }
    });

    if (fact.completed && !firstDoneAt.has(cardId)) {
      firstDoneAt.set(cardId, at);
    }
  });

  const toDone = [];

  firstDoneAt.forEach((doneAt, cardId) => {
    const createdAt = createdAtByCardId.get(cardId);

    if (createdAt !== undefined && createdAt <= doneAt) {
      toDone.push((doneAt - createdAt) / 1000);
    }
  });

  const decided = testing.testingAccepted + testing.testingRejected;
  const medianToDone = median(toDone);

  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    entered: cards.entered.size,
    completed: cards.completed.size,
    deployed: cards.deployed.size,
    reopened: cards.reopened.size,
    ...testing,
    // null rather than 0 when nothing was decided: "no decisions" is not
    // "everything rejected".
    acceptanceRate: decided === 0 ? null : testing.testingAccepted / decided,
    medianSecondsToDone: medianToDone === null ? null : Math.round(medianToDone),
    // How many completed cards the median is over: a card created before the
    // board's history began has no known start and is left out.
    timedToDone: toDone.length,
  };
};

// The card ids whose creation time the median needs and `actions` lacks.
const missingCreations = (actions) => {
  const created = new Set();
  const completed = new Set();

  actions.forEach((action) => {
    const cardId = String(action.cardId);

    if (action.type === 'createCard') {
      created.add(cardId);
    } else if (classify(action).completed) {
      completed.add(cardId);
    }
  });

  return [...completed].filter((cardId) => !created.has(cardId));
};

// actions: this board's createCard and moveCard actions since
// now - REACH_SECONDS, any order. creations: older createCard actions of the
// cards completed in that time (missingCreations). since: the board's oldest
// action, when its history begins.
const compute = ({ actions, creations = [], now, since = null }) => {
  const nowMs = timeOf(now);
  const createdAtByCardId = new Map();

  [...creations, ...actions].forEach((action) => {
    if (action.type !== 'createCard') {
      return;
    }

    const at = timeOf(action.createdAt);
    const cardId = String(action.cardId);

    if (at !== null && (!createdAtByCardId.has(cardId) || at < createdAtByCardId.get(cardId))) {
      createdAtByCardId.set(cardId, at);
    }
  });

  const facts = actions
    .map((action) => ({
      at: timeOf(action.createdAt),
      cardId: String(action.cardId),
      fact: classify(action),
    }))
    .filter(({ at }) => at !== null)
    .sort((a, b) => a.at - b.at);

  const sinceMs = since ? timeOf(since) : null;

  return {
    now: new Date(nowMs).toISOString(),
    since: sinceMs === null ? null : new Date(sinceMs).toISOString(),
    periods: PERIODS.map(({ key, seconds }) => {
      const span = seconds * 1000;

      return {
        key,
        seconds,
        current: windowOf(facts, createdAtByCardId, nowMs - span, nowMs),
        previous: windowOf(facts, createdAtByCardId, nowMs - 2 * span, nowMs - span),
      };
    }),
  };
};

module.exports = {
  PERIODS,
  REACH_SECONDS,
  classify,
  compute,
  missingCreations,
};
