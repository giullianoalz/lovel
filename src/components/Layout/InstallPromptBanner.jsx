import React, { useState } from 'react';
import { Download, X, Share } from 'lucide-react';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';
import './InstallPromptBanner.css';

export const InstallPromptBanner = () => {
  const { canInstall, isIOS, promptInstall, dismissed, dismiss } = useInstallPrompt();
  const [showIOSHelp, setShowIOSHelp] = useState(false);

  if (!canInstall || dismissed) return null;

  return (
    <>
      <div className="install-banner" role="region" aria-label="Install the app">
        <div className="install-banner-icon"><Download size={18} /></div>
        <div className="install-banner-text">
          <strong>Install the app</strong>
          <span>Get alerts and chat with the academy right from your phone.</span>
        </div>
        <div className="install-banner-actions">
          <button
            className="install-banner-btn"
            onClick={() => (isIOS ? setShowIOSHelp(true) : promptInstall())}
          >
            {isIOS ? 'How to install' : 'Install'}
          </button>
          <button className="install-banner-dismiss" onClick={dismiss} aria-label="Not now">
            <X size={16} />
          </button>
        </div>
      </div>

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
            <button className="install-ios-done" onClick={() => { dismiss(); setShowIOSHelp(false); }}>
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default InstallPromptBanner;
