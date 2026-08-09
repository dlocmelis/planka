/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import keyBy from 'lodash/keyBy';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';
import { Button, Icon } from 'semantic-ui-react';

import selectors from '../../../selectors';
import { mentionTextToMarkup } from '../../../utils/mentions';
import { withBotMention } from '../../../utils/bot-chat';

import styles from './Composer.module.scss';

/**
 * The message box.
 *
 * Enter sends and Shift+Enter breaks the line — the chat convention, and the
 * one the Setlfi assistant's composer follows. Planka's own comment box wants
 * Ctrl/Cmd+Enter instead, which is right for a form that is a form and wrong
 * for a conversation.
 *
 * What leaves here is an ordinary Planka comment: plain @mentions are turned
 * into the markup the server stores (the same `mentionTextToMarkup` the card's
 * comment box uses), and `withBotMention` puts the bot's own mention at the
 * head of anything that does not already address it.
 */
const Composer = React.memo(({ bot, isDisabled, onSubmit }) => {
  const boardMemberships = useSelector(selectors.selectMembershipsForCurrentBoard);

  const [t] = useTranslation();
  const [value, setValue] = useState('');
  const fieldRef = useRef(null);

  const userByUsername = useMemo(
    () =>
      keyBy(
        (boardMemberships || []).flatMap(({ user }) => (user.username ? user : [])),
        'username',
      ),
    [boardMemberships],
  );

  // The panel is only mounted while it is open, so this is "focus the message
  // box when the chat opens" — what every chat widget does, and the only thing
  // that puts the keyboard INSIDE the panel: the launcher that opened it is a
  // sibling of the dialog, so until focus moves here the panel's own Escape
  // handler can never fire.
  useEffect(() => {
    if (fieldRef.current && !isDisabled) {
      fieldRef.current.focus();
    }
  }, [isDisabled]);

  const submit = useCallback(() => {
    const text = value.trim();

    if (text === '' || isDisabled) {
      return;
    }

    onSubmit(withBotMention(mentionTextToMarkup(text, userByUsername), bot));
    setValue('');

    if (fieldRef.current) {
      fieldRef.current.focus();
    }
  }, [value, isDisabled, onSubmit, userByUsername, bot]);

  const handleChange = useCallback((event) => {
    setValue(event.target.value);
  }, []);

  const handleKeyDown = useCallback(
    (event) => {
      // An input method confirming a candidate presses Enter too. This is the
      // only plain-Enter submit in the app — Planka's own comment box wants
      // Ctrl/Cmd+Enter — and the app ships ja-JP, ko-KR, zh-CN, zh-TW and
      // vi-VN, so without this the first Enter of a conversion sends half a
      // sentence. `keyCode === 229` is the same signal from browsers that do
      // not set `isComposing` on the key event itself.
      if (event.nativeEvent.isComposing || event.keyCode === 229) {
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    },
    [submit],
  );

  const handleSubmitClick = useCallback(() => {
    submit();
  }, [submit]);

  return (
    <div className={styles.wrapper}>
      <TextareaAutosize
        ref={fieldRef}
        value={value}
        disabled={isDisabled}
        minRows={1}
        maxRows={6}
        placeholder={t('common.askBotAnything', { username: bot.username })}
        aria-label={t('common.askBotAnything', { username: bot.username })}
        className={styles.field}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      <Button
        type="button"
        icon
        primary
        disabled={isDisabled || value.trim() === ''}
        aria-label={t('action.sendMessage')}
        className={styles.button}
        onClick={handleSubmitClick}
      >
        <Icon fitted name="send" />
      </Button>
    </div>
  );
});

Composer.propTypes = {
  /* eslint-disable react/forbid-prop-types */
  bot: PropTypes.object.isRequired,
  /* eslint-enable react/forbid-prop-types */
  isDisabled: PropTypes.bool.isRequired,
  onSubmit: PropTypes.func.isRequired,
};

export default Composer;
