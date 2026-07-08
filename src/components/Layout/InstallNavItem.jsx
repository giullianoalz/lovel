import React, { useState } from 'react';
import { Download, X, Share } from 'lucide-react';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';
import './InstallPromptBanner.css';

/** Persistent "Install app" entry for the sidebar nav — stays available even after the banner is dismissed. */
export const InstallNavItem = ({ onNavigate }) => {
  const { canInstall, isIOS, promptInstall } = useInstallPrompt();
  const [showIOSHelp, setShowIOSHelp] = useState(false);

  if (!canInstall) return null;

  return (
    <>
      <button
        className="nav-item install-nav-item"
        onClick={() => { onNavigate?.(); isIOS ? setShowIOSHelp(true) : promptInstall(); }}
      >
        <Download size={20} />
        <span>Install app</span>
      </button>

      {showIOSHelp && (
        <div className="install-ios-overlay" onClick={() => setShowIOSHelp(false)}>
          <div className="install-ios-card" onClick={(e) => e.stopPropagation()}>
            <button className="install-ios-close" onClick={() => setShowIOSHelp(false)} aria-label="Close">
              <X size={16} />
            </button>
            <h3>Install on iPhone/iPad</h3>
            <ol>
              <li><Share size={16} /> Tap the <strong>Share</strong> button in Safari.</li>
              <li>Choose <strong>Add to Home Screen</strong>.</li>
            </ol>
            <button className="install-ios-done" onClick={() => setShowIOSHelp(false)}>Got it</button>
          </div>
        </div>
      )}
    </>
  );
};

export default InstallNavItem;
