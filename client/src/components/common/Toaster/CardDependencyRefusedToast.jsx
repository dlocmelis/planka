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
// Every one of these answers is reachable from the picker: a card on a board
// this account may not read (404), a link that would close a cycle (422) — A
// waits for B waits for A, which nothing could ever satisfy — the same link
// added by two people at once (409), and a board role downgraded while the card
// modal is open (403). Without this the button simply did nothing, and the only
// way to find out why was the network tab.
//
// `reason` is a key rather than a message because the toast is localised and
// the server's `message` is English; the saga picks it from the code AND, where
// one status covers two different refusals, from that message
// (see sagas/core/services/card-dependencies.js).
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
