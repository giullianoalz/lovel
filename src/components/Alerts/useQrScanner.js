import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The camera half of a door scanner: open the rear camera, watch for a QR, hand
 * the decoded text back once, and get out of the way.
 *
 * Shared by the pickup scanner and the family check-in scanner because the part
 * that is easy to get wrong — releasing the camera, and not firing the same code
 * twice from consecutive frames — is the part they have in common. What to do
 * with the code is what differs, and that stays with the caller.
 */

// Chrome and Android expose a native detector, which is faster and uses far
// less battery on a phone propped at a desk all afternoon. Safari and iOS have
// no such API, so jsQR decodes the frames there instead — without the fallback
// the feature would silently do nothing on an iPhone.
const loadJsQr = () => import('jsqr').then((m) => m.default);

const SCAN_INTERVAL_MS = 250;

/**
 * A QR payload may be the bare token or a JSON envelope carrying it under one
 * of several keys — the parent portal has issued both shapes. Only the token is
 * ever trusted; everything shown at the desk comes back from the server.
 */
export const readToken = (raw, keys = ['token', 'code']) => {
  try {
    const parsed = JSON.parse(raw);
    for (const key of keys) {
      if (parsed?.[key]) return String(parsed[key]);
    }
  } catch {
    // Not JSON: the payload is the token itself.
  }
  return raw;
};

export const useQrScanner = ({ onScan, active = true }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const loopRef = useRef(null);
  // Held in a ref, not state: the scan loop is a closure created once, and a
  // stale flag from state would let a second frame fire the same code again.
  const busyRef = useRef(false);
  // Likewise for the callback — re-running the effect to pick up a new closure
  // would tear the camera down and back up mid-scan.
  const onScanRef = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);

  const [cameraError, setCameraError] = useState(null);

  const stop = useCallback(() => {
    if (loopRef.current) clearInterval(loopRef.current);
    loopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!active) {
      stop();
      return undefined;
    }

    let cancelled = false;
    busyRef.current = false;

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

      setCameraError(null);
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
          if (!canvas) return;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          raw = jsQR(img.data, img.width, img.height)?.data || null;
        }

        if (!raw) return;

        busyRef.current = true;
        stop();
        onScanRef.current(raw);
      }, SCAN_INTERVAL_MS);
    };

    start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [active, stop]);

  return { videoRef, canvasRef, cameraError, stop };
};

export default useQrScanner;
