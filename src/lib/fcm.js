import { getToken, onMessage } from 'firebase/messaging';
import { messaging } from './firebase';
import api from './api';

/**
 * Requests browser notification permission, registers the service worker,
 * fetches an FCM device token, and saves it on the user's profile so the
 * backend can push real notifications (medical/behavior alerts, new chat
 * messages, quiet-hours auto-replies, etc.) even when the app isn't open.
 *
 * No-ops quietly if messaging isn't supported or VITE_FIREBASE_VAPID_KEY
 * isn't configured yet — existing behavior (in-app notifications only)
 * is unaffected.
 */
export const requestAndSaveFcmToken = async (userId) => {
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  if (!messaging || !vapidKey || !userId) return;
  if (typeof Notification === 'undefined') return;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
    if (token) {
      await api.put(`/users/${userId}`, { fcmToken: token });
    }
  } catch (error) {
    console.log('[FCM] Push notifications not enabled:', error.message);
  }
};

/** Shows an in-app toast for pushes that arrive while the tab is focused. */
export const listenForForegroundMessages = (onMessageReceived) => {
  if (!messaging) return () => {};
  return onMessage(messaging, (payload) => {
    onMessageReceived?.(payload.notification, payload.data);
  });
};
