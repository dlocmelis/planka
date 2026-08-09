/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

/**
 * The arithmetic and the conversation shaping behind the floating chat with
 * planka_bot — the launcher's remembered position, the panel's remembered
 * width, and the mapping from a card's comments onto chat messages.
 *
 * Ported from the Setlfi web assistant, which is the widget this one is asked
 * to mirror: the bounds and the drag/storage rules come from setl-web's
 * `lib/assistant/widget_width.ts` (panel width) and the launcher block of
 * `components/assistant/AssistantWidget.tsx` (hold-then-drag reposition,
 * clamped to the viewport, persisted per browser). The React there is Next.js
 * + MUI and cannot cross into this app, but the arithmetic is the half that
 * actually encodes the behaviour, so it is what was carried over.
 *
 * Pure functions only — no React, no `window` and no `localStorage` as
 * globals (the viewport and the storage arrive as parameters), which is what
 * lets `npm test` drive the whole module on Node (utils/bot-chat.test.js).
 */

/* Launcher */

/** Edge length of the round launcher button, in px. */
export const LAUNCHER_SIZE = 56;

/** How close to a viewport edge the launcher may be dragged. */
export const LAUNCHER_EDGE_MARGIN = 8;

/** Hold this long before a press on the launcher becomes a drag; a press
 * shorter than this is a click that opens the panel. */
export const LAUNCHER_HOLD_MS = 400;

/** Movement past this many px before the hold elapses is a scroll or a tap,
 * not the beginning of a drag. */
export const LAUNCHER_HOLD_CANCEL_PX = 10;

/** Where the launcher sits until someone moves it: the bottom-right corner,
 * measured from the viewport's right and bottom edges. */
export const DEFAULT_LAUNCHER_POSITION = Object.freeze({ right: 24, bottom: 24 });

/** localStorage key for the dragged position. Per browser rather than per
 * user: it is a preference about this screen, and it is never cleared on
 * logout (there is nothing private in a pair of offsets). */
export const LAUNCHER_POSITION_KEY = 'planka-bot-chat-launcher-position';

/**
 * A launcher position put back inside the viewport.
 *
 * Positions are stored as distance from the bottom-right corner, so they stay
 * sensible when the viewport changes size — but a window that shrank can still
 * leave the button off-screen, which is why every read and every drag frame
 * goes through this.
 */
export const clampLauncherPosition = (position, viewport) => {
  const maxRight = Math.max(
    LAUNCHER_EDGE_MARGIN,
    viewport.width - LAUNCHER_SIZE - LAUNCHER_EDGE_MARGIN,
  );
  const maxBottom = Math.max(
    LAUNCHER_EDGE_MARGIN,
    viewport.height - LAUNCHER_SIZE - LAUNCHER_EDGE_MARGIN,
  );

  return {
    right: Math.round(Math.min(Math.max(position.right, LAUNCHER_EDGE_MARGIN), maxRight)),
    bottom: Math.round(Math.min(Math.max(position.bottom, LAUNCHER_EDGE_MARGIN), maxBottom)),
  };
};

/**
 * The remembered position, or null when there is none to use.
 *
 * Null rather than the default so a caller can tell "never moved" from "moved
 * back to the corner", and so a storage the browser refuses (private mode,
 * blocked cookies) or a record left by an older build costs nothing but the
 * default corner: a launcher that fails to render is a far worse outcome than
 * one that renders where it always did.
 */
export const readLauncherPosition = (storage, viewport) => {
  try {
    const raw = storage.getItem(LAUNCHER_POSITION_KEY);

    if (raw === null || raw === undefined) {
      return null;
    }

    const parsed = JSON.parse(raw);

    if (
      !parsed ||
      !Number.isFinite(parsed.right) ||
      !Number.isFinite(parsed.bottom) ||
      parsed.right < 0 ||
      parsed.bottom < 0
    ) {
      return null;
    }

    return clampLauncherPosition({ right: parsed.right, bottom: parsed.bottom }, viewport);
  } catch {
    return null;
  }
};

/** Remembers the position. A blocked storage keeps the move for this session
 * and says nothing — there is nothing the user could do about it. */
export const writeLauncherPosition = (storage, position) => {
  try {
    storage.setItem(
      LAUNCHER_POSITION_KEY,
      JSON.stringify({ right: Math.round(position.right), bottom: Math.round(position.bottom) }),
    );
  } catch {
    // Storage full or blocked — the move lasts for this session only.
  }
};

/* Panel width */

/** Narrower than this and the composer's buttons start wrapping. */
export const MIN_PANEL_WIDTH = 320;

/** What the panel opens at for anyone who has not dragged it. */
export const DEFAULT_PANEL_WIDTH = 400;

/** Breathing room kept between the panel's left edge and the viewport's, so a
 * panel dragged as wide as it goes still reads as a panel over the board
 * rather than as a page of its own. */
export const PANEL_EDGE_MARGIN = 32;

/** One arrow-key press on the resize handle. The handle is a real focusable
 * separator, so the panel can be resized without a pointer. */
export const PANEL_WIDTH_STEP = 24;

/** localStorage key for the remembered width. */
export const PANEL_WIDTH_KEY = 'planka-bot-chat-panel-width';

/**
 * The widest the panel may be on a viewport this wide.
 *
 * Never below `MIN_PANEL_WIDTH`: on a viewport narrower than the minimum the
 * two bounds would cross and the clamp below would return the *smaller* of
 * them, which is a panel that shrinks as the window does and never grows back.
 */
export const maxPanelWidth = (viewportWidth) =>
  Math.max(MIN_PANEL_WIDTH, viewportWidth - PANEL_EDGE_MARGIN);

/** A width put back inside the bounds — and rounded, since a pointer delta is
 * fractional on a scaled display and a persisted `399.6` reads badly. */
export const clampPanelWidth = (width, viewportWidth) => {
  if (!Number.isFinite(width)) {
    return DEFAULT_PANEL_WIDTH;
  }

  return Math.round(Math.min(Math.max(width, MIN_PANEL_WIDTH), maxPanelWidth(viewportWidth)));
};

/**
 * The width a drag of the LEFT edge has reached.
 *
 * The panel's right edge is pinned by the layout, so widening it means moving
 * the pointer left — hence the sign flip. `startWidth` is the width when the
 * handle was grabbed, never the live one: adding each frame's delta to the
 * current width accumulates the clamp's own corrections and the panel creeps
 * away from the pointer.
 */
export const panelWidthAfterDrag = (startWidth, startX, pointerX, viewportWidth) =>
  clampPanelWidth(startWidth - (pointerX - startX), viewportWidth);

/** The remembered width, or null when there is none — same reasoning as
 * `readLauncherPosition`. */
export const readPanelWidth = (storage, viewportWidth) => {
  try {
    const raw = storage.getItem(PANEL_WIDTH_KEY);

    if (raw === null || raw === undefined) {
      return null;
    }

    const parsed = Number(raw);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }

    return clampPanelWidth(parsed, viewportWidth);
  } catch {
    return null;
  }
};

/** Remembers the width. */
export const writePanelWidth = (storage, width) => {
  try {
    storage.setItem(PANEL_WIDTH_KEY, String(Math.round(width)));
  } catch {
    // Storage full or blocked — the width lasts for this session only.
  }
};

/* Where the panel hangs */

/** Breathing room between the launcher and the panel that grows out of it. */
export const PANEL_LAUNCHER_GAP = 12;

/** ...and between the panel and the two viewport edges it grows towards. */
export const PANEL_VIEWPORT_MARGIN = 16;

/** The least room the panel needs to be worth opening: a header, a message or
 * two and the composer. */
export const MIN_PANEL_HEIGHT = 280;

/**
 * Where the panel's bottom-right corner sits, given where the launcher has
 * been dragged to.
 *
 * The panel grows UP and to the LEFT out of the launcher, so the caller turns
 * this corner into the two maxima that keep it on screen —
 * `calc(100dvh - bottom - margin)` and `calc(100vw - right - margin)`. Left
 * alone, a launcher parked near the top or the far left drives both of those
 * to nothing: a `calc()` that resolves negative is clamped to zero rather than
 * ignored, so the panel opens with no height at all and the button looks
 * broken. Both are perfectly reachable — `clampLauncherPosition` lets the
 * launcher go right up to either edge, and dragging it out of the way is the
 * whole point of the gesture.
 *
 * So the corner slides back down and to the right as far as it has to for the
 * panel to keep its minimum. The launcher paints above the panel
 * (`Launcher.module.scss` z-index) and stays a toggle, so it is still there to
 * close what it opened when the two overlap.
 */
export const panelAnchor = (position, viewport) => {
  const lowestTop = Math.max(0, viewport.height - MIN_PANEL_HEIGHT - PANEL_VIEWPORT_MARGIN);
  const furthestLeft = Math.max(0, viewport.width - MIN_PANEL_WIDTH - PANEL_VIEWPORT_MARGIN);

  const bottom = Math.max(position.bottom, 0) + LAUNCHER_SIZE + PANEL_LAUNCHER_GAP;

  return {
    right: Math.round(Math.min(Math.max(position.right, 0), furthestLeft)),
    bottom: Math.round(Math.min(bottom, lowestTop)),
  };
};

/* The thread's scroll position */

/**
 * How far above the bottom still counts as being AT the bottom, in px.
 *
 * A tolerance rather than an exact match because sub-pixel layout, a bounce at
 * the end of a momentum scroll and the last line of a growing bubble all leave
 * the scroller a hair short of its own height, and none of them is a user
 * scrolling away. The number is the Setlfi assistant's
 * (`lib/assistant/transcript_scroll.ts`), kept the same so the two panels feel
 * alike.
 */
export const THREAD_BOTTOM_SLACK_PX = 60;

/**
 * Whether the thread is parked at its latest message.
 *
 * Takes the three numbers an `HTMLElement` scroller answers with rather than
 * the element, so a test can hand it a plain object.
 */
export const isAtThreadBottom = (
  { scrollTop, scrollHeight, clientHeight },
  slack = THREAD_BOTTOM_SLACK_PX,
) => scrollHeight - scrollTop - clientHeight < slack;

/**
 * Should the thread be scrolled to its latest message right now?
 *
 * The rule the Setlfi assistant's transcript follows: stick to the bottom
 * until the user scrolls up, and then leave them where they put themselves.
 * Jamming `scrollTop = scrollHeight` on every arrival instead would yank
 * somebody reading back through the card's history down to the newest bubble —
 * and a bot answer lands minutes after the question, which is exactly the gap
 * in which they went looking.
 */
export const shouldFollowThread = ({ stuckToBottom }) => stuckToBottom;

/* The conversation the panel is on */

/** localStorage key for the conversation the panel was last on, so re-opening
 * the launcher resumes it instead of asking again. */
export const LAST_CARD_KEY = 'planka-bot-chat-card-id';

/**
 * The conversation id standing for the board's GENERAL chat — the one that is
 * not about a ticket.
 *
 * The general chat is carried on a card like every other conversation, but it
 * is not identified by that card's id here, and the difference is
 * load-bearing. The panel knows which conversation it is on before it knows
 * anything about the board: a page load renders the widget, reads this value
 * out of storage and reacts to the card in the URL all before the board's
 * lists and cards arrive. Storing the CARD's id would mean the panel could not
 * tell "the general chat" from "some card I cannot resolve yet", and the
 * remembered conversation would be replaced by whichever card the URL had
 * open — on every reload.
 *
 * Planka ids are numeric strings, so this can never collide with one.
 */
export const GENERAL_CHAT_CONVERSATION = 'general';

/** Whether a conversation id is the general chat's rather than a card's. */
export const isGeneralChatConversation = (conversationId) =>
  conversationId === GENERAL_CHAT_CONVERSATION;

export const readLastCardId = (storage) => {
  try {
    const raw = storage.getItem(LAST_CARD_KEY);
    return raw === null || raw === undefined || raw === '' ? null : String(raw);
  } catch {
    return null;
  }
};

export const writeLastCardId = (storage, cardId) => {
  try {
    if (cardId) {
      storage.setItem(LAST_CARD_KEY, String(cardId));
    } else {
      storage.removeItem(LAST_CARD_KEY);
    }
  } catch {
    // Storage blocked — the conversation is remembered for this session only.
  }
};

/* Messages */

/** Who wrote a message, from the panel's point of view. */
export const MessageAuthors = {
  BOT: 'bot',
  SELF: 'self',
  OTHER: 'other',
};

/**
 * Planka's mention markup for a user — `@[username](id)`, the only form the
 * server stores as a mention and the form the orchestrator's own mention
 * matcher reads (devteam-orchestrator internal/board/mentions.go).
 */
export const botMentionMarkup = (bot) => `@[${bot.username}](${bot.id})`;

const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether text already addresses the bot, in either form Planka stores
 * (plain `@planka_bot`, or the `@[planka_bot](id)` markup). */
export const mentionsBot = (text, bot) => {
  if (!text) {
    return false;
  }

  const username = escapeForRegExp(bot.username);

  return (
    new RegExp(`(^|[^a-zA-Z0-9._])@${username}(?![a-zA-Z0-9._])`, 'i').test(text) ||
    new RegExp(`@\\[${username}\\]\\([^)]*\\)`, 'i').test(text)
  );
};

/**
 * The comment text to post for a chat message.
 *
 * Every human comment on a card is triaged and answered by the bot whatever it
 * says, so the mention is not what summons it — but it is what makes the
 * intent legible on the card afterwards, what notifies the bot user, and what
 * the orchestrator's mention-only bootstrap path looks for when it has no
 * cursor to work from (internal/fsm/sweep.go). A message that already names
 * the bot is left exactly as the user typed it.
 */
export const withBotMention = (text, bot) => {
  const trimmed = (text || '').trim();

  if (trimmed === '') {
    return trimmed;
  }

  return mentionsBot(trimmed, bot) ? trimmed : `${botMentionMarkup(bot)} ${trimmed}`;
};

/**
 * The same text with a LEADING mention of one username removed, for display.
 *
 * Both sides of this conversation address each other by name on the card: the
 * composer puts `@planka_bot` at the head of what you send, and the
 * orchestrator's reply opens with `@you` (internal/techlead/triage.go `reply`).
 * On the card that is what makes the exchange legible; in a two-person chat
 * panel it is the same name repeated on every bubble. A mention anywhere else
 * in the message is left alone — there it is part of what was said.
 */
export const stripLeadingMention = (text, username) => {
  if (!text || !username) {
    return text || '';
  }

  const escaped = escapeForRegExp(username);

  return text
    .replace(new RegExp(`^\\s*@\\[${escaped}\\]\\([^)]*\\)\\s*`, 'i'), '')
    .replace(new RegExp(`^\\s*@${escaped}(?![a-zA-Z0-9._])[ \\t]*`, 'i'), '');
};

/**
 * A card's comments as the chat panel renders them: oldest first, each tagged
 * with who wrote it, and each stripped of the leading mention the other side
 * added (see `stripLeadingMention`).
 *
 * Comments arrive newest-first from the store (Card.getCommentsQuerySet orders
 * by id descending) and a chat reads the other way round.
 */
export const buildChatMessages = (comments, { bot, currentUser }) => {
  const ordered = [...(comments || [])].sort((a, b) => {
    const left = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const right = b.createdAt ? new Date(b.createdAt).getTime() : 0;

    if (left !== right) {
      return left - right;
    }

    // Same millisecond (a seeded fixture, or two comments posted in one tick):
    // Planka ids are monotonic, so they settle the order.
    return String(a.id).length - String(b.id).length || String(a.id).localeCompare(String(b.id));
  });

  return ordered.map((comment) => {
    let author = MessageAuthors.OTHER;

    if (bot && comment.userId === bot.id) {
      author = MessageAuthors.BOT;
    } else if (currentUser && comment.userId === currentUser.id) {
      author = MessageAuthors.SELF;
    }

    let { text } = comment;
    if (author === MessageAuthors.SELF && bot) {
      text = stripLeadingMention(text, bot.username);
    } else if (author === MessageAuthors.BOT && currentUser) {
      text = stripLeadingMention(text, currentUser.username);
    }

    return {
      id: comment.id,
      userId: comment.userId,
      createdAt: comment.createdAt,
      author,
      text,
      isPersisted: comment.isPersisted !== false,
    };
  });
};

/** How long the panel keeps saying the bot is thinking before it admits the
 * answer may not be coming. A triage job is a whole agent session — minutes,
 * not seconds — and it queues behind whatever else the pipeline is running,
 * so this is generous on purpose. */
export const BOT_REPLY_TIMEOUT_MS = 10 * 60 * 1000;

export const BotReplyStates = {
  IDLE: 'idle',
  THINKING: 'thinking',
  OVERDUE: 'overdue',
};

/**
 * Whether the panel is waiting on the bot, derived from the thread itself
 * rather than from a flag the composer sets.
 *
 * Deriving it means a reload, a second tab, or an answer that arrives while
 * the panel is closed all agree about the state — a `sent` flag in component
 * state agrees with none of them. The thread is waiting exactly when the last
 * thing in it is your own message; anything the bot said after it ends the
 * wait, and so does another person's comment being the newest (the bot is
 * answering them, not you).
 */
export const botReplyState = (
  messages,
  { now = Date.now(), timeoutMs = BOT_REPLY_TIMEOUT_MS } = {},
) => {
  const last = messages && messages.length > 0 ? messages[messages.length - 1] : null;

  if (!last || last.author !== MessageAuthors.SELF) {
    return BotReplyStates.IDLE;
  }

  const sentAt = last.createdAt ? new Date(last.createdAt).getTime() : NaN;

  if (!Number.isFinite(sentAt)) {
    return BotReplyStates.THINKING;
  }

  return now - sentAt < timeoutMs ? BotReplyStates.THINKING : BotReplyStates.OVERDUE;
};

/**
 * How many messages the bot (or anyone else) has added since the panel was
 * last read — the number the launcher's badge shows.
 *
 * `lastSeenAt` is a timestamp rather than a message id so that a thread the
 * user has never opened counts as entirely unread without the caller having to
 * special-case it.
 */
export const unreadMessageCount = (messages, lastSeenAt) => {
  const seen = lastSeenAt ? new Date(lastSeenAt).getTime() : 0;

  return (messages || []).filter((message) => {
    if (message.author === MessageAuthors.SELF) {
      return false;
    }

    const at = message.createdAt ? new Date(message.createdAt).getTime() : 0;

    return at > seen;
  }).length;
};

/** The badge's label: a count, capped so a long-unread thread cannot widen the
 * launcher, or null when there is nothing to show. */
export const unreadBadgeLabel = (count) => {
  if (!count || count <= 0) {
    return null;
  }

  return count > 99 ? '99+' : String(count);
};
