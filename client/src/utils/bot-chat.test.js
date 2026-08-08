/**
 * @jest-environment node
 */

/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import {
  BOT_REPLY_TIMEOUT_MS,
  BotReplyStates,
  DEFAULT_PANEL_WIDTH,
  LAUNCHER_EDGE_MARGIN,
  LAUNCHER_POSITION_KEY,
  LAUNCHER_SIZE,
  LAST_CARD_KEY,
  MIN_PANEL_WIDTH,
  MessageAuthors,
  PANEL_EDGE_MARGIN,
  PANEL_WIDTH_KEY,
  botMentionMarkup,
  botReplyState,
  buildChatMessages,
  clampLauncherPosition,
  clampPanelWidth,
  maxPanelWidth,
  mentionsBot,
  panelWidthAfterDrag,
  readLastCardId,
  readLauncherPosition,
  readPanelWidth,
  stripLeadingMention,
  unreadBadgeLabel,
  unreadMessageCount,
  withBotMention,
  writeLastCardId,
  writeLauncherPosition,
  writePanelWidth,
} from './bot-chat';

const BOT = { id: 'user-bot', username: 'planka_bot', name: 'Orchestrator Bot' };
const ME = { id: 'user-me', username: 'deniss' };

const createStorage = (initial = {}) => {
  const values = { ...initial };

  return {
    values,
    getItem: (key) => (key in values ? values[key] : null),
    setItem: (key, value) => {
      values[key] = String(value);
    },
    removeItem: (key) => {
      delete values[key];
    },
  };
};

const blockedStorage = () => ({
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
});

describe('clampLauncherPosition', () => {
  const viewport = { width: 1000, height: 800 };

  test('leaves a position that is already inside the viewport', () => {
    expect(clampLauncherPosition({ right: 24, bottom: 24 }, viewport)).toEqual({
      right: 24,
      bottom: 24,
    });
  });

  test('pulls a launcher dragged past the far edges back inside', () => {
    expect(clampLauncherPosition({ right: 5000, bottom: 5000 }, viewport)).toEqual({
      right: viewport.width - LAUNCHER_SIZE - LAUNCHER_EDGE_MARGIN,
      bottom: viewport.height - LAUNCHER_SIZE - LAUNCHER_EDGE_MARGIN,
    });
  });

  test('keeps the margin when dragged into the near edges', () => {
    expect(clampLauncherPosition({ right: -50, bottom: 0 }, viewport)).toEqual({
      right: LAUNCHER_EDGE_MARGIN,
      bottom: LAUNCHER_EDGE_MARGIN,
    });
  });

  test('never crosses the bounds on a viewport smaller than the button', () => {
    expect(clampLauncherPosition({ right: 24, bottom: 24 }, { width: 20, height: 20 })).toEqual({
      right: LAUNCHER_EDGE_MARGIN,
      bottom: LAUNCHER_EDGE_MARGIN,
    });
  });
});

describe('launcher position storage', () => {
  const viewport = { width: 1000, height: 800 };

  test('round-trips a dragged position', () => {
    const storage = createStorage();

    writeLauncherPosition(storage, { right: 120.4, bottom: 200.6 });

    expect(JSON.parse(storage.values[LAUNCHER_POSITION_KEY])).toEqual({ right: 120, bottom: 201 });
    expect(readLauncherPosition(storage, viewport)).toEqual({ right: 120, bottom: 201 });
  });

  test('reads null when nothing was ever stored, so the caller keeps the default corner', () => {
    expect(readLauncherPosition(createStorage(), viewport)).toBeNull();
  });

  test('reads null for a corrupt or half-written record instead of throwing', () => {
    expect(
      readLauncherPosition(createStorage({ [LAUNCHER_POSITION_KEY]: 'not json' }), viewport),
    ).toBeNull();
    expect(
      readLauncherPosition(createStorage({ [LAUNCHER_POSITION_KEY]: '{"right":10}' }), viewport),
    ).toBeNull();
  });

  test('clamps a position stored on a bigger screen to this one', () => {
    const storage = createStorage({ [LAUNCHER_POSITION_KEY]: '{"right":1800,"bottom":900}' });

    expect(readLauncherPosition(storage, viewport)).toEqual({
      right: viewport.width - LAUNCHER_SIZE - LAUNCHER_EDGE_MARGIN,
      bottom: viewport.height - LAUNCHER_SIZE - LAUNCHER_EDGE_MARGIN,
    });
  });

  test('survives a storage the browser refuses', () => {
    expect(() => writeLauncherPosition(blockedStorage(), { right: 1, bottom: 1 })).not.toThrow();
    expect(readLauncherPosition(blockedStorage(), viewport)).toBeNull();
  });
});

describe('panel width', () => {
  test('the ceiling leaves a margin, and never drops below the minimum', () => {
    expect(maxPanelWidth(1000)).toBe(1000 - PANEL_EDGE_MARGIN);
    expect(maxPanelWidth(200)).toBe(MIN_PANEL_WIDTH);
  });

  test('clamps into the bounds and rounds a fractional pointer delta', () => {
    expect(clampPanelWidth(10, 1000)).toBe(MIN_PANEL_WIDTH);
    expect(clampPanelWidth(5000, 1000)).toBe(1000 - PANEL_EDGE_MARGIN);
    expect(clampPanelWidth(399.6, 1000)).toBe(400);
  });

  test('falls back to the default rather than NaN', () => {
    expect(clampPanelWidth(Number.NaN, 1000)).toBe(DEFAULT_PANEL_WIDTH);
  });

  test('dragging the left edge leftwards widens the panel', () => {
    expect(panelWidthAfterDrag(400, 600, 500, 1400)).toBe(500);
    expect(panelWidthAfterDrag(400, 600, 660, 1400)).toBe(340);
  });

  test('a drag measures from the width the handle was grabbed at, not the live one', () => {
    // Two frames of the same gesture: the second must not compound the first.
    expect(panelWidthAfterDrag(400, 600, 550, 1400)).toBe(450);
    expect(panelWidthAfterDrag(400, 600, 500, 1400)).toBe(500);
  });

  test('round-trips through storage and clamps what it reads back', () => {
    const storage = createStorage();

    writePanelWidth(storage, 512.7);

    expect(storage.values[PANEL_WIDTH_KEY]).toBe('513');
    expect(readPanelWidth(storage, 1400)).toBe(513);
    expect(readPanelWidth(storage, 400)).toBe(MIN_PANEL_WIDTH + 48);
  });

  test('reads null when there is no preference, and for junk', () => {
    expect(readPanelWidth(createStorage(), 1400)).toBeNull();
    expect(readPanelWidth(createStorage({ [PANEL_WIDTH_KEY]: 'wide' }), 1400)).toBeNull();
    expect(readPanelWidth(createStorage({ [PANEL_WIDTH_KEY]: '0' }), 1400)).toBeNull();
  });
});

describe('last card storage', () => {
  test('round-trips the card the panel was last on', () => {
    const storage = createStorage();

    writeLastCardId(storage, 'card-1');

    expect(storage.values[LAST_CARD_KEY]).toBe('card-1');
    expect(readLastCardId(storage)).toBe('card-1');
  });

  test('clearing the conversation forgets the card', () => {
    const storage = createStorage({ [LAST_CARD_KEY]: 'card-1' });

    writeLastCardId(storage, null);

    expect(readLastCardId(storage)).toBeNull();
  });
});

describe('mentions', () => {
  test('the markup is the form the Planka server stores', () => {
    expect(botMentionMarkup(BOT)).toBe('@[planka_bot](user-bot)');
  });

  test('recognises both forms of a mention, and neither a lookalike nor an email', () => {
    expect(mentionsBot('@planka_bot what is up', BOT)).toBe(true);
    expect(mentionsBot('hey @[planka_bot](user-bot) hello', BOT)).toBe(true);
    expect(mentionsBot('@planka_bot2 is someone else', BOT)).toBe(false);
    expect(mentionsBot('mail me at me@planka_bot', BOT)).toBe(false);
    expect(mentionsBot('nothing here', BOT)).toBe(false);
  });

  test('addresses the bot when the message does not already', () => {
    expect(withBotMention('what is blocking card 12?', BOT)).toBe(
      '@[planka_bot](user-bot) what is blocking card 12?',
    );
  });

  test('leaves a message that already names the bot exactly as typed', () => {
    expect(withBotMention('  @planka_bot ping  ', BOT)).toBe('@planka_bot ping');
    expect(withBotMention('@[planka_bot](user-bot) ping', BOT)).toBe(
      '@[planka_bot](user-bot) ping',
    );
  });

  test('an empty message stays empty rather than becoming a bare mention', () => {
    expect(withBotMention('   ', BOT)).toBe('');
  });

  test('strips only a LEADING mention for display', () => {
    expect(stripLeadingMention('@[planka_bot](user-bot) hello', BOT.username)).toBe('hello');
    expect(stripLeadingMention('@planka_bot hello', BOT.username)).toBe('hello');
    expect(stripLeadingMention('ask @planka_bot about it', BOT.username)).toBe(
      'ask @planka_bot about it',
    );
    // The bot's own replies open with the asker's name, and it posts them as
    // plain text rather than as mention markup.
    expect(stripLeadingMention('@deniss it is in review.', ME.username)).toBe('it is in review.');
    expect(stripLeadingMention('anything', undefined)).toBe('anything');
  });
});

describe('buildChatMessages', () => {
  const comments = [
    // Newest first, the order the store hands them over.
    {
      id: '30',
      userId: BOT.id,
      text: 'It is in review.',
      createdAt: new Date('2026-08-08T10:02:00Z'),
    },
    {
      id: '20',
      userId: ME.id,
      text: '@[planka_bot](user-bot) what is the status?',
      createdAt: new Date('2026-08-08T10:01:00Z'),
    },
    {
      id: '10',
      userId: 'user-other',
      text: 'looks good',
      createdAt: new Date('2026-08-08T10:00:00Z'),
    },
  ];

  test('reads oldest first and tags every author', () => {
    const messages = buildChatMessages(comments, { bot: BOT, currentUser: ME });

    expect(messages.map((message) => message.id)).toEqual(['10', '20', '30']);
    expect(messages.map((message) => message.author)).toEqual([
      MessageAuthors.OTHER,
      MessageAuthors.SELF,
      MessageAuthors.BOT,
    ]);
  });

  test('hides the mention the composer added on your own messages only', () => {
    const messages = buildChatMessages(comments, { bot: BOT, currentUser: ME });

    expect(messages[1].text).toBe('what is the status?');
    expect(messages[2].text).toBe('It is in review.');
  });

  test('orders by id when two comments share a timestamp', () => {
    const at = new Date('2026-08-08T10:00:00Z');
    const messages = buildChatMessages(
      [
        { id: '9', userId: ME.id, text: 'b', createdAt: at },
        { id: '10', userId: ME.id, text: 'c', createdAt: at },
        { id: '8', userId: ME.id, text: 'a', createdAt: at },
      ],
      { bot: BOT, currentUser: ME },
    );

    expect(messages.map((message) => message.text)).toEqual(['a', 'b', 'c']);
  });

  test('marks an optimistic message as not yet persisted', () => {
    const messages = buildChatMessages(
      [{ id: 'local', userId: ME.id, text: 'hi', createdAt: new Date(), isPersisted: false }],
      { bot: BOT, currentUser: ME },
    );

    expect(messages[0].isPersisted).toBe(false);
  });

  test('an unfetched thread is an empty conversation, not a crash', () => {
    expect(buildChatMessages(undefined, { bot: BOT, currentUser: ME })).toEqual([]);
  });

  test('without a bot on the board nothing is attributed to it', () => {
    const messages = buildChatMessages(comments, { bot: null, currentUser: ME });

    expect(messages.map((message) => message.author)).toEqual([
      MessageAuthors.OTHER,
      MessageAuthors.SELF,
      MessageAuthors.OTHER,
    ]);
  });
});

describe('botReplyState', () => {
  const at = (iso) => new Date(iso);
  const sent = { author: MessageAuthors.SELF, createdAt: at('2026-08-08T10:00:00Z') };
  const answered = { author: MessageAuthors.BOT, createdAt: at('2026-08-08T10:01:00Z') };

  test('an empty thread is idle', () => {
    expect(botReplyState([])).toBe(BotReplyStates.IDLE);
  });

  test('waits while your message is the last thing said', () => {
    expect(botReplyState([sent], { now: at('2026-08-08T10:00:30Z').getTime() })).toBe(
      BotReplyStates.THINKING,
    );
  });

  test('stops waiting once the bot has answered', () => {
    expect(botReplyState([sent, answered], { now: at('2026-08-08T10:02:00Z').getTime() })).toBe(
      BotReplyStates.IDLE,
    );
  });

  test('admits after the timeout that the answer may not be coming', () => {
    expect(
      botReplyState([sent], { now: sent.createdAt.getTime() + BOT_REPLY_TIMEOUT_MS + 1 }),
    ).toBe(BotReplyStates.OVERDUE);
  });

  test('someone else being last is not you waiting', () => {
    expect(
      botReplyState([
        sent,
        { author: MessageAuthors.OTHER, createdAt: at('2026-08-08T10:00:30Z') },
      ]),
    ).toBe(BotReplyStates.IDLE);
  });
});

describe('unread counting', () => {
  const seen = new Date('2026-08-08T10:00:00Z');
  const messages = [
    { author: MessageAuthors.BOT, createdAt: new Date('2026-08-08T09:59:00Z') },
    { author: MessageAuthors.SELF, createdAt: new Date('2026-08-08T10:01:00Z') },
    { author: MessageAuthors.BOT, createdAt: new Date('2026-08-08T10:02:00Z') },
    { author: MessageAuthors.OTHER, createdAt: new Date('2026-08-08T10:03:00Z') },
  ];

  test('counts what arrived from other people after the panel was last read', () => {
    expect(unreadMessageCount(messages, seen)).toBe(2);
  });

  test('your own messages are never unread', () => {
    expect(unreadMessageCount([messages[1]], seen)).toBe(0);
  });

  test('everything counts when the thread has never been read', () => {
    expect(unreadMessageCount(messages, null)).toBe(3);
  });

  test('the badge counts, and caps so a long absence cannot widen the launcher', () => {
    expect(unreadBadgeLabel(0)).toBeNull();
    expect(unreadBadgeLabel(3)).toBe('3');
    expect(unreadBadgeLabel(99)).toBe('99');
    expect(unreadBadgeLabel(1234)).toBe('99+');
  });
});
