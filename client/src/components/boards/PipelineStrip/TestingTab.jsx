/*!
 * Copyright (c) 2026 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React from 'react';
import PropTypes from 'prop-types';
import upperFirst from 'lodash/upperFirst';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { Icon, Label } from 'semantic-ui-react';

import {
  formatDay,
  formatDuration,
  groupStagesByCard,
  secondsSince,
  stagePercent,
} from '../../../utils/pipeline-strip';

import styles from './PipelineStrip.module.scss';

const PROFILE_KEYS = {
  scoped: 'pipeline.profileScoped',
  full: 'pipeline.profileFull',
};

const RESULT_KEYS = {
  ok: 'pipeline.resultOk',
  fail: 'pipeline.resultFail',
  error: 'pipeline.resultError',
  skipped: 'pipeline.resultSkipped',
};

// What a count of a suite reads as: tests, or packages for a `go test` that is
// not verbose. A count with no denominator is a count and nothing more.
const countText = (t, unit, done, total) => {
  const packages = unit === 'package';

  if (total) {
    return t(packages ? 'pipeline.progressPackages' : 'pipeline.progressTests', { done, total });
  }

  return t(packages ? 'pipeline.countPackages' : 'pipeline.countTests', { count: done });
};

function Profile({ profile }) {
  const [t] = useTranslation();

  if (!PROFILE_KEYS[profile]) {
    return null;
  }

  return (
    <Label
      size="mini"
      className={classNames(styles.chip, profile === 'full' && styles.chipFull)}
      data-profile={profile}
    >
      {t(PROFILE_KEYS[profile])}
    </Label>
  );
}

Profile.propTypes = {
  profile: PropTypes.string,
};

Profile.defaultProps = {
  profile: undefined,
};

// The smoke-test gate: every stage running or waiting for a container slot,
// grouped by card, and below it the stages that finished most recently.
const TestingTab = React.memo(({ tests, nowMs, durationUnits, onOpenCard }) => {
  const [t, i18n] = useTranslation();

  const groups = groupStagesByCard(tests.stages);
  const recent = tests.recent || [];

  return (
    <div className={styles.tab} data-tab-panel="testing">
      <div className={styles.tabSummary}>
        {t('pipeline.testsSummary', {
          running: tests.running || 0,
          waiting: tests.waiting || 0,
          max: tests.maxContainers || 0,
        })}
      </div>
      {groups.length === 0 && <div className={styles.empty}>{t('pipeline.testsNone')}</div>}
      {groups.map((group) => (
        <div key={group.cardId} className={styles.group} data-test-card={group.cardId}>
          <button type="button" className={styles.link} onClick={() => onOpenCard(group.cardId)}>
            {group.cardName || t('pipeline.untitledCard')}
          </button>
          {group.stages.map((stage) => {
            const waiting = stage.status === 'queued';
            const since = secondsSince(stage.since, nowMs);
            const percent = stagePercent(stage);

            return (
              <div
                key={stage.stage}
                className={classNames(styles.row, waiting && styles.rowWaiting)}
                data-stage={stage.stage}
                data-status={stage.status}
              >
                <span className={styles.rowName}>{stage.stage}</span>
                <span className={styles.rowBar}>
                  <span className={styles.bar}>
                    {!waiting && (
                      <span
                        className={classNames(styles.fill, styles.stageBuild)}
                        style={{ width: `${percent === null ? 0 : percent}%` }}
                      />
                    )}
                    {!waiting && percent === null && <span className={styles.fillUnknown} />}
                    <span className={styles.barText}>
                      {waiting
                        ? t('pipeline.testWaiting', { max: tests.maxContainers || 0 })
                        : t('pipeline.testRunning')}
                    </span>
                    {percent !== null && <span className={styles.barPercent}>{percent}%</span>}
                  </span>
                </span>
                <span className={styles.rowDetails}>
                  <Profile profile={stage.profile} />
                  {since !== null && (
                    <span className={styles.detail} title={t('pipeline.inThisStatus')}>
                      <Icon name="hourglass half" />
                      {formatDuration(since, durationUnits)}
                    </span>
                  )}
                  {stage.unit && stage.done > 0 && (
                    <span className={styles.detail} data-count>
                      {countText(t, stage.unit, stage.done, stage.total)}
                    </span>
                  )}
                  {stage.failed > 0 && (
                    <Label size="mini" className={classNames(styles.chip, styles.chipRefused)}>
                      {t('pipeline.failedCount', { count: stage.failed })}
                    </Label>
                  )}
                  {stage.container && (
                    <code className={styles.container} title={t('pipeline.container')}>
                      {stage.container}
                    </code>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ))}
      <div className={styles.section}>
        <span className={styles.sectionTitle}>{t('pipeline.recentStages')}</span>
        {tests.recordedSince && (
          <span className={styles.detail}>
            {' '}
            {t('pipeline.recordedSince', {
              date: formatDay(tests.recordedSince, i18n && i18n.language),
            })}
          </span>
        )}
      </div>
      {recent.length === 0 && <div className={styles.empty}>{t('pipeline.recentStagesNone')}</div>}
      {recent.map((run, index) => {
        const ago = secondsSince(run.finishedAt, nowMs);

        return (
          <div
            // Settled rows have no id of their own; the list is newest-first
            // and replaced whole on every poll.
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            className={styles.row}
            data-recent-stage={run.stage}
          >
            <span className={styles.rowName}>
              <Label
                size="mini"
                className={classNames(styles.chip, styles[`result${upperFirst(run.status)}`])}
                data-result={run.status}
              >
                {RESULT_KEYS[run.status] ? t(RESULT_KEYS[run.status]) : run.status}
              </Label>
            </span>
            <span className={styles.rowBar}>
              <span className={styles.rowStage}>{run.stage}</span>{' '}
              <button type="button" className={styles.link} onClick={() => onOpenCard(run.cardId)}>
                {run.cardName || t('pipeline.untitledCard')}
              </button>
            </span>
            <span className={styles.rowDetails}>
              <Profile profile={run.profile} />
              <span className={styles.detail} title={t('pipeline.duration')}>
                <Icon name="clock outline" />
                {formatDuration(run.durationSeconds, durationUnits)}
              </span>
              {run.queuedSeconds > 0 && (
                <span className={styles.detail}>
                  {t('pipeline.queuedPart', {
                    duration: formatDuration(run.queuedSeconds, durationUnits),
                  })}
                </span>
              )}
              {run.unit && run.tests > 0 && (
                <span className={styles.detail}>{countText(t, run.unit, run.tests, 0)}</span>
              )}
              {run.failed > 0 && (
                <span className={styles.detail}>
                  {t('pipeline.failedCount', { count: run.failed })}
                </span>
              )}
              {run.flaked && (
                <Label size="mini" className={classNames(styles.chip, styles.chipPaused)}>
                  {t('pipeline.flaky')}
                </Label>
              )}
              {!run.flaked && run.attempts > 1 && (
                <span className={styles.detail}>
                  {t('pipeline.attempts', { count: run.attempts })}
                </span>
              )}
              {run.error && (
                <span className={styles.detail} title={run.error}>
                  <Icon name="warning sign" />
                </span>
              )}
              {ago !== null && (
                <span className={styles.detail}>
                  {t('pipeline.ago', { duration: formatDuration(ago, durationUnits) })}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
});

TestingTab.propTypes = {
  tests: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
  nowMs: PropTypes.number.isRequired,
  durationUnits: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
  onOpenCard: PropTypes.func.isRequired,
};

export default TestingTab;
