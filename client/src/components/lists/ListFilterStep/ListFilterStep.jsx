/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import isEmpty from 'lodash/isEmpty';
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

const ListFilterStep = React.memo(({ listId }) => {
  const selectListById = useMemo(() => selectors.makeSelectListById(), []);

  const list = useSelector((state) => selectListById(state, listId));

  const dispatch = useDispatch();
  const [t] = useTranslation();
  const [step, openStep, handleBack] = useSteps();

  const filterUserIds = useMemo(() => list.filterUserIds || [], [list.filterUserIds]);
  const filterLabelIds = useMemo(() => list.filterLabelIds || [], [list.filterLabelIds]);
  const customFieldFilter = useMemo(() => list.customFieldFilter || {}, [list.customFieldFilter]);

  const isFilterActive =
    filterUserIds.length > 0 || filterLabelIds.length > 0 || !isEmpty(customFieldFilter);

  const handleUserSelect = useCallback(
    (userId) => {
      dispatch(entryActions.addUserToFilterInList(userId, listId));
    },
    [listId, dispatch],
  );

  const handleUserDeselect = useCallback(
    (userId) => {
      dispatch(entryActions.removeUserFromFilterInList(userId, listId));
    },
    [listId, dispatch],
  );

  const handleUserClick = useCallback(
    ({
      currentTarget: {
        dataset: { id: userId },
      },
    }) => {
      dispatch(entryActions.removeUserFromFilterInList(userId, listId));
    },
    [listId, dispatch],
  );

  const handleLabelSelect = useCallback(
    (labelId) => {
      dispatch(entryActions.addLabelToFilterInList(labelId, listId));
    },
    [listId, dispatch],
  );

  const handleLabelDeselect = useCallback(
    (labelId) => {
      dispatch(entryActions.removeLabelFromFilterInList(labelId, listId));
    },
    [listId, dispatch],
  );

  const handleLabelClick = useCallback(
    ({
      currentTarget: {
        dataset: { id: labelId },
      },
    }) => {
      dispatch(entryActions.removeLabelFromFilterInList(labelId, listId));
    },
    [listId, dispatch],
  );

  const handleFieldClick = useCallback(
    ({
      currentTarget: {
        dataset: { name: fieldName },
      },
    }) => {
      const nextCustomFieldFilter = { ...customFieldFilter };
      delete nextCustomFieldFilter[fieldName];

      dispatch(entryActions.updateCustomFieldFilterInList(listId, nextCustomFieldFilter));
    },
    [listId, customFieldFilter, dispatch],
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
    filterUserIds.forEach((userId) => {
      dispatch(entryActions.removeUserFromFilterInList(userId, listId));
    });

    filterLabelIds.forEach((labelId) => {
      dispatch(entryActions.removeLabelFromFilterInList(labelId, listId));
    });

    if (!isEmpty(customFieldFilter)) {
      dispatch(entryActions.updateCustomFieldFilterInList(listId, {}));
    }
  }, [listId, filterUserIds, filterLabelIds, customFieldFilter, dispatch]);

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
            {Object.keys(customFieldFilter).map((fieldName) => (
              <span key={fieldName} className={styles.chip}>
                <button
                  type="button"
                  data-name={fieldName}
                  className={styles.fieldChip}
                  onClick={handleFieldClick}
                >
                  {customFieldFilter[fieldName]
                    ? `${fieldName}: ${customFieldFilter[fieldName]}`
                    : fieldName}
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
};

export default ListFilterStep;
