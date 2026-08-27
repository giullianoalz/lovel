import { useState, useEffect, useCallback } from 'react';
import { isIOSDevice, isStandalone, watchStandalone } from '../lib/platform';

const LS_DISMISSED_AT = 'pwa_install_dismissed_at';
const REPROMPT_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

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
  const [standalone, setStandalone] = useState(isStandalone);
  const isIOS = isIOSDevice();

  useEffect(() => {
    if (standalone) return;
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [standalone]);

  // The window can become app-like after we've already rendered: the install
  // finishes, or the launcher swaps display modes. Re-check instead of trusting
  // the value we read on mount.
  useEffect(() => watchStandalone(() => {
    setStandalone(isStandalone());
    setDeferredPrompt(null);
  }), []);

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

  const canInstall = !standalone && (!!deferredPrompt || isIOS);

  return { canInstall, isIOS, standalone, hasNativePrompt: !!deferredPrompt, promptInstall, dismissed, dismiss };
};
