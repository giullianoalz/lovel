import { useState, useEffect, useCallback } from 'react';

const LS_DISMISSED_AT = 'pwa_install_dismissed_at';
const REPROMPT_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// "Outside the browser" covers more than display-mode: standalone — a launcher
// can hand us fullscreen or minimal-ui, iOS answers only navigator.standalone,
// and an Android TWA gives itself away through the referrer.
const DISPLAY_MODES = ['standalone', 'fullscreen', 'minimal-ui'];

const isStandalone = () =>
  DISPLAY_MODES.some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches) ||
  window.navigator.standalone === true ||
  document.referrer.startsWith('android-app://');

// iPadOS 13+ reports itself as "Macintosh"; the touch points are what give it
// away. Without that second check an iPad matched neither branch and never got
// an install button at all.
const isIOSDevice = () => {
  const ua = window.navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  return /macintosh/i.test(ua) && window.navigator.maxTouchPoints > 1;
};

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
  useEffect(() => {
    const sync = () => {
      setStandalone(isStandalone());
      setDeferredPrompt(null);
    };
    const queries = DISPLAY_MODES.map((mode) => window.matchMedia(`(display-mode: ${mode})`));
    // addListener is the pre-Safari-14 spelling; iPadOS 13 still needs it.
    queries.forEach((q) => (q.addEventListener ? q.addEventListener('change', sync) : q.addListener(sync)));
    window.addEventListener('appinstalled', sync);
    return () => {
      queries.forEach((q) => (q.removeEventListener ? q.removeEventListener('change', sync) : q.removeListener(sync)));
      window.removeEventListener('appinstalled', sync);
    };
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

  const canInstall = !standalone && (!!deferredPrompt || isIOS);

  return { canInstall, isIOS, hasNativePrompt: !!deferredPrompt, promptInstall, dismissed, dismiss };
};
