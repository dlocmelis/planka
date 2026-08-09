/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';

import { MessageAuthors } from '../../../utils/bot-chat';
import Markdown from '../Markdown';
import TimeAgo from '../TimeAgo';
import UserAvatar from '../../users/UserAvatar';

import styles from './Message.module.scss';

/**
 * One bubble in the thread.
 *
 * Your own messages sit on the right without an avatar; the bot and anyone
 * else who commented on the card sit on the left with theirs — a card's
 * comments are a conversation the whole board can join, and hiding the other
 * voices would make the panel disagree with the card it is showing.
 */
const Message = React.memo(({ message }) => {
  const isSelf = message.author === MessageAuthors.SELF;

  return (
    <div
      className={classNames(
        styles.wrapper,
        isSelf && styles.wrapperSelf,
        !message.isPersisted && styles.wrapperPending,
      )}
    >
      {!isSelf && (
        <span className={styles.avatar}>
          <UserAvatar id={message.userId} size="small" />
        </span>
      )}
      <div
        className={classNames(
          styles.bubble,
          isSelf && styles.bubbleSelf,
          message.author === MessageAuthors.BOT && styles.bubbleBot,
        )}
      >
        <Markdown>{message.text}</Markdown>
        <span className={styles.date}>
          <TimeAgo date={message.createdAt} />
        </span>
      </div>
    </div>
  );
});

Message.propTypes = {
  /* eslint-disable react/forbid-prop-types */
  message: PropTypes.object.isRequired,
  /* eslint-enable react/forbid-prop-types */
};

export default Message;
