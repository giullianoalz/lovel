import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, QrCode, ShieldCheck, AlertTriangle, CameraOff } from 'lucide-react';
import api from '../../lib/api';
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

// Chrome and Android expose a native detector, which is faster and uses far
// less battery on a phone propped at a desk all afternoon. Safari and iOS have
// no such API, so jsQR decodes the frames there instead — without the fallback
// the feature would silently do nothing on an iPhone.
const loadJsQr = () => import('jsqr').then((m) => m.default);

const SCAN_INTERVAL_MS = 250;

const PickupScanner = ({ onClose, onReleased }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const loopRef = useRef(null);
  // Held in a ref, not state: the scan loop is a closure created once, and a
  // stale `busy` from state would let a second frame fire the same token again.
  const busyRef = useRef(false);

  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [cameraError, setCameraError] = useState(null);

  const stopCamera = useCallback(() => {
    if (loopRef.current) clearInterval(loopRef.current);
    loopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const submitToken = useCallback(async (token) => {
    busyRef.current = true;
    stopCamera();
    setError(null);
    try {
      const { data } = await api.post('/sessions/pickup/scan', { token });
      setResult(data);
      if (onReleased) onReleased(data);
    } catch (err) {
      setError(err.response?.data?.message || 'That code could not be verified.');
    }
  }, [onReleased, stopCamera]);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
      } catch {
        setCameraError('No camera access. Allow the camera for this site, then reopen the scanner.');
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      // iOS refuses to play an inline video without both of these.
      video.setAttribute('playsinline', 'true');
      video.muted = true;
      await video.play().catch(() => {});

      const native = 'BarcodeDetector' in window
        ? new window.BarcodeDetector({ formats: ['qr_code'] })
        : null;
      const jsQR = native ? null : await loadJsQr();
      if (cancelled) return;

      loopRef.current = setInterval(async () => {
        if (busyRef.current || !video.videoWidth) return;

        let raw = null;
        if (native) {
          const codes = await native.detect(video).catch(() => []);
          raw = codes[0]?.rawValue || null;
        } else {
          const canvas = canvasRef.current;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          raw = jsQR(img.data, img.width, img.height)?.data || null;
        }

        if (!raw) return;

        // The portal encodes a JSON envelope, but only the token is trusted —
        // everything shown to the desk comes back from the server. A bare
        // token is accepted too, so a re-issued code format can't break this.
        let token = raw;
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.token) token = parsed.token;
        } catch {
          // Not JSON: treat the payload as the token itself.
        }
        submitToken(token);
      }, SCAN_INTERVAL_MS);
    };

    start();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [stopCamera, submitToken]);

  useEffect(() => stopCamera, [stopCamera]);

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
