/**
 * @jest-environment jsdom
 */

/*!
 * Copyright (c) 2026 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { createStore } from 'redux';

import PipelineStrip from './PipelineStrip';

// Keys come back with their values, so a test can read what was counted.
jest.mock('react-i18next', () => {
  const t = (key, values) =>
    values && typeof values === 'object' ? `${key}${JSON.stringify(values)}` : key;

  return {
    useTranslation: () => [t, { language: 'en-US' }],
  };
});

jest.mock('react-beautiful-dnd', () => ({
  DragDropContext: (props) => props.children,
  Droppable: (props) =>
    props.children({ innerRef: () => {}, droppableProps: {}, placeholder: null }, {}),
  Draggable: (props) =>
    props.children(
      { innerRef: () => {}, draggableProps: {}, dragHandleProps: {} },
      { isDragging: false },
    ),
}));

jest.mock('../../../lib/popup', () => ({
  usePopup: () => (props) => props.children,
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: () => {},
}));

const mockUser = { id: 'user-1', name: 'Deniss', username: 'deniss' };
const mockLabels = [
  { id: '1001', name: 'bug', color: 'berry-red' },
  { id: '1002', name: 'ui', color: 'lagoon-blue' },
];

jest.mock('../../../selectors', () => ({
  __esModule: true,
  default: {
    selectCurrentUser: () => mockUser,
    selectAccessToken: () => 'planka-token',
    selectLabelsForCurrentBoard: () => mockLabels,
  },
}));

jest.mock('../../../lib/redux-router', () => ({
  push: (to) => ({ type: 'router-push', payload: { to } }),
}));

window.IS_REACT_ACT_ENVIRONMENT = true;

const BOARD_ID = 'board-1';
const NOW = '2026-09-24T12:00:00Z';

const DAY = 24 * 60 * 60 * 1000;
const at = (ms) => new Date(Date.parse(NOW) - ms).toISOString();

const PLANKA_URL = `/api/boards/${BOARD_ID}/pipeline-statistics`;
const STATS_URL = `/_term/pipeline/stats?board=${BOARD_ID}`;

let container;
let root;
let store;
let answers;
let fetchCalls;

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
});

const view = () => ({
  pipeline: true,
  boardId: BOARD_ID,
  now: NOW,
  threads: [{ name: 'A1', account: 'claude-a', state: 'idle' }],
  queue: [],
  paused: [],
  drain: { active: false },
  dispatching: true,
  canEdit: true,
  canPause: true,
  tests: { maxContainers: 3, running: 0, waiting: 0, stages: [], recent: [] },
  deploys: { deploying: 0, waiting: 0, lanes: [] },
  accounts: [],
});

const periodsOf = (make) =>
  [
    ['24h', DAY],
    ['7d', 7 * DAY],
    ['30d', 30 * DAY],
  ].map(([key, span], index) => ({
    key,
    seconds: span / 1000,
    current: { from: at(span), to: NOW, ...make(key, 'current', index) },
    previous: { from: at(2 * span), to: at(span), ...make(key, 'previous', index) },
  }));

const boardFlow = (key, side, index) => {
  const current = side === 'current';

  return {
    entered: current ? 5 + index : 4,
    completed: current ? 12 : 10,
    deployed: current ? 3 : 3,
    reopened: current ? 2 : 1,
    testingSent: 6,
    testingAccepted: current ? 4 : 2,
    testingRejected: current ? 1 : 2,
    acceptanceRate: current ? 0.8 : 0.5,
    medianSecondsToDone: current ? 7200 : null,
    timedToDone: current ? 4 : 0,
  };
};

const CREATORS = [
  { key: 'den@setlfi.com', name: 'Deniss Locmelis', cards: 12 },
  { key: 'planka-bot@setlfi.com', name: 'Orchestrator Bot', cards: 40 },
];

const boardStats = () => ({
  boardId: BOARD_ID,
  now: NOW,
  since: '2026-07-21T22:26:29Z',
  periods: periodsOf(boardFlow),
  filterOptions: { creators: CREATORS },
});

const pipelineWindow = (key, side) => {
  const current = side === 'current';

  return {
    gate: {
      runs: current ? 10 : 0,
      passed: current ? 8 : 0,
      failed: current ? 1 : 0,
      errored: current ? 1 : 0,
      skipped: 2,
      flaked: current ? 1 : 0,
      stages:
        current && key === '7d'
          ? [
              { stage: 'setl-web:unit1', runs: 6, fails: 2, avgSeconds: 540 },
              { stage: 'setl:unit', runs: 4, fails: 0, avgSeconds: 180 },
            ]
          : [],
    },
    deploys: { jobs: 4, succeeded: current ? 3 : 4, failed: current ? 1 : 0, avgSeconds: 900 },
    sessions: current
      ? [
          { kind: 'build', sessions: 30, failed: 3, spendUsd: 420.5 },
          { kind: 'review', sessions: 20, failed: 0, spendUsd: 100 },
          { kind: 'e2e', sessions: 10, failed: 0, spendUsd: 0, outcomeUnknown: true },
        ]
      : [{ kind: 'build', sessions: 25, failed: 5, spendUsd: 300 }],
    spendUsd: current ? 520.5 : 300,
  };
};

const pipelineStats = () => ({
  pipeline: true,
  boardId: BOARD_ID,
  now: NOW,
  gateSince: '2026-09-24T08:00:00Z',
  sessionsSince: '2026-07-21T21:05:25Z',
  periods: periodsOf(pipelineWindow),
});

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
};

const renderStrip = async () => {
  act(() => {
    root.render(
      <Provider store={store}>
        <PipelineStrip boardId={BOARD_ID} />
      </Provider>,
    );
  });

  await flush();
};

const click = (element) => {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

const openStatistics = async () => {
  click(container.querySelector('[role="tab"][data-tab="statistics"]'));
  await flush();
  await flush();
};

const panel = () => container.querySelector('[data-tab-panel="statistics"]');

// The cell of one figure in one period: [value, delta].
const cell = (table, stat, periodIndex) => {
  const row = panel().querySelector(`[data-stats="${table}"] [data-stat="${stat}"]`);
  const td = row.querySelectorAll('td')[periodIndex];
  const delta = td.querySelector('[data-direction]');

  return {
    text: td.textContent,
    direction: delta && delta.getAttribute('data-direction'),
    className: delta ? delta.className : '',
    title: delta && delta.getAttribute('title'),
  };
};

const callsTo = (url) => fetchCalls.filter(([called]) => called === url);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('planka_pipelineStrip_expanded', 'true');
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout'], now: Date.parse(NOW) });

  answers = {
    [`/_term/pipeline?board=${BOARD_ID}`]: () => jsonResponse(200, view()),
    [STATS_URL]: () => jsonResponse(200, pipelineStats()),
    [PLANKA_URL]: () => jsonResponse(200, { item: boardStats() }),
  };
  fetchCalls = [];
  global.fetch = jest.fn((url, init) => {
    fetchCalls.push([url, init]);

    // A filtered board-flow request is answered as the unfiltered one unless
    // a test says otherwise.
    const answer = answers[url] || (url.startsWith(`${PLANKA_URL}?`) && answers[PLANKA_URL]);

    return Promise.resolve(answer ? answer() : jsonResponse(404, {}));
  });

  store = createStore((state) => state || {});

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });

  container.remove();
  delete global.fetch;
  jest.useRealTimers();
});

test('the statistics are asked for only once the tab is opened, and it is remembered', async () => {
  await renderStrip();

  expect(callsTo(STATS_URL)).toHaveLength(0);
  expect(callsTo(PLANKA_URL)).toHaveLength(0);

  await openStatistics();

  expect(panel()).not.toBeNull();
  expect(callsTo(STATS_URL)).toHaveLength(1);
  expect(callsTo(PLANKA_URL)).toHaveLength(1);
  expect(localStorage.getItem('planka_pipelineStrip_tab')).toBe('statistics');
});

test('Planka is asked with the bearer token, the orchestrator with the board cookies', async () => {
  await renderStrip();
  await openStatistics();

  const [[, plankaInit]] = callsTo(PLANKA_URL);
  expect(plankaInit.headers.Authorization).toBe('Bearer planka-token');

  const [[, statsInit]] = callsTo(STATS_URL);
  expect(statsInit.credentials).toBe('same-origin');
  expect(statsInit.headers.Authorization).toBeUndefined();
});

test('every board-flow figure is shown for 24h, 7d and 30d beside the previous period', async () => {
  await renderStrip();
  await openStatistics();

  const headers = [...panel().querySelectorAll('[data-stats="board"] thead th')].map(
    (th) => th.textContent,
  );
  expect(headers).toEqual([
    '',
    'pipeline.statsPeriod24h',
    'pipeline.statsPeriod7d',
    'pipeline.statsPeriod30d',
  ]);

  const rows = [...panel().querySelectorAll('[data-stats="board"] [data-stat]')].map((row) =>
    row.getAttribute('data-stat'),
  );
  expect(rows).toEqual([
    'entered',
    'completed',
    'deployed',
    'reopened',
    'testingSent',
    'testingAccepted',
    'testingRejected',
    'acceptanceRate',
    'medianToDone',
  ]);

  // 12 completed against 10: up a fifth, and that is good news.
  const completed = cell('board', 'completed', 0);
  expect(completed.text).toContain('12');
  expect(completed.text).toContain('▲ pipeline.statsPercent{"percent":20}');
  expect(completed.className).toContain('statsDeltaGood');
  expect(completed.title).toBe('pipeline.statsPrevious{"value":"10"}');

  // Reopened doubled: up, and bad news.
  const reopened = cell('board', 'reopened', 1);
  expect(reopened.direction).toBe('up');
  expect(reopened.className).toContain('statsDeltaBad');

  // A rate moves in points: 50% to 80% is thirty points.
  const acceptance = cell('board', 'acceptanceRate', 2);
  expect(acceptance.text).toContain('pipeline.statsPercent{"percent":80}');
  expect(acceptance.text).toContain('▲ pipeline.statsPoints{"points":30}');

  // Unchanged is said, and a figure with nothing to compare has no arrow.
  expect(cell('board', 'deployed', 0).direction).toBe('flat');
  const median = cell('board', 'medianToDone', 0);
  expect(median.text).toContain('2pipeline.unitHours 00pipeline.unitMinutes');
  expect(median.direction).toBeNull();

  // The board's history covers all 60 days on screen: no "since" note.
  expect(panel().querySelector('[data-since-note="pipeline.statsBoardSince"]')).toBeNull();
});

test('the pipeline figures, the stage table and the sessions by kind are shown', async () => {
  await renderStrip();
  await openStatistics();

  expect(cell('pipeline', 'gateRuns', 0).text).toContain('10');
  expect(cell('pipeline', 'gatePassRate', 0).text).toContain('pipeline.statsPercent{"percent":80}');
  // Nothing ran before: a rate over nothing has no comparison.
  expect(cell('pipeline', 'gatePassRate', 0).direction).toBeNull();
  expect(cell('pipeline', 'deploysFailed', 0).className).toContain('statsDeltaBad');
  // Sixty sessions, but the failure rate is over the fifty with an outcome.
  expect(cell('pipeline', 'sessions', 0).text).toContain('60');
  expect(cell('pipeline', 'sessionFailureRate', 0).text).toContain(
    'pipeline.statsPercent{"percent":6}',
  );
  expect(cell('pipeline', 'spend', 0).text).toContain('$520.50');

  // The gate's history began today: the tab says so; the sessions' did not.
  const gateNote = panel().querySelector('[data-since-note="pipeline.statsGateSince"]');
  expect(gateNote).not.toBeNull();
  expect(gateNote.textContent).toContain('pipeline.statsGateSince');
  expect(panel().querySelector('[data-since-note="pipeline.statsSessionsSince"]')).toBeNull();

  // The per-stage table opens on 7 days…
  const stageRows = () =>
    [...panel().querySelectorAll('[data-stage-row]')].map((row) =>
      [...row.children].map((child) => child.textContent),
    );
  expect(stageRows()).toEqual([
    ['setl-web:unit1', '6', '2', '9pipeline.unitMinutes 00pipeline.unitSeconds'],
    ['setl:unit', '4', '0', '3pipeline.unitMinutes 00pipeline.unitSeconds'],
  ]);

  // …and switches period without asking again.
  const asked = callsTo(STATS_URL).length;
  click(panel().querySelector('[data-stage-period="24h"]'));
  await flush();
  expect(stageRows()).toEqual([]);
  expect(panel().textContent).toContain('pipeline.statsStagesNone');
  expect(callsTo(STATS_URL)).toHaveLength(asked);

  // Sessions by kind, busiest first, each with its failure share and spend.
  const kinds = [...panel().querySelectorAll('[data-session-kind]')].map((row) =>
    row.getAttribute('data-session-kind'),
  );
  expect(kinds).toEqual(['build', 'review', 'e2e']);
  const build = panel().querySelector('[data-session-kind="build"]');
  expect(build.textContent).toContain('pipeline.statsKindDetail{"percent":10,"spend":"$420.50"}');
  // An e2e session's recorded error is its container being stopped: no share.
  const e2e = panel().querySelector('[data-session-kind="e2e"]');
  expect(e2e.textContent).toContain('pipeline.statsKindSpend{"spend":"$0.00"}');
  expect(e2e.textContent).not.toContain('statsKindDetail');
});

test('an orchestrator without the statistics route still shows the board flow', async () => {
  answers[STATS_URL] = () => jsonResponse(404, { error: 'not found' });

  await renderStrip();
  await openStatistics();

  expect(panel().querySelector('[data-stats="board"]')).not.toBeNull();
  expect(panel().querySelector('[data-stats="pipeline"]')).toBeNull();
  expect(panel().textContent).toContain('pipeline.statsPipelineUnavailable');
});

test('a board half that cannot be read says why, and the pipeline half still shows', async () => {
  answers[PLANKA_URL] = () => jsonResponse(500, { message: 'database down' });

  await renderStrip();
  await openStatistics();

  expect(panel().querySelector('[data-stats="board"]')).toBeNull();
  expect(panel().textContent).toContain('pipeline.statsFailed{"error":"database down"}');
  expect(panel().querySelector('[data-stats="pipeline"]')).not.toBeNull();
});

describe('Board flow filters', () => {
  const FILTERS_KEY = `planka_pipelineStrip_statsFilters_${BOARD_ID}`;

  // The board-flow requests, as the parameters each one carried.
  const boardRequests = () =>
    fetchCalls
      .map(([url]) => url)
      .filter((url) => url === PLANKA_URL || url.startsWith(`${PLANKA_URL}?`))
      .map((url) => Object.fromEntries(new URLSearchParams(url.split('?')[1] || '')));

  const lastBoardRequest = () => boardRequests()[boardRequests().length - 1];

  const filter = (name) => panel().querySelector(`[data-filter="${name}"]`);

  // Types into a box as a person does: React hears an input event.
  const type = (input, value) => {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  const pick = (name, text) => {
    const option = [...filter(name).querySelectorAll('[role="option"]')].find((item) =>
      item.textContent.includes(text),
    );

    click(option);
  };

  const waitForTypingToPause = async () => {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 450);
      });
    });
    await flush();
  };

  const localDay = (year, month, day) => new Date(year, month - 1, day).toISOString();

  test('every filter becomes a parameter of the board-flow request, and only that one', async () => {
    await renderStrip();
    await openStatistics();

    // Nothing filtered: the request is exactly the unfiltered one.
    expect(callsTo(PLANKA_URL)).toHaveLength(1);

    pick('labelIds', 'bug');
    pick('labelIds', 'ui');
    await flush();
    expect(lastBoardRequest()).toEqual({ labelIds: '1001,1002' });

    // The creators are the ones the answer listed.
    pick('creators', 'Deniss Locmelis');
    await flush();
    expect(lastBoardRequest()).toEqual({ labelIds: '1001,1002', creators: 'den@setlfi.com' });

    // The keyword and number boxes wait for the typing to pause.
    const asked = boardRequests().length;
    type(filter('search'), 'log');
    type(filter('search'), 'login');
    type(filter('durationMinHours'), '1.5');
    type(filter('durationMaxHours'), '48');
    type(filter('costMin'), '1');
    type(filter('costMax'), '12.5');
    await flush();
    expect(boardRequests()).toHaveLength(asked);

    await waitForTypingToPause();
    expect(boardRequests()).toHaveLength(asked + 1);
    expect(lastBoardRequest()).toEqual({
      labelIds: '1001,1002',
      creators: 'den@setlfi.com',
      search: 'login',
      durationMin: '5400',
      durationMax: '172800',
      costMin: '1',
      costMax: '12.5',
    });

    // Local days, the "to" day included whole.
    type(filter('from'), '2026-09-01');
    type(filter('to'), '2026-09-15');
    await flush();
    expect(lastBoardRequest()).toMatchObject({
      from: localDay(2026, 9, 1),
      to: localDay(2026, 9, 16),
    });

    // The orchestrator is never asked with a filter.
    fetchCalls
      .map(([url]) => url)
      .filter((url) => url.startsWith('/_term/pipeline/stats'))
      .forEach((url) => expect(url).toBe(STATS_URL));

    // The heading says what is filtered, and the note says what is not.
    const title = panel().querySelector('[data-stats-title]').textContent;
    expect(title).toContain('pipeline.statsBoardTitleFiltered');
    expect(title).toContain('bug, ui');
    expect(title).toContain('Deniss Locmelis');
    expect(title).toContain('pipeline.statsFilterQuoted{\\"text\\":\\"login\\"}');
    expect(panel().querySelector('[data-filters-note]').textContent).toContain(
      'pipeline.statsFiltersBoardOnly',
    );
  });

  test('a date range makes Board flow one column, and the pipeline keeps its three', async () => {
    const custom = {
      key: 'custom',
      seconds: 15 * 86400,
      current: {
        from: localDay(2026, 9, 1),
        to: localDay(2026, 9, 16),
        ...boardFlow('custom', 'current', 0),
      },
      previous: {
        from: localDay(2026, 8, 17),
        to: localDay(2026, 9, 1),
        ...boardFlow('custom', 'previous', 0),
      },
    };

    answers[PLANKA_URL] = () => jsonResponse(200, { item: boardStats() });

    await renderStrip();
    await openStatistics();

    answers[
      `${PLANKA_URL}?${new URLSearchParams({ from: localDay(2026, 9, 1), to: localDay(2026, 9, 16) })}`
    ] = () => jsonResponse(200, { item: { ...boardStats(), periods: [custom] } });

    type(filter('from'), '2026-09-01');
    type(filter('to'), '2026-09-15');
    await flush();
    await flush();

    const headers = (table) =>
      [...panel().querySelectorAll(`[data-stats="${table}"] thead th`)].map((th) => th.textContent);

    expect(headers('board')).toEqual(['', 'Sep 1 – Sep 15']);
    expect(cell('board', 'completed', 0).text).toContain('12');
    expect(cell('board', 'completed', 0).direction).toBe('up');
    expect(headers('pipeline')).toEqual([
      '',
      'pipeline.statsPeriod24h',
      'pipeline.statsPeriod7d',
      'pipeline.statsPeriod30d',
    ]);
    expect(panel().querySelector('[data-stats-title]').textContent).toContain('Sep 1 – Sep 15');
  });

  test('a date range that cannot be asked for is said, and not sent', async () => {
    await renderStrip();
    await openStatistics();

    type(filter('from'), '2026-09-15');
    type(filter('to'), '2026-09-01');
    await flush();

    expect(panel().querySelector('[data-range-error="order"]')).not.toBeNull();
    expect(lastBoardRequest()).toEqual({});

    type(filter('from'), '2025-09-01');
    type(filter('to'), '2026-09-15');
    await flush();

    expect(panel().querySelector('[data-range-error="length"]').textContent).toContain(
      'pipeline.statsFilterRangeTooLong{"days":366}',
    );
    expect(lastBoardRequest()).toEqual({});
  });

  test('the filters are remembered for the board, and Clear forgets them', async () => {
    localStorage.setItem(
      FILTERS_KEY,
      JSON.stringify({ labelIds: ['1002'], search: 'deploy', costMax: '5' }),
    );
    // Another board's filters are its own.
    localStorage.setItem(
      'planka_pipelineStrip_statsFilters_board-2',
      JSON.stringify({ search: 'other board' }),
    );

    await renderStrip();
    await openStatistics();

    // The first request already carries them, and the inputs show them.
    expect(boardRequests()).toEqual([{ labelIds: '1002', search: 'deploy', costMax: '5' }]);
    expect(filter('search').value).toBe('deploy');
    expect(filter('costMax').value).toBe('5');

    click(panel().querySelector('[data-filter-clear]'));
    await flush();

    expect(lastBoardRequest()).toEqual({});
    expect(filter('search').value).toBe('');
    expect(localStorage.getItem(FILTERS_KEY)).toBeNull();
    expect(panel().querySelector('[data-stats-title]').textContent).toBe(
      'pipeline.statsBoardTitle',
    );
    expect(panel().querySelector('[data-filter-clear]').disabled).toBe(true);
  });

  test('a filter the server refuses shows why, not the figures asked without it', async () => {
    await renderStrip();
    await openStatistics();

    expect(panel().querySelector('[data-stats="board"]')).not.toBeNull();

    answers[`${PLANKA_URL}?labelIds=1001`] = () =>
      jsonResponse(400, { code: 'E_INVALID_FILTER', message: 'labelIds must be label ids' });

    pick('labelIds', 'bug');
    await flush();
    await flush();

    expect(panel().querySelector('[data-stats="board"]')).toBeNull();
    expect(panel().textContent).toContain(
      'pipeline.statsFailed{"error":"labelIds must be label ids"}',
    );
  });

  test('the one-minute refresh keeps asking with the filters', async () => {
    localStorage.setItem(FILTERS_KEY, JSON.stringify({ creators: ['den@setlfi.com'] }));
    jest.useFakeTimers({ now: Date.parse(NOW) });

    const settle = async () => {
      await act(async () => {
        for (let i = 0; i < 10; i += 1) {
          await Promise.resolve(); // eslint-disable-line no-await-in-loop
        }
      });
    };

    act(() => {
      root.render(
        <Provider store={store}>
          <PipelineStrip boardId={BOARD_ID} />
        </Provider>,
      );
    });
    await settle();
    click(container.querySelector('[role="tab"][data-tab="statistics"]'));
    await settle();

    expect(boardRequests()).toEqual([{ creators: 'den@setlfi.com' }]);

    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    await settle();

    expect(boardRequests()).toEqual([
      { creators: 'den@setlfi.com' },
      { creators: 'den@setlfi.com' },
    ]);
  });
});
