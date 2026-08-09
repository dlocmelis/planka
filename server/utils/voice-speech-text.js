/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * Markdown → speakable text.
 *
 * planka_bot answers in markdown and a speech model reads what it is given, so
 * "## Summary" becomes "hash hash Summary" and a fenced diff becomes ninety
 * seconds of punctuation. This is the one place that is fixed, before anything
 * reaches a provider.
 *
 * Ported from the Setlfi assistant's server voice — setl's
 * `data/core/tts/markdown.go` (the strip) and `data/core/tts/table.go` (the
 * narration), which are the files this ticket was told to reuse. The wording of
 * the narration, the row cap and the placeholders are carried across
 * VERBATIM: a table read out one way by the assistant and another way here
 * would be the same product speaking two dialects. Change one side and change
 * the other.
 *
 * What deliberately did NOT come across is `data/core/tts/numbers.go`, the pass
 * that rewrites figures into spoken form ("1.2M" → "1.2 million"). It is gated
 * on the message being English, it changes the user's own characters — where
 * being wrong about the locale changes a figure's VALUE — and a board comment
 * is not the per-merchant financial table it was written for. The cell text is
 * copied through unchanged instead, which is what the narration itself does.
 */

/** Stands in for a fenced code block. A block kind is REPLACED rather than
 * removed when its absence is itself information: a reply that showed
 * something and then says "as you can see above" is confusing if the thing
 * simply vanished. */
const CODE_PLACEHOLDER = '…code omitted…';

/** Stands in for a markdown table that could not be narrated — a block with a
 * delimiter row and no usable cells. */
const TABLE_PLACEHOLDER = '…table omitted…';

/** How many body rows are spoken before the rest are summarized ("And 24 more
 * rows."). At roughly ten words a row a 60-row table is four minutes of digits,
 * which nobody listens to; the tail is ANNOUNCED rather than dropped in
 * silence, because a listener who is told there are 24 more rows can look at
 * the screen, where the table still is. */
const MAX_NARRATED_ROWS = 20;

// Fence openers/closers: ``` or ~~~, at ANY indent, with an optional info
// string. CommonMark caps a fence's own indent at 3 spaces, but a fence nested
// two list levels deep lands at 4+ and is still a fence — a routine shape in
// bot replies. Nothing is lost by being lax: an indented bare ``` is never
// speakable text.
const FENCE_RE = /^\s*(```+|~~~+)/;
// The row that makes the lines around it a table rather than text that happens
// to contain a pipe.
const TABLE_DELIM_RE = /^\s*\|?[\s:|-]*-[\s:|-]*\|[\s:|-]*$/;
// Setext heading underline: === or --- directly beneath a paragraph.
const SETEXT_RE = /^\s{0,3}(=+|-+)\s*$/;

const ATX_HEADING_RE = /^\s{0,3}#{1,6}\s+/;
const BLOCKQUOTE_RE = /^\s*>\s?/;
const BULLET_RE = /^\s*[-*+]\s+/;
const ORDERED_RE = /^\s*\d{1,9}[.)]\s+/;
const IMAGE_RE = /!\[([^\]]*)\]\([^)]*\)/g;
const INLINE_LINK_RE = /\[([^\]]*)\]\([^)]*\)/g;
const REF_LINK_RE = /\[([^\]]*)\]\[[^\]]*\]/g;
const AUTOLINK_RE = /<((?:https?|mailto):[^>\s]+)>/g;
const HTML_TAG_RE = /<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s[^<>]*)?\/?>/g;
const DOUBLE_TICK_RE = /``([^`]+)``/g;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const BOLD_STAR_RE = /\*\*([^*]+)\*\*/g;
const BOLD_UNDER_RE = /__([^_]+)__/g;
const STRIKE_RE = /~~([^~]+)~~/g;
const ITALIC_STAR_RE = /\*([^*\n]+)\*/g;
// Underscore emphasis with explicit boundaries: without them `snake_case_name`
// loses its underscores and is spoken as one word.
const ITALIC_UNDER_RE = /(?<![\p{L}\p{N}_])_([^_\n]+)_(?![\p{L}\p{N}_])/gu;
const BLANK_LINES_RE = /\n{3,}/g;
const TRAILING_SPACE_RE = /[ \t]+\n/g;
const MULTI_SPACE_RE = /[ \t]{2,}/g;
// Backslash escapes: \* \_ \# … — the escape is syntax, the char is text.
const ESCAPE_RE = /\\([\\`*_{}[\]()#+\-.!|>~])/g;

/**
 * The characters a backslash may escape in markdown, and the private-use runes
 * they are parked on while the inline passes run.
 *
 * An escaped star is TEXT, but the emphasis passes cannot tell it from syntax —
 * `\*star\*` came out as `\star\`. So each escaped character is swapped for a
 * code point no markdown construct matches, and swapped back at the end.
 */
const ESCAPABLE_CHARS = '\\`*_{}[]()#+-.!|>~';
const ESCAPE_PLACEHOLDER = 0xe000; // private use area

const maskEscapes = (text) => {
  // A private-use character already in the text would be restored as a markdown
  // character it never was; nothing legitimate emits them, so they go.
  const cleaned = [...text]
    .filter((character) => {
      const code = character.codePointAt(0);
      return code < ESCAPE_PLACEHOLDER || code >= ESCAPE_PLACEHOLDER + ESCAPABLE_CHARS.length;
    })
    .join('');

  return cleaned.replace(ESCAPE_RE, (match, character) => {
    const index = ESCAPABLE_CHARS.indexOf(character);
    return index < 0 ? match : String.fromCodePoint(ESCAPE_PLACEHOLDER + index);
  });
};

const unmaskEscapes = (text) =>
  [...text]
    .map((character) => {
      const index = character.codePointAt(0) - ESCAPE_PLACEHOLDER;
      return index >= 0 && index < ESCAPABLE_CHARS.length ? ESCAPABLE_CHARS[index] : character;
    })
    .join('');

/**
 * Every element name in the HTML Living Standard's element index, plus the
 * obsolete presentational ones a model still emits.
 *
 * It is a WHITELIST on purpose: `<word …>` is not only markup. In ordinary
 * prose it is a comparison ("balance<threshold and days>30") or a placeholder
 * ("put it in <path>"), and deleting one takes words out of a sentence the
 * voice then reads confidently and wrongly. Foreign content (svg, math and
 * their children) is deliberately absent — `<path>`, `<text>` and `<line>` are
 * words, and speaking a stray tag name is a far smaller failure than deleting
 * one.
 */
const HTML_ELEMENTS = new Set(
  (
    'a abbr acronym address applet area article aside audio b base basefont bdi bdo big blink ' +
    'blockquote body br button canvas caption center cite code col colgroup data datalist dd del ' +
    'details dfn dialog dir div dl dt em embed fieldset figcaption figure font footer form frame ' +
    'frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend ' +
    'li link main map mark marquee menu meta meter nav nobr noframes noscript object ol optgroup ' +
    'option output p param picture pre progress q rp rt ruby s samp script search section select ' +
    'slot small source span strike strong style sub summary sup table tbody td template textarea ' +
    'tfoot th thead time title tr track tt u ul var video wbr xmp'
  ).split(' '),
);

/** Removes HTML tags and leaves everything else exactly as it was, including a
 * `<`/`>` pair that is not markup. */
const stripHtmlTags = (text) =>
  text.replace(HTML_TAG_RE, (tag, name) => (HTML_ELEMENTS.has(name.toLowerCase()) ? '' : tag));

/**
 * Whether a line is a thematic break: three or more of `-`, `*` or `_`, all the
 * same character, spaces allowed between them and up to three in front.
 */
const isThematicBreak = (line) => {
  const trimmed = line.replace(/^ +/, '');

  if (line.length - trimmed.length > 3) {
    return false;
  }

  let marker = '';
  let count = 0;

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];

    if (character === ' ' || character === '\t') {
      // Spaces between the markers are allowed.
    } else if (character === '-' || character === '*' || character === '_') {
      if (marker === '') {
        marker = character;
      } else if (character !== marker) {
        return false;
      }

      count += 1;
    } else {
      return false;
    }
  }

  return count >= 3;
};

/** Whether a line closes a fence opened with `opener`. A closer must use the
 * same character and be at least as long, so a ``` inside a ~~~ block does not
 * end it. */
const isFenceClose = (line, opener) => {
  const match = FENCE_RE.exec(line);

  if (!match) {
    return false;
  }

  return match[1][0] === opener[0] && match[1].length >= opener.length;
};

/** Gives a heading a full stop when it has no terminal punctuation of its own,
 * so the model pauses instead of running it into the next line. */
const endSentence = (value) => {
  const trimmed = value.replace(/[ \t]+$/, '');

  if (trimmed === '') {
    return trimmed;
  }

  return '.!?:;,'.includes(trimmed[trimmed.length - 1]) ? trimmed : `${trimmed}.`;
};

/**
 * Whether text holds anything a voice could say — at least one letter or digit.
 *
 * Checked on the FINAL text, which is why the placeholders deliberately contain
 * words: "…code omitted…" is worth speaking, "###" is not.
 */
const hasSpeakableContent = (text) => /[\p{L}\p{N}]/u.test(String(text || ''));

/** Drops blank entries from a list of labels, so a table with an unnamed column
 * does not narrate an empty item ("Volume,  and Fees"). */
const nonEmpty = (items) => items.filter((item) => item !== '');

/** Renders items the way a person reads a list out: "a, b and c". */
const joinList = (items) => {
  if (items.length === 0) {
    return '';
  }

  if (items.length === 1) {
    return items[0];
  }

  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }

  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
};

/** Renders "1 row" / "2 rows". */
const plural = (count, singular, pluralForm) =>
  count === 1 ? `1 ${singular}` : `${count} ${pluralForm}`;

/**
 * Whether a cell is a figure rather than a name.
 *
 * Deliberately generous about the decoration a figure carries — a currency
 * symbol, thousands separators, a percent sign, a magnitude suffix, a leading
 * sign, accounting parentheses — because all of those are what a number looks
 * like in a table. A magnitude letter only counts as a SUFFIX: "1.2M" is a
 * figure, "M1" is an identifier, and reading it as a figure would cost the
 * table its subject column.
 */
const looksNumeric = (cell) => {
  let digits = 0;

  // `every` short-circuits, so this reads the cell exactly as far as the first
  // character that rules it out.
  const isAllowed = [...cell].every((character) => {
    if (/\d/.test(character)) {
      digits += 1;
      return true;
    }

    // A space is a thousands separator in half of Europe; the rest is the
    // decoration a figure carries.
    if (/\s/.test(character) || '.,+-%()$€£¥'.includes(character)) {
      return true;
    }

    // The magnitude suffixes (k, M, bn, tn) — and only as a SUFFIX.
    if ('kKmMbBtTn'.includes(character)) {
      return digits > 0;
    }

    return false;
  });

  return isAllowed && digits > 0;
};

// A calendar period written entirely in digits: a bare year, an ISO date or
// month, or a slashed date. Anything with a letter in it — "Q1 2024" — is
// already non-numeric and needs no help from this.
const DATE_LIKE_RE = /^(?:\d{4}|\d{4}-\d{1,2}(?:-\d{1,2})?|\d{1,2}\/\d{1,2}\/\d{2,4})$/;

/** Whether a cell is a calendar period rather than a measurement. A bare
 * four-digit number is only read as a year inside a plausible range — 30000
 * rows processed is a count, 2024 is a year. */
const looksLikeDate = (cell) => {
  if (!DATE_LIKE_RE.test(cell)) {
    return false;
  }

  if (cell.length === 4) {
    const year = Number.parseInt(cell, 10);
    return year >= 1900 && year <= 2100;
  }

  return true;
};

/**
 * Splits one `| a | b |` row into its trimmed cells, or null when the row
 * carries no data at all.
 *
 * The outer pipes are optional in GFM, so they are trimmed rather than
 * required. An escaped pipe needs no special handling: every backslash escape
 * is masked onto a private-use character BEFORE the block loop runs, so a `\|`
 * is not a `|` by the time this sees it — which is also why narration must copy
 * cell text through verbatim instead of trying to read it.
 */
const splitTableRow = (line) => {
  let trimmed = line.trim();

  if (trimmed === '') {
    return null;
  }

  trimmed = trimmed.replace(/^\|/, '').replace(/\|$/, '');

  const cells = trimmed.split('|').map((cell) => cell.trim());

  // A row of nothing but empty cells carries no data and would narrate as a
  // bare full stop.
  return cells.some((cell) => cell !== '') ? cells : null;
};

const parseTableBlock = (lines) => {
  if (lines.length < 2) {
    return { header: [], rows: [] };
  }

  const header = splitTableRow(lines[0]) || [];
  const rows = [];

  lines.slice(2).forEach((line) => {
    const cells = splitTableRow(line);

    if (cells) {
      rows.push(cells);
    }
  });

  return { header, rows };
};

/**
 * Whether the first column names its rows rather than measuring them.
 *
 * Decided from the DATA, not the header: a column of figures is a measure
 * whatever it is called, and a column of names is a subject whatever it is
 * called — including when it is called nothing at all, which is the shape a
 * statistical summary is rendered in. A majority, not "any": one non-numeric
 * cell in a column of figures is a footnote marker, not evidence.
 */
const hasLabelColumn = (block) => {
  if (block.header.length < 2) {
    return false;
  }

  let named = 0;

  block.rows.forEach((row) => {
    if (row.length === 0 || row[0] === '') {
      return;
    }

    // A period is a subject even though it is written in digits: a table keyed
    // by year would otherwise be narrated "Row 1: Year 2023, Revenue 100".
    if (!looksNumeric(row[0]) || looksLikeDate(row[0])) {
      named += 1;
    }
  });

  return named * 2 > block.rows.length;
};

/** Speaks a one-column table as the list it is. Running it through the
 * row-by-row form below would produce "Row 1: Merchant Acme.", once per
 * value. */
const narrateSingleColumn = (block) => {
  const label = block.header[0];
  let values = block.rows.filter((row) => row.length > 0 && row[0] !== '').map((row) => row[0]);

  if (values.length === 0) {
    return '';
  }

  let more = 0;
  if (values.length > MAX_NARRATED_ROWS) {
    more = values.length - MAX_NARRATED_ROWS;
    values = values.slice(0, MAX_NARRATED_ROWS);
  }

  let sentence =
    label === '' ? `A table of ${joinList(values)}.` : `A table of ${label}: ${joinList(values)}.`;

  if (more > 0) {
    sentence += ` And ${plural(more, 'more value', 'more values')}.`;
  }

  return sentence;
};

/**
 * Speaks a table of two or more columns.
 *
 * The first column is treated as the row's SUBJECT when it reads like one,
 * because that is what makes a row a sentence ("Acme: Volume 1234.56, Fees
 * 12.34") instead of a list of coordinates. A table whose first column is
 * itself a figure has no such subject and its rows are numbered instead.
 */
const narrateColumns = (block) => {
  const labelColumn = hasLabelColumn(block);
  // With a subject column and exactly one measure — "| Metric | Value |",
  // which is the shape every summary lands in — the intro sentence has already
  // named the measure, and repeating it on every row is noise a person reading
  // the table out would not produce.
  const showLabels = !labelColumn || block.header.length > 2;
  const sentences = [];

  const count = plural(block.rows.length, 'row', 'rows');
  const measures = nonEmpty(block.header.slice(1));

  if (!labelColumn) {
    sentences.push(`A table of ${count} with columns ${joinList(nonEmpty(block.header))}.`);
  } else if (measures.length === 0) {
    // The subject column is the only named one. "comparing  by Metric" would
    // say nothing twice and leave a doubled space where the list should be.
    sentences.push(`A table of ${count} of ${block.header[0]}.`);
  } else if (block.header[0] === '') {
    // The corner cell is blank — the shape a statistical summary is rendered
    // in, where the first column holds the metric NAMES and needs no header to
    // say so. Only the "by X" has nothing to name, so it is left off rather
    // than costing the table its subject column entirely.
    sentences.push(`A table of ${count} comparing ${joinList(measures)}.`);
  } else {
    sentences.push(`A table of ${count} comparing ${joinList(measures)} by ${block.header[0]}.`);
  }

  let { rows } = block;
  let more = 0;
  if (rows.length > MAX_NARRATED_ROWS) {
    more = rows.length - MAX_NARRATED_ROWS;
    rows = rows.slice(0, MAX_NARRATED_ROWS);
  }

  rows.forEach((row, rowIndex) => {
    const [firstCell] = row;

    let subject = `Row ${rowIndex + 1}`;
    let values = row;

    if (labelColumn) {
      values = row.slice(1);

      // A blank subject CELL in a column that names the other rows still needs
      // a subject, or the sentence opens on a colon (": 20.") and the voice
      // pauses at nothing.
      if (firstCell !== '') {
        subject = firstCell;
      }
    }

    const parts = [];

    values.forEach((cell, valueIndex) => {
      if (cell === '') {
        return;
      }

      // The header index a value belongs to: one past its own when the first
      // column was consumed as the subject. A row with more cells than the
      // header has keeps its values and loses only their labels.
      const headerIndex = labelColumn ? valueIndex + 1 : valueIndex;
      const label =
        showLabels && headerIndex < block.header.length ? block.header[headerIndex] : '';

      parts.push(label === '' ? cell : `${label} ${cell}`);
    });

    if (parts.length === 0) {
      // Every value in the row was blank; the subject is still worth saying,
      // because "it is in the table and it is empty" is an answer.
      sentences.push(endSentence(subject));
      return;
    }

    sentences.push(`${subject}: ${parts.join(', ')}.`);
  });

  if (more > 0) {
    sentences.push(`And ${plural(more, 'more row', 'more rows')}.`);
  }

  return sentences.join(' ');
};

/**
 * Renders a table block as sentences, or '' when there is nothing worth saying
 * — in which case the caller falls back to TABLE_PLACEHOLDER, so a malformed
 * block still tells the listener something was there.
 */
const narrateTable = (lines) => {
  const block = parseTableBlock(lines);

  if (block.header.length === 0) {
    return '';
  }

  if (block.rows.length === 0) {
    // A header with no body is a real shape — an empty result rendered as a
    // table — and saying so is the whole answer to "what did it find".
    return `An empty table with columns ${joinList(nonEmpty(block.header))}.`;
  }

  if (block.header.length === 1) {
    return narrateSingleColumn(block);
  }

  return narrateColumns(block);
};

/** Removes the `>` prefixes from every line, in place.
 *
 * Looped per line because a nested quote carries one marker per level: a single
 * pass would leave the inner ones to be spoken. Done BEFORE the block loop, not
 * inside it — a quote can contain any block construct, and every branch below
 * matches from the start of the line, so a marker still in place hides the
 * construct from all of them and the raw markdown is read aloud. */
const stripBlockquoteMarkers = (lines) =>
  lines.map((line) => {
    let stripped = line;

    while (BLOCKQUOTE_RE.test(stripped)) {
      stripped = stripped.replace(BLOCKQUOTE_RE, '');
    }

    return stripped;
  });

/** Everything that works on the text rather than on its lines. */
const stripInline = (text) => {
  // Inline constructs, in an order that matters: images before links (an image
  // is a link with a bang), code spans before emphasis (so `a*b*c` keeps its
  // stars), autolinks before the HTML-tag sweep would eat them.
  let out = text.replace(IMAGE_RE, '$1');
  out = out.replace(INLINE_LINK_RE, '$1');
  out = out.replace(REF_LINK_RE, '$1');
  out = out.replace(AUTOLINK_RE, '$1');
  out = out.replace(DOUBLE_TICK_RE, '$1');
  out = out.replace(INLINE_CODE_RE, '$1');
  out = stripHtmlTags(out);
  out = out.replace(BOLD_STAR_RE, '$1');
  out = out.replace(BOLD_UNDER_RE, '$1');
  out = out.replace(STRIKE_RE, '$1');
  out = out.replace(ITALIC_STAR_RE, '$1');
  out = out.replace(ITALIC_UNDER_RE, '$1');
  out = unmaskEscapes(out);

  out = out.replace(TRAILING_SPACE_RE, '\n');
  out = out.replace(MULTI_SPACE_RE, ' ');
  out = out.replace(BLANK_LINES_RE, '\n\n');

  return out.trim();
};

/**
 * Converts a markdown message into plain text a speech model can read.
 *
 * Deliberately NOT handled: 4-space indented code blocks. Telling one from a
 * nested list item needs the list context a real parser tracks, and the bot's
 * replies fence their code, so the guess would cost more than it buys.
 */
const stripMarkdown = (markdown) => {
  let source = String(markdown || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  // Escaped characters are parked before anything else looks at the text, so
  // that a `\*` is never mistaken for emphasis syntax.
  source = maskEscapes(source);

  const lines = stripBlockquoteMarkers(source.split('\n'));
  const out = [];
  // Whether the last line appended was ordinary paragraph text. A setext
  // underline only underlines a paragraph, and "---" is otherwise a thematic
  // break or the tail of a bullet list — this is what tells the three apart
  // without a full block parser.
  let previousWasParagraph = false;

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];

    const fence = FENCE_RE.exec(line);

    if (fence) {
      // An unclosed fence (a reply cut off mid-block) swallows the rest, which
      // is right: the remainder is code.
      const closer = fence[1];
      index += 1;

      while (index < lines.length && !isFenceClose(lines[index], closer)) {
        index += 1;
      }

      out.push(CODE_PLACEHOLDER);
      previousWasParagraph = false;
    } else if (
      index + 1 < lines.length &&
      line.includes('|') &&
      TABLE_DELIM_RE.test(lines[index + 1])
    ) {
      // A table is a header row, the delimiter row that identifies it, and the
      // body rows touching it. A pipe on a line with no delimiter row under it
      // is just a pipe in prose and falls through.
      const start = index;
      index += 1; // the delimiter row

      while (index + 1 < lines.length && lines[index + 1].includes('|')) {
        index += 1;
      }

      out.push(narrateTable(lines.slice(start, index + 1)) || TABLE_PLACEHOLDER);
      previousWasParagraph = false;
    } else if (previousWasParagraph && SETEXT_RE.test(line)) {
      // The line above was the heading, so give it a heading's sentence stop
      // and drop the underline. Checked before the thematic break, because
      // "---" is both and the paragraph above decides which.
      out[out.length - 1] = endSentence(out[out.length - 1]);
      previousWasParagraph = false;
    } else if (isThematicBreak(line)) {
      previousWasParagraph = false;
    } else if (ATX_HEADING_RE.test(line)) {
      // A heading has no punctuation of its own, so without a stop it runs into
      // the paragraph beneath it: "Summary The job ran".
      line = line.replace(ATX_HEADING_RE, '');
      line = line.replace(/[ \t]+$/, '').replace(/#+$/, '');
      out.push(endSentence(line.trim()));
      previousWasParagraph = false;
    } else {
      // Blockquote markers are already gone, so a quoted bullet is seen as the
      // bullet it is.
      const isListItem = BULLET_RE.test(line) || ORDERED_RE.test(line);
      line = line.replace(BULLET_RE, '').replace(ORDERED_RE, '');
      out.push(line);
      previousWasParagraph = !isListItem && line.trim() !== '';
    }
  }

  return stripInline(out.join('\n'));
};

/** What replaces the tail of a message that was cut. Spoken rather than
 * silent: a listener told the rest is on screen can go and read it. */
const CUT_NOTICE = '…the rest is on screen…';

/**
 * The prepared text bounded at `maxChars` code points, cut at its last sentence
 * so the voice does not stop mid-word.
 *
 * Narration makes the prepared text longer than the markdown a length ceiling
 * measured — a narrated table is prose — so the cut is the bound on what is
 * actually synthesized, and it is a CUT rather than a rejection: a reply the
 * caller was told it could speak must not come back refused.
 */
const cutSpeechText = (text, maxChars) => {
  const characters = [...String(text || '')];

  if (!maxChars || maxChars <= 0 || characters.length <= maxChars) {
    return String(text || '');
  }

  const head = characters.slice(0, maxChars).join('');
  // The last sentence boundary in what survived; the whole head when there is
  // none, which is a wall of text with no punctuation in it.
  const lastStop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  const kept = lastStop > 0 ? head.slice(0, lastStop + 1) : head.replace(/\s+\S*$/, '');

  return `${kept.trim()} ${CUT_NOTICE}`.trim();
};

module.exports = {
  CODE_PLACEHOLDER,
  CUT_NOTICE,
  MAX_NARRATED_ROWS,
  TABLE_PLACEHOLDER,
  cutSpeechText,
  hasSpeakableContent,
  narrateTable,
  stripMarkdown,
};
