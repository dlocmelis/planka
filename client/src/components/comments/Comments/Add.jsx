/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import keyBy from 'lodash/keyBy';
import React, { useCallback, useState, useRef, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Mention, MentionsInput } from 'react-mentions';
import { Button, Form } from 'semantic-ui-react';
import { useClickAwayListener, useDidUpdate, useToggle } from '../../../lib/hooks';

import selectors from '../../../selectors';
import entryActions from '../../../entry-actions';
import { useEscapeInterceptor, useForm, useNestedRef } from '../../../hooks';
import { isUsernameChar, mentionTextToMarkup } from '../../../utils/mentions';
import {
  buildMentionData,
  isReporterMentionId,
  parseReporterFromCardDescription,
} from '../../../utils/setlfi-reporter';
import { isModifierKeyPressed } from '../../../utils/event-helpers';
import UserAvatar from '../../users/UserAvatar';

import styles from './Add.module.scss';

const DEFAULT_DATA = {
  text: '',
};

const Add = React.memo(() => {
  const boardMemberships = useSelector(selectors.selectMembershipsForCurrentBoard);
  // On a Setlfi support card the person who raised the ticket is offered here
  // too, above the board members. They have no Planka account, so the entry is
  // built from the card's own header — see utils/setlfi-reporter.js, and the
  // setl side that turns the resulting mention into a message on their feedback
  // page.
  const cardDescription = useSelector(
    (state) => (selectors.selectCurrentCard(state) || {}).description,
  );

  const dispatch = useDispatch();
  const [t] = useTranslation();
  const [data, , setData] = useForm(DEFAULT_DATA);
  const [isOpened, setIsOpened] = useState(false);
  const [selectTextFieldState, selectTextField] = useToggle();

  const textFieldRef = useRef(null);
  const textMentionsRef = useRef(null);
  const textInputRef = useRef(null);
  const [buttonRef, handleButtonRef] = useNestedRef();

  const userByUsername = useMemo(
    () =>
      keyBy(
        boardMemberships.flatMap(({ user }) => (user.username ? user : [])),
        'username',
      ),
    [boardMemberships],
  );

  const reporter = useMemo(
    () => parseReporterFromCardDescription(cardDescription),
    [cardDescription],
  );

  // The reporter is deliberately NOT in `userByUsername`: that map is what
  // rewrites typed `@name` text into mention markup, and a bare word typed into
  // the middle of an internal note must not silently become an address to the
  // customer. Only picking them out of this list does.
  const mentionData = useMemo(
    () => buildMentionData(boardMemberships, reporter),
    [boardMemberships, reporter],
  );

  const submit = useCallback(() => {
    const cleanData = {
      ...data,
      text: mentionTextToMarkup(data.text.trim(), userByUsername),
    };

    if (!cleanData.text) {
      textInputRef.current.select();
      return;
    }

    dispatch(entryActions.createCommentInCurrentCard(cleanData));
    setData(DEFAULT_DATA);
    selectTextField();
  }, [dispatch, data, setData, selectTextField, userByUsername]);

  const handleEscape = useCallback(() => {
    if (textMentionsRef.current.isOpened()) {
      textMentionsRef.current.clearSuggestions();
      return;
    }

    setIsOpened(false);
    textInputRef.current.blur();
  }, []);

  const [activateEscapeInterceptor, deactivateEscapeInterceptor] =
    useEscapeInterceptor(handleEscape);

  const handleSubmit = useCallback(() => {
    submit();
  }, [submit]);

  const handleFieldFocus = useCallback(() => {
    setIsOpened(true);
  }, []);

  const handleFieldChange = useCallback(
    (_, text) => {
      setData({
        text: !isUsernameChar(text.slice(-1)) ? mentionTextToMarkup(text, userByUsername) : text,
      });
    },
    [setData, userByUsername],
  );

  const handleFieldKeyDown = useCallback(
    (event) => {
      if (isModifierKeyPressed(event) && event.key === 'Enter') {
        submit();
      }
    },
    [submit],
  );

  const handleAwayClick = useCallback(() => {
    setIsOpened(false);
  }, []);

  const handleClickAwayCancel = useCallback(() => {
    textInputRef.current.focus();
  }, []);

  const clickAwayProps = useClickAwayListener(
    [textFieldRef, buttonRef],
    handleAwayClick,
    handleClickAwayCancel,
  );

  const suggestionRenderer = useCallback(
    (entry, _, highlightedDisplay) =>
      isReporterMentionId(entry.id) ? (
        // No UserAvatar: there is no user record behind this entry. The badge
        // and the email are what tell it apart from the board member with a
        // similar name directly below it — the confusion the ticket reported.
        <div className={styles.suggestion}>
          <span className={styles.reporterBadge}>{t('common.reporter')}</span>
          {highlightedDisplay}
          {entry.email && <span className={styles.reporterEmail}>{entry.email}</span>}
        </div>
      ) : (
        <div className={styles.suggestion}>
          <UserAvatar id={entry.id} size="tiny" />
          {highlightedDisplay}
        </div>
      ),
    [t],
  );

  useDidUpdate(() => {
    if (isOpened) {
      activateEscapeInterceptor();
    } else {
      deactivateEscapeInterceptor();
    }
  }, [isOpened]);

  useDidUpdate(() => {
    textInputRef.current.focus();
  }, [selectTextFieldState]);

  return (
    <Form onSubmit={handleSubmit}>
      <div ref={textFieldRef} className={styles.field}>
        <MentionsInput
          {...clickAwayProps} // eslint-disable-line react/jsx-props-no-spreading
          allowSpaceInQuery
          allowSuggestionsAboveCursor
          ref={textMentionsRef}
          inputRef={textInputRef}
          value={data.text}
          placeholder={t('common.writeComment')}
          maxLength={1048576}
          rows={isOpened ? 3 : 1}
          className="mentions-input"
          style={{
            control: {
              minHeight: isOpened ? '79px' : '37px',
            },
          }}
          onFocus={handleFieldFocus}
          onChange={handleFieldChange}
          onKeyDown={handleFieldKeyDown}
        >
          <Mention
            appendSpaceOnAdd
            data={mentionData}
            displayTransform={(_, display) => `@${display}`}
            renderSuggestion={suggestionRenderer}
            className={styles.mention}
          />
        </MentionsInput>
      </div>
      {(isOpened || data.text.length > 0) && (
        <div className={styles.controls}>
          <Button
            {...clickAwayProps} // eslint-disable-line react/jsx-props-no-spreading
            positive
            ref={handleButtonRef}
            content={t('action.addComment')}
            className={styles.button}
          />
        </div>
      )}
    </Form>
  );
});

export default Add;
