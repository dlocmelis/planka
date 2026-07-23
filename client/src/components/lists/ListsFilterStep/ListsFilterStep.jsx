/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import upperFirst from 'lodash/upperFirst';
import camelCase from 'lodash/camelCase';
import React, { useCallback } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Icon, Menu } from 'semantic-ui-react';
import { Popup } from '../../../lib/custom-ui';

import selectors from '../../../selectors';

import styles from './ListsFilterStep.module.scss';
import globalStyles from '../../../styles.module.scss';

const ListsFilterStep = React.memo(({ currentIds, onSelect, onDeselect, onShowAll, onHideAll }) => {
  const lists = useSelector(selectors.selectKanbanListsForCurrentBoard);

  const [t] = useTranslation();

  const handleToggleClick = useCallback(
    (_, { value: listId }) => {
      if (currentIds.includes(listId)) {
        onDeselect(listId);
      } else {
        onSelect(listId);
      }
    },
    [currentIds, onSelect, onDeselect],
  );

  return (
    <>
      <Popup.Header>
        {t('common.lists', {
          context: 'title',
        })}
      </Popup.Header>
      <Popup.Content>
        <Menu secondary vertical className={styles.menu}>
          <Menu.Item className={styles.menuItem} onClick={onShowAll}>
            <Icon name="eye" className={styles.menuItemIcon} />
            {t('common.showAll')}
          </Menu.Item>
          <Menu.Item className={styles.menuItem} onClick={onHideAll}>
            <Icon name="eye slash" className={styles.menuItemIcon} />
            {t('common.hideAll')}
          </Menu.Item>
          <hr className={styles.divider} />
          {lists.map((list) => (
            <Menu.Item
              key={list.id}
              value={list.id}
              className={styles.menuItem}
              onClick={handleToggleClick}
            >
              {list.color && (
                <span
                  className={classNames(
                    styles.colorChip,
                    globalStyles[`background${upperFirst(camelCase(list.color))}`],
                  )}
                />
              )}
              {list.name || t(`common.${list.type}`)}
              {!currentIds.includes(list.id) && <Icon name="check" className={styles.checkIcon} />}
            </Menu.Item>
          ))}
        </Menu>
      </Popup.Content>
    </>
  );
});

ListsFilterStep.propTypes = {
  currentIds: PropTypes.array.isRequired, // eslint-disable-line react/forbid-prop-types
  onSelect: PropTypes.func.isRequired,
  onDeselect: PropTypes.func.isRequired,
  onShowAll: PropTypes.func.isRequired,
  onHideAll: PropTypes.func.isRequired,
};

export default ListsFilterStep;
