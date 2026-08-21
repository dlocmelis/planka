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
// The list is THIS board's cards, because the client holds one board at a time.
// A dependency may cross boards — a request waiting for a sprint card is the
// case this feature was asked for — and the second half of this popup is how
// one is made from here: paste the other card's LINK (or its id) into the same
// box and it is offered by id. The server checks the id and refuses one the
// user may not read, so nothing here has to.
//
// A card search across boards would be the tidier control and it needs an
// endpoint that does not exist; pasting the link of the card you are looking at
// needs nothing and is what a person reaches for anyway.
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

  // A card id typed or pasted in, either bare or inside a card link. Offered
  // only when it is not already a card on this board (that one is in the list
  // above, under its own name, which is the better thing to click) and not
  // already a dependency.
  const pastedCardId = useMemo(() => {
    const match = /(?:\/cards\/)?(\d{6,})\s*$/.exec(search.trim());

    if (!match) {
      return null;
    }

    const id = match[1];

    if (excludedIds.includes(id) || cards.some((card) => card.id === id)) {
      return null;
    }

    return id;
  }, [search, cards, excludedIds]);

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
          placeholder={t('common.searchCardsOrPasteLink')}
          maxLength={128}
          icon="search"
          onChange={handleSearchChange}
        />
        {filteredCards.length > 0 && (
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
        )}
        {pastedCardId && (
          <button
            type="button"
            data-id={pastedCardId}
            className={styles.item}
            onClick={handleSelectClick}
          >
            {t('common.useCardWithId', {
              id: pastedCardId,
            })}
          </button>
        )}
        {filteredCards.length === 0 && !pastedCardId && (
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
