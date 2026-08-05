import { useState, useCallback } from 'react';
import { messaging } from '../lib/firebase';
import { requestAndSaveFcmToken } from '../lib/fcm';

const supported = () =>
  typeof Notification !== 'undefined' && !!messaging && !!import.meta.env.VITE_FIREBASE_VAPID_KEY;

/**
 * Surfaces the current Notification permission and lets the user (re)trigger
 * the browser's push prompt on demand. The one automatic attempt made on
 * login (Sidebar.jsx) fires silently — if it's dismissed or blocked there was
 * previously no way to tell, or to try again, from inside the app.
 */
export const usePushNotifications = (userId) => {
  const [permission, setPermission] = useState(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  const [enabling, setEnabling] = useState(false);

  const enable = useCallback(async () => {
    if (!userId || enabling) return;
    setEnabling(true);
    try {
      const result = await requestAndSaveFcmToken(userId);
      setPermission(result === 'granted' ? 'granted' : (Notification?.permission || result));
    } finally {
      setEnabling(false);
    }
  }, [userId, enabling]);

  return { supported: supported(), permission, enabling, enable };
};
