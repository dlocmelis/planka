/*!
 * Copyright (c) 2026 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

// The pure half of the board's Pipeline strip (components/boards/PipelineStrip):
// everything it decides from the orchestrator's GET /_term/pipeline answer
// without touching the DOM, so the rules are tested on their own.
//
// The raise rules mirror the orchestrator's (cmd/orchestrator/pipelineview.go,
// raiseRank and Raise). The strip only PREVIEWS them — the server decides — but
// a preview that disagrees with the server would tell a person one label and
// then apply another, so the two are kept to the same few lines.

// Priority ranks as internal/priority numbers them.
export const PriorityRanks = {
  VERY_LOW: -2,
  LOW: -1,
  NORMAL: 0,
  HIGH: 1,
  VERY_HIGH: 2,
};

const PRIORITY_NAMES = {
  [PriorityRanks.VERY_LOW]: 'Very Low',
  [PriorityRanks.LOW]: 'Low',
  [PriorityRanks.NORMAL]: 'Normal',
  [PriorityRanks.HIGH]: 'High',
  [PriorityRanks.VERY_HIGH]: 'Very High',
};

export const priorityName = (rank) => PRIORITY_NAMES[rank] || String(rank);

// Passing a Normal-or-lower job takes High; passing a High (or Very High) job
// takes Very High, which is the ceiling.
export const raiseRank = (targetRank) =>
  targetRank <= PriorityRanks.NORMAL ? PriorityRanks.HIGH : PriorityRanks.VERY_HIGH;

// E2E and pool jobs are the two keys nothing may be raised above.
export const isLockedJob = (item) => !!(item && (item.e2e || item.managesPool));

export const RaiseRefusals = {
  NOT_UPWARD: 'notUpward',
  LOCKED: 'locked',
  OWN_CARD: 'ownCard',
};

export const RaiseOutcomes = {
  RAISE: 'raise',
  CEILING: 'ceiling',
};

// What moving queue[fromIndex] above queue[aboveIndex] would do:
//   { allowed: false, refusal }                 — the move is not offered
//   { allowed: true, outcome: 'raise', from, to, tie } — the label it applies
//   { allowed: true, outcome: 'ceiling', from } — already as high as a move
//                                               gives; the queue keeps its
//                                               stage/age order
// `tie` says the card lands at the same priority as the job it passes, so
// between the two the queue goes by stage and age.
export const previewRaise = (queue, fromIndex, aboveIndex) => {
  const item = queue[fromIndex];
  const target = queue[aboveIndex];

  if (!item || !target || aboveIndex >= fromIndex) {
    return { allowed: false, refusal: RaiseRefusals.NOT_UPWARD };
  }

  if (isLockedJob(target)) {
    return { allowed: false, refusal: RaiseRefusals.LOCKED };
  }

  if (target.cardId === item.cardId) {
    return { allowed: false, refusal: RaiseRefusals.OWN_CARD };
  }

  const current = item.priorityRank || 0;
  const want = raiseRank(target.priorityRank || 0);

  if (current >= want) {
    return {
      allowed: true,
      outcome: RaiseOutcomes.CEILING,
      from: priorityName(current),
      to: priorityName(current),
      tie: true,
    };
  }

  return {
    allowed: true,
    outcome: RaiseOutcomes.RAISE,
    from: priorityName(current),
    to: priorityName(want),
    tie: (target.priorityRank || 0) === want,
  };
};

// The index "⤒ To top" moves an item above: the first job that is not locked
// and not the card's own. -1 when there is nothing it could pass.
export const topTargetIndex = (queue, fromIndex) => {
  const item = queue[fromIndex];

  if (!item) {
    return -1;
  }

  for (let index = 0; index < fromIndex; index += 1) {
    if (!isLockedJob(queue[index]) && queue[index].cardId !== item.cardId) {
      return index;
    }
  }

  return -1;
};

// The index "▲ Move up" moves an item above, or -1.
export const upTargetIndex = (queue, fromIndex) => {
  const aboveIndex = fromIndex - 1;

  return previewRaise(queue, fromIndex, aboveIndex).allowed ? aboveIndex : -1;
};

// A react-beautiful-dnd drop, as a raise: dropping at destination index d
// (from source index s > d) puts the item where queue[d] was, so queue[d] is
// the job it was dropped above. Anything else — a drop outside the list, in
// place, or downward — is not a raise.
export const dropTargetIndex = (sourceIndex, destinationIndex) => {
  if (destinationIndex === null || destinationIndex === undefined) {
    return -1;
  }

  return destinationIndex < sourceIndex ? destinationIndex : -1;
};

// The queue as it reads after a raise the server has not answered yet: the
// item moved to aboveIndex, carrying the priority the preview promised.
export const applyRaise = (queue, fromIndex, aboveIndex, preview) => {
  const next = [...queue];
  const [item] = next.splice(fromIndex, 1);
  const raised =
    preview && preview.outcome === RaiseOutcomes.RAISE
      ? {
          ...item,
          priority: preview.to,
          priorityRank: raiseRank(queue[aboveIndex].priorityRank || 0),
        }
      : item;

  next.splice(aboveIndex, 0, raised);

  return next;
};

// A thread is working when it holds a job, whatever its slot state says —
// overflow and retiring slots can be busy too.
export const isThreadBusy = (thread) => !!thread.jobId;

// The collapsed strip's chips.
export const summarize = (view) => {
  const threads = (view && view.threads) || [];

  return {
    busy: threads.filter(isThreadBusy).length,
    total: threads.length,
    queued: ((view && view.queue) || []).length,
    paused: ((view && view.paused) || []).length,
    draining: !!(view && view.drain && view.drain.active),
  };
};

// How full a thread's bar is, 0..100, or null when nothing says. The agent's
// own percentage when it gave one, done/total otherwise.
export const progressPercent = (progress) => {
  if (!progress) {
    return null;
  }

  if (progress.known) {
    return Math.max(0, Math.min(100, progress.percent));
  }

  if (progress.total > 0 && progress.done <= progress.total) {
    return Math.round((100 * progress.done) / progress.total);
  }

  return null;
};

export const DEFAULT_DURATION_UNITS = {
  d: 'd',
  h: 'h',
  m: 'm',
  s: 's',
};

const pad = (value) => String(value).padStart(2, '0');

// A duration as the strip prints it: the two largest units, the second padded
// so a ticking value does not change width every second.
//   45 → 45s, 725 → 12m 05s, 11220 → 3h 07m, 187200 → 2d 4h
export const formatDuration = (totalSeconds, units = DEFAULT_DURATION_UNITS) => {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (days > 0) {
    return `${days}${units.d} ${hours}${units.h}`;
  }

  if (hours > 0) {
    return `${hours}${units.h} ${pad(minutes)}${units.m}`;
  }

  if (minutes > 0) {
    return `${minutes}${units.m} ${pad(secs)}${units.s}`;
  }

  return `${secs}${units.s}`;
};

// Seconds from an ISO time to nowMs, or null when the time is missing.
export const secondsSince = (iso, nowMs) => {
  if (!iso) {
    return null;
  }

  const at = Date.parse(iso);

  if (Number.isNaN(at)) {
    return null;
  }

  return Math.max(0, Math.floor((nowMs - at) / 1000));
};

// Threads grouped by the account serving them, accounts in first-seen order.
export const groupByAccount = (threads) => {
  const groups = [];
  const byAccount = {};

  (threads || []).forEach((thread) => {
    const account = thread.account || '';

    if (!byAccount[account]) {
      byAccount[account] = { account, threads: [] };
      groups.push(byAccount[account]);
    }

    byAccount[account].threads.push(thread);
  });

  return groups;
};

// The stage a bar is coloured by: the job's kind, folded into the handful of
// stages the pipeline has.
const STAGE_BY_KIND = {
  triage: 'triage',
  clarify: 'triage',
  'reopen-route': 'triage',
  dev: 'build',
  'dev-fix': 'build',
  express: 'build',
  review: 'review',
  deploy: 'deploy',
  ops: 'deploy',
  handoff: 'deploy',
};

export const stageOf = (thread) => {
  if (thread.buildType === 'e2e') {
    return 'e2e';
  }

  return STAGE_BY_KIND[thread.kind] || 'other';
};

// Build types the orchestrator reports.
export const BuildTypes = {
  E2E: 'e2e',
  REGULAR: 'regular',
  EXPRESS: 'express',
};

// The label an idle thread shows, by its slot state.
export const IDLE_REASON_KEYS = {
  idle: 'pipeline.idle',
  draining: 'pipeline.idleDraining',
  limited: 'pipeline.idleLimited',
  capped: 'pipeline.idleCapped',
  retiring: 'pipeline.idleRetiring',
  overflow: 'pipeline.idle',
};

export const idleReasonKey = (state) => IDLE_REASON_KEYS[state] || IDLE_REASON_KEYS.idle;

// Polling cadence: 5 s while a person is looking at the details, 30 s while
// the strip is folded away.
export const POLL_EXPANDED_MS = 5000;
export const POLL_COLLAPSED_MS = 30000;

export const pollInterval = (expanded) => (expanded ? POLL_EXPANDED_MS : POLL_COLLAPSED_MS);

// The expanded strip's tabs, in the order they are drawn. Build is the
// threads, held cards and queue; the next three read the orchestrator's
// tests, deploys and accounts. A tab whose data the orchestrator did not send
// (one that predates it) is not offered. Statistics fetches its own figures
// (StatisticsTab), half of them from Planka itself, but it is offered only
// beside the other three: an orchestrator that predates the tabs keeps the
// strip exactly as it was, and one that has them but not the statistics route
// is told apart inside the tab ("keeps no pipeline statistics").
export const Tabs = {
  BUILD: 'build',
  TESTING: 'testing',
  DEPLOYMENT: 'deployment',
  ACCOUNTS: 'accounts',
  STATISTICS: 'statistics',
};

const TAB_FIELDS = {
  [Tabs.BUILD]: null,
  [Tabs.TESTING]: 'tests',
  [Tabs.DEPLOYMENT]: 'deploys',
  [Tabs.ACCOUNTS]: 'accounts',
  [Tabs.STATISTICS]: 'tests',
};

export const availableTabs = (view) =>
  Object.keys(TAB_FIELDS).filter((tab) => {
    const field = TAB_FIELDS[tab];
    return field === null || !!(view && view[field]);
  });

// The tab to show: the remembered one when this view offers it, Build
// otherwise — a remembered tab is never lost, only not shown while an older
// orchestrator cannot fill it.
export const activeTab = (remembered, view) =>
  availableTabs(view).includes(remembered) ? remembered : Tabs.BUILD;

export const isTab = (value) => Object.values(Tabs).includes(value);

// The collapsed header's extra chips: the smoke gate's stages running and
// waiting, the deployments holding a lane (and the cards behind them), and
// the Claude accounts at their usage limit. null for a part the orchestrator
// did not send.
export const summarizeTabs = (view) => {
  const tests = view && view.tests;
  const deploys = view && view.deploys;
  const accounts = view && view.accounts;

  return {
    tests: tests ? { running: tests.running || 0, waiting: tests.waiting || 0 } : null,
    deploys: deploys ? { deploying: deploys.deploying || 0, waiting: deploys.waiting || 0 } : null,
    limited: accounts ? accounts.filter((account) => account.limited).map(({ name }) => name) : [],
  };
};

// Gate stages grouped by card, cards in first-seen order (the orchestrator
// sends waiting stages first, so a card with one waiting leads).
export const groupStagesByCard = (stages) => {
  const groups = [];
  const byCard = {};

  (stages || []).forEach((stage) => {
    if (!byCard[stage.cardId]) {
      byCard[stage.cardId] = {
        cardId: stage.cardId,
        cardName: stage.cardName,
        cardBoardId: stage.cardBoardId,
        stages: [],
      };
      groups.push(byCard[stage.cardId]);
    }

    byCard[stage.cardId].stages.push(stage);
  });

  return groups;
};

// How far through its suite a running stage is, 0..100, or null when there is
// no usable denominator — none learned yet, or one a count has already
// passed, which proves it was another workload's.
export const stagePercent = (stage) => {
  if (!stage || !stage.total || !stage.done || stage.done > stage.total) {
    return null;
  }

  return Math.floor((100 * stage.done) / stage.total);
};

// Seconds from nowMs to an ISO time, or null when the time is missing or past.
export const secondsUntil = (iso, nowMs) => {
  if (!iso) {
    return null;
  }

  const at = Date.parse(iso);

  if (Number.isNaN(at) || at < nowMs) {
    return null;
  }

  return Math.floor((at - nowMs) / 1000);
};

// A reset or a start as a person reads it: the time alone when it is today,
// with the date when it is not — a reset three days out must not read as a
// time this afternoon.
export const formatWhen = (iso, nowMs, locale) => {
  const at = new Date(iso);

  if (!iso || Number.isNaN(at.getTime())) {
    return '';
  }

  const now = new Date(nowMs);
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();

  const time = at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  if (sameDay) {
    return time;
  }

  return `${at.toLocaleDateString(locale, { month: 'short', day: 'numeric' })}, ${time}`;
};

// The date a history starts on: "24 Sep".
export const formatDay = (iso, locale) => {
  const at = new Date(iso);

  if (!iso || Number.isNaN(at.getTime())) {
    return '';
  }

  return at.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
};

// The three usage windows an account can report, in the order they are shown.
export const USAGE_WINDOWS = ['5h', 'week', 'week_fable'];

// How a usage window is coloured: by the endpoint's own verdict when it gave
// one — the threshold it warns at is the account's, not a number the strip can
// know — and only by the percentage when it gave none.
export const usageLevel = (window) => {
  if (window.status === 'refused' || window.status === 'warning' || window.status === 'ok') {
    return window.status;
  }

  return window.percent >= 90 ? 'warning' : 'ok';
};

// The Statistics tab. Every figure is shown for the last 24 hours, 7 days and
// 30 days, beside the period of the same length before it. The board-flow
// half is Planka's GET /api/boards/:id/pipeline-statistics; the pipeline half
// is the orchestrator's GET /_term/pipeline/stats. Both answer
// {periods: [{key, seconds, current, previous}]} in this order.
export const STATS_PERIODS = ['24h', '7d', '30d'];

// The statistics poll: they are read over two months of history and move by
// the minute at most.
export const STATS_POLL_MS = 60000;

export const statsPeriod = (stats, key) =>
  (stats && stats.periods && stats.periods.find((period) => period.key === key)) || null;

// part / whole, or null when there is no whole: "nothing ran" is not "all
// failed".
export const ratio = (part, whole) => (whole > 0 ? part / whole : null);

export const Directions = {
  UP: 'up',
  DOWN: 'down',
  FLAT: 'flat',
};

// How a figure moved against the previous period: its direction and the
// change in percent of the previous value — null when the previous value was
// 0, where a percentage means nothing, and a direction of null when either
// side is unknown.
export const compareCounts = (current, previous) => {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return { direction: null, percent: null };
  }

  if (current === previous) {
    return { direction: Directions.FLAT, percent: 0 };
  }

  const direction = current > previous ? Directions.UP : Directions.DOWN;

  if (previous === 0) {
    return { direction, percent: null };
  }

  return { direction, percent: Math.round((100 * Math.abs(current - previous)) / previous) };
};

// A rate (0..1) moves in percentage POINTS: 40% to 50% is ten points, not a
// quarter.
export const compareRates = (current, previous) => {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return { direction: null, points: null };
  }

  const points = Math.round(100 * (current - previous));

  if (points === 0) {
    return { direction: Directions.FLAT, points: 0 };
  }

  return { direction: points > 0 ? Directions.UP : Directions.DOWN, points: Math.abs(points) };
};

// Whether a move is good news: `better` is the direction a figure should go
// (up for completions, down for failures), null for one that is neither.
export const deltaTone = (direction, better) => {
  if (!better || !direction || direction === Directions.FLAT) {
    return null;
  }

  return direction === better ? 'good' : 'bad';
};

// When a history starts inside the periods on screen — the smoke gate's since
// the day it began to be recorded — the tab says "since 24 Sep" rather than
// let the missing days read as a quiet stretch. The date to say, or null when
// the history covers every period shown, the 30 days before the last 30
// included.
export const historyStartsInside = (since, stats) => {
  const month = statsPeriod(stats, '30d');

  if (!since || !month) {
    return null;
  }

  const sinceMs = Date.parse(since);
  const fromMs = Date.parse(month.previous.from);

  if (Number.isNaN(sinceMs) || Number.isNaN(fromMs)) {
    return null;
  }

  return sinceMs > fromMs ? since : null;
};

// The kinds of agent session any period saw, busiest over the last 30 days
// first, so every row of the table lines up across the periods.
export const sessionKinds = (stats) => {
  const totals = {};

  ((stats && stats.periods) || []).forEach((period) => {
    [period.current, period.previous].forEach((window) => {
      (window.sessions || []).forEach(({ kind }) => {
        totals[kind] = totals[kind] || 0;
      });
    });
  });

  const month = statsPeriod(stats, '30d');

  if (month) {
    (month.current.sessions || []).forEach(({ kind, sessions }) => {
      totals[kind] = sessions;
    });
  }

  return Object.keys(totals).sort((a, b) => totals[b] - totals[a] || a.localeCompare(b));
};

// One kind's row in a window: zeros when the window saw none of it.
export const sessionsOf = (window, kind) =>
  ((window && window.sessions) || []).find((item) => item.kind === kind) || {
    kind,
    sessions: 0,
    failed: 0,
    spendUsd: 0,
  };

// A window's session totals over every kind. `judged` leaves out the kinds
// whose attempts record no outcome (e2e: the orchestrator's outcomeUnknown),
// and is what a failure rate is over.
export const sessionTotals = (window) =>
  ((window && window.sessions) || []).reduce(
    (total, item) => ({
      sessions: total.sessions + item.sessions,
      failed: total.failed + item.failed,
      judged: total.judged + (item.outcomeUnknown ? 0 : item.sessions),
    }),
    { sessions: 0, failed: 0, judged: 0 },
  );

// Dollars as a person reads them: "$1,234.56", "$0.42".
export const formatUsd = (value, locale) =>
  new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);
