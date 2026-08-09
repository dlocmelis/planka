/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Icon, Input } from 'semantic-ui-react';

import selectors from '../../../selectors';
import { useNestedRef } from '../../../hooks';

import styles from './CardPicker.module.scss';

/** How many conversations the list shows at once. A board runs to hundreds of
 * cards and this is a 400px-wide panel; the search box above is how the rest
 * are reached, and the list says outright how many it is not showing rather
 * than ending in silence. */
const VISIBLE_LIMIT = 50;

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
  const [searchFieldRef, handleSearchFieldRef] = useNestedRef('inputRef');

  // The picker is only mounted while the panel is open on no card, so this is
  // "focus the search box when the chat opens with nothing chosen" — the same
  // job the composer does once there IS a card, and for the same reason: the
  // launcher that opened the panel is a SIBLING of the dialog, so until focus
  // moves inside it the panel's own Escape handler can never fire.
  useEffect(() => {
    searchFieldRef.current.focus();
  }, [searchFieldRef]);

  const { visibleCards, hiddenTotal } = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matching =
      term === '' ? cards : cards.filter((card) => (card.name || '').toLowerCase().includes(term));

    return {
      visibleCards: matching.slice(0, VISIBLE_LIMIT),
      hiddenTotal: Math.max(0, matching.length - VISIBLE_LIMIT),
    };
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
          ref={handleSearchFieldRef}
          size="small"
          icon="search"
          iconPosition="left"
          value={search}
          placeholder={t('common.searchCards')}
          aria-label={t('common.searchCards')}
          onChange={handleSearchChange}
        />
      </div>
      {visibleCards.length === 0 ? (
        <div className={styles.empty}>{t('common.noCardsToChatOn')}</div>
      ) : (
        <ul className={styles.items}>
          {visibleCards.map((card) => (
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
          {hiddenTotal > 0 && (
            <li className={styles.more}>
              {t('common.andMoreCardsSearchToNarrow', { count: hiddenTotal })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
});

CardPicker.propTypes = {
  onSelect: PropTypes.func.isRequired,
};

export default CardPicker;
