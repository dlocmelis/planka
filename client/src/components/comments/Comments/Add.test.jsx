/**
 * @jest-environment jsdom
 */

/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';

import Add from './Add';

// What the comment box offers when you press `@`. The unit rules live in
// utils/setlfi-reporter.test.js; what THIS test is for is the wiring — a parser
// nothing calls answers nobody, and the ticket is precisely that the dropdown
// did not carry the reporter.
//
// react-mentions is stubbed rather than driven: its suggestion overlay measures
// the caret with layout APIs jsdom does not implement. The stub records the
// `data` the component hands it and renders each entry through the component's
// own `renderSuggestion`, which is exactly the pair the real one uses.
let mentionProps;
let mentionsProps;

jest.mock('react-mentions', () => ({
  __esModule: true,
  // forwardRef because the component holds a ref on it (to close the suggestion
  // list on Escape), and a plain function component would only warn.
  MentionsInput: jest
    .requireActual('react')
    .forwardRef(({ children, value, onChange, inputRef }, ref) => {
      mentionsProps = { value, onChange };
      /* eslint-disable no-param-reassign */
      if (ref) {
        ref.current = { isOpened: () => false, clearSuggestions: () => {} };
      }
      /* eslint-enable no-param-reassign */

      return (
        <div>
          <textarea data-testid="text" ref={inputRef} value={value} onChange={onChange} readOnly />
          {children}
        </div>
      );
    }),
  /* eslint-disable react/prop-types -- a stub, not a component with a contract */
  Mention: ({ data, renderSuggestion, ...rest }) => {
    mentionProps = { data, renderSuggestion, ...rest };
    return (
      <ul data-testid="suggestions">
        {data.map((entry) => (
          <li key={entry.id} data-entry-id={entry.id}>
            {renderSuggestion(entry, '', entry.display, 0, false)}
          </li>
        ))}
      </ul>
    );
  },
  /* eslint-enable react/prop-types */
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => [(key) => key],
}));

let mockCard;
let mockMemberships;

jest.mock('../../../selectors', () => ({
  __esModule: true,
  default: {
    selectCurrentCard: () => mockCard,
    selectMembershipsForCurrentBoard: () => mockMemberships,
  },
}));

jest.mock('../../../entry-actions', () => ({
  __esModule: true,
  default: {
    createCommentInCurrentCard: (data) => ({ type: 'CREATE_COMMENT', payload: data }),
  },
}));

jest.mock('react-redux', () => ({
  useDispatch: () => () => {},
  useSelector: (selector) => selector({}),
}));

jest.mock('../../users/UserAvatar', () => ({
  __esModule: true,
  default: ({ id }) => <span data-testid="avatar">{id}</span>,
}));

window.IS_REACT_ACT_ENVIRONMENT = true;

const SUPPORT_CARD_DESCRIPTION = [
  '--- Setlfi ---',
  'Reporter: Deniss Locmelis den@setlfi.com',
  'Project: Tunzer (6a57aa2cc609223fff50b85c)',
  'Request: SR-000001',
  'Type: bug',
  '--------------',
  '[EVERYTHING BELOW IS VISIBLE TO THE CUSTOMER — put internal notes in a comment]',
  '',
  'Charts do not render for the last quarter.',
].join('\n');

const render = () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const root = createRoot(container);
  act(() => {
    root.render(<Add />);
  });

  return { container, unmount: () => act(() => root.unmount()) };
};

describe('the comment composer on a Setlfi support card', () => {
  beforeEach(() => {
    mentionProps = null;
    mentionsProps = null;
    mockMemberships = [
      // The Planka user from the ticket's screenshot: a colleague whose name
      // begins the same way as the customer's, and who is NOT the reporter.
      { user: { id: '1428506806699622212', username: 'deniss', name: 'Deniss' } },
      { user: { id: '1428506806699622213', username: 'planka_bot', name: 'Orchestrator Bot' } },
    ];
    mockCard = { id: 'card-1', description: SUPPORT_CARD_DESCRIPTION };
  });

  it('offers the ticket reporter, first', () => {
    const { container, unmount } = render();

    expect(mentionProps.data.map((entry) => entry.id)).toEqual([
      'reporter',
      '1428506806699622212',
      '1428506806699622213',
    ]);
    expect(mentionProps.data[0].display).toBe('Deniss Locmelis');

    // And the entry is legible as the customer rather than as a colleague.
    const reporterEntry = container.querySelector('[data-entry-id="reporter"]');
    expect(reporterEntry.textContent).toContain('common.reporter');
    expect(reporterEntry.textContent).toContain('den@setlfi.com');
    expect(reporterEntry.querySelector('[data-testid="avatar"]')).toBeNull();

    unmount();
  });

  it('writes the mention setl reads, with the reporter sentinel as its id', () => {
    // react-mentions builds the markup from `markup`, which this component
    // leaves at the library default — `@[__display__](__id__)`, the same
    // spelling utils/mentions.js writes for a board member. Picking the
    // reporter therefore lands `@[Deniss Locmelis](reporter)` in the comment,
    // which is what setl's CommentVisibility publishes to the feedback page.
    render();

    expect(mentionProps.markup).toBeUndefined();
    expect(mentionProps.displayTransform(mentionProps.data[0].id, 'Deniss Locmelis')).toBe(
      '@Deniss Locmelis',
    );
  });

  it('says the reporter will read the comment, once it tags them', async () => {
    // A comment that leaves the board and lands on a customer's screen must not
    // be a surprise to the person writing it — the visibility rule is otherwise
    // invisible from inside Planka.
    const { container, unmount } = render();

    expect(container.textContent).not.toContain('common.reporterWillSeeThisComment');

    // Driven through the component's own onChange, the way react-mentions calls
    // it when a suggestion is picked: (event, newValue) with the MARKUP.
    const type = async (value) => {
      await act(async () => {
        mentionsProps.onChange({ target: { value } }, value);
      });
    };

    await type('@[Deniss Locmelis](reporter) hi');
    expect(container.textContent).toContain('common.reporterWillSeeThisComment');

    await type('an internal note about @[deniss](1428506806699622212)');
    expect(container.textContent).not.toContain('common.reporterWillSeeThisComment');

    unmount();
  });

  it('offers board members only on a card that is not a support ticket', () => {
    mockCard = { id: 'card-2', description: 'An engineer wrote this card by hand.' };
    const { unmount } = render();

    expect(mentionProps.data.map((entry) => entry.id)).toEqual([
      '1428506806699622212',
      '1428506806699622213',
    ]);

    unmount();
  });

  it('survives a card with no description at all', () => {
    mockCard = { id: 'card-3' };
    const { unmount } = render();

    expect(mentionProps.data).toHaveLength(2);

    unmount();
  });
});
