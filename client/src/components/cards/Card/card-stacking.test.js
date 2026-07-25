/**
 * @jest-environment node
 */

/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import fs from 'fs';
import path from 'path';

// CSS modules are stubbed out in jest (tests/style-mock.js), so the stacking invariant is asserted
// against the SCSS sources themselves rather than against rendered components.

const COMPONENTS_DIR = path.resolve(__dirname, '..', '..');
const CARD_SCSS_PATH = path.join(__dirname, 'Card.module.scss');
const BULK_ACTIONS_BAR_SCSS_NAME = 'BulkActionsBar.module.scss';
const BULK_ACTIONS_BAR_SCSS_PATH = path.join(
  COMPONENTS_DIR,
  'cards',
  'BulkActionsBar',
  BULK_ACTIONS_BAR_SCSS_NAME,
);

// Every surface that paints inside the board and must stay under the bulk actions overlay.
const BOARD_SURFACE_DIRS = [
  path.join(COMPONENTS_DIR, 'cards', 'Card'),
  path.join(COMPONENTS_DIR, 'lists'),
  path.join(COMPONENTS_DIR, 'boards', 'Board'),
];

// Blanks out comments while keeping line positions intact, so commented-out or explanatory
// z-index mentions are not picked up as declarations.
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

// Drops nested blocks (`&:hover`, `label`, ...) so only the selector's own declarations remain.
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

const zIndexOf = (source, className) => {
  const value = declarationOf(source, className, 'z-index');

  return value === null ? null : Number.parseInt(value, 10);
};

const collectModuleScssFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return collectModuleScssFiles(entryPath);
    }

    return entry.name.endsWith('.module.scss') ? [entryPath] : [];
  });

const collectZIndexDeclarations = (filePath) => {
  const source = readScss(filePath);
  const declarations = [];
  const pattern = /z-index\s*:\s*(-?\d+)/g;

  let match = pattern.exec(source);

  while (match !== null) {
    declarations.push({
      file: path.relative(COMPONENTS_DIR, filePath),
      line: source.slice(0, match.index).split('\n').length,
      value: Number.parseInt(match[1], 10),
    });

    match = pattern.exec(source);
  }

  return declarations;
};

const bulkActionsBarScss = readScss(BULK_ACTIONS_BAR_SCSS_PATH);
const cardScss = readScss(CARD_SCSS_PATH);

// The single tier the bulk actions overlay paints on; everything drawn inside the board must
// stay below it, otherwise card controls punch through the bar (and its steps).
const BOARD_OVERLAY_Z = zIndexOf(bulkActionsBarScss, 'wrapper');

describe('board surface stacking invariants', () => {
  test('BulkActionsBar declares one overlay tier for its bar and its steps', () => {
    expect(BOARD_OVERLAY_Z).toEqual(expect.any(Number));
    expect(zIndexOf(bulkActionsBarScss, 'stepWrapper')).toBe(BOARD_OVERLAY_Z);
  });

  test('Card controls stay below the BulkActionsBar overlay tier', () => {
    const violations = ['actionsButton', 'checkbox'].flatMap((className) => {
      const zIndex = zIndexOf(cardScss, className);

      if (zIndex !== null && zIndex < BOARD_OVERLAY_Z) {
        return [];
      }

      return [
        `.${className} declares z-index: ${zIndex} in Card.module.scss — it must be strictly less ` +
          `than the BulkActionsBar overlay tier (z-index: ${BOARD_OVERLAY_Z})`,
      ];
    });

    expect(violations).toEqual([]);
  });

  test('Card .wrapper owns a stacking context for its controls', () => {
    expect(declarationOf(cardScss, 'wrapper', 'position')).toBe('relative');
    expect(declarationOf(cardScss, 'wrapper', 'z-index')).toBe('0');
  });

  test('no board surface is declared above the BulkActionsBar overlay tier', () => {
    const files = BOARD_SURFACE_DIRS.flatMap(collectModuleScssFiles).filter(
      (filePath) => path.basename(filePath) !== BULK_ACTIONS_BAR_SCSS_NAME,
    );

    expect(files.length).toBeGreaterThan(0);

    const violations = files
      .flatMap(collectZIndexDeclarations)
      .filter(({ value }) => value > BOARD_OVERLAY_Z)
      .map(
        ({ file, line, value }) =>
          `${file}:${line} declares z-index: ${value}, above the BulkActionsBar overlay tier ` +
          `(z-index: ${BOARD_OVERLAY_Z})`,
      );

    expect(violations).toEqual([]);
  });
});
