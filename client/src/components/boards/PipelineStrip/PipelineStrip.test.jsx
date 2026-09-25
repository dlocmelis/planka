/**
 * @jest-environment jsdom
 */

/*!
 * Copyright (c) 2026 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import fs from 'fs';
import path from 'path';
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { createStore } from 'redux';

import enUS from '../../../locales/en-US/core';
import ruRU from '../../../locales/ru-RU/core';
import PipelineStrip from './PipelineStrip';

const mockDragDropContextProps = [];
const mockDraggableProps = [];
const mockPopupProps = [];
const mockToasts = [];
let mockCurrentUser;

// Keys come back with their values, so a test can read what a chip counted.
jest.mock('react-i18next', () => {
  const t = (key, values) =>
    values && typeof values === 'object' ? `${key}${JSON.stringify(values)}` : key;

  return {
    useTranslation: () => [t],
  };
});

jest.mock('react-beautiful-dnd', () => ({
  DragDropContext: (props) => {
    mockDragDropContextProps.push(props);
    return props.children;
  },
  Droppable: (props) =>
    props.children({ innerRef: () => {}, droppableProps: {}, placeholder: null }, {}),
  Draggable: (props) => {
    mockDraggableProps.push(props);
    return props.children(
      { innerRef: () => {}, draggableProps: {}, dragHandleProps: {} },
      { isDragging: false },
    );
  },
}));

// The popup renders its trigger inline; the props the confirmation step would
// get are kept so a test can confirm it.
jest.mock('../../../lib/popup', () => ({
  usePopup: () => (props) => {
    mockPopupProps.push(props);
    return props.children;
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: (message) => mockToasts.push(message),
}));

jest.mock('../../../selectors', () => ({
  __esModule: true,
  default: {
    selectCurrentUser: () => mockCurrentUser,
  },
}));

jest.mock('../../../lib/redux-router', () => ({
  push: (to) => ({ type: 'router-push', payload: { to } }),
}));

window.IS_REACT_ACT_ENVIRONMENT = true;

const BOARD_ID = 'board-1';

let container;
let root;
let store;
let dispatchedActions;
let fetchCalls;
let getAnswer;
let postAnswer;

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
});

const view = (overrides = {}) => ({
  pipeline: true,
  boardId: BOARD_ID,
  now: '2026-09-23T12:00:00Z',
  threads: [
    {
      name: 'A1',
      account: 'kimi-a',
      state: 'busy',
      jobId: 'run-1',
      kind: 'dev',
      role: 'Dev',
      cardId: 'card-1',
      cardName: 'Build the thing',
      cardType: 'Feature',
      buildType: 'regular',
      column: 'Development',
      progress: { done: 2, total: 4, percent: 50, known: true },
      stageStart: '2026-09-23T11:48:00Z',
      pipelineStart: '2026-09-23T09:00:00Z',
    },
    { name: 'A2', account: 'kimi-a', state: 'idle' },
    {
      name: 'B1',
      account: 'kimi-b',
      state: 'busy',
      jobId: 'run-2',
      kind: 'review',
      role: 'Review',
      cardId: 'card-2',
      cardName: 'Review the thing',
      buildType: 'e2e',
    },
    { name: 'B2', account: 'kimi-b', state: 'limited' },
  ],
  queue: [
    {
      jobId: 'job-e2e',
      cardId: 'card-e',
      name: 'Watched',
      kind: 'dev',
      priority: 'Normal',
      priorityRank: 0,
      e2e: true,
      waitingSeconds: 10,
    },
    {
      jobId: 'job-a',
      cardId: 'card-a',
      name: 'First',
      kind: 'dev',
      priority: 'Normal',
      priorityRank: 0,
      waitingSeconds: 300,
    },
    {
      jobId: 'job-b',
      cardId: 'card-b',
      name: 'Second',
      kind: 'dev',
      priority: 'High',
      priorityRank: 1,
      waitingSeconds: 200,
    },
    {
      jobId: 'job-c',
      cardId: 'card-c',
      name: 'Third',
      kind: 'review',
      priority: 'Normal',
      priorityRank: 0,
      waitingSeconds: 100,
    },
  ],
  paused: [{ cardId: 'card-p', name: 'Held', by: 'deniss', at: '2026-09-23T11:00:00Z' }],
  drain: { active: false },
  dispatching: true,
  canEdit: true,
  canPause: true,
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

const posts = () => fetchCalls.filter(([, init]) => init && init.method === 'POST');

const lastDragDropProps = () => mockDragDropContextProps[mockDragDropContextProps.length - 1];

beforeEach(() => {
  localStorage.clear();

  mockDragDropContextProps.length = 0;
  mockDraggableProps.length = 0;
  mockPopupProps.length = 0;
  mockToasts.length = 0;
  mockCurrentUser = { id: 'user-1', name: 'Deniss K', username: 'deniss.k' };

  fetchCalls = [];
  getAnswer = () => jsonResponse(200, view());
  postAnswer = () => jsonResponse(200, { changed: true, from: 'Normal', to: 'High', note: 'ok' });

  global.fetch = jest.fn((url, init) => {
    fetchCalls.push([url, init]);
    return Promise.resolve(init && init.method === 'POST' ? postAnswer(url, init) : getAnswer(url));
  });

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
});

describe('boards the pipeline does not drive', () => {
  test('{pipeline:false} renders nothing', async () => {
    getAnswer = () => jsonResponse(200, { pipeline: false });

    await renderStrip();

    expect(fetchCalls[0][0]).toBe('/_term/pipeline?board=board-1');
    expect(container.innerHTML).toBe('');
  });

  // Even on a board this browser has seen a strip on, where any other failure
  // is drawn as "orchestrator unreachable".
  test.each([401, 403, 404])('an answer of %i renders nothing', async (status) => {
    localStorage.setItem('planka_pipelineStrip_drivenBoards', JSON.stringify([BOARD_ID]));
    getAnswer = () => jsonResponse(status, { error: 'no' });

    await renderStrip();

    expect(container.innerHTML).toBe('');
  });

  test('a 200 that is not JSON (a Planka with no /_term in front) renders nothing', async () => {
    getAnswer = () => ({ ok: true, status: 200, json: () => Promise.reject(new Error('html')) });

    await renderStrip();

    expect(container.innerHTML).toBe('');
  });
});

test('a board that had a strip says so when the orchestrator cannot be reached', async () => {
  await renderStrip();
  expect(container.querySelector('[data-pipeline-strip="ok"]')).not.toBeNull();

  act(() => {
    root.unmount();
  });
  root = createRoot(container);

  getAnswer = () => jsonResponse(502, { error: 'bad gateway' });
  await renderStrip();

  expect(container.querySelector('[data-pipeline-strip="unreachable"]').textContent).toContain(
    'pipeline.unreachable',
  );
});

test('the collapsed summary counts busy threads, the queue, paused cards and the drain', async () => {
  getAnswer = () => jsonResponse(200, view({ drain: { active: true, actor: 'deniss' } }));

  await renderStrip();

  expect(chipText('threads')).toBe('pipeline.threadsBusy{"busy":2,"total":4}');
  expect(chipText('queue')).toBe('pipeline.queueCount{"count":4}');
  expect(chipText('paused')).toContain('pipeline.pausedCount{"count":1}');
  expect(chipText('draining')).toBe('pipeline.draining');
  // One segment per thread, collapsed by default: no bars, no queue.
  expect(container.querySelectorAll('[data-thread]')).toHaveLength(0);
  expect(mockDragDropContextProps).toHaveLength(0);
});

test('clicking the summary expands the strip and remembers it', async () => {
  await renderStrip();

  click(container.querySelector('[data-toggle][aria-expanded="false"]'));
  // Expanding asks again at once, rather than waiting out the collapsed 30 s.
  await flush();
  expect(fetchCalls).toHaveLength(2);

  expect(container.querySelectorAll('[data-thread]')).toHaveLength(2);
  expect(localStorage.getItem('planka_pipelineStrip_expanded')).toBe('true');
});

describe('expanded, with the queue open', () => {
  beforeEach(() => {
    localStorage.setItem('planka_pipelineStrip_expanded', 'true');
    localStorage.setItem('planka_pipelineStrip_queueOpened', 'true');
  });

  test('a job dropped above another raises it with that job as aboveJobId', async () => {
    await renderStrip();

    // "Third" (index 3) dropped at index 1, where "First" was.
    act(() => {
      lastDragDropProps().onDragEnd({
        draggableId: 'job-c',
        source: { index: 3 },
        destination: { index: 1 },
      });
    });
    await flush();

    expect(posts()).toHaveLength(1);
    expect(posts()[0][0]).toBe('/_term/pipeline/raise');
    expect(posts()[0][1].headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(posts()[0][1].body)).toEqual({ cardId: 'card-c', aboveJobId: 'job-a' });
    expect(mockToasts[mockToasts.length - 1].params).toMatchObject({
      title: 'pipeline.raisedTo',
      values: { level: 'High', name: 'First' },
    });
  });

  test('a drop above an e2e job, or downward, raises nothing', async () => {
    await renderStrip();

    act(() => {
      lastDragDropProps().onDragEnd({ source: { index: 3 }, destination: { index: 0 } });
      lastDragDropProps().onDragEnd({ source: { index: 1 }, destination: { index: 3 } });
    });
    await flush();

    expect(posts()).toHaveLength(0);
  });

  test('"Move up" raises above the job just above it', async () => {
    await renderStrip();

    // The menu says which label each move applies before it is made: "Third"
    // (Normal) passing "Second" (High) takes Very High.
    const menu = mockPopupProps.find(
      ({ upPreview }) => upPreview === 'pipeline.willApply{"level":"Very High"}',
    );

    await act(async () => {
      menu.onMoveUp();
    });
    await flush();

    expect(JSON.parse(posts()[0][1].body)).toEqual({ cardId: 'card-c', aboveJobId: 'job-b' });
  });

  test('"To top" raises above the first job that is not e2e or pool work', async () => {
    await renderStrip();

    const menu = mockPopupProps.find(
      ({ upPreview }) => upPreview === 'pipeline.willApply{"level":"Very High"}',
    );

    expect(menu.topPreview).toBe('pipeline.willApply{"level":"High"}');

    await act(async () => {
      menu.onMoveToTop();
    });
    await flush();

    expect(JSON.parse(posts()[0][1].body)).toEqual({ cardId: 'card-c', aboveJobId: 'job-a' });
  });

  test('a refused raise puts the queue back and says why', async () => {
    postAnswer = () => jsonResponse(409, { error: 'that move is not allowed: job is gone' });

    await renderStrip();

    // The refetch after the failure must not be what restores the order.
    getAnswer = () => new Promise(() => {});

    act(() => {
      lastDragDropProps().onDragEnd({ source: { index: 3 }, destination: { index: 1 } });
    });

    await flush();

    const order = [...container.querySelectorAll('[data-job]')].map((element) =>
      element.getAttribute('data-job'),
    );

    expect(order).toEqual(['job-e2e', 'job-a', 'job-b', 'job-c']);
    expect(mockToasts[mockToasts.length - 1].params).toMatchObject({
      title: 'pipeline.raiseFailed',
      detail: 'that move is not allowed: job is gone',
      negative: true,
    });
  });

  test('an editor gets the drain switch, behind a confirmation', async () => {
    await renderStrip();

    expect(container.querySelector('[data-action="drain-on"]')).not.toBeNull();

    const confirmation = mockPopupProps.find(
      ({ title }) => title === 'pipeline.pausePipelineConfirm',
    );

    await act(async () => {
      confirmation.onConfirm();
    });
    await flush();

    expect(posts()[0][0]).toBe('/_term/pipeline/drain');
    expect(JSON.parse(posts()[0][1].body)).toEqual({ on: true });
  });

  // The orchestrator credits the drain to the username; the strip says so
  // before it answers, rather than "by —".
  test('pausing the pipeline credits the editor at once', async () => {
    postAnswer = () => new Promise(() => {});

    await renderStrip();

    const confirmation = mockPopupProps.find(
      ({ title }) => title === 'pipeline.pausePipelineConfirm',
    );

    await act(async () => {
      confirmation.onConfirm();
    });
    await flush();

    expect(container.querySelector('[data-drain-status]').textContent).toContain(
      '"actor":"deniss.k"',
    );
  });

  test('pausing the pipeline falls back to the name when there is no username', async () => {
    mockCurrentUser = { id: 'user-1', name: 'Deniss K', username: null };
    postAnswer = () => new Promise(() => {});

    await renderStrip();

    await act(async () => {
      mockPopupProps.find(({ title }) => title === 'pipeline.pausePipelineConfirm').onConfirm();
    });
    await flush();

    expect(container.querySelector('[data-drain-status]').textContent).toContain(
      '"actor":"Deniss K"',
    );
  });

  test('raise and drain controls are hidden from a viewer who cannot edit', async () => {
    getAnswer = () => jsonResponse(200, view({ canEdit: false }));

    await renderStrip();

    // The queue itself is still shown…
    expect(container.querySelectorAll('[data-job]')).toHaveLength(4);
    // …but nothing moves it and nothing drains the pipeline.
    expect(container.querySelector('[data-action="drain-on"]')).toBeNull();
    expect(container.querySelector('[data-action="drain-off"]')).toBeNull();
    expect(container.querySelector('[data-action="move-menu"]')).toBeNull();
    expect(mockPopupProps.filter(({ onMoveUp }) => onMoveUp)).toHaveLength(0);
    expect(mockDraggableProps.every(({ isDragDisabled }) => isDragDisabled)).toBe(true);
    // Pausing is the card rule, not the editor rule, so it stays.
    expect(container.textContent).toContain('pipeline.pause');
  });

  test('an editor can drag every job that is not locked or already first', async () => {
    await renderStrip();

    const disabled = Object.fromEntries(
      mockDraggableProps
        .slice(-4)
        .map(({ draggableId, isDragDisabled }) => [draggableId, isDragDisabled]),
    );

    expect(disabled).toEqual({ 'job-e2e': true, 'job-a': false, 'job-b': false, 'job-c': false });
  });

  test('pausing a card on a thread posts it and shows it paused at once', async () => {
    postAnswer = () => new Promise(() => {});

    await renderStrip();

    const pauseButton = [...container.querySelectorAll('[data-thread="A1"] button')].find(
      (element) => element.textContent.includes('pipeline.pause'),
    );

    click(pauseButton);
    await flush();

    expect(posts()[0][0]).toBe('/_term/pipeline/pause');
    expect(JSON.parse(posts()[0][1].body)).toEqual({ cardId: 'card-1' });
    expect(container.querySelector('[data-thread="A1"]').textContent).toContain('pipeline.paused');
  });

  test('the ticket name opens the card modal through the router', async () => {
    await renderStrip();

    click(container.querySelector('[data-thread="A1"] button'));

    expect(dispatchedActions).toContainEqual({
      type: 'router-push',
      payload: { to: '/cards/card-1' },
    });
  });
});

test('the queue opens by itself when every thread is busy', async () => {
  localStorage.setItem('planka_pipelineStrip_expanded', 'true');

  getAnswer = () =>
    jsonResponse(
      200,
      view({
        threads: view().threads.filter(({ jobId }) => jobId),
      }),
    );

  await renderStrip();

  expect(container.querySelectorAll('[data-job]')).toHaveLength(4);
});

test('the queue stays shut while a thread is free', async () => {
  localStorage.setItem('planka_pipelineStrip_expanded', 'true');

  await renderStrip();

  expect(container.querySelectorAll('[data-job]')).toHaveLength(0);
});

test('every pipeline string the strip uses is in en-US and ru-RU', () => {
  const sources = [
    'PipelineStrip.jsx',
    'ThreadBar.jsx',
    'QueuePanel.jsx',
    'MoveStep.jsx',
    'TestingTab.jsx',
    'DeploymentTab.jsx',
    'AccountsTab.jsx',
    'StatisticsTab.jsx',
  ]
    .map((file) => fs.readFileSync(path.join(__dirname, file), 'utf8'))
    .join('\n');
  const helpers = fs.readFileSync(path.join(__dirname, '../../../utils/pipeline-strip.js'), 'utf8');

  const keys = new Set(
    [...`${sources}\n${helpers}`.matchAll(/['"`]pipeline\.([A-Za-z0-9_]+)['"`]/g)].map(
      ([, key]) => key,
    ),
  );

  // ConfirmationStep asks for its title with the `title` context.
  ['pausePipelineConfirm', 'resumePipelineConfirm'].forEach((key) => {
    keys.delete(key);
    keys.add(`${key}_title`);
  });
  ['e2e', 'regular', 'express'].forEach((type) => keys.add(`buildType_${type}`));

  expect(keys.size).toBeGreaterThan(100);

  [enUS, ruRU].forEach((locale) => {
    const missing = [...keys].filter((key) => !locale.translation.pipeline[key]);
    expect(missing).toEqual([]);
  });

  expect(Object.keys(ruRU.translation.pipeline).sort()).toEqual(
    Object.keys(enUS.translation.pipeline).sort(),
  );
});

describe('polling', () => {
  const settle = async () => {
    await act(async () => {
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve(); // eslint-disable-line no-await-in-loop
      }
    });
  };

  const advance = async (ms) => {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
    await settle();
  };

  const gets = () => fetchCalls.filter(([, init]) => !init || !init.method);

  const renderWithFakeTimers = async () => {
    act(() => {
      root.render(
        <Provider store={store}>
          <PipelineStrip boardId={BOARD_ID} />
        </Provider>,
      );
    });
    await settle();
  };

  let hidden;

  beforeEach(() => {
    jest.useFakeTimers();
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  });

  afterEach(() => {
    jest.useRealTimers();
    delete document.hidden;
  });

  test('every 30 s while collapsed', async () => {
    await renderWithFakeTimers();
    expect(gets()).toHaveLength(1);

    await advance(29000);
    expect(gets()).toHaveLength(1);

    await advance(1000);
    expect(gets()).toHaveLength(2);
  });

  test('every 5 s while expanded', async () => {
    localStorage.setItem('planka_pipelineStrip_expanded', 'true');

    await renderWithFakeTimers();
    expect(gets()).toHaveLength(1);

    await advance(5000);
    expect(gets()).toHaveLength(2);

    await advance(5000);
    expect(gets()).toHaveLength(3);
  });

  test('not at all on a hidden tab, and at once when it is shown again', async () => {
    hidden = true;

    await renderWithFakeTimers();
    await advance(60000);
    expect(gets()).toHaveLength(0);

    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await settle();
    expect(gets()).toHaveLength(1);
  });

  // A poll whose timer fires while an action's request is pending could be
  // answered from before the action and paint over the optimistic view.
  test('no poll is made while an action is pending, and one follows it', async () => {
    localStorage.setItem('planka_pipelineStrip_expanded', 'true');

    let answerPost;
    postAnswer = () =>
      new Promise((resolve) => {
        answerPost = () => resolve(jsonResponse(200, { drain: { active: true } }));
      });

    await renderWithFakeTimers();
    expect(gets()).toHaveLength(1);

    await act(async () => {
      mockPopupProps.find(({ title }) => title === 'pipeline.pausePipelineConfirm').onConfirm();
    });
    await settle();
    expect(container.querySelector('[data-drain-status]')).not.toBeNull();

    // Two poll intervals pass with the request still pending: the server
    // would still say the pipeline is not draining.
    await advance(10000);
    expect(gets()).toHaveLength(1);
    expect(container.querySelector('[data-drain-status]')).not.toBeNull();

    getAnswer = () => jsonResponse(200, view({ drain: { active: true, actor: 'deniss.k' } }));

    await act(async () => {
      answerPost();
    });
    await settle();

    expect(gets()).toHaveLength(2);
    expect(container.querySelector('[data-drain-status]')).not.toBeNull();

    // And polling goes on as before.
    await advance(5000);
    expect(gets()).toHaveLength(3);
  });

  test('stops asking on a board the pipeline does not drive', async () => {
    getAnswer = () => jsonResponse(200, { pipeline: false });

    await renderWithFakeTimers();
    await advance(120000);

    expect(gets()).toHaveLength(1);
  });
});
