/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import Config from '../constants/Config';

const http = {};

// TODO: add all methods
['GET', 'POST', 'DELETE'].forEach((method) => {
  http[method.toLowerCase()] = (url, data, headers) => {
    const formData =
      data &&
      Object.keys(data).reduce((result, key) => {
        result.append(key, data[key]);

        return result;
      }, new FormData());

    return fetch(`${Config.BASE_PATH}/api${url}`, {
      method,
      headers,
      body: formData,
      credentials: 'include',
    })
      .then((response) =>
        response.json().then((body) => ({
          body,
          isError: response.status !== 200,
        })),
      )
      .then(({ body, isError }) => {
        if (isError) {
          throw body;
        }

        return body;
      });
  };
});

/**
 * POST with a JSON body rather than the multipart form the methods above send.
 *
 * It exists for one payload shape the form cannot carry safely: a base64
 * recording, and the base64 audio that comes back (`api/voice.js`). Sails'
 * body parser handles `application/json` with a stated 1 MB limit, while a
 * large multipart TEXT field goes through skipper's streaming parser, which
 * hands control to the action after 500 ms whether or not the field arrived —
 * so a big field can silently fail to reach `req.body`. Everything else about
 * the request, and the way an error body is thrown, is identical.
 */
http.postJson = (url, data, headers) =>
  fetch(`${Config.BASE_PATH}/api${url}`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
    credentials: 'include',
  })
    .then((response) =>
      response.json().then((body) => ({
        body,
        isError: response.status !== 200,
      })),
    )
    .then(({ body, isError }) => {
      if (isError) {
        throw body;
      }

      return body;
    });

export default http;
