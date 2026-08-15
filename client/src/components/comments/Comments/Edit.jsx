/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import { dequal } from 'dequal';
import { keyBy } from 'lodash';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Mention, MentionsInput } from 'react-mentions';
import { Button, Form } from 'semantic-ui-react';
import { useClickAwayListener } from '../../../lib/hooks';

import selectors from '../../../selectors';
import entryActions from '../../../entry-actions';
import { useForm, useNestedRef } from '../../../hooks';
import { isUsernameChar, mentionTextToMarkup } from '../../../utils/mentions';
import {
  buildMentionData,
  hasReporterMention,
  isReporterMentionId,
  parseReporterFromCardDescription,
} from '../../../utils/setlfi-reporter';
import { focusEnd } from '../../../utils/element-helpers';
import { isModifierKeyPressed } from '../../../utils/event-helpers';
import UserAvatar from '../../users/UserAvatar';

import styles from './Edit.module.scss';

const Edit = React.memo(({ commentId, onClose }) => {
  const selectCommentById = useMemo(() => selectors.makeSelectCommentById(), []);

  const comment = useSelector((state) => selectCommentById(state, commentId));
  const boardMemberships = useSelector(selectors.selectMembershipsForCurrentBoard);
  // The reporter is offered while EDITING too, and that is not a nicety:
  // tagging somebody a beat late — the comment is written, then the customer
  // turns out to need it — is what an edit is for. setl publishes a comment an
  // edit adds the mention to (support.Reconciler.applyMentionedLater).
  const cardDescription = useSelector(
    (state) => (selectors.selectCurrentCard(state) || {}).description,
  );

  const dispatch = useDispatch();
  const [t] = useTranslation();

  const defaultData = useMemo(
    () => ({
      text: comment.text,
    }),
    [comment.text],
  );

  const [data, , setData] = useForm(() => ({
    text: '',
    ...defaultData,
  }));

  const textFieldRef = useRef(null);
  const textMentionsRef = useRef(null);
  const textInputRef = useRef(null);
  const [submitButtonRef, handleSubmitButtonRef] = useNestedRef();
  const [cancelButtonRef, handleCancelButtonRef] = useNestedRef();

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

  // Not in `userByUsername` on purpose — see the same note in Add.jsx.
  const mentionData = useMemo(
    () => buildMentionData(boardMemberships, reporter),
    [boardMemberships, reporter],
  );

  const submit = useCallback(() => {
    const cleanData = {
      ...data,
      text: mentionTextToMarkup(data.text.trim(), userByUsername),
    };

    if (cleanData.text && !dequal(cleanData, defaultData)) {
      dispatch(entryActions.updateComment(commentId, cleanData));
    }

    onClose();
  }, [commentId, onClose, dispatch, defaultData, data, userByUsername]);

  const handleSubmit = useCallback(() => {
    submit();
  }, [submit]);

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
      if (event.key === 'Enter') {
        if (isModifierKeyPressed(event)) {
          submit();
        }
      } else if (event.key === 'Escape') {
        if (textMentionsRef.current.isOpened()) {
          textMentionsRef.current.clearSuggestions();
          return;
        }

        onClose();
      }
    },
    [onClose, submit],
  );

  const handleCancelClick = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleClickAwayCancel = useCallback(() => {
    textInputRef.current.focus();
  }, []);

  const clickAwayProps = useClickAwayListener(
    [textFieldRef, submitButtonRef, cancelButtonRef],
    submit,
    handleClickAwayCancel,
  );

  const suggestionRenderer = useCallback(
    (entry, _, highlightedDisplay) =>
      isReporterMentionId(entry.id) ? (
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

  useEffect(() => {
    focusEnd(textInputRef.current);
  }, []);

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
          maxLength={1048576}
          rows={3}
          className="mentions-input"
          style={{
            control: {
              minHeight: '79px',
            },
          }}
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
      {/* Adding the tag in an EDIT publishes the comment too — setl promotes a
          staff comment an edit tags the reporter in. Say so here as well. */}
      {hasReporterMention(data.text) && (
        <div className={styles.reporterNotice}>{t('common.reporterWillSeeThisComment')}</div>
      )}
      <div className={styles.controls}>
        <Button
          {...clickAwayProps} // eslint-disable-line react/jsx-props-no-spreading
          positive
          ref={handleSubmitButtonRef}
          content={t('action.save')}
        />
        <Button
          {...clickAwayProps} // eslint-disable-line react/jsx-props-no-spreading
          ref={handleCancelButtonRef}
          type="button"
          content={t('action.cancel')}
          onClick={handleCancelClick}
        />
      </div>
    </Form>
  );
});

Edit.propTypes = {
  commentId: PropTypes.string.isRequired,
  onClose: PropTypes.func.isRequired,
};

export default Edit;
