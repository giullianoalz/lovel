import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BellRing, X, AlertTriangle, Check } from 'lucide-react';
import './PushNotificationNavItem.css';

/**
 * The "why didn't notifications turn on" card, shared by every place that can
 * ask for permission — the sidebar nav item and the prompt banner.
 *
 * When permission is blocked the fix lives in browser chrome we can't reach, so
 * all this can do is explain it — which only helps if the explanation matches
 * the browser the person is actually holding. Hence per-browser steps instead
 * of one set of generic ones.
 *
 * Rendered through a portal for the same reason InstallIOSHelp is: `position:
 * fixed` resolves against the nearest ancestor carrying a transform or
 * backdrop-filter rather than the viewport, and both triggers sit inside one —
 * the sidebar drawer animates on `translateY`, and the banner sits in the
 * content column.
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

/**
 * @param {'blocked'|'dismissed'|'failed'|'success'} state - why the card opened.
 *   'blocked' needs browser settings, 'dismissed' is retryable in place,
 *   'failed' is a setup problem, 'success' confirms an unblock landed.
 */
export const PushHelpCard = ({ state, enabling, onRetry, onClose }) => {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const help = unblockSteps(detectPlatform(), typeof window !== 'undefined' ? window.location.hostname : '');
  const isBlocked = state === 'blocked';
  const dismissed = state === 'dismissed';
  const failed = state === 'failed';

  return createPortal(
    <div className="push-help-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="push-help-card" onClick={(e) => e.stopPropagation()}>
        <button className="push-help-close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>

        {state === 'success' ? (
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
                <button className="push-help-primary" onClick={onRetry} disabled={enabling}>
                  {enabling ? 'Enabling…' : 'Try again'}
                </button>
              )}
              <button className="push-help-secondary" onClick={onClose}>
                {isBlocked ? 'Close' : 'Not now'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default PushHelpCard;
