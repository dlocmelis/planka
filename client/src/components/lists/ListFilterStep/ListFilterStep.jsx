/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Icon, Menu } from 'semantic-ui-react';
import { Popup } from '../../../lib/custom-ui';

import selectors from '../../../selectors';
import entryActions from '../../../entry-actions';
import { useSteps } from '../../../hooks';
import BoardMembershipsStep from '../../board-memberships/BoardMembershipsStep';
import LabelsStep from '../../labels/LabelsStep';

import styles from './ListFilterStep.module.scss';

const StepTypes = {
  MEMBERS: 'MEMBERS',
  LABELS: 'LABELS',
};

const ListFilterStep = React.memo(({ listId, onClose }) => {
  const selectFilterUserIdsByListId = useMemo(
    () => selectors.makeSelectFilterUserIdsByListId(),
    [],
  );

  const selectFilterLabelIdsByListId = useMemo(
    () => selectors.makeSelectFilterLabelIdsByListId(),
    [],
  );

  const selectIsFilterActiveByListId = useMemo(
    () => selectors.makeSelectIsFilterActiveByListId(),
    [],
  );

  const filterUserIds = useSelector((state) => selectFilterUserIdsByListId(state, listId));
  const filterLabelIds = useSelector((state) => selectFilterLabelIdsByListId(state, listId));
  const isFilterActive = useSelector((state) => selectIsFilterActiveByListId(state, listId));

  const dispatch = useDispatch();
  const [t] = useTranslation();
  const [step, openStep, handleBack] = useSteps();

  const handleUserSelect = useCallback(
    (userId) => {
      dispatch(entryActions.addUserToListFilter(userId, listId));
    },
    [listId, dispatch],
  );

  const handleUserDeselect = useCallback(
    (userId) => {
      dispatch(entryActions.removeUserFromListFilter(userId, listId));
    },
    [listId, dispatch],
  );

  const handleLabelSelect = useCallback(
    (labelId) => {
      dispatch(entryActions.addLabelToListFilter(labelId, listId));
    },
    [listId, dispatch],
  );

  const handleLabelDeselect = useCallback(
    (labelId) => {
      dispatch(entryActions.removeLabelFromListFilter(labelId, listId));
    },
    [listId, dispatch],
  );

  const handleMembersClick = useCallback(() => {
    openStep(StepTypes.MEMBERS);
  }, [openStep]);

  const handleLabelsClick = useCallback(() => {
    openStep(StepTypes.LABELS);
  }, [openStep]);

  const handleClearFilterClick = useCallback(() => {
    dispatch(entryActions.clearListFilter(listId));
    onClose();
  }, [listId, onClose, dispatch]);

  if (step) {
    switch (step.type) {
      case StepTypes.MEMBERS:
        return (
          <BoardMembershipsStep
            currentUserIds={filterUserIds}
            title="common.filterByMembers"
            onUserSelect={handleUserSelect}
            onUserDeselect={handleUserDeselect}
            onBack={handleBack}
          />
        );
      case StepTypes.LABELS:
        return (
          <LabelsStep
            currentIds={filterLabelIds}
            title="common.filterByLabels"
            onSelect={handleLabelSelect}
            onDeselect={handleLabelDeselect}
            onBack={handleBack}
          />
        );
      default:
    }
  }

  return (
    <>
      <Popup.Header>
        {t('common.filterList', {
          context: 'title',
        })}
      </Popup.Header>
      <Popup.Content>
        <Menu secondary vertical className={styles.menu}>
          <Menu.Item className={styles.menuItem} onClick={handleMembersClick}>
            <Icon name="user outline" className={styles.menuItemIcon} />
            {t('common.filterByMembers', {
              context: 'title',
            })}
          </Menu.Item>
          <Menu.Item className={styles.menuItem} onClick={handleLabelsClick}>
            <Icon name="bookmark outline" className={styles.menuItemIcon} />
            {t('common.filterByLabels', {
              context: 'title',
            })}
          </Menu.Item>
          {isFilterActive && (
            <Menu.Item className={styles.menuItem} onClick={handleClearFilterClick}>
              <Icon name="eraser" className={styles.menuItemIcon} />
              {t('action.clearFilter', {
                context: 'title',
              })}
            </Menu.Item>
          )}
        </Menu>
      </Popup.Content>
    </>
  );
});

ListFilterStep.propTypes = {
  listId: PropTypes.string.isRequired,
  onClose: PropTypes.func.isRequired,
};

export default ListFilterStep;
