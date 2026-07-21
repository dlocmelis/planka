/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

import Config from '../constants/Config';

const urlBase64ToUint8Array = (base64String) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

  return Uint8Array.from([...window.atob(base64)].map((character) => character.charCodeAt(0)));
};

export const isPushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export const isIosNonInstalled = () => {
  const isIos =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  return isIos && window.navigator.standalone === false;
};

export const registerServiceWorker = () =>
  navigator.serviceWorker.register(`${Config.BASE_PATH}/sw.js`);

export const getPushSubscription = async () => {
  const registration = await navigator.serviceWorker.getRegistration();

  if (!registration) {
    return null;
  }

  return registration.pushManager.getSubscription();
};

export const subscribeToPush = async (vapidPublicKey) => {
  const registration = await registerServiceWorker();

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
};

export const unsubscribeFromPush = async () => {
  const subscription = await getPushSubscription();

  if (!subscription) {
    return null;
  }

  const { endpoint } = subscription;

  await subscription.unsubscribe();

  return endpoint;
};

export const serializePushSubscription = (subscription) => {
  const { endpoint, keys } = subscription.toJSON();

  return {
    endpoint,
    keys,
    userAgent: navigator.userAgent,
  };
};
