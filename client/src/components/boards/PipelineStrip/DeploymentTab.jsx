/*!
 * Copyright (c) 2026 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { Icon, Label } from 'semantic-ui-react';

import { formatDuration, progressPercent, secondsSince } from '../../../utils/pipeline-strip';
import { cardTerminalUrl } from './api';

import styles from './PipelineStrip.module.scss';

const JOB_STATE_KEYS = {
  preparing: 'pipeline.deployPreparing',
  'waiting-thread': 'pipeline.deployWaitingThread',
  running: 'pipeline.deployRunning',
  finishing: 'pipeline.deployFinishing',
};

// A deploy job's outcome, as job_attempts records its last attempt: `ok` is
// the deploy session reporting, the rest are why it did not.
const DEPLOY_RESULT_KEYS = {
  ok: 'pipeline.deployResultOk',
  error: 'pipeline.deployResultError',
  'empty-result': 'pipeline.deployResultNoResult',
  auth: 'pipeline.deployResultAuth',
};

const CardLink = ({ card, onOpenCard }) => {
  const [t] = useTranslation();

  return (
    <button type="button" className={styles.link} onClick={() => onOpenCard(card.cardId)}>
      {card.name || t('pipeline.untitledCard')}
    </button>
  );
};

CardLink.propTypes = {
  card: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
  onOpenCard: PropTypes.func.isRequired,
};

// One lane per repository, from the orchestrator's own deploy queue: the
// deployment holding it, the cards waiting in deploy order, and the last
// deploys — with a staged orchestrator self-redeploy above them all.
const DeploymentTab = React.memo(({ deploys, nowMs, durationUnits, onOpenCard }) => {
  const [t] = useTranslation();

  const lanes = deploys.lanes || [];
  const redeploy = deploys.selfRedeploy;
  const redeployAge = redeploy && secondsSince(redeploy.stagedAt, nowMs);

  return (
    <div className={styles.tab} data-tab-panel="deployment">
      {redeploy && (
        <div className={styles.notice} data-self-redeploy>
          <Icon name="sync alternate" />
          {t('pipeline.selfRedeploy', {
            age: redeployAge === null ? '—' : formatDuration(redeployAge, durationUnits),
          })}
          {(redeploy.cards || []).map((card) => (
            <span key={card.cardId}>
              {' '}
              <CardLink card={card} onOpenCard={onOpenCard} />
            </span>
          ))}
        </div>
      )}
      {lanes.length === 0 && <div className={styles.empty}>{t('pipeline.deployNone')}</div>}
      {lanes.map((lane) => {
        const current = lane.current;
        const riders = (current && current.riders) || [];
        const waitingCards = lane.waiting || [];
        const recent = lane.recent || [];
        const held = current && secondsSince(current.since, nowMs);
        const percent = current && progressPercent(current.progress);

        return (
          <div key={lane.repo} className={styles.group} data-lane={lane.repo}>
            <div className={styles.accountName}>{lane.repo}</div>
            {current ? (
              <div className={styles.row} data-deploying={current.cardId}>
                <span className={styles.rowName}>
                  <Label size="mini" className={classNames(styles.chip, styles.chipDeploying)}>
                    {t('pipeline.deployingNow')}
                  </Label>
                </span>
                <span className={styles.rowBar}>
                  <span className={styles.bar}>
                    <span
                      className={classNames(styles.fill, styles.stageDeploy)}
                      style={{ width: `${percent === null ? 0 : percent}%` }}
                    />
                    {current.jobState === 'running' && percent === null && (
                      <span className={styles.fillUnknown} />
                    )}
                    <button
                      type="button"
                      className={styles.barText}
                      onClick={() => onOpenCard(current.cardId)}
                    >
                      {current.name || t('pipeline.untitledCard')}
                    </button>
                    {percent !== null && <span className={styles.barPercent}>{percent}%</span>}
                  </span>
                </span>
                <span className={styles.rowDetails}>
                  <span className={styles.detail} data-job-state={current.jobState}>
                    {JOB_STATE_KEYS[current.jobState]
                      ? t(JOB_STATE_KEYS[current.jobState], { thread: current.thread || '—' })
                      : current.jobState}
                  </span>
                  {current.progress && current.progress.total > 0 && (
                    <span className={styles.detail} title={t('pipeline.tasksDone')}>
                      {current.progress.done}/{current.progress.total}
                    </span>
                  )}
                  {held !== null && (
                    <span className={styles.detail} title={t('pipeline.deploySince')}>
                      <Icon name="hourglass half" />
                      {formatDuration(held, durationUnits)}
                    </span>
                  )}
                  {current.cardId && (
                    <a
                      href={cardTerminalUrl(current.cardId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.terminalLink}
                      title={t('pipeline.openTerminal')}
                    >
                      <Icon name="terminal" />
                    </a>
                  )}
                </span>
                {riders.length > 0 && (
                  <span className={styles.rowExtra} data-riders>
                    {t('pipeline.deployRiders', { count: riders.length })}{' '}
                    {riders.map((card, index) => (
                      <span key={card.cardId}>
                        {index > 0 && ', '}
                        <CardLink card={card} onOpenCard={onOpenCard} />
                      </span>
                    ))}
                  </span>
                )}
              </div>
            ) : (
              <div className={styles.empty}>{t('pipeline.deployIdle')}</div>
            )}
            {waitingCards.length > 0 && (
              <div className={styles.subsection} data-deploy-waiting>
                <span className={styles.sectionTitle}>
                  {t('pipeline.deployWaiting', { count: waitingCards.length })}
                </span>
                {waitingCards.map((card, index) => {
                  const waited = secondsSince(card.queuedAt, nowMs);

                  return (
                    <div key={card.cardId} className={styles.row} data-waiting={card.cardId}>
                      <span className={styles.rowName}>{index + 1}</span>
                      <span className={styles.rowBar}>
                        <CardLink card={card} onOpenCard={onOpenCard} />
                      </span>
                      <span className={styles.rowDetails}>
                        <Label size="mini" className={classNames(styles.chip, styles.chipPriority)}>
                          {card.priority}
                        </Label>
                        <span className={styles.detail} title={t('pipeline.waiting')}>
                          <Icon name="hourglass half" />
                          {formatDuration(
                            waited === null ? card.waitingSeconds || 0 : waited,
                            durationUnits,
                          )}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {recent.length > 0 && (
              <div className={styles.subsection} data-deploy-recent>
                <span className={styles.sectionTitle}>{t('pipeline.deployRecent')}</span>
                {recent.map((run) => {
                  const ago = secondsSince(run.finishedAt, nowMs);

                  return (
                    <div key={run.jobId} className={styles.row} data-deploy-run={run.jobId}>
                      <span className={styles.rowName}>
                        <Label
                          size="mini"
                          className={classNames(
                            styles.chip,
                            run.status === 'ok' ? styles.resultOk : styles.resultFail,
                          )}
                          data-result={run.status}
                        >
                          {DEPLOY_RESULT_KEYS[run.status]
                            ? t(DEPLOY_RESULT_KEYS[run.status])
                            : run.status}
                        </Label>
                      </span>
                      <span className={styles.rowBar}>
                        <CardLink card={run} onOpenCard={onOpenCard} />
                      </span>
                      <span className={styles.rowDetails}>
                        <span className={styles.detail} title={t('pipeline.duration')}>
                          <Icon name="clock outline" />
                          {formatDuration(run.durationSeconds, durationUnits)}
                        </span>
                        {run.attempts > 1 && (
                          <span className={styles.detail}>
                            {t('pipeline.attempts', { count: run.attempts })}
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
            )}
          </div>
        );
      })}
    </div>
  );
});

DeploymentTab.propTypes = {
  deploys: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
  nowMs: PropTypes.number.isRequired,
  durationUnits: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
  onOpenCard: PropTypes.func.isRequired,
};

export default DeploymentTab;
