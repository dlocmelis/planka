/*!
 * Copyright (c) 2026 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import {
  RaiseOutcomes,
  RaiseRefusals,
  applyRaise,
  dropTargetIndex,
  formatDuration,
  groupByAccount,
  previewRaise,
  progressPercent,
  summarize,
  topTargetIndex,
  upTargetIndex,
} from './pipeline-strip';

const job = (jobId, cardId, priorityRank = 0, extra = {}) => ({
  jobId,
  cardId,
  name: `card ${cardId}`,
  priorityRank,
  ...extra,
});

describe('previewRaise (the rank preview)', () => {
  test('passing a Normal job applies High', () => {
    const queue = [job('j1', 'c1', 0), job('j2', 'c2', 0)];

    expect(previewRaise(queue, 1, 0)).toEqual({
      allowed: true,
      outcome: RaiseOutcomes.RAISE,
      from: 'Normal',
      to: 'High',
      tie: false,
    });
  });

  test('passing a Low job still applies High — Normal-or-lower means High', () => {
    const queue = [job('j1', 'c1', -1), job('j2', 'c2', -2)];

    expect(previewRaise(queue, 1, 0)).toMatchObject({ to: 'High', from: 'Very Low' });
  });

  test('passing a High job applies Very High', () => {
    const queue = [job('j1', 'c1', 1), job('j2', 'c2', 0)];

    expect(previewRaise(queue, 1, 0)).toMatchObject({
      outcome: RaiseOutcomes.RAISE,
      to: 'Very High',
      tie: false,
    });
  });

  test('passing a Very High job applies Very High and says it is a tie', () => {
    const queue = [job('j1', 'c1', 2), job('j2', 'c2', 1)];

    expect(previewRaise(queue, 1, 0)).toMatchObject({
      outcome: RaiseOutcomes.RAISE,
      to: 'Very High',
      tie: true,
    });
  });

  test('a card already at the level a move gives is at the ceiling, not raised', () => {
    const queue = [job('j1', 'c1', 1), job('j2', 'c2', 2)];

    expect(previewRaise(queue, 1, 0)).toMatchObject({
      allowed: true,
      outcome: RaiseOutcomes.CEILING,
      from: 'Very High',
    });
  });

  test('nothing is moved above an e2e job or a pool job', () => {
    const queue = [
      job('j1', 'c1', 0, { e2e: true }),
      job('j2', 'c2', 0, { managesPool: true }),
      job('j3', 'c3', 0),
    ];

    expect(previewRaise(queue, 2, 0)).toEqual({
      allowed: false,
      refusal: RaiseRefusals.LOCKED,
    });
    expect(previewRaise(queue, 2, 1)).toEqual({
      allowed: false,
      refusal: RaiseRefusals.LOCKED,
    });
  });

  test('only upward moves are offered', () => {
    const queue = [job('j1', 'c1'), job('j2', 'c2')];

    expect(previewRaise(queue, 0, 1)).toEqual({
      allowed: false,
      refusal: RaiseRefusals.NOT_UPWARD,
    });
    expect(previewRaise(queue, 1, 1).allowed).toBe(false);
  });

  test('a card is not raised above its own other job', () => {
    const queue = [job('j1', 'c1'), job('j2', 'c1')];

    expect(previewRaise(queue, 1, 0)).toEqual({
      allowed: false,
      refusal: RaiseRefusals.OWN_CARD,
    });
  });
});

describe('queue move targets', () => {
  const queue = [
    job('e2e', 'c0', 0, { e2e: true }),
    job('pool', 'cp', 0, { managesPool: true }),
    job('j1', 'c1'),
    job('j2', 'c2'),
    job('j3', 'c3'),
  ];

  test('a drop above index d is a raise above the job that was at d', () => {
    expect(dropTargetIndex(4, 2)).toBe(2);
    expect(dropTargetIndex(2, 4)).toBe(-1);
    expect(dropTargetIndex(3, 3)).toBe(-1);
    expect(dropTargetIndex(3, null)).toBe(-1);
  });

  test('"To top" stops under the e2e and pool jobs', () => {
    expect(topTargetIndex(queue, 4)).toBe(2);
    expect(topTargetIndex(queue, 2)).toBe(-1);
  });

  test('"Move up" is not offered directly under a locked job', () => {
    expect(upTargetIndex(queue, 4)).toBe(3);
    expect(upTargetIndex(queue, 2)).toBe(-1);
  });

  test('the optimistic queue moves the item and carries the previewed level', () => {
    const preview = previewRaise(queue, 4, 2);
    const next = applyRaise(queue, 4, 2, preview);

    expect(next.map(({ jobId }) => jobId)).toEqual(['e2e', 'pool', 'j3', 'j1', 'j2']);
    expect(next[2]).toMatchObject({ priority: 'High', priorityRank: 1 });
  });
});

describe('summarize (the collapsed chips)', () => {
  test('counts busy threads by their job, and the queue, paused cards and drain', () => {
    const view = {
      threads: [
        { name: 'A1', state: 'busy', jobId: 'j1' },
        { name: 'A2', state: 'idle' },
        { name: 'B1', state: 'overflow', jobId: 'j2' },
        { name: 'B2', state: 'limited' },
      ],
      queue: [job('j3', 'c3'), job('j4', 'c4'), job('j5', 'c5')],
      paused: [{ cardId: 'c9' }],
      drain: { active: true },
    };

    expect(summarize(view)).toEqual({
      busy: 2,
      total: 4,
      queued: 3,
      paused: 1,
      draining: true,
    });
  });

  test('an empty or missing view counts nothing', () => {
    expect(summarize(null)).toEqual({ busy: 0, total: 0, queued: 0, paused: 0, draining: false });
  });
});

describe('formatDuration', () => {
  test('shows the two largest units, padding the second', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(725)).toBe('12m 05s');
    expect(formatDuration(3600)).toBe('1h 00m');
    expect(formatDuration(11220)).toBe('3h 07m');
    expect(formatDuration(187200)).toBe('2d 4h');
  });

  test('never goes negative and tolerates junk', () => {
    expect(formatDuration(-30)).toBe('0s');
    expect(formatDuration(undefined)).toBe('0s');
    expect(formatDuration(59.9)).toBe('59s');
  });

  test('takes localised unit suffixes', () => {
    expect(formatDuration(11220, { d: 'д', h: 'ч', m: 'м', s: 'с' })).toBe('3ч 07м');
  });
});

describe('progressPercent', () => {
  test("prefers the agent's own percent, falls back to done/total", () => {
    expect(progressPercent({ done: 1, total: 4, percent: 70, known: true })).toBe(70);
    expect(progressPercent({ done: 1, total: 4, percent: 0, known: false })).toBe(25);
    expect(progressPercent({ done: 0, total: 0, percent: 0, known: false })).toBeNull();
    expect(progressPercent(undefined)).toBeNull();
  });
});

test('groupByAccount keeps accounts in first-seen order', () => {
  const groups = groupByAccount([
    { name: 'A1', account: 'kimi-a' },
    { name: 'CB1', account: 'claude-b' },
    { name: 'A2', account: 'kimi-a' },
  ]);

  expect(groups.map(({ account, threads }) => [account, threads.map(({ name }) => name)])).toEqual([
    ['kimi-a', ['A1', 'A2']],
    ['claude-b', ['CB1']],
  ]);
});
