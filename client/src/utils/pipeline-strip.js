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
