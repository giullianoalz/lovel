import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';
import { InstallIOSHelp } from './InstallIOSHelp';
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

      {showIOSHelp && <InstallIOSHelp onClose={() => setShowIOSHelp(false)} />}
    </>
  );
};

/**
 * Same action as the nav item, but pinned in the mobile top bar so it's on
 * screen without opening the menu — the sidebar entry is invisible on phones
 * until you tap the hamburger, which is where most families live.
 */
export const InstallHeaderButton = () => {
  const { canInstall, isIOS, promptInstall } = useInstallPrompt();
  const [showIOSHelp, setShowIOSHelp] = useState(false);

  if (!canInstall) return null;

  return (
    <>
      <button
        className="install-header-btn"
        onClick={() => (isIOS ? setShowIOSHelp(true) : promptInstall())}
        aria-label="Install the app"
      >
        <Download size={16} />
        <span>Install</span>
      </button>

      {showIOSHelp && <InstallIOSHelp onClose={() => setShowIOSHelp(false)} />}
    </>
  );
};

export default InstallNavItem;
