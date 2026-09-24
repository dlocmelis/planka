/*!
 * Copyright (c) 2026 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import {
  Tabs,
  activeTab,
  availableTabs,
  formatWhen,
  groupStagesByCard,
  secondsUntil,
  stagePercent,
  summarizeTabs,
  usageLevel,
} from './pipeline-strip';

const fullView = {
  threads: [],
  tests: { running: 3, waiting: 2, stages: [], recent: [] },
  deploys: { deploying: 1, waiting: 4, lanes: [] },
  accounts: [
    { name: 'claude-a', limited: false },
    { name: 'claude-b', limited: true },
    { name: 'claude-c', limited: true, threads: 0 },
  ],
};

describe('tabs', () => {
  test('every tab is offered when the orchestrator sends its data', () => {
    expect(availableTabs(fullView)).toEqual([
      Tabs.BUILD,
      Tabs.TESTING,
      Tabs.DEPLOYMENT,
      Tabs.ACCOUNTS,
      Tabs.STATISTICS,
    ]);
  });

  test('an orchestrator that predates the tabs offers Build alone', () => {
    expect(availableTabs({ threads: [] })).toEqual([Tabs.BUILD]);
    expect(availableTabs(null)).toEqual([Tabs.BUILD]);
  });

  test('the remembered tab is shown when offered, Build otherwise', () => {
    expect(activeTab(Tabs.DEPLOYMENT, fullView)).toBe(Tabs.DEPLOYMENT);
    expect(activeTab(Tabs.DEPLOYMENT, { threads: [] })).toBe(Tabs.BUILD);
    expect(activeTab(Tabs.STATISTICS, fullView)).toBe(Tabs.STATISTICS);
    expect(activeTab(Tabs.STATISTICS, { threads: [] })).toBe(Tabs.BUILD);
    expect(activeTab('history', fullView)).toBe(Tabs.BUILD);
    expect(activeTab(null, fullView)).toBe(Tabs.BUILD);
  });
});

describe('summarizeTabs (the header chips)', () => {
  test('counts running and waiting stages, deployments, and every account at its limit', () => {
    expect(summarizeTabs(fullView)).toEqual({
      tests: { running: 3, waiting: 2 },
      deploys: { deploying: 1, waiting: 4 },
      limited: ['claude-b', 'claude-c'],
    });
  });

  test('says nothing about a part the orchestrator did not send', () => {
    expect(summarizeTabs({ threads: [] })).toEqual({ tests: null, deploys: null, limited: [] });
  });
});

test('groupStagesByCard keeps the cards in the order they arrive', () => {
  const stages = [
    { cardId: 'c2', cardName: 'Two', stage: 'setl:unit', status: 'queued' },
    { cardId: 'c1', cardName: 'One', stage: 'setl-web:unit1', status: 'running' },
    { cardId: 'c2', cardName: 'Two', stage: 'setl:race', status: 'running' },
  ];

  expect(groupStagesByCard(stages)).toEqual([
    { cardId: 'c2', cardName: 'Two', cardBoardId: undefined, stages: [stages[0], stages[2]] },
    { cardId: 'c1', cardName: 'One', cardBoardId: undefined, stages: [stages[1]] },
  ]);
  expect(groupStagesByCard(undefined)).toEqual([]);
});

describe('stagePercent', () => {
  test('is done over total', () => {
    expect(stagePercent({ done: 120, total: 480 })).toBe(25);
    expect(stagePercent({ done: 1, total: 500 })).toBe(0);
  });

  test('is null with no usable denominator, never a clamp', () => {
    expect(stagePercent({ done: 969, total: 19 })).toBeNull();
    expect(stagePercent({ done: 12 })).toBeNull();
    expect(stagePercent({ done: 0, total: 10 })).toBeNull();
    expect(stagePercent(null)).toBeNull();
  });
});

test('secondsUntil counts down to a future time and is null for a past one', () => {
  const now = Date.parse('2026-09-24T14:26:00Z');

  expect(secondsUntil('2026-09-24T16:40:00Z', now)).toBe(8040);
  expect(secondsUntil('2026-09-24T14:00:00Z', now)).toBeNull();
  expect(secondsUntil(undefined, now)).toBeNull();
});

test('formatWhen adds the date to a time that is not today', () => {
  const now = new Date(2026, 8, 24, 14, 26).getTime();
  const today = new Date(2026, 8, 24, 16, 40).toISOString();
  const later = new Date(2026, 8, 27, 16, 40).toISOString();

  const todayText = formatWhen(today, now, 'en-GB');
  const laterText = formatWhen(later, now, 'en-GB');

  expect(todayText).toBe('16:40');
  expect(laterText).toContain('16:40');
  expect(laterText).toContain('27');
  expect(laterText).not.toBe(todayText);
  expect(formatWhen(undefined, now)).toBe('');
});

describe('usageLevel', () => {
  test("follows the endpoint's own verdict when it gave one", () => {
    expect(usageLevel({ percent: 99, status: 'ok' })).toBe('ok');
    expect(usageLevel({ percent: 40, status: 'warning' })).toBe('warning');
    expect(usageLevel({ percent: 100, status: 'refused' })).toBe('refused');
  });

  test('falls back to the percentage when it gave none', () => {
    expect(usageLevel({ percent: 92 })).toBe('warning');
    expect(usageLevel({ percent: 40 })).toBe('ok');
  });
});
