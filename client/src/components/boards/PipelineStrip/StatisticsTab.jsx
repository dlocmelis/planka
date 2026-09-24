/*!
 * Copyright (c) 2026 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Dropdown, Icon } from 'semantic-ui-react';

import selectors from '../../../selectors';
import {
  Directions,
  EMPTY_STATS_FILTERS,
  STATS_CUSTOM_PERIOD,
  STATS_FILTER_DEBOUNCE_MS,
  STATS_MAX_RANGE_DAYS,
  STATS_PERIODS,
  compareCounts,
  compareRates,
  deltaTone,
  formatDay,
  formatDuration,
  formatStatsRange,
  formatUsd,
  hasStatsFilters,
  historyStartsInside,
  ratio,
  readStatsFilters,
  sessionKinds,
  sessionTotals,
  sessionsOf,
  statsFilterQuery,
  statsPeriod,
  statsPeriodKeys,
  statsRange,
  writeStatsFilters,
} from '../../../utils/pipeline-strip';
import useStatistics, { HalfStatuses } from './use-statistics';

import styles from './PipelineStrip.module.scss';

const PERIOD_KEYS = {
  '24h': 'pipeline.statsPeriod24h',
  '7d': 'pipeline.statsPeriod7d',
  '30d': 'pipeline.statsPeriod30d',
};

const Kinds = {
  COUNT: 'count',
  RATE: 'rate',
  DURATION: 'duration',
  USD: 'usd',
};

const ARROWS = {
  [Directions.UP]: '▲',
  [Directions.DOWN]: '▼',
  [Directions.FLAT]: '=',
};

// The board-flow rows, read off Planka's answer. `better` is the direction
// the figure should move, which colours its arrow; null leaves it uncoloured.
const BOARD_ROWS = [
  { key: 'entered', title: 'pipeline.statsEntered', value: (w) => w.entered },
  { key: 'completed', title: 'pipeline.statsCompleted', value: (w) => w.completed, better: 'up' },
  { key: 'deployed', title: 'pipeline.statsDeployed', value: (w) => w.deployed, better: 'up' },
  { key: 'reopened', title: 'pipeline.statsReopened', value: (w) => w.reopened, better: 'down' },
  { key: 'testingSent', title: 'pipeline.statsTestingSent', value: (w) => w.testingSent },
  {
    key: 'testingAccepted',
    title: 'pipeline.statsTestingAccepted',
    value: (w) => w.testingAccepted,
    better: 'up',
  },
  {
    key: 'testingRejected',
    title: 'pipeline.statsTestingRejected',
    value: (w) => w.testingRejected,
    better: 'down',
  },
  {
    key: 'acceptanceRate',
    title: 'pipeline.statsAcceptanceRate',
    kind: Kinds.RATE,
    value: (w) => w.acceptanceRate,
    better: 'up',
  },
  {
    key: 'medianToDone',
    title: 'pipeline.statsMedianToDone',
    kind: Kinds.DURATION,
    value: (w) => w.medianSecondsToDone,
    better: 'down',
  },
];

// The pipeline rows, read off the orchestrator's answer.
const PIPELINE_ROWS = [
  { key: 'gateRuns', title: 'pipeline.statsGateRuns', value: (w) => w.gate.runs },
  {
    key: 'gatePassRate',
    title: 'pipeline.statsGatePassRate',
    kind: Kinds.RATE,
    value: (w) => ratio(w.gate.passed, w.gate.runs),
    better: 'up',
  },
  {
    key: 'gateFlaked',
    title: 'pipeline.statsGateFlaked',
    value: (w) => w.gate.flaked,
    better: 'down',
  },
  {
    key: 'deploysSucceeded',
    title: 'pipeline.statsDeploysSucceeded',
    value: (w) => w.deploys.succeeded,
    better: 'up',
  },
  {
    key: 'deploysFailed',
    title: 'pipeline.statsDeploysFailed',
    value: (w) => w.deploys.failed,
    better: 'down',
  },
  { key: 'sessions', title: 'pipeline.statsSessions', value: (w) => sessionTotals(w).sessions },
  {
    key: 'sessionFailureRate',
    title: 'pipeline.statsSessionFailureRate',
    kind: Kinds.RATE,
    value: (w) => {
      const totals = sessionTotals(w);
      return ratio(totals.failed, totals.judged);
    },
    better: 'down',
  },
  { key: 'spend', title: 'pipeline.statsSpend', kind: Kinds.USD, value: (w) => w.spendUsd },
];

const percentOf = (rate) => Math.round(100 * rate);

function useFormat(durationUnits) {
  const [t, i18n] = useTranslation();
  const locale = i18n && i18n.language;

  return (kind, value) => {
    if (value === null || value === undefined) {
      return '—';
    }

    switch (kind) {
      case Kinds.RATE:
        return t('pipeline.statsPercent', { percent: percentOf(value) });
      case Kinds.DURATION:
        return formatDuration(value, durationUnits);
      case Kinds.USD:
        return formatUsd(value, locale);
      default:
        return String(value);
    }
  };
}

// One figure for one period: the value, and how it moved against the period
// before it — ▲/▼ with the change in percent (in points for a rate), the
// previous value in its tooltip.
function StatCell({ kind, current, previous, better, detail, durationUnits }) {
  const [t] = useTranslation();
  const format = useFormat(durationUnits);

  const rate = kind === Kinds.RATE;
  const { direction, percent, points } = rate
    ? compareRates(current, previous)
    : compareCounts(current, previous);
  const tone = deltaTone(direction, better);

  let change = null;

  if (direction && direction !== Directions.FLAT) {
    if (rate) {
      change = t('pipeline.statsPoints', { points });
    } else if (percent !== null) {
      change = t('pipeline.statsPercent', { percent });
    }
  }

  return (
    <td className={styles.statsCell}>
      <span className={styles.statsValue}>{format(kind, current)}</span>
      {direction && (
        <span
          className={classNames(
            styles.statsDelta,
            tone === 'good' && styles.statsDeltaGood,
            tone === 'bad' && styles.statsDeltaBad,
          )}
          title={t('pipeline.statsPrevious', { value: format(kind, previous) })}
          data-direction={direction}
        >
          {ARROWS[direction]}
          {change && ` ${change}`}
        </span>
      )}
      {detail && <div className={styles.statsSub}>{detail}</div>}
    </td>
  );
}

StatCell.propTypes = {
  kind: PropTypes.string,
  current: PropTypes.number,
  previous: PropTypes.number,
  better: PropTypes.string,
  detail: PropTypes.string,
  durationUnits: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
};

StatCell.defaultProps = {
  kind: Kinds.COUNT,
  current: null,
  previous: null,
  better: null,
  detail: null,
};

// One column per period the answer holds: 24h, 7d and 30d, or the viewer's
// own dates ("1 Sep – 15 Sep").
function PeriodHeader({ stats }) {
  const [t, i18n] = useTranslation();

  return (
    <thead>
      <tr>
        <th aria-hidden="true" />
        {statsPeriodKeys(stats).map((key) => (
          <th key={key} scope="col" data-period={key}>
            {key === STATS_CUSTOM_PERIOD
              ? formatStatsRange(statsPeriod(stats, key), i18n && i18n.language)
              : t(PERIOD_KEYS[key])}
          </th>
        ))}
      </tr>
    </thead>
  );
}

PeriodHeader.propTypes = {
  stats: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
};

// A table of figures, one row each, one column per period.
function StatsTable({ name, rows, stats, durationUnits }) {
  const [t] = useTranslation();

  return (
    <table className={styles.statsTable} data-stats={name}>
      <PeriodHeader stats={stats} />
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} data-stat={row.key}>
            <th scope="row">{t(row.title)}</th>
            {statsPeriodKeys(stats).map((key) => {
              const period = statsPeriod(stats, key);

              return period ? (
                <StatCell
                  key={key}
                  kind={row.kind}
                  current={row.value(period.current)}
                  previous={row.value(period.previous)}
                  better={row.better}
                  durationUnits={durationUnits}
                />
              ) : (
                <td key={key}>—</td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

StatsTable.propTypes = {
  name: PropTypes.string.isRequired,
  rows: PropTypes.arrayOf(
    PropTypes.shape({
      key: PropTypes.string.isRequired,
      title: PropTypes.string.isRequired,
      kind: PropTypes.string,
      value: PropTypes.func.isRequired,
      better: PropTypes.string,
    }),
  ).isRequired,
  stats: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
  durationUnits: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
};

// What a half says when it has no figures to show.
function HalfState({ half, unavailableKey }) {
  const [t] = useTranslation();

  if (half.status === HalfStatuses.LOADING) {
    return <div className={styles.empty}>{t('pipeline.statsLoading')}</div>;
  }

  if (half.status === HalfStatuses.UNAVAILABLE) {
    return <div className={styles.empty}>{t(unavailableKey)}</div>;
  }

  if (half.status === HalfStatuses.ERROR) {
    return (
      <div className={styles.empty}>
        <Icon name="warning sign" />
        {t('pipeline.statsFailed', { error: half.error || '' })}
      </div>
    );
  }

  return null;
}

HalfState.propTypes = {
  half: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
  unavailableKey: PropTypes.string.isRequired,
};

// A history that starts inside the periods on screen says so.
function SinceNote({ since, stats, textKey }) {
  const [t] = useTranslation();
  const date = historyStartsInside(since, stats);

  if (!date) {
    return null;
  }

  return (
    <div className={styles.statsNote} data-since-note={textKey}>
      <Icon name="info circle" />
      {t(textKey, { date: formatDay(date) })}
    </div>
  );
}

SinceNote.propTypes = {
  since: PropTypes.string,
  stats: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
  textKey: PropTypes.string.isRequired,
};

SinceNote.defaultProps = {
  since: undefined,
};

// The per-stage table, for one period at a time.
function StageTable({ stats, durationUnits }) {
  const [t] = useTranslation();
  const [periodKey, setPeriodKey] = useState('7d');

  const period = statsPeriod(stats, periodKey);
  const stages = (period && period.current.gate.stages) || [];

  return (
    <div className={styles.subsection} data-stats="stages">
      <div className={styles.statsHeading}>
        <span className={styles.sectionTitle}>{t('pipeline.statsStagesTitle')}</span>
        <span className={styles.statsSwitch} role="group">
          {STATS_PERIODS.map((key) => (
            <button
              key={key}
              type="button"
              className={classNames(styles.tabButton, key === periodKey && styles.tabButtonActive)}
              aria-pressed={key === periodKey}
              data-stage-period={key}
              onClick={() => setPeriodKey(key)}
            >
              {t(PERIOD_KEYS[key])}
            </button>
          ))}
        </span>
      </div>
      {stages.length === 0 ? (
        <div className={styles.empty}>{t('pipeline.statsStagesNone')}</div>
      ) : (
        <table className={styles.statsTable}>
          <thead>
            <tr>
              <th scope="col">{t('pipeline.stage')}</th>
              <th scope="col">{t('pipeline.statsRuns')}</th>
              <th scope="col">{t('pipeline.statsFails')}</th>
              <th scope="col">{t('pipeline.statsAvgDuration')}</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((stage) => (
              <tr key={stage.stage} data-stage-row={stage.stage}>
                <th scope="row" className={styles.rowStage}>
                  {stage.stage}
                </th>
                <td>{stage.runs}</td>
                <td className={classNames(stage.fails > 0 && styles.statsDeltaBad)}>
                  {stage.fails}
                </td>
                <td>{formatDuration(stage.avgSeconds, durationUnits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

StageTable.propTypes = {
  stats: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
  durationUnits: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
};

// A kind's failure share and spend in one period. A kind whose attempts record
// no outcome (e2e) shows its spend alone: a 100% failure share there would be
// the container being stopped, not the sessions failing.
const kindDetail = (t, current, failed, locale) => {
  if (current.sessions === 0) {
    return null;
  }

  const spend = formatUsd(current.spendUsd, locale);

  if (current.outcomeUnknown) {
    return t('pipeline.statsKindSpend', { spend });
  }

  return t('pipeline.statsKindDetail', { percent: percentOf(failed), spend });
};

// Agent sessions by kind, one row per kind, with each period's failure share
// and spend.
function SessionTable({ stats, durationUnits }) {
  const [t, i18n] = useTranslation();
  const kinds = sessionKinds(stats);

  if (kinds.length === 0) {
    return <div className={styles.empty}>{t('pipeline.statsSessionsNone')}</div>;
  }

  return (
    <table className={styles.statsTable} data-stats="sessions">
      <PeriodHeader stats={stats} />
      <tbody>
        {kinds.map((kind) => (
          <tr key={kind} data-session-kind={kind}>
            <th scope="row" className={styles.rowStage}>
              {kind}
            </th>
            {STATS_PERIODS.map((key) => {
              const period = statsPeriod(stats, key);
              const current = sessionsOf(period.current, kind);
              const previous = sessionsOf(period.previous, kind);
              const failed = ratio(current.failed, current.sessions);

              return (
                <StatCell
                  key={key}
                  current={current.sessions}
                  previous={previous.sessions}
                  detail={kindDetail(t, current, failed, i18n && i18n.language)}
                  durationUnits={durationUnits}
                />
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

SessionTable.propTypes = {
  stats: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
  durationUnits: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
};

// The Board flow filters: what the inputs hold, and what was last asked for.
// The keyword and number boxes wait for typing to pause before they ask; a
// pick from a list, a date and Clear ask at once. What was asked for is
// remembered for the board, in this browser.
function useStatsFilters(boardId) {
  const [filters, setFilters] = useState(() => readStatsFilters(boardId));
  const [applied, setApplied] = useState(filters);

  useEffect(() => {
    if (filters === applied) {
      return undefined;
    }

    const timer = setTimeout(() => setApplied(filters), STATS_FILTER_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [filters, applied]);

  useEffect(() => {
    writeStatsFilters(boardId, applied);
  }, [boardId, applied]);

  const change = useCallback(
    (patch, { immediate = false } = {}) => {
      const next = { ...filters, ...patch };

      setFilters(next);

      if (immediate) {
        setApplied(next);
      }
    },
    [filters],
  );

  return { filters, applied, change };
}

const RANGE_ERROR_KEYS = {
  incomplete: 'pipeline.statsFilterRangeIncomplete',
  order: 'pipeline.statsFilterRangeOrder',
  length: 'pipeline.statsFilterRangeTooLong',
};

// A min – max pair as the heading says it.
const boundsText = (t, min, max, format) => {
  const [low, high] = [min, max].map((value) => (value.trim() ? format(value.trim()) : null));

  if (low && high) {
    return t('pipeline.statsFilterBetween', { min: low, max: high });
  }

  if (low) {
    return t('pipeline.statsFilterAtLeast', { min: low });
  }

  return high ? t('pipeline.statsFilterAtMost', { max: high }) : null;
};

// What the Board flow heading says is filtered, e.g.
// `bug, ui · “login” · Deniss Locmelis · 2 h – 10 h · $1.00 – $5.00 · 1 Sep – 15 Sep`.
const describeFilters = (t, filters, { labels, creators, locale }) => {
  const labelById = new Map(labels.map((label) => [label.id, label]));
  const creatorByKey = new Map(creators.map((creator) => [creator.key, creator]));
  const range = statsRange(filters);

  return [
    filters.labelIds
      .map((id) => {
        const label = labelById.get(id);
        return label ? label.name || label.color : id;
      })
      .join(', '),
    filters.search.trim() && t('pipeline.statsFilterQuoted', { text: filters.search.trim() }),
    filters.creators
      .map((key) => (creatorByKey.has(key) ? creatorByKey.get(key).name : key))
      .join(', '),
    boundsText(t, filters.durationMinHours, filters.durationMaxHours, (hours) =>
      t('pipeline.statsFilterHoursValue', { hours }),
    ),
    boundsText(t, filters.costMin, filters.costMax, (usd) => formatUsd(usd, locale)),
    range &&
      !range.error &&
      formatStatsRange({ current: { from: range.from, to: range.to } }, locale),
  ]
    .filter(Boolean)
    .join(' · ');
};

// The filter bar above Board flow.
function FilterBar({ filters, change, labels, creators }) {
  const [t] = useTranslation();

  const labelOptions = labels.map((label) => ({
    key: label.id,
    value: label.id,
    text: label.name || label.color,
  }));

  // Who appears on the board, and anyone remembered who no longer does, so a
  // stored pick can still be seen and removed.
  const creatorOptions = [
    ...creators.map((creator) => ({
      key: creator.key,
      value: creator.key,
      text: t('pipeline.statsFilterCreatorOption', { name: creator.name, cards: creator.cards }),
    })),
    ...filters.creators
      .filter((key) => !creators.some((creator) => creator.key === key))
      .map((key) => ({ key, value: key, text: key })),
  ];

  const range = statsRange(filters);

  const numberBox = (key, placeholder) => (
    <input
      type="number"
      min="0"
      step="any"
      className={styles.statsFilterNumber}
      value={filters[key]}
      placeholder={placeholder}
      aria-label={placeholder}
      data-filter={key}
      onChange={(event) => change({ [key]: event.target.value })}
    />
  );

  return (
    <div className={styles.statsFilterBlock}>
      <div className={styles.statsFilters} data-stats-filters>
        <Dropdown
          multiple
          search
          selection
          className={styles.statsFilterSelect}
          options={labelOptions}
          value={filters.labelIds}
          placeholder={t('pipeline.statsFilterLabels')}
          noResultsMessage={t('pipeline.statsFilterNoOptions')}
          data-filter="labelIds"
          onChange={(_, { value }) => change({ labelIds: value }, { immediate: true })}
        />
        <input
          type="search"
          className={styles.statsFilterSearch}
          value={filters.search}
          placeholder={t('pipeline.statsFilterKeyword')}
          aria-label={t('pipeline.statsFilterKeyword')}
          data-filter="search"
          onChange={(event) => change({ search: event.target.value })}
        />
        <Dropdown
          multiple
          search
          selection
          className={styles.statsFilterSelect}
          options={creatorOptions}
          value={filters.creators}
          placeholder={t('pipeline.statsFilterCreators')}
          noResultsMessage={t('pipeline.statsFilterNoOptions')}
          data-filter="creators"
          onChange={(_, { value }) => change({ creators: value }, { immediate: true })}
        />
        <span className={styles.statsFilterGroup}>
          {t('pipeline.statsFilterDuration')}
          {numberBox('durationMinHours', t('pipeline.statsFilterMin'))}
          {numberBox('durationMaxHours', t('pipeline.statsFilterMax'))}
        </span>
        <span className={styles.statsFilterGroup}>
          {t('pipeline.statsFilterCost')}
          {numberBox('costMin', t('pipeline.statsFilterMin'))}
          {numberBox('costMax', t('pipeline.statsFilterMax'))}
        </span>
        <span className={styles.statsFilterGroup}>
          {t('pipeline.statsFilterDates')}
          <input
            type="date"
            className={styles.statsFilterDate}
            value={filters.from}
            max={filters.to || undefined}
            aria-label={t('pipeline.statsFilterFrom')}
            data-filter="from"
            onChange={(event) => change({ from: event.target.value }, { immediate: true })}
          />
          –
          <input
            type="date"
            className={styles.statsFilterDate}
            value={filters.to}
            min={filters.from || undefined}
            aria-label={t('pipeline.statsFilterTo')}
            data-filter="to"
            onChange={(event) => change({ to: event.target.value }, { immediate: true })}
          />
        </span>
        <button
          type="button"
          className={styles.tabButton}
          disabled={!hasStatsFilters(filters)}
          data-filter-clear
          onClick={() => change(EMPTY_STATS_FILTERS, { immediate: true })}
        >
          {t('pipeline.statsFilterClear')}
        </button>
      </div>
      {range && range.error && (
        <div className={styles.statsNote} data-range-error={range.error}>
          <Icon name="warning sign" />
          {t(RANGE_ERROR_KEYS[range.error], { days: STATS_MAX_RANGE_DAYS })}
        </div>
      )}
      <div className={styles.statsNote} data-filters-note>
        <Icon name="info circle" />
        {t('pipeline.statsFiltersBoardOnly')}
      </div>
    </div>
  );
}

FilterBar.propTypes = {
  filters: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
  change: PropTypes.func.isRequired,
  labels: PropTypes.array.isRequired, // eslint-disable-line react/forbid-prop-types
  creators: PropTypes.array.isRequired, // eslint-disable-line react/forbid-prop-types
};

const NO_LABELS = [];

// The Statistics tab: this board's flow, from Planka's own history, and the
// pipeline's gate, deploys, agent sessions and spend, from the orchestrator —
// each for the last 24 hours, 7 days and 30 days beside the period before.
// Board flow can be narrowed by the filter bar above it, and its periods
// swapped for dates of the viewer's own; the pipeline half is the whole
// board's either way.
function BoardStatistics({ boardId, durationUnits }) {
  const [t, i18n] = useTranslation();
  const accessToken = useSelector(selectors.selectAccessToken);
  const labels = useSelector(selectors.selectLabelsForCurrentBoard) || NO_LABELS;

  const { filters, applied, change } = useStatsFilters(boardId);
  const query = useMemo(() => statsFilterQuery(applied), [applied]);

  const { board, pipeline } = useStatistics(boardId, accessToken, true, query);

  const boardStats = board.data;
  const pipelineStats = pipeline.data;

  // Who created the board's cards, from the last answer that said: a
  // filtered answer lists them all the same, and the list must not vanish
  // while one is being asked.
  const [creators, setCreators] = useState([]);
  const answeredCreators =
    boardStats && boardStats.filterOptions && boardStats.filterOptions.creators;

  useEffect(() => {
    if (answeredCreators) {
      setCreators(answeredCreators);
    }
  }, [answeredCreators]);

  const summary = query
    ? describeFilters(t, applied, { labels, creators, locale: i18n && i18n.language })
    : '';

  return (
    <div className={styles.tab} data-tab-panel="statistics">
      <FilterBar filters={filters} change={change} labels={labels} creators={creators} />
      <div className={styles.sectionTitle} data-stats-title>
        {summary
          ? t('pipeline.statsBoardTitleFiltered', { filters: summary })
          : t('pipeline.statsBoardTitle')}
      </div>
      {boardStats ? (
        <>
          <StatsTable
            name="board"
            rows={BOARD_ROWS}
            stats={boardStats}
            durationUnits={durationUnits}
          />
          <SinceNote
            since={boardStats.since}
            stats={boardStats}
            textKey="pipeline.statsBoardSince"
          />
        </>
      ) : (
        <HalfState half={board} unavailableKey="pipeline.statsBoardUnavailable" />
      )}
      <div className={classNames(styles.section, styles.sectionTitle)}>
        {t('pipeline.statsPipelineTitle')}
      </div>
      {pipelineStats ? (
        <>
          <StatsTable
            name="pipeline"
            rows={PIPELINE_ROWS}
            stats={pipelineStats}
            durationUnits={durationUnits}
          />
          <SinceNote
            since={pipelineStats.gateSince}
            stats={pipelineStats}
            textKey="pipeline.statsGateSince"
          />
          <SinceNote
            since={pipelineStats.sessionsSince}
            stats={pipelineStats}
            textKey="pipeline.statsSessionsSince"
          />
          <StageTable stats={pipelineStats} durationUnits={durationUnits} />
          <div className={styles.subsection}>
            <span className={styles.sectionTitle}>{t('pipeline.statsSessionsTitle')}</span>
            <SessionTable stats={pipelineStats} durationUnits={durationUnits} />
          </div>
        </>
      ) : (
        <HalfState half={pipeline} unavailableKey="pipeline.statsPipelineUnavailable" />
      )}
    </div>
  );
}

BoardStatistics.propTypes = {
  boardId: PropTypes.string.isRequired,
  durationUnits: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
};

// Keyed by the board, so another board starts from its own remembered
// filters rather than asking once with this one's.
const StatisticsTab = React.memo(({ boardId, durationUnits }) => (
  <BoardStatistics key={boardId} boardId={boardId} durationUnits={durationUnits} />
));

StatisticsTab.propTypes = {
  boardId: PropTypes.string.isRequired,
  durationUnits: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
};

export default StatisticsTab;
