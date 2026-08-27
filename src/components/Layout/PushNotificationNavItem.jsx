import React, { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { PushHelpCard } from './PushHelpCard';
import { InstallIOSHelp } from './InstallIOSHelp';
import './PushNotificationNavItem.css';

/**
 * Manual control for push notifications, next to InstallNavItem. The browser's
 * permission prompt is one-shot by design — this is the only way to retry after
 * a dismissal, or to find out the permission got blocked at all.
 *
 * On an iPhone that hasn't installed the app there is nothing to prompt for
 * yet: iOS only delivers web push to an app on the Home Screen. This used to
 * render nothing at all in that case, which is a large part of why most of the
 * roster has no device registered — so it now points at the install instead.
 */
export const PushNotificationNavItem = ({ userId, onNavigate }) => {
  const { supported, needsInstall, permission, enabling, lastResult, enable } = usePushNotifications(userId);
  const [helpOpen, setHelpOpen] = useState(false);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);

  const isBlocked = permission === 'denied';
  const justGranted = helpOpen && permission === 'granted';

  // The card stays up after an unblock to confirm it worked (the nav item that
  // opened it is already gone by then), and closes itself shortly after.
  useEffect(() => {
    if (!justGranted) return;
    const timer = setTimeout(() => setHelpOpen(false), 2600);
    return () => clearTimeout(timer);
  }, [justGranted]);

  // Nothing to offer once notifications are on, and nothing to show on a
  // browser that can't do web push at all (e.g. Safari pre-16.4) — unless this
  // is an iOS device that just needs installing first.
  if ((!supported || permission === 'granted') && !needsInstall && !helpOpen) return null;

  const handleClick = async () => {
    if (needsInstall) { setInstallHelpOpen(true); return; }
    if (isBlocked) { setHelpOpen(true); return; }
    onNavigate?.();
    const outcome = await enable();
    // A prompt that was closed, blocked, or that failed leaves the user with
    // no feedback at all otherwise — the browser dialog just disappears.
    if (outcome && outcome !== 'granted') setHelpOpen(true);
  };

  /* What the card says depends on why it opened: a fresh block, a dismissed
     prompt (retryable, no browser settings needed), or a setup problem. */
  const helpState = justGranted ? 'success'
    : isBlocked ? 'blocked'
    : lastResult === 'dismissed' ? 'dismissed'
    : (lastResult === 'error' || lastResult === 'not-configured') ? 'failed'
    : 'blocked';

  return (
    <>
      {(needsInstall || (supported && permission !== 'granted')) && (
        <button
          className={`nav-item push-nav-item${isBlocked ? ' is-blocked' : ''}`}
          onClick={handleClick}
          disabled={enabling}
        >
          {isBlocked ? <BellOff size={20} /> : <Bell size={20} />}
          <span className="push-nav-label">
            {isBlocked ? 'Notifications off' : enabling ? 'Enabling…' : 'Enable notifications'}
            <small>
              {needsInstall ? 'Add to your Home Screen first — tap for steps'
                : isBlocked ? 'Blocked by your browser — tap to fix'
                : 'Alerts, messages and reminders'}
            </small>
          </span>
        </button>
      )}

      {helpOpen && (
        <PushHelpCard
          state={helpState}
          enabling={enabling}
          onRetry={handleClick}
          onClose={() => setHelpOpen(false)}
        />
      )}

      {installHelpOpen && <InstallIOSHelp onClose={() => setInstallHelpOpen(false)} />}
    </>
  );
};

export default PushNotificationNavItem;
