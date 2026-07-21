/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/* eslint-env serviceworker */
/* eslint-disable no-restricted-globals -- `self` is the global scope in a service worker */

self.addEventListener('push', (event) => {
  let payload = {};

  try {
    payload = event.data.json();
  } catch {
    /* empty */
  }

  const { title = '', body, icon, badge, data } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      data,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = new URL(
    (event.notification.data && event.notification.data.url) || '/',
    self.location.origin,
  ).href;

  event.waitUntil(
    clients
      .matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      .then((clientList) => {
        const client = clientList.find(({ url: clientUrl }) =>
          clientUrl.startsWith(self.location.origin),
        );

        if (client) {
          return client.focus().then((focusedClient) => {
            if (focusedClient && focusedClient.navigate) {
              return focusedClient.navigate(url);
            }

            return undefined;
          });
        }

        return clients.openWindow(url);
      }),
  );
});
