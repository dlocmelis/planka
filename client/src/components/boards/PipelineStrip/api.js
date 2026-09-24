/*!
 * Copyright (c) 2026 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

// The orchestrator's Pipeline API, served by the card terminal that Caddy
// mounts on the board's own origin at /_term (devteam-orchestrator,
// internal/cardterm/pipeline.go). It is called same-origin, so the board's
// sign-in cookies are what authenticate the viewer; nothing else is sent.

import Config from '../../../constants/Config';

export const PIPELINE_PATH = '/_term/pipeline';

export const cardTerminalUrl = (cardId) => `/_term/card/${encodeURIComponent(cardId)}`;

// A request that did not get the answer it wanted: `status` is the HTTP
// status, or undefined when the orchestrator could not be reached at all.
export class PipelineError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'PipelineError';
    this.status = status;
  }
}

const readJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

// Answers:
//   null — this board has no strip: {pipeline:false}, 401, 403, 404, or an
//          origin that serves something other than JSON at /_term (a Planka
//          without the orchestrator in front of it)
//   the view — {pipeline:true, threads, queue, paused, drain, ...}
// and throws PipelineError when the orchestrator could not be asked
// (a network failure, or Caddy answering 502/503/504 for it).
export const fetchPipeline = async (boardId, { signal } = {}) => {
  let response;

  try {
    response = await fetch(`${PIPELINE_PATH}?board=${encodeURIComponent(boardId)}`, {
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
      },
      signal,
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw error;
    }

    throw new PipelineError(error ? error.message : 'network error');
  }

  if ([401, 403, 404].includes(response.status)) {
    return null;
  }

  if (!response.ok) {
    const body = await readJson(response);

    throw new PipelineError(
      (body && body.error) || `the orchestrator answered ${response.status}`,
      response.status,
    );
  }

  const body = await readJson(response);

  if (!body || body.pipeline !== true) {
    return null;
  }

  return body;
};

const post = async (action, payload) => {
  let response;

  try {
    response = await fetch(`${PIPELINE_PATH}/${action}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new PipelineError(error ? error.message : 'network error');
  }

  const body = await readJson(response);

  if (!response.ok) {
    throw new PipelineError(
      (body && body.error) || `the orchestrator answered ${response.status}`,
      response.status,
    );
  }

  return body || {};
};

// Moves a queued card up past the queued job aboveJobId. Answers
// {changed, from, to, note}.
export const raise = (cardId, aboveJobId) => post('raise', { cardId, aboveJobId });

export const pauseCard = (cardId) => post('pause', { cardId });

export const resumeCard = (cardId) => post('resume', { cardId });

// Flips the pipeline's Restart control switch. Answers {drain}.
export const setDrain = (on) => post('drain', { on });

// The Statistics tab's two halves. Each answers the figures, or null when that
// half is not there to read (an orchestrator that predates the route, or a
// viewer the board does not answer), and throws PipelineError when it could not
// be asked.

const getJson = async (url, { headers, signal } = {}) => {
  let response;

  try {
    response = await fetch(url, {
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...headers,
      },
      signal,
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw error;
    }

    throw new PipelineError(error ? error.message : 'network error');
  }

  if ([401, 403, 404].includes(response.status)) {
    return null;
  }

  const body = await readJson(response);

  if (!response.ok) {
    throw new PipelineError(
      (body && (body.error || body.message)) || `the server answered ${response.status}`,
      response.status,
    );
  }

  return body;
};

// The pipeline half: gate, deploy and session statistics from the
// orchestrator (GET /_term/pipeline/stats), under the strip's own sign-in.
// `cards` keeps the figures to those cards (comma-separated ids), `range` is
// a custom period as statsRangeQuery writes it ('from=…&to=…').
export const fetchPipelineStats = async (boardId, { signal, cards, range } = {}) => {
  const body = await getJson(
    `${PIPELINE_PATH}/stats?board=${encodeURIComponent(boardId)}${
      cards === undefined ? '' : `&cards=${encodeURIComponent(cards)}`
    }${range ? `&${range}` : ''}`,
    {
      signal,
    },
  );

  return body && body.pipeline === true ? body : null;
};

// The board-flow half: Planka's own GET /api/boards/:id/pipeline-statistics.
// The /api middleware reads the bearer token from the Authorization header,
// not from a cookie, so it is sent here as the sagas send it. `query` is the
// tab's filters (statsFilterQuery), empty when nothing is filtered.
export const fetchBoardStatistics = async (boardId, accessToken, { signal, query } = {}) => {
  const body = await getJson(
    `${Config.BASE_PATH}/api/boards/${encodeURIComponent(boardId)}/pipeline-statistics${
      query ? `?${query}` : ''
    }`,
    {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      signal,
    },
  );

  return body && body.item ? body.item : null;
};
