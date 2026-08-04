/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://build.setlfi.com/"}
 */

/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { createStore } from 'redux';

import Linkify from './Linkify';

let mockCardsById;

// react-router builds an encoder at import time, and the jsdom environment has
// no TextEncoder. The factory runs before the real module is loaded, which is
// the one hook that lets the shim land first — jest hoists it above the imports.
jest.mock('react-router', () => {
  if (typeof global.TextEncoder === 'undefined') {
    // eslint-disable-next-line global-require
    const { TextEncoder, TextDecoder } = require('util');

    global.TextEncoder = TextEncoder;
    global.TextDecoder = TextDecoder;
  }

  return jest.requireActual('react-router');
});

jest.mock('../../../selectors', () => ({
  __esModule: true,
  default: {
    makeSelectCardById: () => (_, id) => mockCardsById[id] || null,
  },
}));

// The subtask name that took the board down on 2026-08-04: the progress trail
// was cut inside the host of its last link, leaving `https://github.c` with an
// ellipsis glued to it.
const INCIDENT_NAME =
  't00b · 3 files changed: … · 41 command runs · https://beszel.dev/guide/alerts, ' +
  'Beszel alerts per system "all systems"…, https://github.c…';

window.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let store;

const render = (children) => {
  act(() => {
    root.render(
      <Provider store={store}>
        <Linkify>{children}</Linkify>
      </Provider>,
    );
  });
};

beforeEach(() => {
  mockCardsById = {};

  container = document.createElement('div');
  document.body.appendChild(container);

  root = createRoot(container);
  store = createStore(() => ({}));
});

afterEach(() => {
  act(() => {
    root.unmount();
  });

  container.remove();
});

describe('Linkify', () => {
  it('renders a name whose link is cut mid-host instead of unmounting the app', () => {
    // The premise: this is the href the linkifier hands to Link, and the URL
    // parser rejects an ellipsis inside a host.
    expect(() => new URL('https://github.c…')).toThrow();

    render(INCIDENT_NAME);

    expect(container.textContent).toBe(INCIDENT_NAME);
    expect(container.childNodes.length).toBeGreaterThan(0);
  });

  it('renders an unparseable link as a dead link that goes nowhere useful', () => {
    render('https://github.c…');

    const anchor = container.querySelector('a');
    expect(anchor.textContent).toBe('https://github.c…');
    expect(anchor.getAttribute('target')).toBe('_blank');
  });

  it('keeps showing a link cut in its path', () => {
    render('see https://x.dev/pa…');

    const anchor = container.querySelector('a');
    expect(anchor.getAttribute('href')).toBe('https://x.dev/pa…');
    expect(container.textContent).toBe('see https://x.dev/pa…');
  });

  it('still renders a link to a card on this board as the card name', () => {
    // Quoted: card ids run past what a JS number holds exactly, and an
    // unquoted key would round to a different id than the path carries.
    mockCardsById = { '1833384957804807450': { name: 'A card on the board' } };

    render('https://build.setlfi.com/cards/1833384957804807450');

    const anchor = container.querySelector('a');
    expect(anchor.textContent).toBe('A card on the board');
    expect(anchor.getAttribute('target')).toBeNull();
  });

  it('leaves a same-site link that is not a card alone', () => {
    render('https://build.setlfi.com/boards/1824238005867512848');

    const anchor = container.querySelector('a');
    expect(anchor.textContent).toBe('https://build.setlfi.com/boards/1824238005867512848');
  });
});
