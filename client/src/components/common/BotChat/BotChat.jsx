/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { useDidUpdate } from '../../../lib/hooks';
import { useVoiceChat } from '../../../hooks';

import selectors from '../../../selectors';
import entryActions from '../../../entry-actions';
import { BoardMembershipRoles } from '../../../constants/Enums';
import { isListArchiveOrTrash } from '../../../utils/record-helpers';
import {
  BotReplyStates,
  DEFAULT_LAUNCHER_POSITION,
  DEFAULT_PANEL_WIDTH,
  MessageAuthors,
  PANEL_VIEWPORT_MARGIN,
  botReplyState,
  clampLauncherPosition,
  clampPanelWidth,
  panelAnchor,
  readLastCardId,
  readLauncherPosition,
  readPanelWidth,
  unreadMessageCount,
  withBotMention,
  writeLastCardId,
  writeLauncherPosition,
  writePanelWidth,
} from '../../../utils/bot-chat';
import {
  VOICE_CHAT_STOP_REASON_KEYS,
  VoiceChatPhases,
  readVoiceChatEnabled,
  voiceChatPhase,
  writeVoiceChatEnabled,
} from '../../../utils/voice-chat';
import Launcher from './Launcher';
import Panel from './Panel';

import styles from './BotChat.module.scss';

/** The viewport the launcher is clamped against and the panel is capped
 * against. Read through a helper so there is one answer to "how big is the
 * window" and it is safe where there is none. */
const viewportSize = () =>
  typeof window === 'undefined'
    ? { width: 0, height: 0 }
    : { width: window.innerWidth, height: window.innerHeight };

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
  const voiceCapability = useSelector(selectors.selectVoiceChatCapability);

  const dispatch = useDispatch();

  const launcherRef = useRef(null);

  const [isOpened, setIsOpened] = useState(false);
  const [cardId, setCardId] = useState(null);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  // The sentence a mode that stopped itself leaves behind. Cleared the moment
  // the user switches it back on: it describes a state that no longer holds.
  const [voiceNotice, setVoiceNotice] = useState(null);
  const [position, setPosition] = useState(DEFAULT_LAUNCHER_POSITION);
  const [width, setWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [viewport, setViewport] = useState(viewportSize);
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
    const storedPosition = readLauncherPosition(window.localStorage, viewportSize());
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

    // The mode is remembered per browser, like the panel's width — someone who
    // talks to the bot talks to it every time. Nothing opens on the strength of
    // this alone: the microphone is only reached once the panel is open, and a
    // browser that will not resume its audio without a gesture stops the loop
    // with a sentence rather than listening at nothing (see
    // `VoiceChatStopReasons.AUDIO_SUSPENDED`).
    if (readVoiceChatEnabled(window.localStorage)) {
      setIsVoiceEnabled(true);
    }
  }, []);

  // Keep a moved launcher and a widened panel on-screen through rotations and
  // window resizes.
  useEffect(() => {
    const handleResize = () => {
      const nextViewport = viewportSize();

      // Tracked as state rather than read at render time: a position that is
      // already inside the new viewport does not change, so the two setters
      // below would not re-render, and the panel's caps would go on being
      // computed against the window the tab was opened at.
      setViewport(nextViewport);
      setPosition((current) => clampLauncherPosition(current, nextViewport));
      setWidth((current) => clampPanelWidth(current, nextViewport.width));
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

  // Give the keyboard back to the button that opened the panel, which is the
  // last piece of making Escape actually worth pressing. Everything focusable
  // in the panel unmounts with it — the composer, the picker's search box, the
  // close button — and a browser then drops focus on the body, so the next Tab
  // starts again at the top of the board and whoever was navigating by keyboard
  // has lost their place for having used the feature. The launcher is a toggle
  // that stays on screen, so it is both still there to receive focus and the
  // control the disclosure pattern says owns it.
  useDidUpdate(() => {
    if (!isOpened && launcherRef.current) {
      // Programmatic, so `:focus-visible` follows how the panel was closed: a
      // ring for the Escape that asked for it, none for a mouse on the close
      // button.
      launcherRef.current.focus();
    }
  }, [isOpened]);

  const card = useSelector((state) => (cardId ? selectCardById(state, cardId) : null));

  // A card of another board (or one this board has not loaded) is not a
  // conversation that can be shown here — the panel falls back to the picker
  // without forgetting the stored card, which is still the right one to resume
  // on the board it belongs to.
  const activeCardId = card && card.boardId === boardId ? cardId : null;

  const messages = useSelector((state) => selectChatMessagesForCard(state, activeCardId));

  // The board's own rule, which is the one the server enforces on
  // POST /cards/:id/comments: a membership, and editor or `canComment` on it.
  const canCommentOnBoard = useSelector((state) => {
    const boardMembership = selectors.selectCurrentUserMembershipForCurrentBoard(state);

    if (!boardMembership) {
      return false;
    }

    return boardMembership.role === BoardMembershipRoles.EDITOR || !!boardMembership.canComment;
  });

  // ...and the card's, kept apart from it so the panel can say WHICH of the
  // two is stopping it. An archived card is still openable — the whole app
  // renders it read-only rather than hiding it (Attachments, TaskList,
  // CustomField all do the same) — so a chat that followed the user into one
  // and then blamed their board membership would be telling them something
  // untrue about their account.
  const isCardArchivedOrTrashed = useSelector((state) => {
    if (!card) {
      return false;
    }

    const list = selectListById(state, card.listId);

    return !!list && isListArchiveOrTrash(list);
  });

  const canComment = canCommentOnBoard && !isCardArchivedOrTrashed;

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

  // The rest of a long conversation, one page at a time. The service is the
  // same one the effect above calls once — it paginates backwards from
  // `lastCommentId`, which is exactly what "earlier" means here.
  const handleLoadEarlier = useCallback(() => {
    if (!activeCardId || (card && card.isCommentsFetching)) {
      return;
    }

    dispatch(entryActions.fetchCommentsForCard(activeCardId));
  }, [activeCardId, card, dispatch]);

  const handleSubmit = useCallback(
    (text) => {
      if (!activeCardId) {
        return;
      }

      dispatch(entryActions.createCommentForCard(activeCardId, { text }));
    },
    [activeCardId, dispatch],
  );

  /* Voice chat */

  const [t] = useTranslation();

  // Which bot replies have already been read aloud. Kept as ids rather than as
  // a cursor because a reply is marked spoken whatever happened to it — a
  // synthesis that failed must not be retried on the next render for ever — and
  // because it is reset whenever the conversation or the mode changes, so it
  // grows by one entry per answer heard.
  const [spokenMessageIds, setSpokenMessageIds] = useState([]);
  // The moment voice chat started listening to THIS conversation. It is what
  // separates "the answer I am waiting for" from "the thread I just opened":
  // without it, turning the mode on would read out whichever reply happened to
  // be at the bottom of a conversation from last week, and a card whose history
  // arrives after the mode is switched on would do it a second time.
  const [voiceStartedAt, setVoiceStartedAt] = useState(null);

  useEffect(() => {
    setSpokenMessageIds([]);
    setVoiceStartedAt(isVoiceEnabled ? new Date() : null);
  }, [isVoiceEnabled, activeCardId]);

  const pendingSpeech = useMemo(() => {
    if (!isVoiceEnabled || !voiceStartedAt) {
      return null;
    }

    const last = messages[messages.length - 1];

    if (!last || last.author !== MessageAuthors.BOT || !last.isPersisted) {
      return null;
    }

    if (!last.createdAt || new Date(last.createdAt) <= voiceStartedAt) {
      return null;
    }

    if (spokenMessageIds.includes(last.id)) {
      return null;
    }

    return { id: last.id, text: last.text };
  }, [isVoiceEnabled, voiceStartedAt, messages, spokenMessageIds]);

  const handleVoiceTranscript = useCallback(
    (text) => {
      if (!activeCardId || !bot) {
        return;
      }

      // Straight out, without passing through the composer: that is the whole
      // difference between voice chat and a dictation button — when enough
      // silence has gone by, it sends. `withBotMention` is the same wrapper the
      // typed path uses, so the comment reads on the card exactly as a typed
      // one would; no mention markup pass is needed because nobody can type an
      // @mention into a microphone.
      dispatch(
        entryActions.createCommentForCard(activeCardId, { text: withBotMention(text, bot) }),
      );
    },
    [activeCardId, bot, dispatch],
  );

  const handleVoiceSpoken = useCallback((messageId) => {
    setSpokenMessageIds((current) =>
      current.includes(messageId) ? current : [...current, messageId],
    );
  }, []);

  const handleVoiceStop = useCallback(
    (reason) => {
      setIsVoiceEnabled(false);
      writeVoiceChatEnabled(window.localStorage, false);
      setVoiceNotice(t(VOICE_CHAT_STOP_REASON_KEYS[reason] || VOICE_CHAT_STOP_REASON_KEYS.failed));
    },
    [t],
  );

  const voice = useVoiceChat({
    isEnabled: isVoiceEnabled,
    cardId: activeCardId,
    capability: voiceCapability,
    canComment,
    pendingSpeech,
    onTranscript: handleVoiceTranscript,
    onSpoken: handleVoiceSpoken,
    onStop: handleVoiceStop,
  });

  const handleVoiceToggle = useCallback(() => {
    setIsVoiceEnabled((current) => {
      const next = !current;

      writeVoiceChatEnabled(window.localStorage, next);

      return next;
    });

    // The notice described a mode that has just been switched again.
    setVoiceNotice(null);
  }, []);

  const voicePhase = voiceChatPhase({
    isEnabled: isVoiceEnabled,
    isAvailable: voice.isAvailable,
    isMicReady: voice.isMicReady,
    isSpeaking: voice.isSpeaking,
    isWaitingForReply: replyState === BotReplyStates.THINKING,
    isTranscribing: voice.isTranscribing,
    isCapturing: voice.isCapturing,
  });

  const voiceChat = useMemo(
    () => ({
      isAvailable: voice.isAvailable,
      isEnabled: isVoiceEnabled,
      // A mode that is on but cannot run says so where the loop's own status
      // would be, rather than through a toggle that looks switched on and does
      // nothing.
      phase: isVoiceEnabled && !voice.isAvailable ? VoiceChatPhases.BLOCKED : voicePhase,
      notice: voiceNotice || undefined,
      onToggle: handleVoiceToggle,
      onStopSpeaking: voice.stopSpeaking,
    }),
    [
      voice.isAvailable,
      voice.stopSpeaking,
      isVoiceEnabled,
      voicePhase,
      voiceNotice,
      handleVoiceToggle,
    ],
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
  // capped against the viewport, and the corner it hangs from slides back when
  // the launcher is parked too near the top or the far left for a panel to fit
  // above it (`panelAnchor`).
  const anchor = panelAnchor(position, viewport);

  return (
    <>
      {isOpened && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div
          role="dialog"
          aria-label={bot.name || bot.username}
          // Focusable-but-not-tabbable, which is what keeps Escape working for
          // the whole time the panel is open. The composer takes focus when it
          // opens, but a click on a message bubble — text, not a control —
          // takes it away again, and a browser hands it to the nearest
          // focusable ANCESTOR. Without this that is nothing at all, so focus
          // lands on the body, outside the React tree the synthetic keydown
          // travels up, and the handler below stops being reachable from the
          // keyboard the moment the user touches what they came to read.
          tabIndex={-1}
          className={styles.panelAnchor}
          style={{ right: anchor.right, bottom: anchor.bottom }}
          onKeyDown={handleKeyDown}
        >
          <Panel
            bot={bot}
            cardId={activeCardId || undefined}
            cardName={activeCardId && card ? card.name : undefined}
            messages={messages}
            replyState={replyState}
            isCommentsFetching={!!(card && card.isCommentsFetching)}
            hasEarlierMessages={!!(activeCardId && card && card.isAllCommentsFetched === false)}
            canComment={canComment}
            isCardArchivedOrTrashed={isCardArchivedOrTrashed}
            voiceChat={voiceChat}
            width={width}
            maxWidth={`calc(100vw - ${anchor.right + PANEL_VIEWPORT_MARGIN}px)`}
            maxHeight={`calc(100dvh - ${anchor.bottom + PANEL_VIEWPORT_MARGIN}px)`}
            onWidthChange={handleWidthChange}
            onSubmit={handleSubmit}
            onSelectCard={handleSelectCard}
            onClearCard={handleClearCard}
            onLoadEarlier={handleLoadEarlier}
            onClose={handleClose}
          />
        </div>
      )}
      <Launcher
        ref={launcherRef}
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
