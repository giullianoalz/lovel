import React, { useState, useCallback } from 'react';
import { X, QrCode, ShieldCheck, AlertTriangle, CameraOff } from 'lucide-react';
import api from '../../lib/api';
import { useQrScanner, readToken } from './useQrScanner';
import './PickupScanner.css';

/**
 * Scans a parent's pickup QR at the door. A successful scan checks the child
 * out on its own — see scanPickup on the server for why nothing is written
 * until the code has been proven valid for today.
 *
 * The result panel leads with who is collecting, because that is the fact the
 * desk has to check against the person in front of them. The app can prove the
 * code is genuine; only the receptionist can prove the face matches.
 */

const PickupScanner = ({ onClose, onReleased }) => {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleScan = useCallback(async (raw) => {
    setError(null);
    try {
      const { data } = await api.post('/sessions/pickup/scan', { token: readToken(raw) });
      setResult(data);
      if (onReleased) onReleased(data);
    } catch (err) {
      setError(err.response?.data?.message || 'That code could not be verified.');
    }
  }, [onReleased]);

  const { videoRef, canvasRef, cameraError } = useQrScanner({
    onScan: handleScan,
    active: !result && !error,
  });

  const fmtTime = (v) =>
    v ? new Date(v).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="scanner-modal">
        <button className="modal-close" onClick={onClose}><X size={18} /></button>

        <div className="scanner-header">
          <div className="scanner-icon"><QrCode size={22} /></div>
          <div>
            <h2>Scan pickup code</h2>
            <p>Ask the person collecting to show their QR.</p>
          </div>
        </div>

        {!result && !error && (
          cameraError ? (
            <div className="scanner-camera-error">
              <CameraOff size={40} />
              <p>{cameraError}</p>
            </div>
          ) : (
            <div className="scanner-viewport">
              <video ref={videoRef} className="scanner-video" playsInline muted />
              <canvas ref={canvasRef} className="scanner-canvas" />
              <div className="scanner-reticle" />
            </div>
          )
        )}

        {error && (
          <div className="scanner-result scanner-result-bad">
            <AlertTriangle size={36} />
            <p className="scanner-message">{error}</p>
            <button className="scanner-btn" onClick={onClose}>Close</button>
          </div>
        )}

        {result && (
          <div className="scanner-result scanner-result-good">
            <div className="scanner-badge"><ShieldCheck size={18} /> Authorised</div>

            {/* The name comes first and largest: this is the check the app
                cannot do, so it has to be the thing the desk reads. */}
            <h3 className="scanner-person">{result.pickupPerson}</h3>
            {result.relationship && <p className="scanner-relationship">{result.relationship}</p>}
            {result.authorisedBy && (
              <p className="scanner-authorised-by">Authorised by {result.authorisedBy}</p>
            )}

            {result.released.length > 0 && (
              <div className="scanner-list">
                <p className="scanner-list-label">Checked out</p>
                {result.released.map((s) => (
                  <div key={s.studentId} className="scanner-list-row">
                    <span>{s.fullName}</span>
                    <span className="scanner-stamp">{fmtTime(s.checkedOutAt)}</span>
                  </div>
                ))}
              </div>
            )}

            {result.alreadyOut.length > 0 && (
              <div className="scanner-list scanner-list-muted">
                <p className="scanner-list-label">Already picked up</p>
                {result.alreadyOut.map((s) => (
                  <div key={s.studentId} className="scanner-list-row">
                    <span>{s.fullName}</span>
                    <span className="scanner-stamp">
                      {s.checkedOutTo ? `${s.checkedOutTo}, ` : ''}{fmtTime(s.checkedOutAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <button className="scanner-btn scanner-btn-primary" onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PickupScanner;
