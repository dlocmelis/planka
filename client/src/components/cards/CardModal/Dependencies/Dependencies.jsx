/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from 'semantic-ui-react';

import selectors from '../../../../selectors';
import entryActions from '../../../../entry-actions';
import { usePopupInClosableContext } from '../../../../hooks';
import CardDependenciesStep from '../../CardDependenciesStep';

import styles from './Dependencies.module.scss';

// "Dependent on: card B", plus the mirror of it — what is waiting for THIS card.
//
// Both halves are drawn because a dependency is only readable from one end at a
// time otherwise: somebody looking at the blocker has no way of knowing that
// finishing it releases three other tickets, and that is exactly the thing the
// automation will act on.
const Dependencies = React.memo(({ canEdit }) => {
  const card = useSelector(selectors.selectCurrentCard);
  const dependencies = useSelector(selectors.selectDependenciesForCurrentCard);
  const dependents = useSelector(selectors.selectDependentsForCurrentCard);

  const dispatch = useDispatch();
  const [t] = useTranslation();

  // What the picker must not offer: the cards this one already waits for, and
  // THIS CARD ITSELF.
  //
  // Its own id is here because the picker's list cannot exclude it — that list
  // is selectCardsExceptCurrentForCurrentBoard, which has already dropped it —
  // while the paste box can still be handed this card's own link, and the
  // server answers that 422 `cardDependsOnItself`. Offering a button whose only
  // outcome is a refusal is worse than not offering it.
  const excludedIds = useMemo(
    () => [card.id, ...dependencies.map((dependency) => dependency.dependsOnCardId)],
    [card.id, dependencies],
  );

  const handleSelect = useCallback(
    (dependsOnCardId) => {
      dispatch(entryActions.createCardDependencyInCurrentCard(dependsOnCardId));
    },
    [dispatch],
  );

  const handleRemoveClick = useCallback(
    (event) => {
      dispatch(entryActions.deleteCardDependency(card.id, event.currentTarget.dataset.id));
    },
    [dispatch, card.id],
  );

  const CardDependenciesPopup = usePopupInClosableContext(CardDependenciesStep);

  if (dependencies.length === 0 && dependents.length === 0 && !canEdit) {
    return null;
  }

  const renderName = (dependency) => {
    if (!dependency.card) {
      // The other end is on a board this client has not loaded. Saying so is
      // the honest answer; inventing a name would be worse than none.
      return <span className={styles.unknown}>{t('common.cardOnAnotherBoard')}</span>;
    }

    return (
      <span className={classNames(styles.name, dependency.isDone && styles.nameDone)}>
        {dependency.card.name}
      </span>
    );
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>{t('common.dependsOn')}</div>
      {dependencies.length === 0 && (
        <div className={styles.empty}>{t('common.noDependencies')}</div>
      )}
      {dependencies.map((dependency) => (
        <div key={dependency.dependsOnCardId} className={styles.item}>
          <Icon
            name={dependency.isDone ? 'check circle outline' : 'hourglass half'}
            className={styles.itemIcon}
          />
          {renderName(dependency)}
          {dependency.listName && <span className={styles.listName}>{dependency.listName}</span>}
          {canEdit && (
            <Button
              type="button"
              data-id={dependency.dependsOnCardId}
              className={styles.removeButton}
              onClick={handleRemoveClick}
            >
              <Icon fitted name="trash alternate outline" size="small" />
            </Button>
          )}
        </div>
      ))}
      {canEdit && (
        <CardDependenciesPopup excludedIds={excludedIds} onSelect={handleSelect}>
          <button type="button" className={styles.addButton}>
            {t('action.addDependency')}
          </button>
        </CardDependenciesPopup>
      )}
      {dependents.length > 0 && (
        <>
          <div className={styles.header}>{t('common.blocking')}</div>
          {dependents.map((dependent) => (
            <div key={dependent.cardId} className={styles.item}>
              <Icon name="linkify" className={styles.itemIcon} />
              {renderName(dependent)}
              {dependent.listName && <span className={styles.listName}>{dependent.listName}</span>}
            </div>
          ))}
        </>
      )}
    </div>
  );
});

Dependencies.propTypes = {
  canEdit: PropTypes.bool.isRequired,
};

export default Dependencies;
