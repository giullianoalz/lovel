import React, { useEffect, useMemo, useState } from 'react';
import { Bell, BellOff, BellRing, X, AlertTriangle, Check } from 'lucide-react';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import './PushNotificationNavItem.css';

/**
 * Manual control for push notifications, next to InstallNavItem. The
 * automatic prompt on login (Sidebar.jsx) is one-shot by browser design —
 * this is the only way to retry after a dismissal, or to find out the
 * permission got blocked at all.
 *
 * When it is blocked the fix lives in browser chrome we can't reach, so all
 * this can do is explain it — which only helps if the explanation matches the
 * browser the person is actually holding. Hence per-browser steps instead of
 * one set of generic ones, and a live permission watch so the card confirms
 * the unblock worked instead of telling everyone to reload.
 */

/** Which set of unblock steps applies. Coarse on purpose — the browsers within each bucket share the same UI. */
const detectPlatform = () => {
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Edg\//.test(ua)) return 'edge';
  if (/Chrome\/|Chromium\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
};

/** `**bold**` in a step becomes a <strong> — the steps are mostly UI labels worth calling out. */
const renderStep = (text) =>
  text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) =>
    part.startsWith('**')
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : <React.Fragment key={i}>{part}</React.Fragment>
  );

const unblockSteps = (platform, host) => {
  switch (platform) {
    case 'ios':
      return {
        heading: 'Turn notifications back on (iPhone/iPad)',
        steps: [
          'Open the **Settings** app on your device.',
          'Tap **Notifications**, then find **Love Learning** in the list.',
          'Turn **Allow Notifications** on.',
        ],
        note: 'Notifications only work if you added Love Learning to your Home Screen. If it is not in the list, install it first with "Install app".',
      };
    case 'android':
      return {
        heading: 'Turn notifications back on (Android)',
        steps: [
          'Tap the icon to the left of the web address in Chrome.',
          'Tap **Permissions**, then **Notifications**.',
          'Switch **Notifications** to **Allow**.',
        ],
        note: `Site: ${host}`,
      };
    case 'firefox':
      return {
        heading: 'Turn notifications back on (Firefox)',
        steps: [
          'Click the padlock in the address bar.',
          'Find **Send Notifications — Blocked** and click the **×** next to it.',
          'Come back here and press **Try again**.',
        ],
        note: `Site: ${host}`,
      };
    case 'safari':
      return {
        heading: 'Turn notifications back on (Safari)',
        steps: [
          'Open the **Safari** menu, then **Settings…**.',
          'Go to the **Websites** tab and pick **Notifications** on the left.',
          `Find **${host}** and set it to **Allow**.`,
        ],
      };
    case 'edge':
      return {
        heading: 'Turn notifications back on (Edge)',
        steps: [
          'Click the padlock to the left of the web address.',
          'Open **Permissions for this site**.',
          'Set **Notifications** to **Allow**.',
        ],
        note: `Site: ${host}`,
      };
    case 'chrome':
      return {
        heading: 'Turn notifications back on (Chrome)',
        steps: [
          'Click the sliders icon to the left of the web address.',
          'Open **Site settings**.',
          'Set **Notifications** to **Allow**.',
        ],
        note: `Site: ${host}`,
      };
    default:
      return {
        heading: 'Turn notifications back on',
        steps: [
          'Open your browser\'s settings for this site — usually the icon to the left of the web address.',
          'Find the **Notifications** permission.',
          'Change it from **Block** to **Allow**.',
        ],
        note: `Site: ${host}`,
      };
  }
};

export const PushNotificationNavItem = ({ userId, onNavigate }) => {
  const { supported, permission, enabling, lastResult, enable } = usePushNotifications(userId);
  const [helpOpen, setHelpOpen] = useState(false);
  const platform = useMemo(detectPlatform, []);
  const host = typeof window !== 'undefined' ? window.location.hostname : '';

  const isBlocked = permission === 'denied';
  const justGranted = helpOpen && permission === 'granted';

  useEffect(() => {
    if (!helpOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setHelpOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [helpOpen]);

  // The card stays up after an unblock to confirm it worked (the nav item that
  // opened it is already gone by then), and closes itself shortly after.
  useEffect(() => {
    if (!justGranted) return;
    const timer = setTimeout(() => setHelpOpen(false), 2600);
    return () => clearTimeout(timer);
  }, [justGranted]);

  // Nothing to offer once notifications are on, and nothing to show on a
  // browser that can't do web push at all (e.g. Safari pre-16.4).
  if ((!supported || permission === 'granted') && !helpOpen) return null;

  const handleClick = async () => {
    if (isBlocked) { setHelpOpen(true); return; }
    onNavigate?.();
    const outcome = await enable();
    // A prompt that was closed, blocked, or that failed leaves the user with
    // no feedback at all otherwise — the browser dialog just disappears.
    if (outcome && outcome !== 'granted') setHelpOpen(true);
  };

  const help = unblockSteps(platform, host);

  /* What the card says depends on why it opened: a fresh block, a dismissed
     prompt (retryable, no browser settings needed), or a setup problem. */
  const dismissed = !isBlocked && lastResult === 'dismissed';
  const failed = !isBlocked && (lastResult === 'error' || lastResult === 'not-configured');

  return (
    <>
      {supported && permission !== 'granted' && (
        <button
          className={`nav-item push-nav-item${isBlocked ? ' is-blocked' : ''}`}
          onClick={handleClick}
          disabled={enabling}
        >
          {isBlocked ? <BellOff size={20} /> : <Bell size={20} />}
          <span className="push-nav-label">
            {isBlocked ? 'Notifications off' : enabling ? 'Enabling…' : 'Enable notifications'}
            <small>{isBlocked ? 'Blocked by your browser — tap to fix' : 'Alerts, messages and reminders'}</small>
          </span>
        </button>
      )}

      {helpOpen && (
        <div className="push-help-overlay" onClick={() => setHelpOpen(false)} role="dialog" aria-modal="true">
          <div className="push-help-card" onClick={(e) => e.stopPropagation()}>
            <button className="push-help-close" onClick={() => setHelpOpen(false)} aria-label="Close">
              <X size={16} />
            </button>

            {justGranted ? (
              <div className="push-help-success">
                <span className="push-help-success-icon"><Check size={22} /></span>
                <h3>Notifications are on</h3>
                <p>You'll get alerts, messages and reminders on this device.</p>
              </div>
            ) : (
              <>
                <div className="push-help-header">
                  <span className={`push-help-icon${failed ? ' is-warning' : ''}`}>
                    {failed ? <AlertTriangle size={20} /> : <BellRing size={20} />}
                  </span>
                  <div>
                    <h3>
                      {failed ? 'Notifications could not be turned on'
                        : dismissed ? 'Almost there'
                        : help.heading}
                    </h3>
                    <p>
                      {failed ? 'Something went wrong setting this device up. Try again in a moment, or reload the page.'
                        : dismissed ? 'The browser asked for permission and the prompt was closed. Press Try again and choose Allow.'
                        : 'This browser is blocking notifications for this site. Only you can change that, from the browser itself:'}
                    </p>
                  </div>
                </div>

                {!dismissed && !failed && (
                  <ol className="push-help-steps">
                    {help.steps.map((step, i) => (
                      <li key={i}><span className="push-help-step-num">{i + 1}</span><span>{renderStep(step)}</span></li>
                    ))}
                  </ol>
                )}

                {!dismissed && !failed && help.note && <p className="push-help-note">{help.note}</p>}

                <div className="push-help-actions">
                  {isBlocked ? (
                    <p className="push-help-watching">Waiting — this closes on its own once you allow it.</p>
                  ) : (
                    <button className="push-help-primary" onClick={handleClick} disabled={enabling}>
                      {enabling ? 'Enabling…' : 'Try again'}
                    </button>
                  )}
                  <button className="push-help-secondary" onClick={() => setHelpOpen(false)}>
                    {isBlocked ? 'Close' : 'Not now'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default PushNotificationNavItem;
