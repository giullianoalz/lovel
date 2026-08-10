import React from 'react';
import { createPortal } from 'react-dom';
import { X, Share } from 'lucide-react';
import './InstallPromptBanner.css';

/**
 * Safari never fires beforeinstallprompt, so iOS gets these manual steps instead.
 *
 * Rendered through a portal on purpose. `position: fixed` resolves against the
 * nearest ancestor carrying a transform/filter/backdrop-filter rather than the
 * viewport, and every place this is opened from sits inside one: the mobile
 * header pill lives in a `translateY(-50%)` wrapper, the header itself has a
 * backdrop blur, and the sidebar drawer animates on `translateY`. Left in
 * place, the overlay sized itself to that tiny box instead of the screen.
 */
export const InstallIOSHelp = ({ onClose }) => createPortal(
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
  </div>,
  document.body,
);

export default InstallIOSHelp;
