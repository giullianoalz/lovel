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
          <strong>Instalar la app</strong>
          <span>Recibe alertas y chatea con la academia desde tu teléfono.</span>
        </div>
        <div className="install-banner-actions">
          <button
            className="install-banner-btn"
            onClick={() => (isIOS ? setShowIOSHelp(true) : promptInstall())}
          >
            {isIOS ? 'Cómo instalar' : 'Descargar app'}
          </button>
          <button className="install-banner-dismiss" onClick={dismiss} aria-label="Ahora no">
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
            <h3>Instalar en iPhone/iPad</h3>
            <ol>
              <li><Share size={16} /> Toca el botón <strong>Compartir</strong> en Safari.</li>
              <li>Selecciona <strong>Agregar a inicio</strong>.</li>
            </ol>
            <button className="install-ios-done" onClick={() => { dismiss(); setShowIOSHelp(false); }}>
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default InstallPromptBanner;
