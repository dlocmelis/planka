/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * The ticket reporter as a mention target.
 *
 * A card on the Setlfi User Requests board is a customer's support ticket,
 * mirrored here by setl's support feature. THE REPORTER HAS NO PLANKA ACCOUNT
 * — every card and comment on that board is authored by one bot — so the
 * mention dropdown, which offers board members, could never offer the one
 * person a staff member most wants to answer. The only route to the customer
 * was an undocumented literal (`@reporter`) typed by hand as the first token of
 * the comment, and a Planka user who happens to share the customer's first name
 * is not the same person: that is the whole of the bug this file exists for.
 *
 * So the entry is synthetic. Everything known about the reporter is in the card
 * description, in the header setl writes (`CardHeader`,
 * data/core/support/planka.go in the setl repository):
 *
 *     **Setlfi ticket**
 *
 *     Reporter: Deniss Locmelis den@setlfi.com
 *     Project: Tunzer (6a57aa2cc609223fff50b85c)
 *     Request: SR-000001
 *     Type: bug
 *
 *     ---
 *
 *     [EVERYTHING BELOW IS VISIBLE TO THE CUSTOMER — put internal notes in a comment]
 *
 * BOTH OPENERS ARE READ. The header used to open `--- Setlfi ---` and close on
 * a row of dashes; that shape made this renderer's own Markdown transform read
 * the card as YAML front matter and print a stack trace where the description
 * belongs, so setl rewrote it. The board still holds every card raised before
 * that, and their reporters have to be taggable too — setl's own
 * `CustomerDescriptionFrom` accepts both for the same reason.
 *
 * THIS IS A CONTRACT BETWEEN TWO REPOSITORIES WITH NO WIRE FORMAT IN BETWEEN.
 * Both sides transcribe it by hand rather than sharing a constant, because
 * nothing here can fail loudly: a reworded header does not break a build, it
 * quietly empties this dropdown, and the customer is never answered.
 * `setlfi-reporter.test.js` pins it here, `TestCardHeaderIsTheShapePlankaParses`
 * pins it in setl.
 *
 * The other end of the round trip is setl's `CommentVisibility`
 * (data/core/support/visibility.go): a comment whose text carries
 * `@[<name>](reporter)` anywhere is mirrored as visible to the reporter and
 * appears on their /feedback page. REPORTER_MENTION_ID is that sentinel, and it
 * cannot collide with a real user: Planka ids are numeric snowflakes.
 */

// The header block, exactly as setl writes it. Only an opener and the reporter
// line are needed to identify the reporter; the closing rule bounds the search
// so a customer who types "Reporter: someone else" into their own description
// cannot redirect a mention.
const HEADER_OPENER = '**Setlfi ticket**';
const LEGACY_HEADER_OPENER = '--- Setlfi ---';
const REPORTER_LINE_PREFIX = 'Reporter:';

// The closing rule, matched as "a line that is nothing but dashes" — `---` as
// written today, `--------------` as written before, and any length between,
// because a human retyping it does not count the dashes. It is `isHeaderRule`
// in setl's data/core/support/planka.go, rule for rule.
const isHeaderRule = (trimmed) => trimmed.length >= 3 && trimmed.replace(/-/g, '') === '';

export const REPORTER_MENTION_ID = 'reporter';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Reads the reporter off a card description, or returns null when the card is
 * not a Setlfi support card.
 *
 * The rules are deliberately narrow — the header has to OPEN the description,
 * and the reporter line has to be inside it. A card an engineer wrote by hand
 * on the same board is not a support ticket and must not grow a mention entry
 * for a customer who does not exist.
 */
export const parseReporterFromCardDescription = (description) => {
  if (typeof description !== 'string') {
    return null;
  }

  const trimmed = description.replace(/^[\s]+/, '');
  if (!trimmed.startsWith(HEADER_OPENER) && !trimmed.startsWith(LEGACY_HEADER_OPENER)) {
    return null;
  }

  const lines = trimmed.split('\n');
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    // The closing rule ends the header. Everything under it is the customer's
    // own description, which the customer writes.
    if (isHeaderRule(line)) {
      return null;
    }
    if (!line.startsWith(REPORTER_LINE_PREFIX)) {
      continue; // eslint-disable-line no-continue
    }

    const rest = line.slice(REPORTER_LINE_PREFIX.length).trim();
    if (!rest) {
      return null;
    }

    // `Reporter: <name> <email>`, and the name is free text that may hold
    // spaces. The LAST token is the email when it looks like one; a header
    // written without one (setl allows an empty reporter name, not an empty
    // address, but this side must not assume) still yields a usable entry.
    const parts = rest.split(/\s+/);
    const last = parts[parts.length - 1];
    const hasEmail = parts.length > 1 && EMAIL_REGEX.test(last);
    const email = hasEmail ? last : '';
    const name = (hasEmail ? parts.slice(0, -1).join(' ') : rest).trim();

    return {
      id: REPORTER_MENTION_ID,
      // The display is what lands in the comment as `@[<display>](reporter)`,
      // so it must never be empty and must never contain the `]` that would
      // truncate the markup.
      display: (name || email || 'reporter').replace(/[[\]()]/g, '').trim() || 'reporter',
      email,
    };
  }

  return null;
};

/**
 * The `data` a comment box hands react-mentions: the reporter first, then the
 * board members.
 *
 * The reporter leads because they are the reason a support card has comments at
 * all, and because a board member with a similar name sitting above them is
 * precisely the mis-tag the screenshot on the ticket showed.
 */
export const buildMentionData = (boardMemberships, reporter) => {
  const members = boardMemberships.map(({ user }) => ({
    id: user.id,
    display: user.username || user.name,
  }));

  // `email` rides along on the entry: react-mentions hands the whole object
  // back to renderSuggestion, which is where it becomes the line that says this
  // is the customer and not a colleague.
  return reporter
    ? [{ id: reporter.id, display: reporter.display, email: reporter.email }, ...members]
    : members;
};

/** True for the synthetic entry, which has no Planka user behind it to render. */
export const isReporterMentionId = (id) => id === REPORTER_MENTION_ID;

// The markup react-mentions writes for the entry above, and the same expression
// setl's `HasReporterMention` applies to the stored comment. It is here so the
// composer can SAY what the tag is about to do — a comment that reaches a
// customer should never be a surprise to the person who wrote it.
const REPORTER_MENTION_REGEX = new RegExp(`@\\[.*?\\]\\(${REPORTER_MENTION_ID}\\)`);

/** True when this comment text tags the reporter, and so will be shown to them. */
export const hasReporterMention = (text) =>
  typeof text === 'string' && REPORTER_MENTION_REGEX.test(text);
