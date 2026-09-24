/*!
 * Copyright (c) 2026 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import {
  Directions,
  STATS_PERIODS,
  compareCounts,
  compareRates,
  deltaTone,
  formatUsd,
  historyStartsInside,
  ratio,
  sessionKinds,
  sessionTotals,
  sessionsOf,
  statsPeriod,
} from './pipeline-strip';

const statsWindow = (sessions = []) => ({ sessions });

const stats = {
  periods: [
    {
      key: '24h',
      current: statsWindow([{ kind: 'review', sessions: 2, failed: 1, spendUsd: 3 }]),
      previous: statsWindow(),
    },
    {
      key: '7d',
      current: statsWindow([{ kind: 'triage', sessions: 1, failed: 0, spendUsd: 0.1 }]),
      previous: statsWindow([{ kind: 'e2e', sessions: 1, failed: 1, spendUsd: 0 }]),
    },
    {
      key: '30d',
      current: {
        ...statsWindow([
          { kind: 'review', sessions: 40, failed: 4, spendUsd: 90 },
          { kind: 'build', sessions: 60, failed: 9, spendUsd: 400 },
          { kind: 'triage', sessions: 40, failed: 0, spendUsd: 1 },
          { kind: 'e2e', sessions: 5, failed: 0, spendUsd: 0, outcomeUnknown: true },
        ]),
      },
      previous: { from: '2026-07-26T12:00:00Z', ...statsWindow() },
    },
  ],
};

describe('statistics', () => {
  test('the periods are 24h, 7d and 30d, in that order', () => {
    expect(STATS_PERIODS).toEqual(['24h', '7d', '30d']);
    expect(statsPeriod(stats, '7d')).toBe(stats.periods[1]);
    expect(statsPeriod(stats, '1y')).toBeNull();
    expect(statsPeriod(null, '7d')).toBeNull();
  });

  test('a count moves by a percentage of the previous period', () => {
    expect(compareCounts(15, 12)).toEqual({ direction: Directions.UP, percent: 25 });
    expect(compareCounts(9, 12)).toEqual({ direction: Directions.DOWN, percent: 25 });
    expect(compareCounts(7, 7)).toEqual({ direction: Directions.FLAT, percent: 0 });
    // From nothing there is a direction but no percentage.
    expect(compareCounts(3, 0)).toEqual({ direction: Directions.UP, percent: null });
    // An unknown side (a median with nothing timed) has no comparison at all.
    expect(compareCounts(null, 4)).toEqual({ direction: null, percent: null });
    expect(compareCounts(4, undefined)).toEqual({ direction: null, percent: null });
  });

  test('a rate moves in percentage points, not percent', () => {
    expect(compareRates(0.5, 0.4)).toEqual({ direction: Directions.UP, points: 10 });
    expect(compareRates(0.3, 0.45)).toEqual({ direction: Directions.DOWN, points: 15 });
    expect(compareRates(0.501, 0.499)).toEqual({ direction: Directions.FLAT, points: 0 });
    expect(compareRates(null, 0.4)).toEqual({ direction: null, points: null });
  });

  test('an arrow is good news when the figure moved the way it should', () => {
    expect(deltaTone(Directions.UP, 'up')).toBe('good');
    expect(deltaTone(Directions.UP, 'down')).toBe('bad');
    expect(deltaTone(Directions.DOWN, 'down')).toBe('good');
    expect(deltaTone(Directions.FLAT, 'up')).toBeNull();
    expect(deltaTone(Directions.UP, null)).toBeNull();
  });

  test('a rate over nothing is unknown, not zero', () => {
    expect(ratio(3, 4)).toBe(0.75);
    expect(ratio(0, 0)).toBeNull();
  });

  test('a history that starts inside the periods on screen is named', () => {
    // The gate's history started on 24 Sep: inside the 60 days on screen.
    expect(historyStartsInside('2026-09-24T13:02:21Z', stats)).toBe('2026-09-24T13:02:21Z');
    // job_attempts reach back to 21 July: before the 30d period's previous
    // window began, so nothing is missing.
    expect(historyStartsInside('2026-07-21T21:05:25Z', stats)).toBeNull();
    expect(historyStartsInside(undefined, stats)).toBeNull();
    expect(historyStartsInside('2026-09-24T13:02:21Z', { periods: [] })).toBeNull();
  });

  test('session kinds line up across periods, busiest over 30 days first', () => {
    expect(sessionKinds(stats)).toEqual(['build', 'review', 'triage', 'e2e']);
    expect(sessionKinds(null)).toEqual([]);
    expect(sessionsOf(stats.periods[0].current, 'build')).toEqual({
      kind: 'build',
      sessions: 0,
      failed: 0,
      spendUsd: 0,
    });
    // An e2e session is counted, but a failure rate is not over it.
    expect(sessionTotals(stats.periods[2].current)).toEqual({
      sessions: 145,
      failed: 13,
      judged: 140,
    });
  });

  test('dollars read as dollars', () => {
    expect(formatUsd(1234.5, 'en-US')).toBe('$1,234.50');
    expect(formatUsd(0.004, 'en-US')).toBe('$0.00');
    expect(formatUsd(undefined, 'en-US')).toBe('$0.00');
  });
});
