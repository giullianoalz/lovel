import React, { useState } from 'react';
import { Download, X } from 'lucide-react';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';
import { InstallIOSHelp } from './InstallIOSHelp';
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
        <InstallIOSHelp onClose={() => { dismiss(); setShowIOSHelp(false); }} />
      )}
    </>
  );
};

export default InstallPromptBanner;
