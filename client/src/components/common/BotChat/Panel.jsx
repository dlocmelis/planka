/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useCallback, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { Button, Icon, Loader } from 'semantic-ui-react';

import {
  BotReplyStates,
  MIN_PANEL_WIDTH,
  PANEL_WIDTH_STEP,
  clampPanelWidth,
  isAtThreadBottom,
  maxPanelWidth,
  panelWidthAfterDrag,
  shouldFollowThread,
} from '../../../utils/bot-chat';
import CardPicker from './CardPicker';
import Composer from './Composer';
import Message from './Message';
import UserAvatar from '../../users/UserAvatar';

import styles from './Panel.module.scss';

/**
 * The docked chat window the launcher opens: the Setlfi assistant's panel,
 * rebuilt on this app's own primitives.
 *
 * It is pinned to the bottom-right corner, so its right edge never moves and
 * the whole of its frame is one number — the width, dragged from the left
 * edge. The handle is a real focusable `separator` rather than a bare div with
 * pointer handlers: a drag-only affordance is unusable without a pointer, and
 * the arrow keys are also the only half of this that a jsdom test can drive.
 */
const Panel = React.memo(
  ({
    bot,
    cardId,
    cardName,
    messages,
    replyState,
    isCommentsFetching,
    hasEarlierMessages,
    canComment,
    width,
    maxWidth,
    maxHeight,
    onWidthChange,
    onSubmit,
    onSelectCard,
    onClearCard,
    onLoadEarlier,
    onClose,
  }) => {
    const [t] = useTranslation();

    const threadRef = useRef(null);
    const widthRef = useRef(width);
    const dragRef = useRef(null);
    // Where the user's own scrolling has left the thread. Starts stuck: a panel
    // that has just opened is showing its latest message by definition.
    const stickToBottomRef = useRef(true);
    const messagesCountRef = useRef(messages.length);
    // How far the thread was from its BOTTOM when "load earlier" was pressed,
    // held until the page it asked for arrives. Null when nothing is pending.
    const earlierOffsetRef = useRef(null);

    widthRef.current = width;

    // A different conversation opens at its own latest message, whatever the
    // last one was left scrolled to. Declared before the effect below so the
    // reset lands first when both fire on the same change.
    useEffect(() => {
      stickToBottomRef.current = true;
      earlierOffsetRef.current = null;

      const element = threadRef.current;

      if (element) {
        element.scrollTop = element.scrollHeight;
      }
    }, [cardId]);

    // Follow the conversation: a new message, ours or the bot's, scrolls the
    // thread to the bottom the way every chat does — unless the user has
    // scrolled up, in which case they are reading something and being yanked
    // away from it is the bug.
    useEffect(() => {
      const element = threadRef.current;
      const hasGrown = messages.length > messagesCountRef.current;
      messagesCountRef.current = messages.length;

      const earlierOffset = earlierOffsetRef.current;

      // The marker belongs to one request: it is spent on the page it asked
      // for, and dropped if that request came back with nothing to add.
      if (earlierOffset !== null && (hasGrown || !isCommentsFetching)) {
        earlierOffsetRef.current = null;
      }

      if (!element) {
        return;
      }

      // Older messages are PREPENDED, so holding `scrollTop` still would leave
      // the reader at the top of a page they have not read while what they were
      // reading slid off the bottom. Holding the distance to the BOTTOM fixed
      // keeps the message they were looking at where they were looking.
      if (earlierOffset !== null && hasGrown) {
        element.scrollTop = element.scrollHeight - earlierOffset;
        return;
      }

      if (!shouldFollowThread({ stuckToBottom: stickToBottomRef.current })) {
        return;
      }

      element.scrollTop = element.scrollHeight;
    }, [messages.length, isCommentsFetching]);

    const handleThreadScroll = useCallback((event) => {
      stickToBottomRef.current = isAtThreadBottom(event.currentTarget);
    }, []);

    const handleLoadEarlierClick = useCallback(() => {
      const element = threadRef.current;
      earlierOffsetRef.current = element ? element.scrollHeight - element.scrollTop : 0;

      onLoadEarlier();
    }, [onLoadEarlier]);

    const handleHandlePointerDown = useCallback((event) => {
      // A right-click on the edge is a context menu, not a drag.
      if (event.button !== 0) {
        return;
      }

      // Stops the drag from selecting the thread behind the handle.
      event.preventDefault();
      dragRef.current = { x: event.clientX, width: widthRef.current };

      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // No pointer capture — the drag simply stops tracking outside the
        // handle.
      }
    }, []);

    const handleHandlePointerMove = useCallback(
      (event) => {
        const start = dragRef.current;

        if (!start) {
          return;
        }

        onWidthChange(
          panelWidthAfterDrag(start.width, start.x, event.clientX, window.innerWidth),
          false,
        );
      },
      [onWidthChange],
    );

    const handleHandlePointerEnd = useCallback(() => {
      if (!dragRef.current) {
        return;
      }

      dragRef.current = null;
      onWidthChange(widthRef.current, true);
    }, [onWidthChange]);

    /** The handle without a pointer. Left widens the panel, because the edge
     * being moved is its left one, and Home/End go to the two bounds. */
    const handleHandleKeyDown = useCallback(
      (event) => {
        const viewportWidth = window.innerWidth;
        let target = null;

        if (event.key === 'ArrowLeft') {
          target = widthRef.current + PANEL_WIDTH_STEP;
        } else if (event.key === 'ArrowRight') {
          target = widthRef.current - PANEL_WIDTH_STEP;
        } else if (event.key === 'Home') {
          target = maxPanelWidth(viewportWidth);
        } else if (event.key === 'End') {
          target = MIN_PANEL_WIDTH;
        }

        if (target === null) {
          return;
        }

        // The arrow keys scroll otherwise, and the thread is right behind this
        // handle.
        event.preventDefault();
        onWidthChange(clampPanelWidth(target, viewportWidth), true);
      },
      [onWidthChange],
    );

    let bodyNode;
    if (!cardId) {
      bodyNode = <CardPicker onSelect={onSelectCard} />;
    } else {
      bodyNode = (
        <div ref={threadRef} className={styles.thread} onScroll={handleThreadScroll}>
          {/* A card's comments arrive one page at a time (COMMENTS_LIMIT), and
              the panel opens on the newest page — without this the rest of a
              long-running conversation is simply unreachable from here, while
              the card's own comment list can still scroll back through it. */}
          {hasEarlierMessages && (
            <div className={styles.earlier}>
              <Button
                type="button"
                basic
                size="mini"
                disabled={isCommentsFetching}
                loading={isCommentsFetching}
                onClick={handleLoadEarlierClick}
              >
                {t('action.loadEarlierMessages')}
              </Button>
            </div>
          )}
          {messages.length === 0 &&
            (isCommentsFetching ? (
              <Loader active inline="centered" size="small" />
            ) : (
              <div className={styles.empty}>
                {t('common.chatWithBotIntro', { username: bot.username })}
              </div>
            ))}
          {messages.map((message) => (
            <Message key={message.id} message={message} />
          ))}
          {replyState === BotReplyStates.THINKING && (
            <div className={styles.status}>
              <Loader active inline size="mini" />
              <span>{t('common.botIsThinking', { username: bot.username })}</span>
            </div>
          )}
          {replyState === BotReplyStates.OVERDUE && (
            <div className={styles.status}>
              <Icon fitted name="clock outline" />
              <span>{t('common.botHasNotAnsweredYet', { username: bot.username })}</span>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className={styles.wrapper} style={{ width, maxWidth, maxHeight }}>
        {/* The WAI-ARIA window-splitter pattern: a focusable `separator` with
            aria-valuenow/min/max IS an interactive widget, which is exactly
            what makes the panel resizable without a pointer. The two rules
            below only know the non-focusable kind of separator. */}
        {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions,
                           jsx-a11y/no-noninteractive-tabindex */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={width}
          aria-valuemin={MIN_PANEL_WIDTH}
          aria-valuemax={maxPanelWidth(typeof window === 'undefined' ? width : window.innerWidth)}
          aria-label={t('common.resizePanel')}
          tabIndex={0}
          className={styles.resizeHandle}
          onPointerDown={handleHandlePointerDown}
          onPointerMove={handleHandlePointerMove}
          onPointerUp={handleHandlePointerEnd}
          onPointerCancel={handleHandlePointerEnd}
          onKeyDown={handleHandleKeyDown}
        />
        {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions,
                          jsx-a11y/no-noninteractive-tabindex */}
        <div className={styles.header}>
          <UserAvatar id={bot.id} size="small" />
          <div className={styles.headerText}>
            <div className={styles.headerName}>{bot.name || bot.username}</div>
            <button
              type="button"
              disabled={!cardId}
              title={cardName || undefined}
              className={styles.headerSubtitle}
              onClick={onClearCard}
            >
              {cardId ? cardName || t('common.card') : t('common.chooseACardToChatOn')}
            </button>
          </div>
          {cardId && (
            <Button
              type="button"
              icon
              basic
              aria-label={t('common.chooseACardToChatOn')}
              title={t('common.chooseACardToChatOn')}
              className={styles.headerButton}
              onClick={onClearCard}
            >
              <Icon fitted name="exchange" />
            </Button>
          )}
          <Button
            type="button"
            icon
            basic
            aria-label={t('action.close')}
            className={styles.headerButton}
            onClick={onClose}
          >
            <Icon fitted name="close" />
          </Button>
        </div>
        {bodyNode}
        {cardId && <Composer bot={bot} isDisabled={!canComment} onSubmit={onSubmit} />}
        {cardId && !canComment && (
          <div className={styles.readOnly}>{t('common.youCannotCommentOnThisBoard')}</div>
        )}
      </div>
    );
  },
);

Panel.propTypes = {
  /* eslint-disable react/forbid-prop-types */
  bot: PropTypes.object.isRequired,
  messages: PropTypes.array.isRequired,
  /* eslint-enable react/forbid-prop-types */
  cardId: PropTypes.string,
  cardName: PropTypes.string,
  replyState: PropTypes.string.isRequired,
  isCommentsFetching: PropTypes.bool.isRequired,
  hasEarlierMessages: PropTypes.bool.isRequired,
  canComment: PropTypes.bool.isRequired,
  width: PropTypes.number.isRequired,
  maxWidth: PropTypes.string.isRequired,
  maxHeight: PropTypes.string.isRequired,
  onWidthChange: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  onSelectCard: PropTypes.func.isRequired,
  onClearCard: PropTypes.func.isRequired,
  onLoadEarlier: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

Panel.defaultProps = {
  cardId: undefined,
  cardName: undefined,
};

export default Panel;
