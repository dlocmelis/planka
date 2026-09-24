/*!
 * Copyright (c) 2026 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import { useCallback, useEffect, useState } from 'react';

import { fetchBoardStatistics, fetchPipelineStats } from './api';
import { STATS_POLL_MS } from '../../../utils/pipeline-strip';

// One half of the Statistics tab: its figures, or why there are none.
//   loading     — not answered yet
//   ok          — `data` is the answer
//   unavailable — the server has no such figures for this viewer (null answer)
//   error       — it could not be asked; `error` says why
export const HalfStatuses = {
  LOADING: 'loading',
  OK: 'ok',
  UNAVAILABLE: 'unavailable',
  ERROR: 'error',
};

const initialHalf = { status: HalfStatuses.LOADING, data: null, error: null };

const settle = (promise) =>
  promise.then(
    (data) =>
      data
        ? { status: HalfStatuses.OK, data, error: null }
        : { status: HalfStatuses.UNAVAILABLE, data: null, error: null },
    (error) =>
      error && error.name === 'AbortError'
        ? null
        : { status: HalfStatuses.ERROR, data: null, error: error ? error.message : '' },
  );

// The Statistics tab's figures: both halves are asked when the tab is shown,
// then once a minute while it stays shown and the page is visible. A half that
// fails keeps its last answer on screen rather than blanking it.
export default (boardId, accessToken, active) => {
  const [board, setBoard] = useState(initialHalf);
  const [pipeline, setPipeline] = useState(initialHalf);

  useEffect(() => {
    setBoard(initialHalf);
    setPipeline(initialHalf);
  }, [boardId]);

  const keep = useCallback(
    (setter) => (next) => {
      if (!next) {
        return;
      }

      setter((prev) =>
        next.status === HalfStatuses.ERROR && prev.status === HalfStatuses.OK
          ? { ...prev, error: next.error }
          : next,
      );
    },
    [],
  );

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    let cancelled = false;
    let timer;
    let controller;

    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) {
        timer = setTimeout(tick, STATS_POLL_MS);
        return;
      }

      controller = typeof AbortController === 'undefined' ? null : new AbortController();
      const signal = controller ? controller.signal : undefined;

      const [boardAnswer, pipelineAnswer] = await Promise.all([
        settle(fetchBoardStatistics(boardId, accessToken, { signal })),
        settle(fetchPipelineStats(boardId, { signal })),
      ]);

      if (cancelled) {
        return;
      }

      keep(setBoard)(boardAnswer);
      keep(setPipeline)(pipelineAnswer);

      timer = setTimeout(tick, STATS_POLL_MS);
    };

    tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);

      if (controller) {
        controller.abort();
      }
    };
  }, [boardId, accessToken, active, keep]);

  return { board, pipeline };
};
