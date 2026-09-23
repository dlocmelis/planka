/*!
 * Copyright (c) 2026 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useCallback } from 'react';
import PropTypes from 'prop-types';
import upperFirst from 'lodash/upperFirst';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { Button, Icon, Label } from 'semantic-ui-react';

import {
  formatDuration,
  idleReasonKey,
  isThreadBusy,
  progressPercent,
  secondsSince,
  stageOf,
} from '../../../utils/pipeline-strip';
import { cardTerminalUrl } from './api';

import styles from './PipelineStrip.module.scss';

// One thread, drawn as a horizontal bar: filled to its card's progress and
// coloured by the stage the job is in, with the ticket and its clocks beside
// it. An idle thread is an empty, dimmed bar saying why it is idle.
const ThreadBar = React.memo(
  ({ thread, nowMs, durationUnits, canPause, onOpenCard, onPause, onResume }) => {
    const [t] = useTranslation();

    const handleNameClick = useCallback(() => {
      onOpenCard(thread.cardId);
    }, [thread.cardId, onOpenCard]);

    const handlePauseClick = useCallback(() => {
      onPause(thread.cardId);
    }, [thread.cardId, onPause]);

    const handleResumeClick = useCallback(() => {
      onResume(thread.cardId);
    }, [thread.cardId, onResume]);

    if (!isThreadBusy(thread)) {
      return (
        <div className={classNames(styles.thread, styles.threadIdle)}>
          <div className={styles.threadName}>{thread.name}</div>
          <div className={styles.threadBarArea}>
            <div className={classNames(styles.bar, styles[`state${upperFirst(thread.state)}`])}>
              <span className={styles.barText}>{t(idleReasonKey(thread.state))}</span>
            </div>
          </div>
        </div>
      );
    }

    const percent = progressPercent(thread.progress);
    const stage = stageOf(thread);
    const inStage = secondsSince(thread.stageStart || thread.jobStart, nowMs);
    const total = secondsSince(thread.pipelineStart, nowMs);

    return (
      <div
        className={classNames(styles.thread, thread.paused && styles.threadPaused)}
        data-thread={thread.name}
      >
        <div className={styles.threadName}>{thread.name}</div>
        <div className={styles.threadBarArea}>
          <div className={styles.bar}>
            <div
              className={classNames(styles.fill, styles[`stage${upperFirst(stage)}`])}
              style={{ width: `${percent === null ? 0 : percent}%` }}
            />
            {percent === null && <div className={styles.fillUnknown} />}
            <button type="button" className={styles.barText} onClick={handleNameClick}>
              {thread.cardName || t('pipeline.untitledCard')}
            </button>
            {percent !== null && <span className={styles.barPercent}>{percent}%</span>}
          </div>
        </div>
        <div className={styles.threadDetails}>
          {thread.cardType && (
            <Label size="mini" className={styles.chip}>
              {thread.cardType}
            </Label>
          )}
          {thread.buildType && (
            <Label
              size="mini"
              className={classNames(styles.chip, styles[`build${upperFirst(thread.buildType)}`])}
            >
              {t(`pipeline.buildType_${thread.buildType}`, thread.buildType)}
            </Label>
          )}
          <span className={styles.detail} title={t('pipeline.stage')}>
            {[thread.column, thread.role].filter(Boolean).join(' · ')}
          </span>
          {thread.progress && thread.progress.total > 0 && (
            <span className={styles.detail} title={t('pipeline.tasksDone')}>
              {thread.progress.done}/{thread.progress.total}
            </span>
          )}
          {inStage !== null && (
            <span className={styles.detail} title={t('pipeline.timeInStage')}>
              <Icon name="hourglass half" />
              {formatDuration(inStage, durationUnits)}
            </span>
          )}
          {total !== null && (
            <span className={styles.detail} title={t('pipeline.totalTime')}>
              <Icon name="clock outline" />
              {formatDuration(total, durationUnits)}
            </span>
          )}
          {thread.paused && (
            <Label size="mini" className={classNames(styles.chip, styles.chipPaused)}>
              ⏸ {t('pipeline.paused')}
            </Label>
          )}
          {canPause &&
            thread.cardId &&
            (thread.paused ? (
              <Button
                compact
                size="mini"
                className={styles.button}
                title={t('pipeline.resumeCard')}
                onClick={handleResumeClick}
              >
                ▶ {t('pipeline.resume')}
              </Button>
            ) : (
              <Button
                compact
                size="mini"
                className={styles.button}
                title={t('pipeline.pauseCard')}
                onClick={handlePauseClick}
              >
                ⏸ {t('pipeline.pause')}
              </Button>
            ))}
          {thread.cardId && (
            <a
              href={cardTerminalUrl(thread.cardId)}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.terminalLink}
              title={t('pipeline.openTerminal')}
            >
              <Icon name="terminal" />
            </a>
          )}
        </div>
      </div>
    );
  },
);

ThreadBar.propTypes = {
  thread: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
  nowMs: PropTypes.number.isRequired,
  durationUnits: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
  canPause: PropTypes.bool.isRequired,
  onOpenCard: PropTypes.func.isRequired,
  onPause: PropTypes.func.isRequired,
  onResume: PropTypes.func.isRequired,
};

export default ThreadBar;
