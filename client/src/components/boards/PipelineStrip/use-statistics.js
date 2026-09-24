/*!
 * Copyright (c) 2026 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchBoardStatistics, fetchPipelineStats } from './api';
import {
  STATS_POLL_MS,
  statsCardFilterQuery,
  statsRangeQuery,
} from '../../../utils/pipeline-strip';

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

// A half that fails keeps its last answer on screen rather than blanking it.
const keep = (setter) => (next) => {
  if (!next) {
    return;
  }

  setter((prev) =>
    next.status === HalfStatuses.ERROR && prev.status === HalfStatuses.OK
      ? { ...prev, error: next.error }
      : next,
  );
};

// Asks `ask(signal)` now and then once a minute while `active` and the page
// is visible, handing each answer to `onAnswer`. Nothing is asked while
// `active` is false.
const usePoll = (active, ask, onAnswer) => {
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

      const answer = await settle(ask(controller ? controller.signal : undefined));

      if (cancelled) {
        return;
      }

      onAnswer(answer);

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
  }, [active, ask, onAnswer]);
};

// The Statistics tab's figures: each half is asked when the tab is shown, then
// once a minute while it stays shown and the page is visible, and each on its
// own — a filter change asks the pipeline half again only when what it
// answers depends on that filter.
//
// boardQuery is the board-flow filters (statsFilterQuery), and the pipeline
// half follows all of them. A card filter narrows it through the cards Board
// flow matched: Planka answers their ids (cardIds), and the orchestrator is
// asked for those cards' figures — so, with a card filter, the pipeline half
// waits for Board flow's answer to the very same filters, dates included (a
// time-to-done filter matches the cards seen in the period read). A custom
// period is sent to the orchestrator as it is (statsRangeQuery), which then
// answers the same one period Board flow does. A Planka answer without
// cardIds (one that predates them) leaves the pipeline half the whole
// board's; an orchestrator that predates the dates answers its three periods,
// and the tab says so.
export default (boardId, accessToken, active, boardQuery = '') => {
  const [board, setBoard] = useState(initialHalf);
  const [pipeline, setPipeline] = useState(initialHalf);

  const cardQuery = useMemo(() => statsCardFilterQuery(boardQuery), [boardQuery]);
  const range = useMemo(() => statsRangeQuery(boardQuery), [boardQuery]);

  // What the pipeline half's answer depends on: with a card filter, every
  // filter (the cards come from Board flow's answer to all of them); without
  // one, only the dates.
  const pipelineQuery = cardQuery ? boardQuery : range;

  // The cards Board flow matched, with the filters it matched them for.
  const [matched, setMatched] = useState(null);

  // The cards the pipeline half counts, as the `cards` parameter: null for
  // every card, undefined while Board flow has not said which for THESE
  // filters — never the cards of the filters before, which a change of dates
  // alone would otherwise send with the new dates.
  let cards = null;

  if (cardQuery) {
    cards = matched && matched.query === boardQuery ? matched.cards : undefined;
  }

  useEffect(() => {
    setBoard(initialHalf);
    setPipeline(initialHalf);
  }, [boardId]);

  // Figures asked with other filters are not these filters' figures: they are
  // not kept on screen while the new ones are asked, nor after they fail.
  useEffect(() => {
    setBoard(initialHalf);
  }, [boardQuery]);

  useEffect(() => {
    setPipeline(initialHalf);
  }, [pipelineQuery]);

  // Which cards Board flow's answer to THESE filters matched — an answer to
  // the filters before is not it — or undefined while there is none.
  const answered = board.status === HalfStatuses.OK && board.query === boardQuery;
  const answeredCards =
    answered && Array.isArray(board.data.cardIds) ? board.data.cardIds.join(',') : null;

  useEffect(() => {
    if (cardQuery && answered) {
      setMatched({ query: boardQuery, cards: answeredCards });
    }
  }, [cardQuery, boardQuery, answered, answeredCards]);

  const askBoard = useCallback(
    (signal) => fetchBoardStatistics(boardId, accessToken, { signal, query: boardQuery }),
    [boardId, accessToken, boardQuery],
  );

  const askPipeline = useCallback(
    (signal) =>
      fetchPipelineStats(boardId, { signal, cards: cards === null ? undefined : cards, range }),
    [boardId, cards, range],
  );

  // Each answer is marked with the filters it answered.
  const onBoard = useMemo(
    () => (next) => keep(setBoard)(next && { ...next, query: boardQuery }),
    [boardQuery],
  );
  const onPipeline = useMemo(() => keep(setPipeline), []);

  usePoll(active, askBoard, onBoard);
  usePoll(active && cards !== undefined, askPipeline, onPipeline);

  // Board flow could not say which cards pass: the pipeline half cannot be
  // asked for them, and says why rather than wait for ever.
  const pipelineHalf =
    cards === undefined && board.status === HalfStatuses.ERROR
      ? { status: HalfStatuses.ERROR, data: null, error: board.error }
      : pipeline;

  return { board, pipeline: pipelineHalf };
};
