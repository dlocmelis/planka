/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { shallowEqual, useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Icon, Menu } from 'semantic-ui-react';
import { Popup } from '../../../lib/custom-ui';

import selectors from '../../../selectors';
import entryActions from '../../../entry-actions';
import { useSteps } from '../../../hooks';
import { BoardMembershipRoles, ListTypes } from '../../../constants/Enums';
import LabelsStep from '../../labels/LabelsStep';
import BoardMembershipsStep from '../../board-memberships/BoardMembershipsStep';
import ConfirmationStep from '../../common/ConfirmationStep';

import styles from './BulkActionsBar.module.scss';

const StepTypes = {
  LABELS: 'LABELS',
  MEMBERS: 'MEMBERS',
  MOVE: 'MOVE',
  DELETE: 'DELETE',
};

const BulkActionsBar = React.memo(() => {
  const selectCardById = useMemo(() => selectors.makeSelectCardById(), []);
  const selectListById = useMemo(() => selectors.makeSelectListById(), []);
  const selectUserIdsByCardId = useMemo(() => selectors.makeSelectUserIdsByCardId(), []);
  const selectLabelIdsByCardId = useMemo(() => selectors.makeSelectLabelIdsByCardId(), []);

  const selectedCardIds = useSelector(selectors.selectSelectedCardIds);

  const selectedCards = useSelector(
    (state) =>
      selectedCardIds.reduce((acc, id) => {
        const card = selectCardById(state, id);

        if (!card) {
          return acc;
        }

        const list = selectListById(state, card.listId);

        acc.push({
          id: card.id,
          listType: list ? list.type : null,
          userIds: selectUserIdsByCardId(state, id),
          labelIds: selectLabelIdsByCardId(state, id),
        });

        return acc;
      }, []),
    (left, right) =>
      left.length === right.length &&
      left.every(
        (item, index) =>
          item.id === right[index].id &&
          item.listType === right[index].listType &&
          shallowEqual(item.userIds, right[index].userIds) &&
          shallowEqual(item.labelIds, right[index].labelIds),
      ),
  );

  const isEditor = useSelector((state) => {
    const boardMembership = selectors.selectCurrentUserMembershipForCurrentBoard(state);
    return !!boardMembership && boardMembership.role === BoardMembershipRoles.EDITOR;
  });

  const lists = useSelector(selectors.selectAvailableListsForCurrentBoard) || [];

  const dispatch = useDispatch();
  const [t] = useTranslation();
  const [step, openStep, handleBack] = useSteps(null);

  const sharedLabelIds = useMemo(() => {
    if (selectedCards.length === 0) {
      return [];
    }

    return selectedCards[0].labelIds.filter((labelId) =>
      selectedCards.every((card) => card.labelIds.includes(labelId)),
    );
  }, [selectedCards]);

  const sharedUserIds = useMemo(() => {
    if (selectedCards.length === 0) {
      return [];
    }

    return selectedCards[0].userIds.filter((userId) =>
      selectedCards.every((card) => card.userIds.includes(userId)),
    );
  }, [selectedCards]);

  const hasCardInClosedList = useMemo(
    () => selectedCards.some((card) => card.listType === ListTypes.CLOSED),
    [selectedCards],
  );

  const handleLabelSelect = useCallback(
    (labelId) => {
      selectedCards.forEach((card) => {
        if (!card.labelIds.includes(labelId)) {
          dispatch(entryActions.addLabelToCard(labelId, card.id));
        }
      });
    },
    [selectedCards, dispatch],
  );

  const handleLabelDeselect = useCallback(
    (labelId) => {
      selectedCards.forEach((card) => {
        if (card.labelIds.includes(labelId)) {
          dispatch(entryActions.removeLabelFromCard(labelId, card.id));
        }
      });
    },
    [selectedCards, dispatch],
  );

  const handleUserSelect = useCallback(
    (userId) => {
      selectedCards.forEach((card) => {
        if (!card.userIds.includes(userId)) {
          dispatch(entryActions.addUserToCard(userId, card.id));
        }
      });
    },
    [selectedCards, dispatch],
  );

  const handleUserDeselect = useCallback(
    (userId) => {
      selectedCards.forEach((card) => {
        if (card.userIds.includes(userId)) {
          dispatch(entryActions.removeUserFromCard(userId, card.id));
        }
      });
    },
    [selectedCards, dispatch],
  );

  const handleListSelect = useCallback(
    (listId) => {
      selectedCards.forEach((card) => {
        dispatch(entryActions.moveCard(card.id, listId));
      });

      dispatch(entryActions.clearCardSelection());
      handleBack();
    },
    [selectedCards, handleBack, dispatch],
  );

  const handleArchiveClick = useCallback(() => {
    selectedCards.forEach((card) => {
      if (card.listType === ListTypes.CLOSED) {
        dispatch(entryActions.moveCardToArchive(card.id));
      }
    });

    dispatch(entryActions.clearCardSelection());
  }, [selectedCards, dispatch]);

  const handleDeleteConfirm = useCallback(() => {
    selectedCards.forEach((card) => {
      dispatch(entryActions.moveCardToTrash(card.id));
    });

    dispatch(entryActions.clearCardSelection());
  }, [selectedCards, dispatch]);

  const handleClear = useCallback(() => {
    dispatch(entryActions.clearCardSelection());
  }, [dispatch]);

  const handleLabelsClick = useCallback(() => {
    openStep(StepTypes.LABELS);
  }, [openStep]);

  const handleMembersClick = useCallback(() => {
    openStep(StepTypes.MEMBERS);
  }, [openStep]);

  const handleMoveClick = useCallback(() => {
    openStep(StepTypes.MOVE);
  }, [openStep]);

  const handleDeleteClick = useCallback(() => {
    openStep(StepTypes.DELETE);
  }, [openStep]);

  useEffect(() => {
    if (selectedCards.length === 0) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        dispatch(entryActions.clearCardSelection());
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedCards.length, dispatch]);

  if (selectedCards.length === 0) {
    return null;
  }

  if (step) {
    switch (step.type) {
      case StepTypes.LABELS:
        return (
          <div className={styles.stepWrapper}>
            <LabelsStep
              currentIds={sharedLabelIds}
              onSelect={handleLabelSelect}
              onDeselect={handleLabelDeselect}
              onBack={handleBack}
            />
          </div>
        );
      case StepTypes.MEMBERS:
        return (
          <div className={styles.stepWrapper}>
            <BoardMembershipsStep
              currentUserIds={sharedUserIds}
              onUserSelect={handleUserSelect}
              onUserDeselect={handleUserDeselect}
              onBack={handleBack}
            />
          </div>
        );
      case StepTypes.MOVE:
        return (
          <div className={styles.stepWrapper}>
            <Popup.Header onBack={handleBack}>
              {t('common.moveCard', {
                context: 'title',
              })}
            </Popup.Header>
            <Popup.Content>
              <Menu secondary vertical className={styles.menu}>
                {lists.map((list) => (
                  <Menu.Item
                    key={list.id}
                    className={styles.menuItem}
                    onClick={() => handleListSelect(list.id)}
                  >
                    {list.name || t(`common.${list.type}`)}
                  </Menu.Item>
                ))}
              </Menu>
            </Popup.Content>
          </div>
        );
      case StepTypes.DELETE:
        return (
          <div className={styles.stepWrapper}>
            <ConfirmationStep
              title="common.deleteCard"
              content="common.areYouSureYouWantToDeleteThisCard"
              buttonContent="action.deleteCard"
              onConfirm={handleDeleteConfirm}
              onBack={handleBack}
            />
          </div>
        );
      default:
    }
  }

  return (
    <div className={styles.wrapper}>
      <span className={styles.count}>
        {t('common.cardsSelected', {
          count: selectedCards.length,
        })}
      </span>
      {isEditor && (
        <>
          <button type="button" className={styles.button} onClick={handleLabelsClick}>
            <Icon name="bookmark outline" />
            {t('common.labels', {
              context: 'title',
            })}
          </button>
          <button type="button" className={styles.button} onClick={handleMembersClick}>
            <Icon name="user outline" />
            {t('common.members', {
              context: 'title',
            })}
          </button>
          <button type="button" className={styles.button} onClick={handleMoveClick}>
            <Icon name="share square outline" />
            {t('action.moveCard', {
              context: 'title',
            })}
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={handleArchiveClick}
            disabled={!hasCardInClosedList}
          >
            <Icon name="archive" />
            {t('action.archive', {
              context: 'title',
            })}
          </button>
          <button type="button" className={styles.button} onClick={handleDeleteClick}>
            <Icon name="trash alternate outline" />
            {t('action.deleteCard', {
              context: 'title',
            })}
          </button>
        </>
      )}
      <button
        type="button"
        className={styles.clearButton}
        title={t('action.clearSelection')}
        onClick={handleClear}
      >
        <Icon fitted name="close" />
      </button>
    </div>
  );
});

BulkActionsBar.StepTypes = StepTypes;

export default BulkActionsBar;
