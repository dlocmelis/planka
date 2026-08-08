/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useCallback, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Icon, Input } from 'semantic-ui-react';

import selectors from '../../../selectors';

import styles from './CardPicker.module.scss';

/**
 * Which conversation the panel is on.
 *
 * The bot answers on a card — that is where it reads the ticket from and where
 * its reply is recorded for everyone else — so a chat needs one chosen. Cards
 * the bot has already spoken on come first: those are the threads that are
 * already conversations, and they are what the user is nearly always coming
 * back to.
 */
const CardPicker = React.memo(({ onSelect }) => {
  const cards = useSelector(selectors.selectChatCardsForCurrentBoard);

  const [t] = useTranslation();
  const [search, setSearch] = useState('');

  const filteredCards = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matching =
      term === '' ? cards : cards.filter((card) => (card.name || '').toLowerCase().includes(term));

    return matching.slice(0, 50);
  }, [cards, search]);

  const handleSearchChange = useCallback((_, { value }) => {
    setSearch(value);
  }, []);

  const handleSelectClick = useCallback(
    (event) => {
      onSelect(event.currentTarget.dataset.id);
    },
    [onSelect],
  );

  return (
    <div className={styles.wrapper}>
      <div className={styles.searchWrapper}>
        <Input
          fluid
          size="small"
          icon="search"
          iconPosition="left"
          value={search}
          placeholder={t('common.searchCards')}
          aria-label={t('common.searchCards')}
          onChange={handleSearchChange}
        />
      </div>
      {filteredCards.length === 0 ? (
        <div className={styles.empty}>{t('common.noCardsToChatOn')}</div>
      ) : (
        <ul className={styles.items}>
          {filteredCards.map((card) => (
            <li key={card.id}>
              <button
                type="button"
                data-id={card.id}
                className={styles.item}
                onClick={handleSelectClick}
              >
                <span className={styles.itemName}>{card.name}</span>
                {card.hasBotComment && <Icon fitted name="comments" className={styles.itemIcon} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

CardPicker.propTypes = {
  onSelect: PropTypes.func.isRequired,
};

export default CardPicker;
