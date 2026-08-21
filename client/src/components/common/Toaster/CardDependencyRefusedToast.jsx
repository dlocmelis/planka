/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { Icon, Message } from 'semantic-ui-react';

// A dependency write the server refused, said out loud.
//
// Every one of these answers is reachable from the picker's paste box: a card
// on a board this account may not read (404), and a link that would close a
// cycle (422) — A waits for B waits for A, which nothing could ever satisfy.
// Without this the button simply did nothing, and the only way to find out why
// was the network tab.
const CardDependencyRefusedToast = React.memo(({ reason }) => {
  const [t] = useTranslation();

  return (
    <Message visible negative size="tiny">
      <Icon name="linkify" />
      {t(`common.${reason}`)}
    </Message>
  );
});

CardDependencyRefusedToast.propTypes = {
  reason: PropTypes.string.isRequired,
};

export default CardDependencyRefusedToast;
