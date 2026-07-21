/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

const buildWebPushPayload = ({ title, body, url }) =>
  JSON.stringify({
    title,
    body,
    icon: '/logo192.png',
    badge: '/favicon.ico',
    data: {
      url,
    },
  });

module.exports = {
  buildWebPushPayload,
};
