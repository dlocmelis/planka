/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useDidUpdate } from '../../../lib/hooks';

import selectors from '../../../selectors';
import entryActions from '../../../entry-actions';
import { BoardMembershipRoles } from '../../../constants/Enums';
import { isListArchiveOrTrash } from '../../../utils/record-helpers';
import {
  DEFAULT_LAUNCHER_POSITION,
  DEFAULT_PANEL_WIDTH,
  LAUNCHER_SIZE,
  botReplyState,
  clampLauncherPosition,
  clampPanelWidth,
  readLastCardId,
  readLauncherPosition,
  readPanelWidth,
  unreadMessageCount,
  writeLastCardId,
  writeLauncherPosition,
  writePanelWidth,
} from '../../../utils/bot-chat';
import Launcher from './Launcher';
import Panel from './Panel';

import styles from './BotChat.module.scss';

/** Breathing room between the launcher and the panel that grows out of it. */
const PANEL_GAP = 12;

/** ...and between the panel and the two viewport edges it grows towards. */
const PANEL_VIEWPORT_MARGIN = 16;

/** How often the panel re-reads the clock while it is open, so "thinking"
 * turns into "still nothing" without waiting for the next message to arrive
 * and re-render it. */
const CLOCK_TICK_MS = 30 * 1000;

/**
 * Chat with planka_bot from anywhere on a board — the floating launcher and
 * the docked panel it opens, mirroring the Setlfi web assistant.
 *
 * The transport is Planka's own: a message is a comment on a card, and the
 * bot's answer is the comment it posts back (devteam-orchestrator triages
 * every human comment and always replies). That is why the panel is on a card
 * rather than on nothing — the card is the thread, it is where the bot reads
 * the context from, and the conversation stays visible to the rest of the
 * board afterwards instead of living in a side channel. It arrives live over
 * the socket the board is already subscribed to, so nothing polls.
 */
const BotChat = React.memo(() => {
  const selectCardById = useMemo(() => selectors.makeSelectCardById(), []);
  const selectListById = useMemo(() => selectors.makeSelectListById(), []);
  const selectChatMessagesForCard = useMemo(() => selectors.makeSelectChatMessagesForCard(), []);

  const boardId = useSelector((state) => selectors.selectPath(state).boardId);
  const openedCardId = useSelector((state) => selectors.selectPath(state).cardId);
  const bot = useSelector(selectors.selectBotUserForCurrentBoard);

  const dispatch = useDispatch();

  const [isOpened, setIsOpened] = useState(false);
  const [cardId, setCardId] = useState(null);
  const [position, setPosition] = useState(DEFAULT_LAUNCHER_POSITION);
  const [width, setWidth] = useState(DEFAULT_PANEL_WIDTH);
  // Nothing that was already on the board when this tab loaded counts as
  // unread: the badge means "something arrived while you were here and not
  // looking", which is the only meaning that stays true across a reload.
  const [lastSeenAt, setLastSeenAt] = useState(() => new Date());
  const [now, setNow] = useState(() => Date.now());

  // Read in an effect rather than in a lazy initializer so the first paint
  // does not depend on storage the browser may refuse, and so a viewport the
  // window has since been resized to is the one the position is clamped
  // against.
  useEffect(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const storedPosition = readLauncherPosition(window.localStorage, viewport);
    const storedWidth = readPanelWidth(window.localStorage, window.innerWidth);
    const storedCardId = readLastCardId(window.localStorage);

    if (storedPosition) {
      setPosition(storedPosition);
    }

    if (storedWidth !== null) {
      setWidth(storedWidth);
    }

    if (storedCardId) {
      setCardId(storedCardId);
    }
  }, []);

  // Keep a moved launcher and a widened panel on-screen through rotations and
  // window resizes.
  useEffect(() => {
    const handleResize = () => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };

      setPosition((current) => clampLauncherPosition(current, viewport));
      setWidth((current) => clampPanelWidth(current, viewport.width));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Follow the user: opening a card makes that card the conversation, the way
  // the Setlfi assistant follows the page you are on.
  useEffect(() => {
    if (openedCardId) {
      setCardId(openedCardId);
    }
  }, [openedCardId]);

  // Only once the conversation actually CHANGES: the first run of a plain
  // effect happens before the hydrating one above has applied the stored card,
  // and would erase it with the initial null.
  useDidUpdate(() => {
    writeLastCardId(window.localStorage, cardId);
  }, [cardId]);

  const card = useSelector((state) => (cardId ? selectCardById(state, cardId) : null));

  // A card of another board (or one this board has not loaded) is not a
  // conversation that can be shown here — the panel falls back to the picker
  // without forgetting the stored card, which is still the right one to resume
  // on the board it belongs to.
  const activeCardId = card && card.boardId === boardId ? cardId : null;

  const messages = useSelector((state) => selectChatMessagesForCard(state, activeCardId));

  const canComment = useSelector((state) => {
    const boardMembership = selectors.selectCurrentUserMembershipForCurrentBoard(state);

    if (!boardMembership) {
      return false;
    }

    if (card) {
      const list = selectListById(state, card.listId);

      if (list && isListArchiveOrTrash(list)) {
        return false;
      }
    }

    return boardMembership.role === BoardMembershipRoles.EDITOR || !!boardMembership.canComment;
  });

  // The thread has to be loaded before it can be read or counted, and comments
  // are fetched per card — the board's own bootstrap does not carry them.
  // Fetched once: the service paginates backwards from `lastCommentId`, so
  // calling it again would walk into the history rather than refresh the head.
  useEffect(() => {
    if (!activeCardId || !card) {
      return;
    }

    if (card.isAllCommentsFetched === null && !card.isCommentsFetching) {
      dispatch(entryActions.fetchCommentsForCard(activeCardId));
    }
  }, [activeCardId, card, dispatch]);

  // Everything visible in an open panel counts as read.
  useEffect(() => {
    if (isOpened) {
      setLastSeenAt(new Date());
    }
  }, [isOpened, messages.length, activeCardId]);

  // The clock the reply state is judged against. It ticks only while the panel
  // is open — nothing off-screen needs to know that a wait has gone from long
  // to too long — and it is state rather than a `Date.now()` at render time so
  // that "still thinking" becomes "no answer yet" on its own, without waiting
  // for the next message to re-render the panel.
  useEffect(() => {
    if (!isOpened) {
      return undefined;
    }

    setNow(Date.now());

    const interval = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(interval);
  }, [isOpened]);

  const unreadCount = useMemo(
    () => (isOpened ? 0 : unreadMessageCount(messages, lastSeenAt)),
    [isOpened, messages, lastSeenAt],
  );

  const replyState = useMemo(() => botReplyState(messages, { now }), [messages, now]);

  // The launcher stays visible under the open panel — unlike the Setlfi
  // assistant, which hides its orb behind the panel — so it has to be the
  // toggle its `aria-expanded` says it is. A second press on a button that
  // announces itself as expanded doing nothing is the wart.
  const handleToggle = useCallback(() => {
    setIsOpened((current) => !current);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpened(false);
  }, []);

  const handleMove = useCallback((nextPosition, isFinal) => {
    setPosition(nextPosition);

    if (isFinal) {
      writeLauncherPosition(window.localStorage, nextPosition);
    }
  }, []);

  const handleWidthChange = useCallback((nextWidth, isFinal) => {
    setWidth(nextWidth);

    if (isFinal) {
      writePanelWidth(window.localStorage, nextWidth);
    }
  }, []);

  const handleSelectCard = useCallback((nextCardId) => {
    setCardId(nextCardId);
  }, []);

  const handleClearCard = useCallback(() => {
    setCardId(null);
  }, []);

  const handleSubmit = useCallback(
    (text) => {
      if (!activeCardId) {
        return;
      }

      dispatch(entryActions.createCommentForCard(activeCardId, { text }));
    },
    [activeCardId, dispatch],
  );

  const handleKeyDown = useCallback((event) => {
    if (event.key === 'Escape') {
      // Only the panel's own Escape: the card modal behind it owns the key
      // otherwise, and closing both at once is not what was asked for.
      event.stopPropagation();
      setIsOpened(false);
    }
  }, []);

  // No bot on this board, no chat: the launcher would open a conversation
  // nobody is listening to.
  if (!boardId || !bot) {
    return null;
  }

  // The panel grows up and to the left out of the launcher, wherever the
  // launcher has been dragged to — so both of the edges it grows towards are
  // capped against the viewport, or a launcher parked near the top or the far
  // left opens a panel with its head off the screen.
  const panelBottom = position.bottom + LAUNCHER_SIZE + PANEL_GAP;

  return (
    <>
      {isOpened && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div
          role="dialog"
          aria-label={bot.name || bot.username}
          className={styles.panelAnchor}
          style={{ right: position.right, bottom: panelBottom }}
          onKeyDown={handleKeyDown}
        >
          <Panel
            bot={bot}
            cardId={activeCardId || undefined}
            cardName={activeCardId && card ? card.name : undefined}
            messages={messages}
            replyState={replyState}
            isCommentsFetching={!!(card && card.isCommentsFetching)}
            canComment={canComment}
            width={width}
            maxWidth={`calc(100vw - ${position.right + PANEL_VIEWPORT_MARGIN}px)`}
            maxHeight={`calc(100dvh - ${panelBottom + PANEL_VIEWPORT_MARGIN}px)`}
            onWidthChange={handleWidthChange}
            onSubmit={handleSubmit}
            onSelectCard={handleSelectCard}
            onClearCard={handleClearCard}
            onClose={handleClose}
          />
        </div>
      )}
      <Launcher
        bot={bot}
        position={position}
        unreadCount={unreadCount}
        isOpened={isOpened}
        onToggle={handleToggle}
        onMove={handleMove}
      />
    </>
  );
});

export default BotChat;
