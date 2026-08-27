/**
 * "What kind of device is this, and are we running installed?" — asked by the
 * install prompt and, since iOS gates web push behind a Home Screen install,
 * by the push prompts too. It lived inside useInstallPrompt.js until the
 * notification side needed the same two answers.
 */

// "Outside the browser" covers more than display-mode: standalone — a launcher
// can hand us fullscreen or minimal-ui, iOS answers only navigator.standalone,
// and an Android TWA gives itself away through the referrer.
export const DISPLAY_MODES = ['standalone', 'fullscreen', 'minimal-ui'];

export const isStandalone = () =>
  DISPLAY_MODES.some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches) ||
  window.navigator.standalone === true ||
  document.referrer.startsWith('android-app://');

// iPadOS 13+ reports itself as "Macintosh"; the touch points are what give it
// away. Without that second check an iPad matched neither branch and never got
// an install button at all.
export const isIOSDevice = () => {
  const ua = window.navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  return /macintosh/i.test(ua) && window.navigator.maxTouchPoints > 1;
};

/**
 * Calls `onChange` whenever the window may have become app-like: the install
 * finishes, or the launcher swaps display modes. Both callers re-read
 * `isStandalone()` rather than trusting what they saw on mount.
 *
 * @returns {() => void} cleanup
 */
export const watchStandalone = (onChange) => {
  const queries = DISPLAY_MODES.map((mode) => window.matchMedia(`(display-mode: ${mode})`));
  // addListener is the pre-Safari-14 spelling; iPadOS 13 still needs it.
  queries.forEach((q) => (q.addEventListener ? q.addEventListener('change', onChange) : q.addListener(onChange)));
  window.addEventListener('appinstalled', onChange);
  return () => {
    queries.forEach((q) => (q.removeEventListener ? q.removeEventListener('change', onChange) : q.removeListener(onChange)));
    window.removeEventListener('appinstalled', onChange);
  };
};
