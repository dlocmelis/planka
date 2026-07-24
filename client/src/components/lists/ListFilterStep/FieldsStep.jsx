/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import debounce from 'lodash/debounce';
import React, { useCallback, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { createSelector } from 'redux-orm';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Icon, Menu } from 'semantic-ui-react';
import { useDidUpdate } from '../../../lib/hooks';
import { Input, Popup } from '../../../lib/custom-ui';

import orm from '../../../orm';
import selectors from '../../../selectors';
import entryActions from '../../../entry-actions';

import styles from './FieldsStep.module.scss';

const makeSelectCustomFieldNamesByListId = () =>
  createSelector(
    orm,
    (_, id) => id,
    ({ List }, id) => {
      const listModel = List.withId(id);

      if (!listModel) {
        return [];
      }

      const names = new Set();
      listModel.getCardsModelArray().forEach((cardModel) => {
        cardModel
          .getCustomFieldGroupsQuerySet()
          .toModelArray()
          .forEach((customFieldGroupModel) => {
            customFieldGroupModel.getCustomFieldsModelArray().forEach((customFieldModel) => {
              if (!customFieldModel.isSecret && customFieldModel.name) {
                names.add(customFieldModel.name);
              }
            });
          });
      });

      return [...names].sort();
    },
  );

const FieldsStep = React.memo(({ listId, onBack }) => {
  const selectListById = useMemo(() => selectors.makeSelectListById(), []);
  const selectCustomFieldNamesByListId = useMemo(() => makeSelectCustomFieldNamesByListId(), []);

  const list = useSelector((state) => selectListById(state, listId));
  const fieldNames = useSelector((state) => selectCustomFieldNamesByListId(state, listId));

  const dispatch = useDispatch();
  const [t] = useTranslation();

  const storedCustomFieldFilter = useMemo(
    () => list.customFieldFilter || {},
    [list.customFieldFilter],
  );

  const [customFieldFilter, setCustomFieldFilter] = useState(storedCustomFieldFilter);

  const debouncedUpdateCustomFieldFilter = useMemo(
    () =>
      debounce((nextCustomFieldFilter) => {
        dispatch(entryActions.updateCustomFieldFilterInList(listId, nextCustomFieldFilter));
      }, 400),
    [listId, dispatch],
  );

  useDidUpdate(() => {
    setCustomFieldFilter(storedCustomFieldFilter);
  }, [storedCustomFieldFilter]);

  const handleToggleClick = useCallback(
    (_, { value: fieldName }) => {
      debouncedUpdateCustomFieldFilter.cancel();

      let nextCustomFieldFilter;
      if (Object.prototype.hasOwnProperty.call(customFieldFilter, fieldName)) {
        nextCustomFieldFilter = { ...customFieldFilter };
        delete nextCustomFieldFilter[fieldName];
      } else {
        nextCustomFieldFilter = {
          ...customFieldFilter,
          [fieldName]: '',
        };
      }

      setCustomFieldFilter(nextCustomFieldFilter);
      dispatch(entryActions.updateCustomFieldFilterInList(listId, nextCustomFieldFilter));
    },
    [listId, customFieldFilter, debouncedUpdateCustomFieldFilter, dispatch],
  );

  const handleValueChange = useCallback(
    (_, { name: fieldName, value }) => {
      const nextCustomFieldFilter = {
        ...customFieldFilter,
        [fieldName]: value,
      };

      setCustomFieldFilter(nextCustomFieldFilter);
      debouncedUpdateCustomFieldFilter(nextCustomFieldFilter);
    },
    [customFieldFilter, debouncedUpdateCustomFieldFilter],
  );

  return (
    <>
      <Popup.Header onBack={onBack}>
        {t('common.filterByFields', {
          context: 'title',
        })}
      </Popup.Header>
      <Popup.Content>
        {fieldNames.length > 0 ? (
          <Menu secondary vertical className={styles.menu}>
            {fieldNames.map((fieldName) => {
              const isSelected = Object.prototype.hasOwnProperty.call(customFieldFilter, fieldName);

              return (
                <div key={fieldName}>
                  <Menu.Item
                    value={fieldName}
                    className={styles.menuItem}
                    onClick={handleToggleClick}
                  >
                    {fieldName}
                    {isSelected && <Icon name="check" className={styles.checkIcon} />}
                  </Menu.Item>
                  {isSelected && (
                    <div className={styles.valueWrapper}>
                      <Input
                        fluid
                        name={fieldName}
                        value={customFieldFilter[fieldName] || ''}
                        placeholder={t('common.enterFieldValue')}
                        maxLength={128}
                        onChange={handleValueChange}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </Menu>
        ) : (
          <div className={styles.empty}>{t('common.noFieldsToFilterBy')}</div>
        )}
      </Popup.Content>
    </>
  );
});

FieldsStep.propTypes = {
  listId: PropTypes.string.isRequired,
  onBack: PropTypes.func,
};

FieldsStep.defaultProps = {
  onBack: undefined,
};

export default FieldsStep;
