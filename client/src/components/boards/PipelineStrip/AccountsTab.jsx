/*!
 * Copyright (c) 2026 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React from 'react';
import PropTypes from 'prop-types';
import upperFirst from 'lodash/upperFirst';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { Label } from 'semantic-ui-react';

import {
  USAGE_WINDOWS,
  formatDuration,
  formatWhen,
  secondsSince,
  secondsUntil,
  usageLevel,
} from '../../../utils/pipeline-strip';

import styles from './PipelineStrip.module.scss';

const WINDOW_KEYS = {
  '5h': 'pipeline.window5h',
  week: 'pipeline.windowWeek',
  week_fable: 'pipeline.windowWeekFable',
};

const STATUS_KEYS = {
  ok: 'pipeline.endpointOk',
  warning: 'pipeline.endpointWarning',
  refused: 'pipeline.endpointRefused',
};

const AUTH_KEYS = {
  subscription: 'pipeline.authSubscription',
  'api-key': 'pipeline.authApiKey',
  endpoint: 'pipeline.authEndpoint',
};

// "resets 16:40, in 2h 14m" — or the time alone once it has passed. The time
// and date are written in the viewer's Planka language, not the browser's.
const resetText = (t, iso, nowMs, durationUnits, locale) => {
  const when = formatWhen(iso, nowMs, locale);
  const until = secondsUntil(iso, nowMs);

  if (until === null) {
    return t('pipeline.resetsAt', { when });
  }

  return t('pipeline.resetsIn', { when, duration: formatDuration(until, durationUnits) });
};

// Each Claude account: its usage windows with when they reset, the
// endpoint's own verdict, whether it is benched at a limit, and how old the
// reading is — from the same tracker the Threads cards render.
const AccountsTab = React.memo(({ accounts, nowMs, durationUnits }) => {
  const [t, i18n] = useTranslation();
  const locale = i18n && i18n.language;

  return (
    <div className={styles.tab} data-tab-panel="accounts">
      {accounts.length === 0 && <div className={styles.empty}>{t('pipeline.accountsNone')}</div>}
      {accounts.map((account) => {
        const age = secondsSince(account.fetchedAt, nowMs);
        const windows = account.windows || [];
        const byKey = {};
        windows.forEach((window) => {
          byKey[window.key] = window;
        });
        const limitUntil = account.limited && secondsUntil(account.limitedUntil, nowMs);

        return (
          <div key={account.name} className={styles.group} data-account={account.name}>
            <div className={styles.accountHeader}>
              <span className={styles.accountTitle}>{account.name}</span>
              <Label size="mini" className={styles.chip}>
                {t(AUTH_KEYS[account.auth] || AUTH_KEYS['api-key'], {
                  host: account.endpointHost || '',
                })}
              </Label>
              <span className={styles.detail}>
                {t('pipeline.accountThreads', { count: account.threads || 0 })}
              </span>
              {account.status && (
                <Label
                  size="mini"
                  className={classNames(styles.chip, styles[`usage${upperFirst(account.status)}`])}
                  title={t('pipeline.endpointStatus')}
                  data-endpoint-status={account.status}
                >
                  {t(STATUS_KEYS[account.status])}
                </Label>
              )}
              {account.limited && (
                <Label
                  size="mini"
                  className={classNames(styles.chip, styles.chipRefused)}
                  data-limited
                >
                  ⛔{' '}
                  {account.limitedUntil
                    ? t('pipeline.limitedUntil', {
                        when: formatWhen(account.limitedUntil, nowMs, locale),
                        duration: formatDuration(limitUntil || 0, durationUnits),
                      })
                    : t('pipeline.limitedUnknown')}
                </Label>
              )}
              {account.limited && account.threads === 0 && (
                <span className={styles.detail}>{t('pipeline.limitedNoThreads')}</span>
              )}
            </div>
            {account.auth === 'subscription' && account.stale && (
              <div className={styles.empty} data-stale>
                {t('pipeline.readingStale', {
                  when: formatWhen(account.fetchedAt, nowMs, locale),
                  duration: formatDuration(age || 0, durationUnits),
                })}
              </div>
            )}
            {account.auth === 'subscription' && !account.fetchedAt && (
              <div className={styles.empty}>{t('pipeline.readingNone')}</div>
            )}
            {account.auth !== 'subscription' && (
              <div className={styles.empty}>{t('pipeline.noUsageWindows')}</div>
            )}
            {USAGE_WINDOWS.filter((key) => byKey[key]).map((key) => {
              const window = byKey[key];
              const level = usageLevel(window);

              return (
                <div key={key} className={styles.row} data-window={key}>
                  <span className={styles.rowName}>{t(WINDOW_KEYS[key])}</span>
                  <span className={styles.rowBar}>
                    <span className={styles.bar}>
                      <span
                        className={classNames(styles.fill, styles[`usage${upperFirst(level)}`])}
                        style={{ width: `${Math.max(0, Math.min(100, window.percent))}%` }}
                      />
                      <span className={styles.barPercent}>{window.percent}%</span>
                    </span>
                  </span>
                  <span className={styles.rowDetails}>
                    {window.resetsAt && (
                      <span className={styles.detail}>
                        {resetText(t, window.resetsAt, nowMs, durationUnits, locale)}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
            {windows.length > 0 && age !== null && (
              <div className={styles.hint}>
                {t('pipeline.readingAge', { duration: formatDuration(age, durationUnits) })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

AccountsTab.propTypes = {
  accounts: PropTypes.array.isRequired, // eslint-disable-line react/forbid-prop-types
  nowMs: PropTypes.number.isRequired,
  durationUnits: PropTypes.object.isRequired, // eslint-disable-line react/forbid-prop-types
};

export default AccountsTab;
