/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import transform from '@diplodoc/transform';
import { defaultOptions as defaultSanitizeOptions } from '@diplodoc/transform/lib/sanitize';
import { colorClassName } from '@gravity-ui/markdown-editor';

import plugins from '../../configs/markdown-plugins';

const Markdown = React.memo(({ children }) => {
  const html = useMemo(() => {
    const options = {
      plugins,
      breaks: true,
      linkify: true,
      linkifyTlds: null,
      sanitizeOptions: {
        ...defaultSanitizeOptions,
        allowedSchemesByTag: { img: ['http', 'https', 'data'] },
      },
      defaultClassName: colorClassName,
    };

    try {
      return transform(children, options).result.html;
    } catch (error) {
      // TEXT THAT STARTS WITH `---` IS NOT A RENDERING FAILURE, IT IS A CARD.
      // transform() runs the source through Liquid first, and Liquid's
      // front-matter step hands everything from a leading `---` down to the
      // next `---` line to js-yaml. A description that merely opens with a
      // rule — or with a header block someone pasted — is not YAML, so js-yaml
      // throws and the whole card body is lost. Retrying with the Liquid pass
      // off skips front matter entirely; nothing here passes Liquid vars, so
      // there is nothing to lose by it.
      try {
        return transform(children, { ...options, disableLiquid: true }).result.html;
      } catch {
        // NEVER `error.toString()`. A YAMLException embeds the offending SOURCE
        // LINES in its message, and this string goes straight into
        // dangerouslySetInnerHTML — so returning it injected unsanitised,
        // user-authored text (support ticket descriptions are written by
        // customers) as live HTML. Falling through to null renders the source
        // as React text instead, which is escaped and still readable.
        return null;
      }
    }
  }, [children]);

  if (html === null) {
    return <div className="yfm">{children}</div>;
  }

  // eslint-disable-next-line react/no-danger
  return <div dangerouslySetInnerHTML={{ __html: html }} className="yfm" />;
});

Markdown.propTypes = {
  children: PropTypes.string.isRequired,
};

export default Markdown;
