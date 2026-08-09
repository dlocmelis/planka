/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';

import {
  LAUNCHER_HOLD_CANCEL_PX,
  LAUNCHER_HOLD_MS,
  clampLauncherPosition,
  unreadBadgeLabel,
} from '../../../utils/bot-chat';
import UserAvatar from '../../users/UserAvatar';

import styles from './Launcher.module.scss';

/**
 * The floating button: a round avatar of the bot pinned to the bottom-right
 * corner, with an unread badge and a hold-then-drag reposition.
 *
 * The gesture is the Setlfi assistant's, ported: press and hold for
 * LAUNCHER_HOLD_MS and the button follows the pointer; move before the hold
 * elapses and it was a tap or a scroll, so the drag never starts. That is what
 * lets one control both toggle the panel on click and be movable out of the
 * way of whatever it is covering, on a touch screen as well as with a mouse.
 *
 * The accessible name does not change with `isOpened`: `aria-expanded` is what
 * carries the state, and a disclosure button whose label flips under the
 * user's cursor is the harder thing to follow.
 */
const Launcher = React.memo(({ bot, position, unreadCount, isOpened, onToggle, onMove }) => {
  const [t] = useTranslation();
  const [isDragging, setIsDragging] = useState(false);

  const holdTimerRef = useRef(null);
  const draggingRef = useRef(false);
  const dragStartRef = useRef(null);
  // Set when a drag has just ended so the pointerup's click does not also open
  // the panel; cleared on the next pointerdown (the click may never fire at
  // all once the pointer was captured).
  const suppressClickRef = useRef(false);

  const cancelHoldTimer = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  useEffect(() => cancelHoldTimer, [cancelHoldTimer]);

  const handlePointerDown = useCallback(
    (event) => {
      suppressClickRef.current = false;

      if (event.button !== undefined && event.button !== 0) {
        return;
      }

      const element = event.currentTarget;
      const { pointerId } = event;

      dragStartRef.current = { x: event.clientX, y: event.clientY, position };

      cancelHoldTimer();
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        draggingRef.current = true;
        setIsDragging(true);

        try {
          element.setPointerCapture(pointerId);
        } catch {
          // Pointer already gone — the drag just will not track.
        }

        if (navigator.vibrate) {
          navigator.vibrate(30);
        }
      }, LAUNCHER_HOLD_MS);
    },
    [position, cancelHoldTimer],
  );

  const handlePointerMove = useCallback(
    (event) => {
      const start = dragStartRef.current;

      if (!start) {
        return;
      }

      const deltaX = event.clientX - start.x;
      const deltaY = event.clientY - start.y;

      if (!draggingRef.current) {
        // Still waiting for the hold — real movement means a tap or a scroll.
        if (
          Math.abs(deltaX) > LAUNCHER_HOLD_CANCEL_PX ||
          Math.abs(deltaY) > LAUNCHER_HOLD_CANCEL_PX
        ) {
          cancelHoldTimer();
          dragStartRef.current = null;
        }

        return;
      }

      onMove(
        clampLauncherPosition(
          { right: start.position.right - deltaX, bottom: start.position.bottom - deltaY },
          { width: window.innerWidth, height: window.innerHeight },
        ),
        false,
      );
    },
    [onMove, cancelHoldTimer],
  );

  const handlePointerEnd = useCallback(() => {
    cancelHoldTimer();
    dragStartRef.current = null;

    if (!draggingRef.current) {
      return;
    }

    draggingRef.current = false;
    setIsDragging(false);
    suppressClickRef.current = true;

    // Persisted once per gesture rather than per frame: a drag is dozens of
    // pointermoves and localStorage is synchronous.
    onMove(position, true);
  }, [position, onMove, cancelHoldTimer]);

  const handleClick = useCallback(() => {
    if (suppressClickRef.current) {
      return;
    }

    onToggle();
  }, [onToggle]);

  const badge = unreadBadgeLabel(unreadCount);

  return (
    <button
      type="button"
      aria-label={
        unreadCount > 0
          ? t('common.chatWithBotWithUnread', { username: bot.username, count: unreadCount })
          : t('common.chatWithBot', { username: bot.username })
      }
      aria-expanded={isOpened}
      className={classNames(styles.launcher, isDragging && styles.launcherDragging)}
      style={{ right: position.right, bottom: position.bottom }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onClick={handleClick}
    >
      <UserAvatar id={bot.id} size="large" />
      {badge && (
        <span aria-hidden="true" className={styles.badge}>
          {badge}
        </span>
      )}
    </button>
  );
});

Launcher.propTypes = {
  /* eslint-disable react/forbid-prop-types */
  bot: PropTypes.object.isRequired,
  position: PropTypes.object.isRequired,
  /* eslint-enable react/forbid-prop-types */
  unreadCount: PropTypes.number.isRequired,
  isOpened: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
  onMove: PropTypes.func.isRequired,
};

export default Launcher;
