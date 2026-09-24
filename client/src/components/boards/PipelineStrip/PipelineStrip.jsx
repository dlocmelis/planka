/*!
 * Copyright (c) 2026 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import upperFirst from 'lodash/upperFirst';
import classNames from 'classnames';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Button, Icon, Label, Placeholder } from 'semantic-ui-react';
import toast from 'react-hot-toast';
import { push } from '../../../lib/redux-router';
import { usePopup } from '../../../lib/popup';

import selectors from '../../../selectors';
import Paths from '../../../constants/Paths';
import ToastTypes from '../../../constants/ToastTypes';
import {
  RaiseOutcomes,
  Tabs,
  activeTab,
  applyRaise,
  availableTabs,
  formatDuration,
  groupByAccount,
  isTab,
  isThreadBusy,
  previewRaise,
  progressPercent,
  secondsSince,
  summarize,
  summarizeTabs,
} from '../../../utils/pipeline-strip';
import ConfirmationStep from '../../common/ConfirmationStep';
import * as api from './api';
import usePipeline, { Statuses } from './use-pipeline';
import ThreadBar from './ThreadBar';
import QueuePanel from './QueuePanel';
import TestingTab from './TestingTab';
import DeploymentTab from './DeploymentTab';
import AccountsTab from './AccountsTab';
import StatisticsTab from './StatisticsTab';

import styles from './PipelineStrip.module.scss';

const EXPANDED_KEY = 'planka_pipelineStrip_expanded';
const QUEUE_OPENED_KEY = 'planka_pipelineStrip_queueOpened';
const TAB_KEY = 'planka_pipelineStrip_tab';
const CSS_VAR = '--pipeline-strip-height';

const readFlag = (key) => {
  try {
    const value = localStorage.getItem(key);
    return value === null ? null : value === 'true';
  } catch {
    return null;
  }
};

const writeFlag = (key, value) => {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, String(value));
    }
  } catch {
    // Storage disabled: the choice lasts for this page only.
  }
};

const readTab = () => {
  try {
    const value = localStorage.getItem(TAB_KEY);
    return isTab(value) ? value : Tabs.BUILD;
  } catch {
    return Tabs.BUILD;
  }
};

const writeTab = (value) => {
  try {
    localStorage.setItem(TAB_KEY, value);
  } catch {
    // Storage disabled: the tab lasts for this page only.
  }
};

const TAB_TITLE_KEYS = {
  [Tabs.BUILD]: 'pipeline.tabBuild',
  [Tabs.TESTING]: 'pipeline.tabTesting',
  [Tabs.DEPLOYMENT]: 'pipeline.tabDeployment',
  [Tabs.ACCOUNTS]: 'pipeline.tabAccounts',
  [Tabs.STATISTICS]: 'pipeline.tabStatistics',
};

const showToast = (params) => {
  toast({
    type: ToastTypes.PIPELINE_STRIP,
    params,
  });
};

// The board's Pipeline strip: what every pipeline thread is doing, what is
// queued and in which order, which cards are held, and whether the pipeline is
// draining — mounted under the board's action bar (common/Fixed). It asks the
// orchestrator on every board and draws nothing on one the pipeline does not
// drive ({pipeline:false}, or /_term answering 401/403/404).
const PipelineStrip = React.memo(({ boardId }) => {
  const [t] = useTranslation();
  const dispatch = useDispatch();
  const currentUser = useSelector(selectors.selectCurrentUser);

  const [expanded, setExpanded] = useState(() => readFlag(EXPANDED_KEY) === true);
  // null: follow the rule (open when every thread is busy); true/false: the
  // person opened or closed it themselves.
  const [queueOpened, setQueueOpened] = useState(() => readFlag(QUEUE_OPENED_KEY));
  // The last tab opened, remembered across boards and reloads.
  const [rememberedTab, setRememberedTab] = useState(readTab);

  const { status, view, error, hidden, act, serverNow } = usePipeline(boardId, expanded);

  const [nowMs, setNowMs] = useState(serverNow);

  // Times in stage and in total tick live while they are on screen.
  useEffect(() => {
    setNowMs(serverNow());

    if (!expanded || hidden || status !== Statuses.OK) {
      return undefined;
    }

    const interval = setInterval(() => setNowMs(serverNow()), 1000);

    return () => clearInterval(interval);
  }, [expanded, hidden, status, view, serverNow]);

  // The board below is positioned under the fixed header by fixed offsets
  // (common/Static); the strip's height is added to them through this.
  const wrapperRef = useRef(null);
  const drawn = status !== Statuses.PROBING && status !== Statuses.NONE;

  useEffect(() => {
    const root = document.documentElement;
    const element = wrapperRef.current;

    if (!drawn || !element) {
      root.style.removeProperty(CSS_VAR);
      return undefined;
    }

    const update = () => root.style.setProperty(CSS_VAR, `${element.offsetHeight}px`);

    update();

    if (typeof ResizeObserver === 'undefined') {
      return () => root.style.removeProperty(CSS_VAR);
    }

    const observer = new ResizeObserver(update);
    observer.observe(element);

    return () => {
      observer.disconnect();
      root.style.removeProperty(CSS_VAR);
    };
  }, [drawn, status]);

  const durationUnits = useMemo(
    () => ({
      d: t('pipeline.unitDays'),
      h: t('pipeline.unitHours'),
      m: t('pipeline.unitMinutes'),
      s: t('pipeline.unitSeconds'),
    }),
    [t],
  );

  const summary = useMemo(() => summarize(view), [view]);
  const tabSummary = useMemo(() => summarizeTabs(view), [view]);
  const tabs = useMemo(() => availableTabs(view), [view]);
  const tab = activeTab(rememberedTab, view);

  const handleTabSelect = useCallback((next) => {
    writeTab(next);
    setRememberedTab(next);
  }, []);
  const allBusy = summary.total > 0 && summary.busy === summary.total;
  const isQueueOpen = queueOpened === null ? allBusy : queueOpened;

  const handleToggle = useCallback(() => {
    setExpanded((prev) => {
      writeFlag(EXPANDED_KEY, !prev);
      return !prev;
    });
  }, []);

  const handleQueueToggle = useCallback(() => {
    const next = !isQueueOpen;

    // Closing it while the rule would open it, or opening it while the rule
    // would close it, is a choice worth remembering; agreeing with the rule
    // hands control back to it.
    const remembered = next === allBusy ? null : next;

    writeFlag(QUEUE_OPENED_KEY, remembered);
    setQueueOpened(remembered);
  }, [isQueueOpen, allBusy]);

  const handleOpenCard = useCallback(
    (cardId) => {
      if (cardId) {
        dispatch(push(Paths.CARDS.replace(':id', cardId)));
      }
    },
    [dispatch],
  );

  const handleRaise = useCallback(
    (fromIndex, aboveIndex, queue) => {
      const item = queue[fromIndex];
      const target = queue[aboveIndex];
      const preview = previewRaise(queue, fromIndex, aboveIndex);

      if (!item || !target || !preview.allowed) {
        return;
      }

      act(
        preview.outcome === RaiseOutcomes.RAISE
          ? (prev) => ({
              ...prev,
              queue: applyRaise(queue, fromIndex, aboveIndex, preview),
            })
          : null,
        () => api.raise(item.cardId, target.jobId),
      ).then(
        (result) => {
          // A raise is said in the viewer's language; a move that changed
          // nothing needs the orchestrator's own reason, which names why.
          showToast({
            title: result.changed ? 'pipeline.raisedTo' : 'pipeline.raiseUnchanged',
            values: {
              level: result.to || preview.to,
              name: target.name || t('pipeline.untitledCard'),
            },
            detail: result.changed ? undefined : result.note,
          });
        },
        (err) => {
          showToast({
            title: 'pipeline.raiseFailed',
            detail: err.message,
            negative: true,
          });
        },
      );
    },
    [act, t],
  );

  const handlePause = useCallback(
    (cardId) => {
      act(
        (prev) => {
          const thread = prev.threads.find((item) => item.cardId === cardId);

          return {
            ...prev,
            threads: prev.threads.map((item) =>
              item.cardId === cardId ? { ...item, paused: true } : item,
            ),
            paused: prev.paused.some((item) => item.cardId === cardId)
              ? prev.paused
              : [
                  ...prev.paused,
                  {
                    cardId,
                    name: thread && thread.cardName,
                    cardBoardId: thread && thread.cardBoardId,
                    at: new Date(serverNow()).toISOString(),
                  },
                ],
          };
        },
        () => api.pauseCard(cardId),
      ).then(
        (result) => {
          showToast({ title: 'pipeline.cardPaused', detail: result.note });
        },
        (err) => {
          showToast({
            title: 'pipeline.pauseFailed',
            detail: err.message,
            negative: true,
          });
        },
      );
    },
    [act, serverNow],
  );

  const handleResume = useCallback(
    (cardId) => {
      act(
        (prev) => ({
          ...prev,
          threads: prev.threads.map((item) =>
            item.cardId === cardId ? { ...item, paused: false } : item,
          ),
          paused: prev.paused.filter((item) => item.cardId !== cardId),
        }),
        () => api.resumeCard(cardId),
      ).then(
        (result) => {
          showToast({ title: 'pipeline.cardResumed', detail: result.note });
        },
        (err) => {
          showToast({
            title: 'pipeline.resumeFailed',
            detail: err.message,
            negative: true,
          });
        },
      );
    },
    [act],
  );

  const handleDrain = useCallback(
    (on) => {
      // The orchestrator credits a drain to the Planka username, so that is
      // what is shown until it answers.
      const actor = currentUser && (currentUser.username || currentUser.name);

      act(
        (prev) => ({
          ...prev,
          dispatching: !on,
          drain: {
            ...prev.drain,
            active: on,
            actor: actor || (prev.drain && prev.drain.actor),
            since: new Date(serverNow()).toISOString(),
          },
        }),
        () => api.setDrain(on),
      ).then(
        () => {
          showToast({ title: on ? 'pipeline.drainOn' : 'pipeline.drainOff' });
        },
        (err) => {
          showToast({
            title: 'pipeline.drainFailed',
            detail: err.message,
            negative: true,
          });
        },
      );
    },
    [act, serverNow, currentUser],
  );

  const handleDrainOn = useCallback(() => handleDrain(true), [handleDrain]);
  const handleDrainOff = useCallback(() => handleDrain(false), [handleDrain]);

  const secondsWaited = useCallback(
    (item) => {
      const since = secondsSince(item.queuedAt, nowMs);
      return since === null ? item.waitingSeconds || 0 : since;
    },
    [nowMs],
  );

  const ConfirmationPopup = usePopup(ConfirmationStep);

  if (!drawn) {
    return null;
  }

  if (status === Statuses.LOADING) {
    return (
      <div ref={wrapperRef} className={styles.outer} data-pipeline-strip="loading">
        <div className={styles.wrapper}>
          <Placeholder fluid className={styles.skeleton}>
            <Placeholder.Line length="full" />
            {expanded && <Placeholder.Line length="very long" />}
          </Placeholder>
        </div>
      </div>
    );
  }

  if (status === Statuses.UNREACHABLE) {
    return (
      <div ref={wrapperRef} className={styles.outer} data-pipeline-strip="unreachable">
        <div className={classNames(styles.wrapper, styles.wrapperUnreachable)}>
          <div className={styles.header}>
            <span className={styles.title}>
              <Icon name="warning sign" />
              {t('pipeline.unreachable')}
            </span>
            {error && <span className={styles.detail}>{error}</span>}
          </div>
        </div>
      </div>
    );
  }

  const drain = view.drain || { active: false };
  const drainAge = secondsSince(drain.since, nowMs);

  return (
    <div ref={wrapperRef} className={styles.outer} data-pipeline-strip="ok">
      <div className={classNames(styles.wrapper, expanded && styles.wrapperExpanded)}>
        <div
          role="button"
          tabIndex={0}
          className={styles.header}
          aria-expanded={expanded}
          title={t(expanded ? 'pipeline.collapse' : 'pipeline.expand')}
          onClick={handleToggle}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              handleToggle();
            }
          }}
        >
          <span className={styles.title}>
            <Icon name={expanded ? 'caret down' : 'caret right'} />
            {t('pipeline.title')}
          </span>
          <span className={styles.segments}>
            {view.threads.map((thread) => {
              const percent = progressPercent(thread.progress);

              return (
                <span
                  key={thread.name}
                  className={classNames(
                    styles.segment,
                    styles[`state${upperFirst(thread.paused ? 'paused' : thread.state)}`],
                  )}
                  title={thread.cardName ? `${thread.name}: ${thread.cardName}` : thread.name}
                >
                  {isThreadBusy(thread) && (
                    <span
                      className={styles.segmentFill}
                      style={{ width: `${percent === null ? 100 : percent}%` }}
                    />
                  )}
                </span>
              );
            })}
          </span>
          <span className={styles.chips} data-summary>
            <Label size="mini" className={styles.chip} data-chip="threads">
              {t('pipeline.threadsBusy', {
                busy: summary.busy,
                total: summary.total,
              })}
            </Label>
            <Label size="mini" className={styles.chip} data-chip="queue">
              {t('pipeline.queueCount', { count: summary.queued })}
            </Label>
            {summary.paused > 0 && (
              <Label
                size="mini"
                className={classNames(styles.chip, styles.chipPaused)}
                data-chip="paused"
              >
                ⏸ {t('pipeline.pausedCount', { count: summary.paused })}
              </Label>
            )}
            {summary.draining && (
              <Label
                size="mini"
                className={classNames(styles.chip, styles.chipDraining)}
                data-chip="draining"
              >
                {t('pipeline.draining')}
              </Label>
            )}
            {!summary.draining && view.dispatching === false && (
              <Label size="mini" className={styles.chip} data-chip="held">
                {t('pipeline.dispatchHeld')}
              </Label>
            )}
            {tabSummary.tests && (
              <Label size="mini" className={styles.chip} data-chip="tests">
                {t('pipeline.testsChip', tabSummary.tests)}
              </Label>
            )}
            {tabSummary.deploys && (
              <Label
                size="mini"
                className={styles.chip}
                title={t('pipeline.deploysChipTitle', tabSummary.deploys)}
                data-chip="deploys"
              >
                {t('pipeline.deploysChip', { count: tabSummary.deploys.deploying })}
              </Label>
            )}
            {tabSummary.limited.length > 0 && (
              <Label
                size="mini"
                className={classNames(styles.chip, styles.chipRefused)}
                data-chip="limited"
              >
                ⛔ {t('pipeline.limitedChip', { names: tabSummary.limited.join(', ') })}
              </Label>
            )}
          </span>
        </div>
        {expanded && tabs.length > 1 && (
          <div className={styles.tabs} role="tablist">
            {tabs.map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={item === tab}
                className={classNames(styles.tabButton, item === tab && styles.tabButtonActive)}
                data-tab={item}
                onClick={() => handleTabSelect(item)}
              >
                {t(TAB_TITLE_KEYS[item])}
                {item === Tabs.ACCOUNTS && tabSummary.limited.length > 0 && ' ⛔'}
              </button>
            ))}
          </div>
        )}
        {expanded && tab === Tabs.TESTING && (
          <div className={styles.body}>
            <TestingTab
              tests={view.tests}
              nowMs={nowMs}
              durationUnits={durationUnits}
              onOpenCard={handleOpenCard}
            />
          </div>
        )}
        {expanded && tab === Tabs.DEPLOYMENT && (
          <div className={styles.body}>
            <DeploymentTab
              deploys={view.deploys}
              nowMs={nowMs}
              durationUnits={durationUnits}
              onOpenCard={handleOpenCard}
            />
          </div>
        )}
        {expanded && tab === Tabs.ACCOUNTS && (
          <div className={styles.body}>
            <AccountsTab accounts={view.accounts} nowMs={nowMs} durationUnits={durationUnits} />
          </div>
        )}
        {expanded && tab === Tabs.STATISTICS && (
          <div className={styles.body}>
            <StatisticsTab boardId={boardId} durationUnits={durationUnits} />
          </div>
        )}
        {expanded && tab === Tabs.BUILD && (
          <div className={styles.body}>
            <div className={styles.controls}>
              {drain.active && (
                <span className={styles.detail} data-drain-status>
                  ⏸{' '}
                  {t('pipeline.drainingSince', {
                    actor: drain.actor || '—',
                    age: drainAge === null ? '—' : formatDuration(drainAge, durationUnits),
                  })}
                </span>
              )}
              {view.canEdit &&
                (drain.active ? (
                  <ConfirmationPopup
                    title="pipeline.resumePipelineConfirm"
                    content="pipeline.resumePipelineConfirmContent"
                    buttonType="positive"
                    buttonContent="pipeline.resumePipeline"
                    onConfirm={handleDrainOff}
                  >
                    <Button compact size="mini" className={styles.button} data-action="drain-off">
                      ▶ {t('pipeline.resumePipeline')}
                    </Button>
                  </ConfirmationPopup>
                ) : (
                  <ConfirmationPopup
                    title="pipeline.pausePipelineConfirm"
                    content="pipeline.pausePipelineConfirmContent"
                    buttonContent="pipeline.pausePipeline"
                    onConfirm={handleDrainOn}
                  >
                    <Button compact size="mini" className={styles.button} data-action="drain-on">
                      ⏸ {t('pipeline.pausePipeline')}
                    </Button>
                  </ConfirmationPopup>
                ))}
            </div>
            <div className={styles.threads}>
              {groupByAccount(view.threads).map((group) => (
                <div key={group.account} className={styles.account}>
                  <div className={styles.accountName}>
                    {group.account || t('pipeline.noAccount')}
                  </div>
                  {group.threads.map((thread) => (
                    <ThreadBar
                      key={thread.name}
                      thread={thread}
                      nowMs={nowMs}
                      durationUnits={durationUnits}
                      canPause={!!view.canPause}
                      onOpenCard={handleOpenCard}
                      onPause={handlePause}
                      onResume={handleResume}
                    />
                  ))}
                </div>
              ))}
            </div>
            {view.paused.length > 0 && (
              <div className={styles.paused} data-paused-row>
                <span className={styles.sectionTitle}>
                  ⏸ {t('pipeline.pausedCards', { count: view.paused.length })}
                </span>
                {view.paused.map((card) => {
                  const age = secondsSince(card.at, nowMs);

                  return (
                    <span key={card.cardId} className={styles.pausedCard}>
                      <button
                        type="button"
                        className={styles.link}
                        onClick={() => handleOpenCard(card.cardId)}
                      >
                        {card.name || t('pipeline.untitledCard')}
                      </button>
                      {(card.by || age !== null) && (
                        <span className={styles.detail}>
                          {[card.by, age === null ? null : formatDuration(age, durationUnits)]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                      {view.canPause && (
                        <Button
                          compact
                          size="mini"
                          className={styles.button}
                          onClick={() => handleResume(card.cardId)}
                        >
                          ▶ {t('pipeline.resume')}
                        </Button>
                      )}
                    </span>
                  );
                })}
              </div>
            )}
            <div className={styles.queue}>
              <button
                type="button"
                className={styles.sectionToggle}
                aria-expanded={isQueueOpen}
                onClick={handleQueueToggle}
              >
                <Icon name={isQueueOpen ? 'caret down' : 'caret right'} />
                {t('pipeline.queueTitle', { count: view.queue.length })}
              </button>
              {isQueueOpen &&
                (view.queue.length > 0 ? (
                  <QueuePanel
                    queue={view.queue}
                    canEdit={!!view.canEdit}
                    secondsWaited={secondsWaited}
                    durationUnits={durationUnits}
                    onOpenCard={handleOpenCard}
                    onRaise={handleRaise}
                  />
                ) : (
                  <div className={styles.empty}>{t('pipeline.queueEmpty')}</div>
                ))}
              {isQueueOpen && view.canEdit && view.queue.length > 1 && (
                <div className={styles.hint}>{t('pipeline.raiseHint')}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

PipelineStrip.propTypes = {
  boardId: PropTypes.string.isRequired,
};

export default PipelineStrip;
