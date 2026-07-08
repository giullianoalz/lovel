import { useState, useEffect, useCallback } from 'react';

const LS_DISMISSED_AT = 'pwa_install_dismissed_at';
const REPROMPT_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

const isIOSDevice = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);

const isDismissed = () => {
  const raw = localStorage.getItem(LS_DISMISSED_AT);
  if (!raw) return false;
  return Date.now() - Number(raw) < REPROMPT_AFTER_MS;
};

/**
 * Surfaces the browser's native "install this app" flow (Android/desktop Chrome)
 * or flags iOS so callers can show manual "Add to Home Screen" instructions —
 * Safari never fires beforeinstallprompt.
 */
export const useInstallPrompt = () => {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [dismissed, setDismissed] = useState(isDismissed);
  const isIOS = isIOSDevice();

  useEffect(() => {
    if (isStandalone()) return;
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const dismiss = useCallback(() => {
    localStorage.setItem(LS_DISMISSED_AT, String(Date.now()));
    setDismissed(true);
  }, []);

  const canInstall = !isStandalone() && (!!deferredPrompt || isIOS);

  return { canInstall, isIOS, hasNativePrompt: !!deferredPrompt, promptInstall, dismissed, dismiss };
};
