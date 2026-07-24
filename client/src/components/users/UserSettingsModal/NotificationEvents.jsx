/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useCallback, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Checkbox, Header } from 'semantic-ui-react';

import selectors from '../../../selectors';
import entryActions from '../../../entry-actions';

import styles from './NotificationEvents.module.scss';

const SECTIONS = [
  { name: 'comments', scopes: ['mentions', 'own', 'user', 'dev', 'all'] },
  { name: 'cardMovement', scopes: ['own', 'user', 'dev', 'all'] },
  { name: 'labels', scopes: ['own', 'user', 'dev', 'all'] },
  { name: 'fields', scopes: ['own', 'user', 'dev', 'all'] },
];

const NotificationEvents = React.memo(() => {
  const user = useSelector(selectors.selectCurrentUser);

  const dispatch = useDispatch();
  const [t] = useTranslation();

  const notificationEvents = useMemo(() => {
    const events = user.notificationEvents || {};

    return SECTIONS.reduce((acc, { name: sectionName, scopes }) => {
      const section = events[sectionName] || {};

      return {
        ...acc,
        [sectionName]: scopes.reduce(
          (scopeAcc, scopeName) => ({
            ...scopeAcc,
            [scopeName]: !!section[scopeName],
          }),
          {},
        ),
      };
    }, {});
  }, [user.notificationEvents]);

  const handleChange = useCallback(
    (_, { name, checked }) => {
      const [sectionName, scopeName] = name.split('.');

      // "all" acts as a group toggle: (de)selecting it (de)selects every scope in the section,
      // and deselecting any sibling scope also deselects "all"
      const nextSection =
        scopeName === 'all'
          ? Object.fromEntries(
              SECTIONS.find((section) => section.name === sectionName).scopes.map((scope) => [
                scope,
                checked,
              ]),
            )
          : {
              ...notificationEvents[sectionName],
              [scopeName]: checked,
              ...(!checked && { all: false }),
            };

      dispatch(
        entryActions.updateCurrentUser({
          notificationEvents: {
            ...notificationEvents,
            [sectionName]: nextSection,
          },
        }),
      );
    },
    [dispatch, notificationEvents],
  );

  return (
    <>
      {SECTIONS.map(({ name: sectionName, scopes }) => (
        <div key={sectionName} className={styles.section}>
          <Header as="h4" className={styles.title}>
            {t(`common.${sectionName}`)}
          </Header>
          {scopes.map((scopeName) => (
            <Checkbox
              key={scopeName}
              name={`${sectionName}.${scopeName}`}
              checked={notificationEvents[sectionName][scopeName]}
              label={t(`common.${scopeName}`)}
              className={styles.checkbox}
              onChange={handleChange}
            />
          ))}
        </div>
      ))}
    </>
  );
});

export default NotificationEvents;
