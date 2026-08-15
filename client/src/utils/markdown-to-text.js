/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import transform from '@diplodoc/transform';

import plugins from '../configs/markdown-plugins';

export default (markdown) => {
  let tokens;
  try {
    tokens = transform(markdown, {
      plugins,
      tokens: true,
    });
  } catch {
    // Same trap as components/common/Markdown.jsx: transform() front-matter
    // parses anything starting with `---` as YAML and throws when it is not.
    // Retry without the Liquid pass, and failing that give back the source —
    // this is the board tile's preview text, and the source is a far better
    // preview of a card than the exception message was. Returning
    // error.toString() also leaked the offending lines of a description into a
    // place that was never meant to show them.
    try {
      tokens = transform(markdown, {
        plugins,
        tokens: true,
        disableLiquid: true,
      });
    } catch {
      return markdown;
    }
  }

  return tokens
    .flatMap((token) => {
      if (!token.children) {
        return [];
      }

      return token.children
        .flatMap((childrenToken) => (childrenToken.type === 'text' ? childrenToken.content : []))
        .join('');
    })
    .join('\n');
};
