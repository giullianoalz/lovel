import React from 'react';
import { X, Share } from 'lucide-react';
import './InstallPromptBanner.css';

/** Safari never fires beforeinstallprompt, so iOS gets these manual steps instead. */
export const InstallIOSHelp = ({ onClose }) => (
  <div className="install-ios-overlay" onClick={onClose}>
    <div className="install-ios-card" onClick={(e) => e.stopPropagation()}>
      <button className="install-ios-close" onClick={onClose} aria-label="Close">
        <X size={16} />
      </button>
      <h3>Install on iPhone/iPad</h3>
      <ol>
        <li><Share size={16} /> Tap the <strong>Share</strong> button in Safari.</li>
        <li>Choose <strong>Add to Home Screen</strong>.</li>
      </ol>
      <button className="install-ios-done" onClick={onClose}>Got it</button>
    </div>
  </div>
);

export default InstallIOSHelp;
