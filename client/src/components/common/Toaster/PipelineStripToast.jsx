/*!
 * Copyright (c) 2026 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { Icon, Message } from 'semantic-ui-react';

// What an action on the board's Pipeline strip did, or why it was undone.
//
// `title` is a catalogue key, localised here; `detail` is the orchestrator's
// own sentence (its note on a raise, its reason for a refusal), shown as it
// came because it names cards and levels the strip cannot know.
const PipelineStripToast = React.memo(({ title, values, detail, negative }) => {
  const [t] = useTranslation();

  return (
    <Message visible positive={!negative} negative={negative} size="tiny">
      <Icon name={negative ? 'undo' : 'check'} />
      {t(title, values)}
      {detail && <div>{detail}</div>}
    </Message>
  );
});

PipelineStripToast.propTypes = {
  title: PropTypes.string.isRequired,
  values: PropTypes.object, // eslint-disable-line react/forbid-prop-types
  detail: PropTypes.string,
  negative: PropTypes.bool,
};

PipelineStripToast.defaultProps = {
  values: undefined,
  detail: undefined,
  negative: false,
};

export default PipelineStripToast;
