import React, { useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';

/**
 * A canvas the parent draws their signature on.
 *
 * Written by hand rather than pulled in as a dependency: the whole job is three
 * pointer handlers and toDataURL, and the popular packages are React-18-era
 * wrappers that would have to be replaced anyway.
 *
 * Pointer events cover mouse, trackpad and touch with the same code — the only
 * extra care needed is `touch-action: none` in the CSS, without which a finger
 * drag scrolls the page instead of drawing.
 */
const SignaturePad = ({ onChange, disabled = false }) => {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  // The canvas is sized in CSS pixels but drawn at device resolution, otherwise
  // the signature is visibly soft on phones — which is where most parents sign.
  useEffect(() => {
    const canvas = canvasRef.current;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      const ctx = canvas.getContext('2d');
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0f172a';
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const pointAt = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e) => {
    if (disabled) return;
    drawing.current = true;
    canvasRef.current.setPointerCapture(e.pointerId);
    const { x, y } = pointAt(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(x, y);
    // A tap with no drag should still leave a mark, so lay down a dot up front.
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const move = (e) => {
    if (!drawing.current) return;
    const { x, y } = pointAt(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setHasInk(true);
    onChange?.(canvasRef.current.toDataURL('image/png'));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onChange?.(null);
  };

  return (
    <div className="sigpad">
      <canvas
        ref={canvasRef}
        className={`sigpad-canvas ${disabled ? 'disabled' : ''}`}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <div className="sigpad-baseline" />
      <div className="sigpad-foot">
        <span className="sigpad-hint">
          {hasInk ? 'Parent/Guardian Signature' : 'Draw your signature above'}
        </span>
        <button type="button" className="sigpad-clear" onClick={clear} disabled={disabled || !hasInk}>
          <Eraser size={13} /> Clear
        </button>
      </div>
    </div>
  );
};

export default SignaturePad;
