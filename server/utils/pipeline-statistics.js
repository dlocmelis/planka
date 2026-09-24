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
//
// A viewer may narrow the figures to some of the board's cards — by label,
// keyword, creator, time to done and cost — and swap the three periods for
// one of their own (parseFilters, matchCards below). Only the input changes:
// the rules that count it are the ones above.

const DAY_SECONDS = 24 * 60 * 60;

const PERIODS = [
  { key: '24h', seconds: DAY_SECONDS },
  { key: '7d', seconds: 7 * DAY_SECONDS },
  { key: '30d', seconds: 30 * DAY_SECONDS },
];

// The key of the one period a read over a custom from - to has.
const CUSTOM_PERIOD_KEY = 'custom';

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

// The periods a read counts: 24h, 7d and 30d back from now, or the one custom
// period [from, to) a viewer picked, beside the period of the same length just
// before it.
const periodsOf = (nowMs, range) => {
  if (range) {
    const seconds = (range.toMs - range.fromMs) / 1000;

    return [{ key: CUSTOM_PERIOD_KEY, seconds, endMs: range.toMs }];
  }

  return PERIODS.map(({ key, seconds }) => ({ key, seconds, endMs: nowMs }));
};

// When a read must start and end: two of its longest period back from its end.
const reachOf = (now, range = null) => {
  if (range) {
    return {
      from: new Date(2 * range.fromMs - range.toMs),
      to: new Date(range.toMs),
    };
  }

  return {
    from: new Date(timeOf(now) - REACH_SECONDS * 1000),
    to: null,
  };
};

// actions: this board's createCard and moveCard actions over the read's reach
// (reachOf), any order. creations: older createCard actions of the cards
// completed in that time (missingCreations). since: the board's oldest
// action, when its history begins. range: a custom period ({ fromMs, toMs },
// parseFilters) in place of 24h, 7d and 30d. cardIds: when set, only actions
// on these cards count (matchCards) — the counting rules themselves are the
// same either way.
const compute = ({ actions, creations = [], now, since = null, range = null, cardIds = null }) => {
  const nowMs = timeOf(now);
  const createdAtByCardId = new Map();
  const counted = (action) => !cardIds || cardIds.has(String(action.cardId));

  [...creations, ...actions].filter(counted).forEach((action) => {
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
    .filter(counted)
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
    periods: periodsOf(nowMs, range).map(({ key, seconds, endMs }) => {
      const span = seconds * 1000;

      return {
        key,
        seconds,
        current: windowOf(facts, createdAtByCardId, endMs - span, endMs),
        previous: windowOf(facts, createdAtByCardId, endMs - 2 * span, endMs - span),
      };
    }),
  };
};

// ─── Filters ────────────────────────────────────────────────────────────────
//
// A viewer may narrow Board flow to some of the board's cards. The filters
// only choose WHICH cards' actions compute() counts; how it counts them is
// the same as without them. Different filters combine with AND; the values of
// one filter (labels, creators) combine with OR, as Planka's own board filter
// does.

// The per-card field the orchestrator writes a card's spend into
// (devteam-orchestrator, internal/board/board.go FieldEstCost), as text such
// as "$1.97" — or "unpriced", which is no cost at all.
const COST_FIELD_NAME = 'Est. Cost (USD)';

const MAX_RANGE_SECONDS = 366 * DAY_SECONDS;
const MAX_SEARCH_LENGTH = 256;
const MAX_LIST_LENGTH = 100;

const ID_REGEX = /^[0-9]+$/;
const NUMBER_REGEX = /^\d+(\.\d+)?$/;
// An ISO 8601 instant with its zone, as Date#toISOString writes it: a bare
// date or a local time would be read in the SERVER's zone, not the viewer's.
const INSTANT_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const listOf = (value) =>
  (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

class FilterError extends Error {}

// The query of GET /api/boards/:id/pipeline-statistics, read into the filters
// and the custom period. Every parameter is optional and a blank one is
// unset; one that is set but not understood throws FilterError, so a typo is
// a 400 rather than a quietly unfiltered answer.
const parseFilters = (query = {}) => {
  const filters = {};
  const text = (name) => {
    const value = query[name];

    if (value === undefined || value === null) {
      return '';
    }

    if (typeof value !== 'string') {
      throw new FilterError(`${name} must be a string`);
    }

    return value.trim();
  };

  const labelIds = listOf(text('labelIds'));

  if (labelIds.length > 0) {
    if (labelIds.length > MAX_LIST_LENGTH || !labelIds.every((id) => ID_REGEX.test(id))) {
      throw new FilterError('labelIds must be a comma-separated list of label ids');
    }

    filters.labelIds = labelIds;
  }

  const search = text('search');

  if (search) {
    if (search.length > MAX_SEARCH_LENGTH) {
      throw new FilterError(`search must be at most ${MAX_SEARCH_LENGTH} characters`);
    }

    filters.search = search.toLowerCase();
  }

  const creators = listOf(text('creators'));

  if (creators.length > 0) {
    if (creators.length > MAX_LIST_LENGTH) {
      throw new FilterError(`creators must list at most ${MAX_LIST_LENGTH} creators`);
    }

    filters.creators = creators.map((key) => key.toLowerCase());
  }

  const bounds = (minName, maxName, key) => {
    const [min, max] = [minName, maxName].map((name) => {
      const value = text(name);

      if (!value) {
        return null;
      }

      if (!NUMBER_REGEX.test(value)) {
        throw new FilterError(`${name} must be a number of at least 0`);
      }

      return Number(value);
    });

    if (min !== null && max !== null && min > max) {
      throw new FilterError(`${minName} must not be above ${maxName}`);
    }

    if (min !== null || max !== null) {
      filters[key] = { min, max };
    }
  };

  bounds('durationMin', 'durationMax', 'duration');
  bounds('costMin', 'costMax', 'cost');

  const [from, to] = ['from', 'to'].map(text);
  let range = null;

  if (from || to) {
    if (!from || !to) {
      throw new FilterError('from and to must be given together');
    }

    const [fromMs, toMs] = [from, to].map((value) =>
      INSTANT_REGEX.test(value) ? Date.parse(value) : NaN,
    );

    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
      throw new FilterError('from and to must be ISO 8601 instants');
    }

    if (fromMs >= toMs) {
      throw new FilterError('from must be before to');
    }

    if (toMs - fromMs > MAX_RANGE_SECONDS * 1000) {
      throw new FilterError(
        `the period from - to must be at most ${MAX_RANGE_SECONDS / DAY_SECONDS} days`,
      );
    }

    range = { fromMs, toMs };
  }

  return { filters, range };
};

// Whether any filter narrows the cards (the custom period alone does not).
const hasCardFilter = (filters) => Object.keys(filters || {}).length > 0;

// The ticket's reporter, from the header the setl support feature writes at
// the top of a card's description (setl, data/core/support/planka.go
// CardHeader):
//
//     **Setlfi ticket**
//
//     Reporter: Deniss Locmelis den@setlfi.com
//     ...
//
//     ---
//
// These are the rules of client/src/utils/setlfi-reporter.js
// (parseReporterFromCardDescription), transcribed because the client's module
// is not loadable here: the header must OPEN the description (either opener),
// and the reporter line counts only above its closing rule, so a
// "Reporter: ..." typed into the body — or into a spec pasted on a card —
// names nobody. Returns { name, email } or null.
const REPORTER_HEADER_OPENERS = ['**Setlfi ticket**', '--- Setlfi ---'];
const REPORTER_LINE_PREFIX = 'Reporter:';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isHeaderRule = (trimmed) => trimmed.length >= 3 && trimmed.replace(/-/g, '') === '';

const parseReporter = (description) => {
  if (typeof description !== 'string') {
    return null;
  }

  const trimmed = description.replace(/^\s+/, '');

  if (!REPORTER_HEADER_OPENERS.some((opener) => trimmed.startsWith(opener))) {
    return null;
  }

  const lines = trimmed.split('\n');

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].trim();

    if (isHeaderRule(line)) {
      return null;
    }

    if (line.startsWith(REPORTER_LINE_PREFIX)) {
      // A Markdown editor may have turned the address into a mailto link:
      // `[a@b.c](mailto:a@b.c)` reads as `a@b.c`, `<a@b.c>` likewise.
      const rest = line
        .slice(REPORTER_LINE_PREFIX.length)
        .replace(/\[([^\]]*)\]\(mailto:[^)]*\)/g, '$1')
        .replace(/<([^>\s]+@[^>\s]+)>/g, '$1')
        .trim();

      if (!rest) {
        return null;
      }

      const parts = rest.split(/\s+/);
      const last = parts[parts.length - 1];
      const email = EMAIL_REGEX.test(last) ? last : '';
      const name = (email ? parts.slice(0, -1).join(' ') : rest).trim();

      return { name: name || email, email };
    }
  }

  return null;
};

// Who a card is by: its reporter when the description names one, otherwise
// the Planka user who created it. People are keyed by their address,
// lowercased, so the same address under several names — "Deniss Locmelis",
// "Den Loc" — is one person, and a reporter who is also the Planka user who
// created other cards is that one person too. A reporter with no address is
// keyed by name; a user with none by id. null when nobody is known (the
// creating user was deleted). reporter is parseReporter's answer for the
// card, when the caller has it already.
const creatorOf = (card, user, reporter = parseReporter(card.description)) => {
  if (reporter) {
    return reporter.email
      ? { key: reporter.email.toLowerCase(), name: reporter.name }
      : { key: `name:${reporter.name.toLowerCase()}`, name: reporter.name };
  }

  if (!user) {
    return null;
  }

  const name = user.name || user.username || user.email || String(user.id);

  return user.email ? { key: user.email.toLowerCase(), name } : { key: `user:${user.id}`, name };
};

// A version of a card that moves whenever the card is written: its
// updatedAt (Card's beforeUpdate stamps it on every Card.update and
// Card.updateOne), else its createdAt.
const versionOf = (card) => {
  const at = card.updatedAt || card.createdAt;

  if (at instanceof Date) {
    return at.toISOString();
  }

  return at ? String(at) : '';
};

// Remembers the Reporter header of each board's cards (parseReporter), so the
// Statistics tab's once-a-minute answer need not read every card's whole
// description to list the board's creators: a card's header is read again
// only when its version (versionOf) has moved. `maxBoards` boards are kept,
// the one asked about longest ago dropped first.
//
// reportersOf(boardId, cards, readDescriptions) answers a Map of card id to
// its reporter (or null). `cards` carry id, createdAt and updatedAt, and a
// card that also carries its description is parsed from it;
// readDescriptions(ids) is asked for the cards whose header is not known at
// their version, and answers them with id, description, createdAt, updatedAt.
const createReporterCache = ({ maxBoards }) => {
  const byBoardId = new Map();

  const reportersOf = async (boardId, cards, readDescriptions) => {
    const known = byBoardId.get(boardId) || new Map();
    const entries = new Map();
    const unread = [];

    cards.forEach((card) => {
      const id = String(card.id);
      const version = versionOf(card);
      const entry = known.get(id);

      if (card.description !== undefined) {
        entries.set(id, { version, reporter: parseReporter(card.description) });
      } else if (entry && entry.version === version) {
        entries.set(id, entry);
      } else {
        unread.push(card.id);
      }
    });

    if (unread.length > 0) {
      (await readDescriptions(unread)).forEach((card) => {
        entries.set(String(card.id), {
          version: versionOf(card),
          reporter: parseReporter(card.description),
        });
      });
    }

    byBoardId.delete(boardId);
    byBoardId.set(boardId, entries);

    if (byBoardId.size > maxBoards) {
      byBoardId.delete(byBoardId.keys().next().value);
    }

    return new Map([...entries].map(([id, { reporter }]) => [id, reporter]));
  };

  return { reportersOf };
};

// The creators on the board, for the filter's dropdown: each with the name
// most of their cards carry, busiest first.
const creatorOptions = (creators) => {
  const byKey = new Map();

  creators.filter(Boolean).forEach(({ key, name }) => {
    if (!byKey.has(key)) {
      byKey.set(key, { key, cards: 0, names: new Map() });
    }

    const entry = byKey.get(key);

    entry.cards += 1;
    entry.names.set(name, (entry.names.get(name) || 0) + 1);
  });

  return [...byKey.values()]
    .map(({ key, cards, names }) => {
      const [name] = [...names.entries()].sort(
        ([a, aCount], [b, bCount]) => bCount - aCount || a.localeCompare(b),
      )[0];

      return { key, name, cards };
    })
    .sort((a, b) => b.cards - a.cards || a.name.localeCompare(b.name));
};

// The dollars in the cost field's text: "$1.97" is 1.97, "$1,234.50" is
// 1234.5; "unpriced", a blank or anything without a number is null.
const parseCost = (content) => {
  if (typeof content !== 'string') {
    return null;
  }

  const match = content.replace(/,/g, '').match(/\d+(\.\d+)?/);

  return match ? Number(match[0]) : null;
};

// Seconds from each card entering the board to its FIRST completion — the
// measure of the median row (windowOf), over a card's whole history rather
// than one window. A card whose creation the history does not hold has no
// known start and gets no figure, as it is left out of the median. actions:
// the cards' createCard and moveCard actions, any order.
const secondsToDoneByCardId = (actions) => {
  const createdAt = new Map();
  const firstDoneAt = new Map();

  actions.forEach((action) => {
    const at = timeOf(action.createdAt);
    const cardId = String(action.cardId);

    if (at === null) {
      return;
    }

    let times = null;

    if (action.type === 'createCard') {
      times = createdAt;
    } else if (classify(action).completed) {
      times = firstDoneAt;
    }

    if (times && (!times.has(cardId) || at < times.get(cardId))) {
      times.set(cardId, at);
    }
  });

  const seconds = new Map();

  firstDoneAt.forEach((doneAt, cardId) => {
    const startAt = createdAt.get(cardId);

    if (startAt !== undefined && startAt <= doneAt) {
      seconds.set(cardId, (doneAt - startAt) / 1000);
    }
  });

  return seconds;
};

const within = (value, { min, max }) =>
  value !== null &&
  value !== undefined &&
  (min === null || value >= min) &&
  (max === null || value <= max);

// The ids of the cards that pass every filter. cards: the board's cards as
// { id, name, description, labelIds, creator (creatorOf), costUsd (parseCost),
// secondsToDone }; a figure a filter is not set for may be left out.
const matchCards = (cards, filters) => {
  const { labelIds, search, creators, duration, cost } = filters;
  const labelIdSet = labelIds && new Set(labelIds.map(String));
  const creatorSet = creators && new Set(creators);

  return new Set(
    cards
      .filter(
        (card) =>
          (!labelIdSet || (card.labelIds || []).some((id) => labelIdSet.has(String(id)))) &&
          (!search ||
            [card.name, card.description].some(
              (value) => typeof value === 'string' && value.toLowerCase().includes(search),
            )) &&
          (!creatorSet || (!!card.creator && creatorSet.has(card.creator.key))) &&
          (!duration || within(card.secondsToDone, duration)) &&
          (!cost || within(card.costUsd, cost)),
      )
      .map((card) => String(card.id)),
  );
};

module.exports = {
  COST_FIELD_NAME,
  CUSTOM_PERIOD_KEY,
  FilterError,
  MAX_RANGE_SECONDS,
  PERIODS,
  REACH_SECONDS,
  classify,
  compute,
  createReporterCache,
  creatorOf,
  creatorOptions,
  hasCardFilter,
  matchCards,
  missingCreations,
  parseCost,
  parseFilters,
  parseReporter,
  reachOf,
  secondsToDoneByCardId,
  versionOf,
};
