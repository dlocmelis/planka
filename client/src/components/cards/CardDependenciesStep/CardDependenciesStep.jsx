/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import PropTypes from 'prop-types';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Input, Popup } from '../../../lib/custom-ui';

import selectors from '../../../selectors';
import { useField, useNestedRef } from '../../../hooks';

import styles from './CardDependenciesStep.module.scss';

// The picker behind "Dependent on": every other card on this board, minus the
// ones the current card already waits for.
//
// Only THIS board's cards, because the client holds one board at a time. The
// API allows a dependency across boards (a request waiting for a sprint card)
// and renders one it is given, but there is nothing here to search the other
// board with — so this popup offers what it can actually list rather than a
// search box that would silently answer for one board only.
const CardDependenciesStep = React.memo(({ excludedIds, onSelect }) => {
  const cards = useSelector(selectors.selectCardsExceptCurrentForCurrentBoard);

  const [t] = useTranslation();
  const [search, handleSearchChange] = useField('');
  const cleanSearch = useMemo(() => search.trim().toLowerCase(), [search]);

  const filteredCards = useMemo(
    () =>
      cards.filter(
        (card) => !excludedIds.includes(card.id) && card.name.toLowerCase().includes(cleanSearch),
      ),
    [cards, excludedIds, cleanSearch],
  );

  const [searchFieldRef, handleSearchFieldRef] = useNestedRef('inputRef');

  const handleSelectClick = useCallback(
    (event) => {
      onSelect(event.currentTarget.dataset.id);
    },
    [onSelect],
  );

  useEffect(() => {
    searchFieldRef.current.focus({
      preventScroll: true,
    });
  }, [searchFieldRef]);

  return (
    <>
      <Popup.Header>
        {t('common.dependsOn', {
          context: 'title',
        })}
      </Popup.Header>
      <Popup.Content>
        <Input
          fluid
          ref={handleSearchFieldRef}
          value={search}
          placeholder={t('common.searchCards')}
          maxLength={128}
          icon="search"
          onChange={handleSearchChange}
        />
        {filteredCards.length > 0 ? (
          <div className={styles.items}>
            {filteredCards.map((card) => (
              <button
                key={card.id}
                type="button"
                data-id={card.id}
                className={styles.item}
                onClick={handleSelectClick}
              >
                {card.name}
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.message}>{t('common.noCardsFound')}</div>
        )}
      </Popup.Content>
    </>
  );
});

CardDependenciesStep.propTypes = {
  /* eslint-disable react/forbid-prop-types */
  excludedIds: PropTypes.array.isRequired,
  /* eslint-enable react/forbid-prop-types */
  onSelect: PropTypes.func.isRequired,
};

export default CardDependenciesStep;
