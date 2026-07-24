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
import UserAvatar from '../../users/UserAvatar';
import LabelChip from '../../labels/LabelChip';
import BoardMembershipsStep from '../../board-memberships/BoardMembershipsStep';
import LabelsStep from '../../labels/LabelsStep';
import FieldsStep from './FieldsStep';

import styles from './ListFilterStep.module.scss';

const StepTypes = {
  MEMBERS: 'MEMBERS',
  LABELS: 'LABELS',
  FIELDS: 'FIELDS',
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
  const selectFilterCustomFieldsByListId = useMemo(
    () => selectors.makeSelectFilterCustomFieldsByListId(),
    [],
  );
  const selectIsFilterActiveByListId = useMemo(
    () => selectors.makeSelectIsFilterActiveByListId(),
    [],
  );

  const filterUserIds = useSelector((state) => selectFilterUserIdsByListId(state, listId)) || [];
  const filterLabelIds = useSelector((state) => selectFilterLabelIdsByListId(state, listId)) || [];
  const storedFilterCustomFields = useSelector((state) =>
    selectFilterCustomFieldsByListId(state, listId),
  );
  const isFilterActive = useSelector((state) => selectIsFilterActiveByListId(state, listId));

  const filterCustomFields = useMemo(
    () => storedFilterCustomFields || [],
    [storedFilterCustomFields],
  );

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

  const handleUserClick = useCallback(
    ({
      currentTarget: {
        dataset: { id: userId },
      },
    }) => {
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

  const handleLabelClick = useCallback(
    ({
      currentTarget: {
        dataset: { id: labelId },
      },
    }) => {
      dispatch(entryActions.removeLabelFromListFilter(labelId, listId));
    },
    [listId, dispatch],
  );

  const handleFieldClick = useCallback(
    ({
      currentTarget: {
        dataset: { name: fieldName },
      },
    }) => {
      const nextFilterCustomFields = filterCustomFields.filter(({ name }) => name !== fieldName);

      dispatch(entryActions.updateCustomFieldFilterInList(listId, nextFilterCustomFields));
    },
    [listId, filterCustomFields, dispatch],
  );

  const handleMembersClick = useCallback(() => {
    openStep(StepTypes.MEMBERS);
  }, [openStep]);

  const handleLabelsClick = useCallback(() => {
    openStep(StepTypes.LABELS);
  }, [openStep]);

  const handleFieldsClick = useCallback(() => {
    openStep(StepTypes.FIELDS);
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
      case StepTypes.FIELDS:
        return <FieldsStep listId={listId} onBack={handleBack} />;
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
        {isFilterActive && (
          <div className={styles.chips}>
            {filterUserIds.map((userId) => (
              <span key={userId} className={styles.chip}>
                <UserAvatar id={userId} size="tiny" onClick={handleUserClick} />
              </span>
            ))}
            {filterLabelIds.map((labelId) => (
              <span key={labelId} className={styles.chip}>
                <LabelChip id={labelId} size="small" onClick={handleLabelClick} />
              </span>
            ))}
            {filterCustomFields.map(({ name, content }) => (
              <span key={name} className={styles.chip}>
                <button
                  type="button"
                  data-name={name}
                  className={styles.fieldChip}
                  onClick={handleFieldClick}
                >
                  {content ? `${name}: ${content}` : name}
                </button>
              </span>
            ))}
          </div>
        )}
        <Menu secondary vertical className={styles.menu}>
          <Menu.Item className={styles.menuItem} onClick={handleMembersClick}>
            <Icon name="user outline" className={styles.menuItemIcon} />
            {t('common.members')}
          </Menu.Item>
          <Menu.Item className={styles.menuItem} onClick={handleLabelsClick}>
            <Icon name="bookmark outline" className={styles.menuItemIcon} />
            {t('common.labels')}
          </Menu.Item>
          <Menu.Item className={styles.menuItem} onClick={handleFieldsClick}>
            <Icon name="sliders horizontal" className={styles.menuItemIcon} />
            {t('common.fields')}
          </Menu.Item>
          {isFilterActive && (
            <>
              <hr className={styles.divider} />
              <Menu.Item className={styles.menuItem} onClick={handleClearFilterClick}>
                <Icon name="cancel" className={styles.menuItemIcon} />
                {t('action.clearFilter')}
              </Menu.Item>
            </>
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
