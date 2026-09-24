/*!
 * Copyright (c) 2026 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useState } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Icon } from 'semantic-ui-react';

import selectors from '../../../selectors';
import {
  Directions,
  STATS_PERIODS,
  compareCounts,
  compareRates,
  deltaTone,
  formatDay,
  formatDuration,
  formatUsd,
  historyStartsInside,
  ratio,
  sessionKinds,
  sessionTotals,
  sessionsOf,
  statsPeriod,
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

function PeriodHeader() {
  const [t] = useTranslation();

  return (
    <thead>
      <tr>
        <th aria-hidden="true" />
        {STATS_PERIODS.map((key) => (
          <th key={key} scope="col">
            {t(PERIOD_KEYS[key])}
          </th>
        ))}
      </tr>
    </thead>
  );
}

// A table of figures, one row each, one column per period.
function StatsTable({ name, rows, stats, durationUnits }) {
  const [t] = useTranslation();

  return (
    <table className={styles.statsTable} data-stats={name}>
      <PeriodHeader />
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} data-stat={row.key}>
            <th scope="row">{t(row.title)}</th>
            {STATS_PERIODS.map((key) => {
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
      <PeriodHeader />
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

// The Statistics tab: this board's flow, from Planka's own history, and the
// pipeline's gate, deploys, agent sessions and spend, from the orchestrator —
// each for the last 24 hours, 7 days and 30 days beside the period before.
const StatisticsTab = React.memo(({ boardId, durationUnits }) => {
  const [t] = useTranslation();
  const accessToken = useSelector(selectors.selectAccessToken);

  const { board, pipeline } = useStatistics(boardId, accessToken, true);

  const boardStats = board.data;
  const pipelineStats = pipeline.data;

  return (
    <div className={styles.tab} data-tab-panel="statistics">
      <div className={styles.sectionTitle}>{t('pipeline.statsBoardTitle')}</div>
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
});

StatisticsTab.propTypes = {
  boardId: PropTypes.string.isRequired,
  durationUnits: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
};

export default StatisticsTab;
