/**
 * @jest-environment node
 */

/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import fs from 'fs';
import path from 'path';

// CSS modules are stubbed out in jest (tests/style-mock.js), so the overflow invariant is asserted
// against the SCSS sources themselves rather than against rendered components.

const SRC_DIR = path.resolve(__dirname, '..', '..', '..');
const GRID_VIEW_SCSS_PATH = path.join(__dirname, 'GridView.module.scss');
const LIST_VIEW_SCSS_PATH = path.join(__dirname, 'ListView.module.scss');

const OVERFLOW_PROPERTIES = ['overflow', 'overflow-x', 'overflow-y'];

// Blanks out comments while keeping line positions intact, so commented-out or explanatory
// overflow mentions are not picked up as declarations.
const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');

const readScss = (filePath) => stripComments(fs.readFileSync(filePath, 'utf8'));

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

// Drops nested blocks (`&:hover`, `@supports`, ...) so only the selector's own declarations remain.
const ownDeclarations = (body) => {
  let depth = 0;
  let result = '';

  [...body].forEach((character) => {
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
    } else if (depth === 0) {
      result += character;
    }
  });

  return result;
};

const declarationOf = (source, className, property) => {
  const body = blockOf(source, className);

  if (body === null) {
    return null;
  }

  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;}]+)`).exec(ownDeclarations(body));

  return match ? match[1].trim() : null;
};

const collectModuleScssFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return collectModuleScssFiles(entryPath);
    }

    return entry.name.endsWith('.module.scss') ? [entryPath] : [];
  });

const collectScrollDeclarations = (filePath) => {
  const source = readScss(filePath);
  const declarations = [];
  const pattern = new RegExp(`(?:^|[;{\\s])(${OVERFLOW_PROPERTIES.join('|')})\\s*:\\s*scroll`, 'g');

  let match = pattern.exec(source);

  while (match !== null) {
    declarations.push({
      file: path.relative(SRC_DIR, filePath),
      line: source.slice(0, match.index).split('\n').length,
      property: match[1],
    });

    match = pattern.exec(source);
  }

  return declarations;
};

const gridViewScss = readScss(GRID_VIEW_SCSS_PATH);
const listViewScss = readScss(LIST_VIEW_SCSS_PATH);

describe('board view scroll overflow invariants', () => {
  // A forced (non-auto) overflow always paints the themed 10px bar from styles.module.scss, even
  // with nothing to scroll — and both wrappers are full-height flex items, so the dead stripe runs
  // the whole page (an empty Archive, which is forced into List view, shows it permanently).
  test('GridView .wrapper scrolls only when it overflows', () => {
    expect(declarationOf(gridViewScss, 'wrapper', 'overflow-y')).toBe('auto');
  });

  test('ListView .wrapper scrolls only when it overflows', () => {
    expect(declarationOf(listViewScss, 'wrapper', 'overflow-y')).toBe('auto');
  });

  test('no module stylesheet forces a permanent scrollbar', () => {
    const files = collectModuleScssFiles(SRC_DIR);

    expect(files.length).toBeGreaterThan(0);

    const violations = files
      .flatMap(collectScrollDeclarations)
      .map(
        ({ file, line, property }) =>
          `${file}:${line} declares ${property}: scroll — use auto (or scrollbar-gutter: stable) ` +
          'so no bar is painted when there is nothing to scroll',
      );

    expect(violations).toEqual([]);
  });
});
