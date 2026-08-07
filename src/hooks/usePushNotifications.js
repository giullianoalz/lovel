import { useState, useEffect, useCallback, useRef } from 'react';
import { messaging } from '../lib/firebase';
import { requestAndSaveFcmToken } from '../lib/fcm';

const isSupported = () =>
  typeof Notification !== 'undefined' && !!messaging && !!import.meta.env.VITE_FIREBASE_VAPID_KEY;

const readPermission = () =>
  typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';

/**
 * Surfaces the current Notification permission and lets the user (re)trigger
 * the browser's push prompt on demand. The one automatic attempt made on
 * login (Sidebar.jsx) fires silently — if it's dismissed or blocked there was
 * previously no way to tell, or to try again, from inside the app.
 *
 * The permission is watched, not read once: a user who unblocks the site does
 * it in browser chrome we can't see, so we re-read it on the Permissions API
 * change event (and on tab focus, for browsers without it). That keeps the UI
 * honest without asking anyone to reload, and re-registers the device token
 * the moment the permission comes back, since the automatic attempt on login
 * already ran and won't run again this session.
 */
export const usePushNotifications = (userId) => {
  const [permission, setPermission] = useState(readPermission);
  const [enabling, setEnabling] = useState(false);
  /** Outcome of the last manual attempt: granted | dismissed | denied | error | not-configured */
  const [lastResult, setLastResult] = useState(null);
  const tokenSavedFor = useRef(null);

  /* Keep `permission` in sync with changes made outside the app. */
  useEffect(() => {
    if (typeof Notification === 'undefined') return;
    let status = null;
    let cancelled = false;
    const sync = () => { if (!cancelled) setPermission(Notification.permission); };

    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    navigator.permissions?.query({ name: 'notifications' })
      .then((result) => {
        if (cancelled) return;
        status = result;
        status.onchange = sync;
      })
      .catch(() => { /* Permissions API unavailable — focus/visibility fallback covers it */ });

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
      if (status) status.onchange = null;
    };
  }, []);

  /* Once granted (here or in browser settings), make sure the device token is saved. */
  useEffect(() => {
    if (permission !== 'granted' || !userId || tokenSavedFor.current === userId) return;
    tokenSavedFor.current = userId;
    requestAndSaveFcmToken(userId).then((result) => {
      if (result !== 'granted') tokenSavedFor.current = null;
    });
  }, [permission, userId]);

  const enable = useCallback(async () => {
    if (!userId || enabling) return 'error';
    setEnabling(true);
    try {
      const result = await requestAndSaveFcmToken(userId);
      const current = readPermission();
      setPermission(current);
      if (result === 'granted') tokenSavedFor.current = userId;
      // fcm.js reports any non-grant as 'denied'. A prompt the user simply
      // closed leaves the permission at 'default' and can be retried, so it
      // has to read differently from a real block, which cannot.
      const outcome = result === 'denied' && current !== 'denied' ? 'dismissed' : result;
      setLastResult(outcome);
      return outcome;
    } finally {
      setEnabling(false);
    }
  }, [userId, enabling]);

  return { supported: isSupported(), permission, enabling, lastResult, enable };
};
