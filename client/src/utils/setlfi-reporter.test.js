/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import {
  REPORTER_MENTION_ID,
  buildMentionData,
  hasReporterMention,
  isReporterMentionId,
  parseReporterFromCardDescription,
} from './setlfi-reporter';

// The card header is written by ANOTHER REPOSITORY (setl's
// data/core/support/planka.go, `CardHeader`) and there is no wire format
// between the two. So it is written out here BY HAND, byte for byte — a test
// that built the fixture from this module's own constants would agree with it
// again after somebody reworded either side, and the failure that reaches a
// customer instead is silent: an empty dropdown and a ticket nobody answers.
//
// The counterpart is `TestCardHeaderIsTheShapePlankaParses` in setl.
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

describe('parseReporterFromCardDescription', () => {
  it('reads the reporter off a Setlfi support card', () => {
    expect(parseReporterFromCardDescription(SUPPORT_CARD_DESCRIPTION)).toEqual({
      id: 'reporter',
      display: 'Deniss Locmelis',
      email: 'den@setlfi.com',
    });
  });

  it('is not fooled by a card that is not a support ticket', () => {
    // The board is shared: an engineer's own card must not grow a mention entry
    // for a customer who does not exist.
    expect(parseReporterFromCardDescription('Reporter: Someone Else x@y.com')).toBeNull();
    expect(parseReporterFromCardDescription('Just a card an engineer wrote.')).toBeNull();
    expect(parseReporterFromCardDescription('')).toBeNull();
    expect(parseReporterFromCardDescription(undefined)).toBeNull();
    expect(parseReporterFromCardDescription(null)).toBeNull();
  });

  it('refuses a reporter line written BELOW the header block', () => {
    // Everything under the closer is the customer's own description, and the
    // customer types it. It must not be able to redirect a mention.
    const spoofed = [
      '--- Setlfi ---',
      'Project: Tunzer (6a57aa2cc609223fff50b85c)',
      'Request: SR-000001',
      'Type: bug',
      '--------------',
      'Reporter: Someone Else nope@example.com',
    ].join('\n');

    expect(parseReporterFromCardDescription(spoofed)).toBeNull();
  });

  it('keeps a name with several words, and copes with a header carrying no email', () => {
    const twoBarrelled = SUPPORT_CARD_DESCRIPTION.replace(
      'Reporter: Deniss Locmelis den@setlfi.com',
      'Reporter: Ada King Countess of Lovelace ada@example.com',
    );
    expect(parseReporterFromCardDescription(twoBarrelled)).toEqual({
      id: 'reporter',
      display: 'Ada King Countess of Lovelace',
      email: 'ada@example.com',
    });

    const nameless = SUPPORT_CARD_DESCRIPTION.replace(
      'Reporter: Deniss Locmelis den@setlfi.com',
      'Reporter: den@setlfi.com',
    );
    expect(parseReporterFromCardDescription(nameless)).toEqual({
      id: 'reporter',
      display: 'den@setlfi.com',
      email: '',
    });
  });

  it('never yields a display that would truncate the mention markup', () => {
    // The display is written into `@[<display>](reporter)`. A `]` in it would
    // end the markup early and the mention would stop being a mention — which
    // on the setl side means the comment silently never reaches the customer.
    const bracketed = SUPPORT_CARD_DESCRIPTION.replace(
      'Reporter: Deniss Locmelis den@setlfi.com',
      'Reporter: Deniss [the] (real) Locmelis den@setlfi.com',
    );
    const reporter = parseReporterFromCardDescription(bracketed);

    expect(reporter.display).toBe('Deniss the real Locmelis');
    expect(reporter.display).not.toMatch(/[[\]()]/);
  });
});

describe('buildMentionData', () => {
  const MEMBERSHIPS = [
    { user: { id: '1428506806699622212', username: 'deniss', name: 'Deniss' } },
    { user: { id: '1428506806699622213', username: null, name: 'Orchestrator Bot' } },
  ];

  it('offers the reporter FIRST, above the board members', () => {
    // The screenshot on the ticket is a dropdown holding `planka_bot` and
    // `deniss` — a Planka user who is NOT the reporter, and whose name starts
    // the same way. Ordering is the difference between tagging the customer and
    // tagging a colleague by accident.
    const reporter = parseReporterFromCardDescription(SUPPORT_CARD_DESCRIPTION);

    expect(buildMentionData(MEMBERSHIPS, reporter)).toEqual([
      { id: 'reporter', display: 'Deniss Locmelis', email: 'den@setlfi.com' },
      { id: '1428506806699622212', display: 'deniss' },
      { id: '1428506806699622213', display: 'Orchestrator Bot' },
    ]);
  });

  it('is exactly the board members on a card with no reporter', () => {
    expect(buildMentionData(MEMBERSHIPS, null)).toEqual([
      { id: '1428506806699622212', display: 'deniss' },
      { id: '1428506806699622213', display: 'Orchestrator Bot' },
    ]);
  });
});

describe('hasReporterMention', () => {
  // It answers the same question setl's `HasReporterMention` answers over the
  // stored comment, and it is what the composer's "the reporter will see this"
  // notice hangs off — so the two must not drift.
  it('is true for the markup the dropdown writes, anywhere in the text', () => {
    expect(hasReporterMention('@[Deniss Locmelis](reporter) shipping Friday')).toBe(true);
    expect(hasReporterMention('Thanks @[Deniss Locmelis](reporter), it is live.')).toBe(true);
    expect(hasReporterMention('Shipped.\n\ncc @[Deniss Locmelis](reporter)')).toBe(true);
  });

  it('is false for anything a staff member writes to a colleague', () => {
    expect(hasReporterMention('@[deniss](1428506806699622212) can you look?')).toBe(false);
    expect(hasReporterMention('the reporter says it is still broken')).toBe(false);
    expect(hasReporterMention('@[someone](reporter-2) ping')).toBe(false);
    expect(hasReporterMention('')).toBe(false);
    expect(hasReporterMention(undefined)).toBe(false);
  });
});

describe('the sentinel id', () => {
  it('is the literal setl looks for, and cannot be a Planka user id', () => {
    // setl's data/core/support/visibility.go turns `@[<name>](reporter)` into a
    // comment the customer can read. Planka ids are numeric snowflakes, so the
    // sentinel can never collide with one.
    expect(REPORTER_MENTION_ID).toBe('reporter');
    expect(isReporterMentionId('reporter')).toBe(true);
    expect(isReporterMentionId('1428506806699622212')).toBe(false);
  });
});
