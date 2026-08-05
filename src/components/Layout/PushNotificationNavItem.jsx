import React, { useState } from 'react';
import { Bell, BellOff, X } from 'lucide-react';
import { usePushNotifications } from '../../hooks/usePushNotifications';

/**
 * Manual control for push notifications, next to InstallNavItem. The
 * automatic prompt on login (Sidebar.jsx) is one-shot by browser design —
 * this is the only way to retry after a dismissal, or to find out the
 * permission got blocked at all.
 */
export const PushNotificationNavItem = ({ userId, onNavigate }) => {
  const { supported, permission, enabling, enable } = usePushNotifications(userId);
  const [showBlockedHelp, setShowBlockedHelp] = useState(false);

  // Nothing to offer once notifications are on, and nothing to show on a
  // browser that can't do web push at all (e.g. Safari pre-16.4).
  if (!supported || permission === 'granted') return null;

  const isBlocked = permission === 'denied';

  const handleClick = () => {
    if (isBlocked) { setShowBlockedHelp(true); return; }
    onNavigate?.();
    enable();
  };

  return (
    <>
      <button className="nav-item install-nav-item" onClick={handleClick} disabled={enabling}>
        {isBlocked ? <BellOff size={20} /> : <Bell size={20} />}
        <span>{isBlocked ? 'Notifications blocked' : enabling ? 'Enabling…' : 'Enable notifications'}</span>
      </button>

      {showBlockedHelp && (
        <div className="install-ios-overlay" onClick={() => setShowBlockedHelp(false)}>
          <div className="install-ios-card" onClick={(e) => e.stopPropagation()}>
            <button className="install-ios-close" onClick={() => setShowBlockedHelp(false)} aria-label="Close">
              <X size={16} />
            </button>
            <h3>Notifications are blocked</h3>
            <ol>
              <li>Tap the lock icon next to the address bar.</li>
              <li>Open <strong>Site settings</strong> (or <strong>Permissions</strong>).</li>
              <li>Set <strong>Notifications</strong> to <strong>Allow</strong>, then reload the page.</li>
            </ol>
            <button className="install-ios-done" onClick={() => setShowBlockedHelp(false)}>Got it</button>
          </div>
        </div>
      )}
    </>
  );
};

export default PushNotificationNavItem;
