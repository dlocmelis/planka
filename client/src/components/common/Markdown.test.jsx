/**
 * @jest-environment jsdom
 */

/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import transform from '@diplodoc/transform';

import Markdown from './Markdown';

// THE REAL @diplodoc/transform CANNOT BE LOADED HERE — it pulls in cheerio,
// which ships ESM that this jest runtime will not parse — so the renderer is a
// mock and what is pinned is the component's own decision ladder: try, retry
// without the Liquid pass, and fall back to TEXT. The one thing that needs the
// real library (does a `---` block actually throw?) is pinned separately below
// against @diplodoc/transform/lib/frontmatter, which loads fine.
jest.mock('@diplodoc/transform', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@diplodoc/transform/lib/sanitize', () => ({ defaultOptions: {} }));
jest.mock('@gravity-ui/markdown-editor', () => ({ colorClassName: 'yfm-colorify' }));
jest.mock('../../configs/markdown-plugins', () => ({ __esModule: true, default: [] }));

// The header the Setlfi support API writes on every card it raises on the
// "Setlfi User Requests" board, in the shape that broke: a description that
// opens with `---` is front matter to @diplodoc/transform, and this one is not
// valid YAML. Kept verbatim so the two repositories can be compared by eye.
const LEGACY_SETL_HEADER = [
  '--- Setlfi ---',
  'Reporter: Deniss Locmelis den@setlfi.com',
  'Project: Tunzer (6a57aa2cc609223fff50b85c)',
  'Request: SR-000001',
  'Type: feature',
  '--------------',
  '[EVERYTHING BELOW IS VISIBLE TO THE CUSTOMER — put internal notes in a comment]',
  '',
  'Charts in Setlfi BI: time series graphs.',
].join('\n');

window.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

const render = (source) => {
  act(() => {
    root.render(<Markdown>{source}</Markdown>);
  });
};

beforeEach(() => {
  transform.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('Markdown', () => {
  it('renders what the transform returns', () => {
    transform.mockReturnValue({ result: { html: '<p>hello</p>' } });

    render('hello');

    expect(container.querySelector('.yfm').innerHTML).toBe('<p>hello</p>');
    expect(transform).toHaveBeenCalledTimes(1);
  });

  it('retries without the Liquid pass when front matter parsing throws', () => {
    transform.mockImplementationOnce(() => {
      throw new Error('YAMLException: end of the stream or a document separator is expected (2:9)');
    });
    transform.mockReturnValue({ result: { html: '<p>the card body</p>' } });

    render(LEGACY_SETL_HEADER);

    expect(transform).toHaveBeenCalledTimes(2);
    expect(transform.mock.calls[0][1].disableLiquid).toBeUndefined();
    expect(transform.mock.calls[1][1].disableLiquid).toBe(true);
    expect(container.querySelector('.yfm').innerHTML).toBe('<p>the card body</p>');
  });

  // THE REGRESSION THIS FILE EXISTS FOR. The catch arm used to `return
  // error.toString()`, and that string goes into dangerouslySetInnerHTML. A
  // js-yaml exception quotes the OFFENDING SOURCE LINES back in its message, and
  // on this board those lines are a support ticket description written by a
  // CUSTOMER — so a description could inject live HTML into an engineer's page,
  // and every reader saw a stack trace instead of the report either way.
  it('falls back to escaped text, never to the error message', () => {
    const source = '---\n<img src="x" onerror="window.pwned = true">\na: 1\nb\n---\nbody';
    transform.mockImplementation(() => {
      throw new Error(`YAMLException: broken\n\n 1 | ${source}`);
    });

    render(source);

    expect(transform).toHaveBeenCalledTimes(2);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src="x"');
    expect(container.textContent).not.toContain('YAMLException');
  });
});

// WHAT THE MOCK ABOVE CANNOT SAY: that the shape really does throw. This runs
// the front-matter step of the installed @diplodoc/transform — the same code
// path transform() reaches through its Liquid pass — over the two header shapes
// the Setlfi support API writes (setl: data/core/support/planka.go, CardHeader).
describe('@diplodoc/transform front matter', () => {
  const { extractFrontMatter } = jest.requireActual('@diplodoc/transform/lib/frontmatter');

  it('throws on a description that opens with a `---` block that is not YAML', () => {
    expect(() => extractFrontMatter(LEGACY_SETL_HEADER)).toThrow(/YAML|end of the stream/i);
  });

  it('leaves a description that does not open on `---` alone', () => {
    const current = [
      '**Setlfi ticket**',
      '',
      'Reporter: Deniss Locmelis den@setlfi.com',
      'Project: Tunzer (6a57aa2cc609223fff50b85c)',
      'Request: SR-000001',
      'Type: feature',
      '',
      '---',
      '',
      '[EVERYTHING BELOW IS VISIBLE TO THE CUSTOMER — put internal notes in a comment]',
      '',
      'Charts in Setlfi BI: time series graphs.',
    ].join('\n');

    const [frontMatter, stripped] = extractFrontMatter(current);
    expect(frontMatter).toEqual({});
    expect(stripped).toBe(current);
  });
});
