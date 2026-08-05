import { getToken, onMessage } from 'firebase/messaging';
import { messaging } from './firebase';
import api from './api';

/**
 * Requests browser notification permission, registers the service worker,
 * fetches an FCM device token, and saves it on the user's profile so the
 * backend can push real notifications (medical/behavior alerts, new chat
 * messages, quiet-hours auto-replies, etc.) even when the app isn't open.
 *
 * Returns a status string instead of throwing, so callers (the automatic
 * mount-time attempt in Sidebar.jsx, and the manual "Enable notifications"
 * nav item) can tell an unsupported browser apart from a denied permission
 * apart from success — there was previously no way to distinguish these
 * from outside this function, so a user who dismissed or blocked the
 * browser's one-shot permission prompt had no way to find out or retry.
 * @returns {Promise<'unsupported'|'not-configured'|'denied'|'granted'|'error'>}
 */
export const requestAndSaveFcmToken = async (userId) => {
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  if (typeof Notification === 'undefined' || !messaging) return 'unsupported';
  if (!vapidKey || !userId) return 'not-configured';

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';

    // Reuse the worker vite-plugin-pwa already registered (/sw.js) — it imports
    // firebase-messaging-sw.js, so it handles background pushes itself.
    // Registering the Firebase worker separately would evict /sw.js from the '/'
    // scope and cost us the PWA install prompt on Android.
    const existing = await navigator.serviceWorker.getRegistration('/');
    const registration = existing
      ? await navigator.serviceWorker.ready
      : await navigator.serviceWorker.register('/sw.js');
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
    if (!token) return 'error';

    await api.put(`/users/${userId}`, { fcmToken: token });
    return 'granted';
  } catch (error) {
    console.log('[FCM] Push notifications not enabled:', error.message);
    return 'error';
  }
};

/** Shows an in-app toast for pushes that arrive while the tab is focused. */
export const listenForForegroundMessages = (onMessageReceived) => {
  if (!messaging) return () => {};
  return onMessage(messaging, (payload) => {
    onMessageReceived?.(payload.notification, payload.data);
  });
};
