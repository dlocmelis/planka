/**
 * @jest-environment node
 */

/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import fs from 'fs';
import path from 'path';

// CSS modules are stubbed out in jest (tests/style-mock.js), so the geometry of the collapsed
// strip's drop zone is asserted against the SCSS source rather than against rendered components.

const LIST_SCSS_PATH = path.join(__dirname, 'List.module.scss');

const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');

// Returns the body of the first `.className { ... }` block, nested blocks included.
const blockOf = (source, className) => {
  const match = new RegExp(`(^|[^\\w-.])\\.${className}\\s*\\{`).exec(source);

  if (!match) {
    return null;
  }

  const start = source.indexOf('{', match.index) + 1;

  let depth = 1;
  let index = start;

  while (index < source.length && depth > 0) {
    if (source[index] === '{') {
      depth += 1;
    } else if (source[index] === '}') {
      depth -= 1;
    }

    index += 1;
  }

  return source.slice(start, index - 1);
};

const pixelsOf = (source, className, property) => {
  const body = blockOf(source, className);

  if (body === null) {
    return null;
  }

  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*(-?\\d+)px`).exec(body);

  return match ? Number.parseInt(match[1], 10) : null;
};

const listScss = stripComments(fs.readFileSync(LIST_SCSS_PATH, 'utf8'));

describe('collapsed strip drop zone geometry', () => {
  const left = pixelsOf(listScss, 'collapsedDropZone', 'left');
  const right = pixelsOf(listScss, 'collapsedDropZone', 'right');

  test('extends the hot-zone into its own gutter, symmetrically and no further', () => {
    // The strip's gutter is .innerWrapperCollapsed's right margin; reaching past its midpoint
    // would overlap the neighbouring list's droppable rect and make rbd's resolution ambiguous
    const gutter = pixelsOf(listScss, 'innerWrapperCollapsed', 'margin-right');
    expect(gutter).toBeGreaterThan(0);

    expect(left).toBeLessThan(0);
    // Symmetric, so the droppable's centre x — what rbd matches the dragged card against —
    // is exactly where it was before the extension
    expect(right).toBe(left);
    expect(-left).toBeLessThanOrEqual(gutter / 2);
  });

  test('offsets the expansion preview so it stays flush with the strip', () => {
    // .collapsedDropExpansion is positioned against the drop zone, which starts left of the
    // strip, so its own left has to cancel that extension out
    expect(pixelsOf(listScss, 'collapsedDropExpansion', 'left')).toBe(-left);
  });
});
