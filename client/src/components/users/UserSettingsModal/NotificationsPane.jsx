/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Button, Divider, Header, Message, Radio, Tab } from 'semantic-ui-react';

import selectors from '../../../selectors';
import entryActions from '../../../entry-actions';
import {
  getPushSubscription,
  isIosNonInstalled,
  isPushSupported,
  serializePushSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from '../../../utils/web-push';
import NotificationServices from '../../notification-services/NotificationServices';

import styles from './NotificationsPane.module.scss';

const NotificationsPane = React.memo(() => {
  const notificationServiceIds = useSelector(selectors.selectNotificationServiceIdsForCurrentUser);
  const webPushBootstrap = useSelector(selectors.selectWebPushBootstrap);
  const webPushState = useSelector(selectors.selectWebPushState);

  const [subscription, setSubscription] = useState(null);
  const [isLocalSubmitting, setIsLocalSubmitting] = useState(false);
  const [isSubscribeFailed, setIsSubscribeFailed] = useState(false);

  const dispatch = useDispatch();
  const [t] = useTranslation();

  useEffect(() => {
    let isCancelled = false;

    const loadSubscription = async () => {
      let currentSubscription;
      try {
        currentSubscription = await getPushSubscription();
      } catch {
        return;
      }

      if (!isCancelled) {
        setSubscription(currentSubscription);
      }
    };

    if (webPushBootstrap && isPushSupported()) {
      loadSubscription();
    }

    return () => {
      isCancelled = true;
    };
  }, [webPushBootstrap]);

  const handleCreate = useCallback(
    (data) => {
      dispatch(entryActions.createNotificationServiceInCurrentUser(data));
    },
    [dispatch],
  );

  const handleToggleChange = useCallback(
    async (_, { checked }) => {
      setIsSubscribeFailed(false);
      setIsLocalSubmitting(true);

      if (checked) {
        let newSubscription;
        try {
          newSubscription = await subscribeToPush(webPushBootstrap.vapidPublicKey);
        } catch {
          setIsLocalSubmitting(false);
          setIsSubscribeFailed(true);
          return;
        }

        setSubscription(newSubscription);
        dispatch(entryActions.createPushSubscription(serializePushSubscription(newSubscription)));
      } else {
        const endpoint = subscription ? subscription.endpoint : null;

        try {
          await unsubscribeFromPush();
        } catch {
          /* empty */
        }

        setSubscription(null);

        if (endpoint) {
          dispatch(entryActions.deletePushSubscription(endpoint));
        }
      }

      setIsLocalSubmitting(false);
    },
    [dispatch, subscription, webPushBootstrap],
  );

  const handleTestClick = useCallback(() => {
    dispatch(entryActions.testPushSubscription());
  }, [dispatch]);

  let pushContent = null;

  if (webPushBootstrap) {
    if (isIosNonInstalled()) {
      pushContent = <Message info content={t('common.addToHomeScreenHint')} />;
    } else if (!isPushSupported()) {
      pushContent = <Message info content={t('common.pushNotificationsNotSupported')} />;
    } else {
      pushContent = (
        <>
          <Radio
            toggle
            checked={!!subscription}
            disabled={
              isLocalSubmitting || webPushState.isSubmitting || Notification.permission === 'denied'
            }
            label={t('common.enablePushNotifications')}
            className={styles.radio}
            onChange={handleToggleChange}
          />
          {Notification.permission === 'denied' && (
            <Message warning content={t('common.pushPermissionDeniedGuidance')} />
          )}
          {(isSubscribeFailed || webPushState.error) && (
            <Message negative content={t('common.subscribeFailed')} />
          )}
          {subscription && (
            <Button
              content={t('common.sendTestNotification')}
              loading={webPushState.isTesting}
              disabled={webPushState.isTesting}
              className={styles.button}
              onClick={handleTestClick}
            />
          )}
          {webPushState.isTestSuccessful && (
            <Message positive content={t('common.testNotificationSent')} />
          )}
          {webPushState.testError && (
            <Message negative content={t('common.testNotificationFailed')} />
          )}
        </>
      );
    }

    pushContent = (
      <>
        <Divider horizontal section>
          <Header as="h4">{t('common.pushNotifications')}</Header>
        </Divider>
        {pushContent}
      </>
    );
  }

  return (
    <Tab.Pane attached={false} className={styles.wrapper}>
      {pushContent}
      <NotificationServices ids={notificationServiceIds} onCreate={handleCreate} />
    </Tab.Pane>
  );
});

export default NotificationsPane;
