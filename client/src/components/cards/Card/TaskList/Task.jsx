/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router';
import { Checkbox, Icon } from 'semantic-ui-react';

import selectors from '../../../../selectors';
import entryActions from '../../../../entry-actions';
import Paths from '../../../../constants/Paths';
import Linkify from '../../../common/Linkify';

import styles from './Task.module.scss';

const Task = React.memo(({ id, canToggle }) => {
  const selectTaskById = useMemo(() => selectors.makeSelectTaskById(), []);
  const selectLinkedCardById = useMemo(() => selectors.makeSelectCardById(), []);

  const task = useSelector((state) => selectTaskById(state, id));

  const linkedCard = useSelector(
    (state) => task.linkedCardId && selectLinkedCardById(state, task.linkedCardId),
  );

  const dispatch = useDispatch();

  const handleToggleChange = useCallback(() => {
    dispatch(
      entryActions.updateTask(id, {
        isCompleted: !task.isCompleted,
      }),
    );
  }, [id, task.isCompleted, dispatch]);

  // Keeps the toggle from opening the card modal or starting a card drag
  const handleToggleClick = useCallback((event) => {
    event.stopPropagation();
  }, []);

  const handleToggleMouseDown = useCallback((event) => {
    event.stopPropagation();
  }, []);

  const handleLinkClick = useCallback((event) => {
    event.stopPropagation();
  }, []);

  return (
    <li className={styles.wrapper}>
      <span className={styles.checkboxWrapper}>
        <Checkbox
          checked={task.isCompleted}
          disabled={!!task.linkedCardId || !task.isPersisted || !canToggle}
          className={styles.checkbox}
          onChange={handleToggleChange}
          onClick={handleToggleClick}
          onMouseDown={handleToggleMouseDown}
        />
      </span>
      {task.linkedCardId ? (
        <>
          <Icon name="exchange" size="small" className={styles.icon} />
          <span className={classNames(styles.name, task.isCompleted && styles.nameCompleted)}>
            <Link to={Paths.CARDS.replace(':id', task.linkedCardId)} onClick={handleLinkClick}>
              {linkedCard ? linkedCard.name : task.name}
            </Link>
          </span>
        </>
      ) : (
        <span className={classNames(styles.name, task.isCompleted && styles.nameCompleted)}>
          <Linkify linkStopPropagation>{task.name}</Linkify>
        </span>
      )}
    </li>
  );
});

Task.propTypes = {
  id: PropTypes.string.isRequired,
  canToggle: PropTypes.bool.isRequired,
};

export default Task;
