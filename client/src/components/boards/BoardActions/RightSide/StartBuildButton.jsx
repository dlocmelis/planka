/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useCallback, useState } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Icon, Popup } from 'semantic-ui-react';

import selectors from '../../../../selectors';

import styles from './RightSide.module.scss';

// Where Caddy mounts the orchestrator's terminal inside this origin.
const TERMINAL_BASE = '/_term';

/*
 * "Build something" — opens an ad-hoc end-to-end build session on the
 * orchestrator and sends the person to its terminal.
 *
 * Three things about this are deliberate:
 *
 * 1. The POST is SAME-ORIGIN, to /_term/e2e. The terminal is also served at
 *    hooks.build.setlfi.com, and going there instead would make this a
 *    cross-origin request needing CORS for no gain.
 * 1b. The session URL is built HERE, from the returned id, and not from the
 *    `path` the orchestrator returns. Caddy mounts the terminal with
 *    `handle_path`, which STRIPS /_term before proxying, so the server has
 *    no prefix configured and answers with a bare `/e2e/<id>`. Following
 *    that would land on Planka's own SPA. Where the terminal is mounted is
 *    the client's knowledge, not the server's.
 * 2. The navigation is window.location.assign, not a <Link> and not an
 *    <a href>. Planka marks same-site links "same-site" and a document-level
 *    listener pushes them into the SPA router, which has no route for
 *    /_term/* — an anchor here would render Planka's own 404.
 * 3. The button is always rendered. The client has no way to know whether
 *    the deployment has sessions switched on, so the server's "not enabled"
 *    answer is shown as the error rather than guessed at up front.
 */
const StartBuildButton = React.memo(() => {
  const board = useSelector(selectors.selectCurrentBoard);

  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState(null);

  const [t] = useTranslation();

  const handleClick = useCallback(async () => {
    if (isOpening) {
      return;
    }

    setIsOpening(true);
    setError(null);

    try {
      const response = await fetch(`${TERMINAL_BASE}/e2e`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId: board.id }),
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        // The orchestrator's refusals are written to be read by a person
        // ("ad-hoc build sessions are not enabled on this deployment"), so
        // show what it said rather than a status code.
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      if (!body.id) {
        throw new Error(t('common.buildSessionFailed'));
      }

      window.location.assign(`${TERMINAL_BASE}/e2e/${body.id}`);
    } catch (e) {
      setError(e.message);
      setIsOpening(false);
    }
  }, [board.id, isOpening, t]);

  const handleErrorClose = useCallback(() => {
    setError(null);
  }, []);

  // ONE popup, controlled by whether there is an error. Rendering a second,
  // force-open popup instead would remount the trigger under the user's
  // cursor and leave a tooltip that nothing can dismiss.
  //
  // The failure has to be visible at all: without it, a click the
  // orchestrator refused looks exactly like a click that never registered.
  return (
    <Popup
      position="bottom right"
      content={error || t('action.startBuildSession')}
      open={error ? true : undefined}
      onClose={handleErrorClose}
      trigger={
        <button
          type="button"
          disabled={isOpening}
          className={styles.button}
          onClick={handleClick}
          aria-label={t('action.startBuildSession')}
        >
          <Icon fitted loading={isOpening} name={isOpening ? 'spinner' : 'magic'} />
        </button>
      }
    />
  );
});

export default StartBuildButton;
