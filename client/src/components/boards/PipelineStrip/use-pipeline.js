/*!
 * Copyright (c) 2026 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchPipeline } from './api';
import { pollInterval } from '../../../utils/pipeline-strip';

export const Statuses = {
  // Not yet known whether this board has a strip: nothing is drawn, so a
  // board the pipeline does not drive never flashes a skeleton.
  PROBING: 'probing',
  // A board that had a strip last time, waiting for its first answer.
  LOADING: 'loading',
  NONE: 'none',
  OK: 'ok',
  UNREACHABLE: 'unreachable',
};

// Boards this browser has seen a strip on. It is what lets the strip draw a
// skeleton while loading, and say "orchestrator unreachable" rather than
// nothing when the orchestrator is down: without it, a board the pipeline
// drives and one it does not look the same whenever /_term cannot answer.
const DRIVEN_KEY = 'planka_pipelineStrip_drivenBoards';

const readDriven = () => {
  try {
    const ids = JSON.parse(localStorage.getItem(DRIVEN_KEY) || '[]');
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
};

export const wasDriven = (boardId) => readDriven().includes(boardId);

const setDriven = (boardId, driven) => {
  const ids = readDriven().filter((id) => id !== boardId);

  if (driven) {
    ids.push(boardId);
  }

  try {
    localStorage.setItem(DRIVEN_KEY, JSON.stringify(ids.slice(-20)));
  } catch {
    // Storage full or disabled: the strip still works, it only forgets.
  }
};

const initialState = (boardId) => ({
  status: wasDriven(boardId) ? Statuses.LOADING : Statuses.PROBING,
  view: null,
  error: null,
});

const isDocumentHidden = () => typeof document !== 'undefined' && document.hidden;

// The strip's data: fetched on mount, polled every 5 s while expanded and
// every 30 s while collapsed, and not at all while the tab is hidden — a
// hidden tab that becomes visible again is refreshed at once.
//
// `act` runs an action optimistically: the view is changed at once, the
// request is made, and a failure puts the view back. Any poll that was already
// in flight when the action began is discarded, so it cannot paint the
// pre-action state over the optimistic one.
export default (boardId, expanded) => {
  const [state, setState] = useState(() => initialState(boardId));
  const [hidden, setHidden] = useState(isDocumentHidden);

  const generationRef = useRef(0);
  const offsetRef = useRef(0);
  const viewRef = useRef(state.view);
  viewRef.current = state.view;

  useEffect(() => {
    generationRef.current += 1;
    setState(initialState(boardId));
  }, [boardId]);

  useEffect(() => {
    const handleVisibilityChange = () => setHidden(isDocumentHidden());

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Answers whether polling should go on.
  const load = useCallback(async () => {
    const generation = generationRef.current;

    let view;

    try {
      view = await fetchPipeline(boardId);
    } catch (error) {
      if (generation === generationRef.current) {
        const known = wasDriven(boardId);

        setState((prev) => ({
          status: known || prev.status === Statuses.OK ? Statuses.UNREACHABLE : Statuses.NONE,
          view: null,
          error: error.message,
        }));
      }

      return true;
    }

    if (generation !== generationRef.current) {
      return true;
    }

    if (!view) {
      setDriven(boardId, false);
      setState({ status: Statuses.NONE, view: null, error: null });

      return false;
    }

    setDriven(boardId, true);
    offsetRef.current = view.now ? Date.parse(view.now) - Date.now() : 0;
    setState({ status: Statuses.OK, view, error: null });

    return true;
  }, [boardId]);

  useEffect(() => {
    if (hidden) {
      return undefined;
    }

    let cancelled = false;
    let timer;

    const tick = async () => {
      const goOn = await load();

      if (!cancelled && goOn) {
        timer = setTimeout(tick, pollInterval(expanded));
      }
    };

    tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [load, expanded, hidden]);

  const act = useCallback(
    async (optimistic, request) => {
      generationRef.current += 1;

      const previous = viewRef.current;

      if (optimistic && previous) {
        setState((prev) => ({ ...prev, view: optimistic(prev.view) }));
      }

      try {
        return await request();
      } catch (error) {
        setState((prev) => ({ ...prev, view: previous }));

        throw error;
      } finally {
        load();
      }
    },
    [load],
  );

  // The server's clock, as best this browser can tell: every duration is
  // measured against it, so a browser clock minutes off does not show a job
  // running for minutes it has not.
  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  return {
    status: state.status,
    view: state.view,
    error: state.error,
    hidden,
    act,
    serverNow,
  };
};
