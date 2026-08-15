/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import transform from '@diplodoc/transform';

import markdownToText from './markdown-to-text';

// The real transform pulls in cheerio, which ships ESM this jest runtime will
// not parse, so the renderer is mocked and what is pinned here is the decision
// this module makes when it throws. See components/common/Markdown.test.jsx for
// the same ladder in the component, and for the check against the real library.
jest.mock('@diplodoc/transform', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../configs/markdown-plugins', () => ({ __esModule: true, default: [] }));

const textTokens = (text) => [{ children: [{ type: 'text', content: text }] }];

// A card description raised by the Setlfi support API before its header stopped
// looking like YAML front matter (setl: data/core/support/planka.go).
const LEGACY_SETL_HEADER = [
  '--- Setlfi ---',
  'Reporter: Deniss Locmelis den@setlfi.com',
  'Request: SR-000001',
  '--------------',
  '',
  'Charts in Setlfi BI: time series graphs.',
].join('\n');

beforeEach(() => {
  transform.mockReset();
});

describe('markdownToText', () => {
  it('returns the text of the tokens', () => {
    transform.mockReturnValue(textTokens('hello'));

    expect(markdownToText('hello')).toBe('hello');
    expect(transform).toHaveBeenCalledTimes(1);
  });

  it('retries without the Liquid pass when front matter parsing throws', () => {
    transform.mockImplementationOnce(() => {
      throw new Error('YAMLException: end of the stream or a document separator is expected (2:9)');
    });
    transform.mockReturnValue(textTokens('Charts in Setlfi BI: time series graphs.'));

    expect(markdownToText(LEGACY_SETL_HEADER)).toBe('Charts in Setlfi BI: time series graphs.');
    expect(transform).toHaveBeenCalledTimes(2);
    expect(transform.mock.calls[0][1].disableLiquid).toBeUndefined();
    expect(transform.mock.calls[1][1].disableLiquid).toBe(true);
  });

  // This is the board tile's preview text. It used to be `error.toString()`, so
  // a card that could not be parsed advertised a stack trace — quoting the
  // description's own lines — from the board.
  it('falls back to the source, never to the error message', () => {
    transform.mockImplementation(() => {
      throw new Error(`YAMLException: broken\n\n 1 | ${LEGACY_SETL_HEADER}`);
    });

    expect(markdownToText(LEGACY_SETL_HEADER)).toBe(LEGACY_SETL_HEADER);
    expect(transform).toHaveBeenCalledTimes(2);
  });
});
