import React, { useCallback, useState } from 'react';
import { Bell, BellOff, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';
import { PushHelpCard } from './PushHelpCard';
import './NotificationPromptBanner.css';

const LS_DISMISSED_AT = 'push_prompt_dismissed_at';
const REPROMPT_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // 14 days, same as the install banner

const isDismissed = () => {
  const raw = localStorage.getItem(LS_DISMISSED_AT);
  if (!raw) return false;
  return Date.now() - Number(raw) < REPROMPT_AFTER_MS;
};

/**
 * Asks signed-in users to turn on notifications, in context, from a tap.
 *
 * The app used to rely on a single silent `requestAndSaveFcmToken` on login:
 * the browser's permission prompt appeared cold, before anyone had a reason to
 * say yes, and a dismissal spent the one shot the browser gives us. The result
 * was a roster where most families had no device registered at all — messages
 * generated a notification row nobody's phone ever heard about.
 *
 * Deliberately quiet about it: it defers to the install banner (on iOS the
 * install is a hard prerequisite for push, so there is nothing to ask yet), and
 * a dismissal is remembered for two weeks.
 */
export const NotificationPromptBanner = () => {
  const { user } = useAuth();
  const { supported, needsInstall, permission, enabling, lastResult, enable } = usePushNotifications(user?.id);
  const { canInstall, dismissed: installDismissed } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(isDismissed);
  const [helpOpen, setHelpOpen] = useState(false);

  const dismiss = useCallback(() => {
    localStorage.setItem(LS_DISMISSED_AT, String(Date.now()));
    setDismissed(true);
  }, []);

  const isBlocked = permission === 'denied';

  const handleClick = async () => {
    if (isBlocked) { setHelpOpen(true); return; }
    const outcome = await enable();
    if (outcome && outcome !== 'granted') setHelpOpen(true);
  };

  // One banner at a time: while the install banner is up it already makes the
  // "get alerts on your phone" case, and on iOS it is the only thing that can.
  const installBannerVisible = canInstall && !installDismissed;

  if (!user?.id || permission === 'granted' || !supported || needsInstall) return null;
  if (installBannerVisible || (dismissed && !helpOpen)) return null;

  const helpState = permission === 'granted' ? 'success'
    : isBlocked ? 'blocked'
    : lastResult === 'dismissed' ? 'dismissed'
    : (lastResult === 'error' || lastResult === 'not-configured') ? 'failed'
    : 'blocked';

  return (
    <>
      {!dismissed && (
        <div className={`push-banner${isBlocked ? ' is-blocked' : ''}`} role="region" aria-label="Turn on notifications">
          <div className="push-banner-icon">{isBlocked ? <BellOff size={18} /> : <Bell size={18} />}</div>
          <div className="push-banner-text">
            <strong>{isBlocked ? 'Notifications are blocked' : 'Turn on notifications'}</strong>
            <span>
              {isBlocked
                ? 'Your browser is blocking them for this site — we can show you how to fix it.'
                : 'Get new messages from the academy on this device, even when the app is closed.'}
            </span>
          </div>
          <div className="push-banner-actions">
            <button className="push-banner-btn" onClick={handleClick} disabled={enabling}>
              {enabling ? 'Turning on…' : isBlocked ? 'How to fix' : 'Turn on'}
            </button>
            <button className="push-banner-dismiss" onClick={dismiss} aria-label="Not now">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {helpOpen && (
        <PushHelpCard
          state={helpState}
          enabling={enabling}
          onRetry={handleClick}
          onClose={() => setHelpOpen(false)}
        />
      )}
    </>
  );
};

export default NotificationPromptBanner;
