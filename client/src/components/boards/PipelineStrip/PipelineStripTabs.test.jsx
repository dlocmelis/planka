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
    useTranslation: () => [t],
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

jest.mock('../../../selectors', () => ({
  __esModule: true,
  default: {
    selectCurrentUser: () => ({ id: 'user-1', name: 'Deniss', username: 'deniss' }),
  },
}));

jest.mock('../../../lib/redux-router', () => ({
  push: (to) => ({ type: 'router-push', payload: { to } }),
}));

window.IS_REACT_ACT_ENVIRONMENT = true;

const BOARD_ID = 'board-1';

// Durations as the strip prints them under the mocked translation, whose unit
// letters come back as their keys: dur(14, 'm', 0, 's') is 14m 00s.
const UNIT_KEYS = {
  d: 'pipeline.unitDays',
  h: 'pipeline.unitHours',
  m: 'pipeline.unitMinutes',
  s: 'pipeline.unitSeconds',
};
const dur = (a, ua, b, ub) => `${a}${UNIT_KEYS[ua]} ${String(b).padStart(2, '0')}${UNIT_KEYS[ub]}`;
const NOW = '2026-09-24T12:00:00Z';

let container;
let root;
let store;
let dispatchedActions;
let getAnswer;

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
});

const tests = () => ({
  maxContainers: 3,
  running: 2,
  waiting: 1,
  stages: [
    {
      cardId: 'card-1',
      cardName: 'Scoped ticket',
      repo: 'setl',
      stage: 'setl:unit',
      profile: 'scoped',
      status: 'queued',
      since: '2026-09-24T11:46:00Z',
    },
    {
      cardId: 'card-2',
      cardName: 'Approved ticket',
      repo: 'setl-web',
      stage: 'setl-web:unit1',
      profile: 'full',
      status: 'running',
      since: '2026-09-24T11:50:00Z',
      container: 'dt-gate-card-2-1',
      unit: 'test',
      done: 120,
      total: 480,
      failed: 2,
      percent: 25,
    },
    {
      cardId: 'card-2',
      cardName: 'Approved ticket',
      repo: 'setl',
      stage: 'setl:vet',
      profile: 'full',
      status: 'running',
      since: '2026-09-24T11:59:00Z',
      container: 'dt-gate-card-2-2',
    },
  ],
  recent: [
    {
      cardId: 'card-3',
      cardName: 'Merged ticket',
      repo: 'setl',
      stage: 'setl:race',
      profile: 'full',
      status: 'fail',
      finishedAt: '2026-09-24T11:40:00Z',
      durationSeconds: 725,
      queuedSeconds: 120,
      unit: 'test',
      tests: 812,
      failed: 3,
      attempts: 2,
    },
    {
      cardId: 'card-3',
      cardName: 'Merged ticket',
      repo: 'setl-web',
      stage: 'setl-web:unit2',
      profile: 'scoped',
      status: 'ok',
      finishedAt: '2026-09-24T11:30:00Z',
      durationSeconds: 300,
      flaked: true,
      attempts: 2,
    },
  ],
  recordedSince: '2026-09-24T08:00:00Z',
});

const deploys = () => ({
  deploying: 1,
  waiting: 2,
  lanes: [
    {
      repo: 'setl',
      current: {
        cardId: 'card-d',
        name: 'Deploying ticket',
        riders: [
          { cardId: 'card-r1', name: 'Rider one' },
          { cardId: 'card-r2', name: 'Rider two' },
        ],
        since: '2026-09-24T11:50:00Z',
        jobId: 'dep-card-d-1',
        jobState: 'running',
        thread: 'CA2',
        jobStart: '2026-09-24T11:52:00Z',
        progress: { done: 2, total: 4, percent: 60, known: true },
      },
      waiting: [
        {
          cardId: 'card-w1',
          name: 'Urgent',
          priority: 'Very High',
          priorityRank: 2,
          queuedAt: '2026-09-24T11:55:00Z',
          waitingSeconds: 300,
        },
        {
          cardId: 'card-w2',
          name: 'Ordinary',
          priority: 'Normal',
          priorityRank: 0,
          queuedAt: '2026-09-24T11:40:00Z',
          waitingSeconds: 1200,
        },
      ],
      recent: [
        {
          cardId: 'card-o',
          name: 'Shipped',
          jobId: 'dep-card-o-1',
          status: 'ok',
          attempts: 1,
          finishedAt: '2026-09-24T10:00:00Z',
          durationSeconds: 480,
        },
        {
          cardId: 'card-f',
          name: 'Did not ship',
          jobId: 'dep-card-f-1',
          status: 'empty-result',
          attempts: 2,
          finishedAt: '2026-09-24T09:00:00Z',
          durationSeconds: 60,
        },
      ],
    },
    { repo: 'setl-web', waiting: [], recent: [] },
  ],
  selfRedeploy: {
    cards: [{ cardId: 'card-o', name: 'Shipped' }],
    stagedAt: '2026-09-24T11:56:00Z',
    unit: 'orch-swap-1',
  },
});

const accounts = () => [
  {
    name: 'claude-a',
    auth: 'subscription',
    threads: 6,
    status: 'warning',
    fetchedAt: '2026-09-24T11:50:00Z',
    windows: [
      { key: '5h', percent: 42, resetsAt: '2026-09-24T14:14:00Z', status: 'ok' },
      { key: 'week', percent: 81, resetsAt: '2026-09-27T09:00:00Z', status: 'warning' },
      { key: 'week_fable', percent: 12, resetsAt: '2026-09-27T09:00:00Z' },
    ],
  },
  {
    name: 'claude-b',
    auth: 'subscription',
    threads: 0,
    fetchedAt: '2026-09-24T06:00:00Z',
    stale: true,
    windows: [],
    limited: true,
    limitedSince: '2026-09-24T10:00:00Z',
    limitedUntil: '2026-09-24T13:00:00Z',
    limitWindow: '5-hour',
  },
  { name: 'claude-c', auth: 'api-key', threads: 2, windows: [] },
];

const view = (overrides = {}) => ({
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
  tests: tests(),
  deploys: deploys(),
  accounts: accounts(),
  ...overrides,
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

const chipText = (name) => {
  const chip = container.querySelector(`[data-chip="${name}"]`);
  return chip && chip.textContent;
};

const panel = (name) => container.querySelector(`[data-tab-panel="${name}"]`);

const openTab = async (name) => {
  click(container.querySelector(`[role="tab"][data-tab="${name}"]`));
  await flush();
};

beforeEach(() => {
  localStorage.clear();
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout'], now: Date.parse(NOW) });

  getAnswer = () => jsonResponse(200, view());
  global.fetch = jest.fn(() => Promise.resolve(getAnswer()));

  dispatchedActions = [];
  store = createStore((state, action) => {
    dispatchedActions.push(action);
    return state || {};
  });

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

describe('the collapsed header', () => {
  test('counts the test stages running and waiting, and the deployments', async () => {
    await renderStrip();

    expect(chipText('tests')).toBe('pipeline.testsChip{"running":2,"waiting":1}');
    expect(chipText('deploys')).toBe('pipeline.deploysChip{"count":1}');
    expect(container.querySelector('[data-chip="deploys"]').getAttribute('title')).toBe(
      'pipeline.deploysChipTitle{"deploying":1,"waiting":2}',
    );
  });

  test('shows a red chip naming an account at its usage limit', async () => {
    await renderStrip();

    const chip = container.querySelector('[data-chip="limited"]');
    expect(chip.textContent).toBe('⛔ pipeline.limitedChip{"names":"claude-b"}');
    expect(chip.className).toContain('chipRefused');
  });

  test('shows no red chip while no account is limited', async () => {
    getAnswer = () =>
      jsonResponse(200, view({ accounts: accounts().map((a) => ({ ...a, limited: false })) }));

    await renderStrip();

    expect(container.querySelector('[data-chip="limited"]')).toBeNull();
  });

  test('an orchestrator that predates the tabs draws the old header and no tabs', async () => {
    localStorage.setItem('planka_pipelineStrip_expanded', 'true');
    getAnswer = () =>
      jsonResponse(200, view({ tests: undefined, deploys: undefined, accounts: undefined }));

    await renderStrip();

    expect(container.querySelector('[data-chip="tests"]')).toBeNull();
    expect(container.querySelector('[data-chip="deploys"]')).toBeNull();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(
      container.querySelectorAll('[data-thread], [data-pipeline-strip="ok"]'),
    ).not.toHaveLength(0);
  });
});

describe('expanded', () => {
  beforeEach(() => {
    localStorage.setItem('planka_pipelineStrip_expanded', 'true');
  });

  test('offers Build, Testing, Deployment, Accounts and Statistics, and opens on Build', async () => {
    await renderStrip();

    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.getAttribute('data-tab'))).toEqual([
      'build',
      'testing',
      'deployment',
      'accounts',
      'statistics',
    ]);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    // The Build tab is the strip as it was: the threads and the queue toggle.
    expect(container.querySelector('[data-tab-panel]')).toBeNull();
    expect(container.textContent).toContain('pipeline.queueTitle');
  });

  test('remembers the last tab opened, across a reload', async () => {
    await renderStrip();
    await openTab('deployment');

    expect(panel('deployment')).not.toBeNull();
    expect(localStorage.getItem('planka_pipelineStrip_tab')).toBe('deployment');

    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    await renderStrip();

    expect(panel('deployment')).not.toBeNull();
    expect(container.querySelector('[data-tab="deployment"]').getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  test('a remembered tab the orchestrator cannot fill falls back to Build without forgetting it', async () => {
    localStorage.setItem('planka_pipelineStrip_tab', 'accounts');
    getAnswer = () => jsonResponse(200, view({ accounts: undefined }));

    await renderStrip();

    expect(panel('accounts')).toBeNull();
    expect(container.textContent).toContain('pipeline.queueTitle');
    expect(localStorage.getItem('planka_pipelineStrip_tab')).toBe('accounts');
  });

  test('Testing: each stage in flight, grouped by card, and the recently finished', async () => {
    await renderStrip();
    await openTab('testing');

    const testing = panel('testing');
    expect(testing.textContent).toContain('pipeline.testsSummary{"running":2,"waiting":1,"max":3}');

    const cards = [...testing.querySelectorAll('[data-test-card]')];
    expect(cards.map((card) => card.getAttribute('data-test-card'))).toEqual(['card-1', 'card-2']);
    expect(cards[1].querySelectorAll('[data-stage]')).toHaveLength(2);

    const waiting = testing.querySelector('[data-stage="setl:unit"]');
    expect(waiting.getAttribute('data-status')).toBe('queued');
    expect(waiting.textContent).toContain('pipeline.testWaiting{"max":3}');
    expect(waiting.querySelector('[data-profile="scoped"]').textContent).toBe(
      'pipeline.profileScoped',
    );
    // Waiting 14 minutes, counted from when it started waiting.
    expect(waiting.textContent).toContain(dur(14, 'm', 0, 's'));
    expect(waiting.querySelector('code')).toBeNull();

    const running = testing.querySelector('[data-stage="setl-web:unit1"]');
    expect(running.textContent).toContain('pipeline.testRunning');
    expect(running.textContent).toContain('25%');
    expect(running.querySelector('[data-count]').textContent).toBe(
      'pipeline.progressTests{"done":120,"total":480}',
    );
    expect(running.textContent).toContain('pipeline.failedCount{"count":2}');
    expect(running.querySelector('[data-profile="full"]').textContent).toBe('pipeline.profileFull');
    expect(running.querySelector('code').textContent).toBe('dt-gate-card-2-1');

    // A stage whose command counts nothing shows no count, never 0/0.
    const vet = testing.querySelector('[data-stage="setl:vet"]');
    expect(vet.querySelector('[data-count]')).toBeNull();
    expect(vet.textContent).not.toContain('%');

    const recent = [...testing.querySelectorAll('[data-recent-stage]')];
    expect(recent.map((row) => row.getAttribute('data-recent-stage'))).toEqual([
      'setl:race',
      'setl-web:unit2',
    ]);
    expect(recent[0].querySelector('[data-result]').textContent).toBe('pipeline.resultFail');
    expect(recent[0].textContent).toContain(dur(12, 'm', 5, 's'));
    expect(recent[0].textContent).toContain(
      `pipeline.queuedPart{"duration":"${dur(2, 'm', 0, 's')}"}`,
    );
    expect(recent[0].textContent).toContain('pipeline.countTests{"count":812}');
    expect(recent[0].textContent).toContain('pipeline.failedCount{"count":3}');
    expect(recent[0].textContent).toContain('pipeline.attempts{"count":2}');
    expect(recent[1].querySelector('[data-result]').textContent).toBe('pipeline.resultOk');
    expect(recent[1].textContent).toContain('pipeline.flaky');
    expect(testing.textContent).toContain('pipeline.recordedSince');
  });

  test('Testing: a stage name opens its card', async () => {
    await renderStrip();
    await openTab('testing');

    click(panel('testing').querySelector('[data-test-card="card-2"] button'));

    expect(dispatchedActions).toContainEqual({
      type: 'router-push',
      payload: { to: '/cards/card-2' },
    });
  });

  test('Deployment: a lane per repository with the deploy, its riders, the waiting cards and the last deploys', async () => {
    await renderStrip();
    await openTab('deployment');

    const deployment = panel('deployment');
    expect(
      [...deployment.querySelectorAll('[data-lane]')].map((lane) => lane.getAttribute('data-lane')),
    ).toEqual(['setl', 'setl-web']);

    const setl = deployment.querySelector('[data-lane="setl"]');
    const now = setl.querySelector('[data-deploying="card-d"]');
    expect(now.textContent).toContain('Deploying ticket');
    expect(now.textContent).toContain('60%');
    expect(now.querySelector('[data-job-state]').textContent).toBe(
      'pipeline.deployRunning{"thread":"CA2"}',
    );
    // Holding the lane for ten minutes.
    expect(now.textContent).toContain(dur(10, 'm', 0, 's'));
    expect(now.querySelector('[data-riders]').textContent).toContain('Rider one');
    expect(now.querySelector('[data-riders]').textContent).toContain('Rider two');

    const waiting = [...setl.querySelectorAll('[data-waiting]')];
    expect(waiting.map((row) => row.getAttribute('data-waiting'))).toEqual(['card-w1', 'card-w2']);
    expect(waiting[0].textContent).toContain('Very High');
    expect(waiting[0].textContent).toContain(dur(5, 'm', 0, 's'));
    expect(waiting[1].textContent).toContain(dur(20, 'm', 0, 's'));

    const runs = [...setl.querySelectorAll('[data-deploy-run]')];
    expect(runs.map((row) => row.querySelector('[data-result]').textContent)).toEqual([
      'pipeline.deployResultOk',
      'pipeline.deployResultNoResult',
    ]);
    expect(runs[0].textContent).toContain(dur(8, 'm', 0, 's'));
    expect(runs[1].textContent).toContain('pipeline.attempts{"count":2}');

    expect(deployment.querySelector('[data-lane="setl-web"]').textContent).toContain(
      'pipeline.deployIdle',
    );

    const redeploy = deployment.querySelector('[data-self-redeploy]');
    expect(redeploy.textContent).toContain(`pipeline.selfRedeploy{"age":"${dur(4, 'm', 0, 's')}"}`);
    expect(redeploy.textContent).toContain('Shipped');
  });

  test('Deployment: a deploy still waiting for a thread says so', async () => {
    const d = deploys();
    d.lanes[0].current = {
      ...d.lanes[0].current,
      jobState: 'waiting-thread',
      thread: undefined,
      progress: undefined,
    };
    d.selfRedeploy = undefined;
    getAnswer = () => jsonResponse(200, view({ deploys: d }));

    await renderStrip();
    await openTab('deployment');

    expect(panel('deployment').querySelector('[data-job-state]').textContent).toBe(
      'pipeline.deployWaitingThread{"thread":"—"}',
    );
    expect(panel('deployment').querySelector('[data-self-redeploy]')).toBeNull();
  });

  test('Accounts: usage windows with resets, the endpoint verdict, the limit and the reading age', async () => {
    await renderStrip();
    await openTab('accounts');

    const accountsPanel = panel('accounts');
    const a = accountsPanel.querySelector('[data-account="claude-a"]');
    expect(
      [...a.querySelectorAll('[data-window]')].map((w) => w.getAttribute('data-window')),
    ).toEqual(['5h', 'week', 'week_fable']);
    const fiveHour = a.querySelector('[data-window="5h"]');
    expect(fiveHour.textContent).toContain('42%');
    expect(fiveHour.textContent).toContain('pipeline.resetsIn');
    expect(fiveHour.textContent).toContain(`"duration":"${dur(2, 'h', 14, 'm')}"`);
    // A reset three days out carries its date.
    expect(a.querySelector('[data-window="week"]').textContent).toMatch(/27/);
    expect(a.querySelector('[data-endpoint-status]').textContent).toBe('pipeline.endpointWarning');
    expect(a.textContent).toContain(`pipeline.readingAge{"duration":"${dur(10, 'm', 0, 's')}"}`);
    expect(a.querySelector('[data-limited]')).toBeNull();

    const b = accountsPanel.querySelector('[data-account="claude-b"]');
    expect(b.querySelector('[data-limited]').textContent).toContain('pipeline.limitedUntil');
    expect(b.querySelector('[data-limited]').textContent).toContain(
      `"duration":"${dur(1, 'h', 0, 'm')}"`,
    );
    expect(b.textContent).toContain('pipeline.limitedNoThreads');
    expect(b.querySelector('[data-stale]').textContent).toContain('pipeline.readingStale');
    expect(b.querySelectorAll('[data-window]')).toHaveLength(0);

    const c = accountsPanel.querySelector('[data-account="claude-c"]');
    expect(c.textContent).toContain('pipeline.authApiKey');
    expect(c.textContent).toContain('pipeline.noUsageWindows');

    // The tab itself carries the alarm while it is not open.
    expect(container.querySelector('[data-tab="accounts"]').textContent).toContain('⛔');
  });
});
