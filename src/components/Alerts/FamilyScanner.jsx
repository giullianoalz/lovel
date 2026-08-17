import React, { useState, useCallback } from 'react';
import { X, QrCode, Users, AlertTriangle, CameraOff, LogIn, LogOut, CheckCircle2, Clock } from 'lucide-react';
import api from '../../lib/api';
import { useQrScanner, readToken } from './useQrScanner';
import './PickupScanner.css';
// The check-in buttons are the board's, and they should look identical here —
// it is the same action, so importing its sheet beats restyling them.
import './CheckInBoard.css';
import './FamilyScanner.css';

/**
 * The arrival scanner: a family shows the household QR at the door and whoever
 * is on the desk checks in the children who actually walked in.
 *
 * Deliberately two steps, unlike the pickup scanner. That code is issued for one
 * named person on one day, so acting on the scan alone is safe. A family code is
 * permanent and covers every sibling — a parent dropping off one child would
 * otherwise mark the other one present from the car park. So the scan only
 * asks the server who the code covers, and the desk taps the child in front of
 * them.
 */

const fmtTime = (value) => {
  if (!value) return '';
  // startTime/endTime are TIME columns, which arrive as 1970-01-01T:HH:MM:SSZ.
  // Read them in UTC — treating them as local shifts every class by the
  // browser's offset and puts the morning block at 4am.
  return new Date(value).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  });
};

const fmtStamp = (value) =>
  value ? new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';

const FamilyScanner = ({ onClose, onChanged }) => {
  const [family, setFamily] = useState(null);
  const [error, setError] = useState(null);
  // Keyed by `${sessionId}:${studentId}` so two taps on different children
  // don't disable each other's buttons.
  const [pending, setPending] = useState({});
  const [actionError, setActionError] = useState(null);
  const [manual, setManual] = useState('');

  const handleScan = useCallback(async (raw) => {
    setError(null);
    try {
      const { data } = await api.post('/sessions/front-desk/scan', {
        code: readToken(raw, ['code', 'family', 'token']),
      });
      setFamily(data);
    } catch (err) {
      setError(err.response?.data?.message || 'That code could not be read.');
    }
  }, []);

  const { videoRef, canvasRef, cameraError } = useQrScanner({
    onScan: handleScan,
    active: !family && !error,
  });

  const reset = () => {
    setFamily(null);
    setError(null);
    setActionError(null);
    setManual('');
  };

  const mark = async (studentId, sessionId, action, status = 'PRESENT') => {
    const key = `${sessionId}:${studentId}`;
    setPending((prev) => ({ ...prev, [key]: true }));
    setActionError(null);
    try {
      // FAMILY_QR, not MANUAL: the door log should be able to show that the
      // household presented its code, rather than that someone tapped a name.
      const { data } = await api.post(`/sessions/${sessionId}/check-in`, {
        studentId, action, status, source: 'FAMILY_QR',
      });
      // Patch the one row rather than rescanning: the family is standing there,
      // and sending them back for another scan to see the result is absurd.
      setFamily((prev) => ({
        ...prev,
        students: prev.students.map((s) => s.id !== studentId ? s : {
          ...s,
          sessions: s.sessions.map((sess) => sess.sessionId !== sessionId ? sess : {
            ...sess,
            status: data.attendance.status,
            checkedAt: data.attendance.checkedAt,
            checkedOutAt: data.attendance.checkedOutAt,
            checkedOutTo: data.attendance.checkedOutTo,
          }),
        }),
      }));
      if (onChanged) onChanged();
    } catch (err) {
      setActionError(err.response?.data?.message || 'Could not record that. Try again.');
    } finally {
      setPending((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="scanner-modal family-scanner">
        <button className="modal-close" onClick={onClose}><X size={18} /></button>

        <div className="scanner-header">
          <div className="scanner-icon"><QrCode size={22} /></div>
          <div>
            <h2>Scan family code</h2>
            <p>Ask the family to show the QR from their portal.</p>
          </div>
        </div>

        {!family && !error && (
          <>
            {cameraError ? (
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
            )}

            {/* A blocked camera or a cracked phone screen shouldn't stop the
                door. The family can read the code out from their portal. */}
            <form
              className="fs-manual"
              onSubmit={(e) => { e.preventDefault(); if (manual.trim()) handleScan(manual.trim()); }}
            >
              <input
                type="text"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Or type the family code"
                aria-label="Family code"
              />
              <button type="submit" className="checkin-btn" disabled={!manual.trim()}>Look up</button>
            </form>
          </>
        )}

        {error && (
          <div className="scanner-result scanner-result-bad">
            <AlertTriangle size={36} />
            <p className="scanner-message">{error}</p>
            <div className="fs-footer">
              <button className="scanner-btn" onClick={reset}>Try again</button>
              <button className="scanner-btn scanner-btn-primary" onClick={onClose}>Close</button>
            </div>
          </div>
        )}

        {family && (
          <div className="fs-result">
            <div className="fs-family">
              <Users size={16} />
              <span>{family.familyName}</span>
            </div>

            {actionError && <p className="fs-action-error">{actionError}</p>}

            <div className="fs-students">
              {family.students.map((student) => (
                <div key={student.id} className="fs-student">
                  <div className="fs-student-head">
                    <div className="fs-avatar">{student.fullName?.[0] || '?'}</div>
                    <span className="fs-student-name">{student.fullName}</span>
                  </div>

                  {student.sessions.length === 0 ? (
                    <p className="fs-nothing">Nothing scheduled today.</p>
                  ) : (
                    student.sessions.map((sess) => {
                      const key = `${sess.sessionId}:${student.id}`;
                      const busy = !!pending[key];
                      const arrived = !!sess.checkedAt;
                      const left = !!sess.checkedOutAt;

                      return (
                        <div key={sess.sessionId} className={`fs-session ${left ? 'is-out' : arrived ? 'is-in' : ''}`}>
                          <div className="fs-session-info">
                            <span className="fs-class">{sess.className}</span>
                            <span className="fs-meta">
                              <Clock size={12} />
                              {fmtTime(sess.startTime)} &ndash; {fmtTime(sess.endTime)}
                            </span>
                            <span className="fs-state">
                              {left ? (
                                <>Picked up {fmtStamp(sess.checkedOutAt)}{sess.checkedOutTo && ` by ${sess.checkedOutTo}`}</>
                              ) : arrived ? (
                                <><CheckCircle2 size={12} /> {sess.status === 'LATE' ? 'Late' : 'In'} since {fmtStamp(sess.checkedAt)}</>
                              ) : (
                                'Not arrived'
                              )}
                            </span>
                          </div>

                          <div className="fs-actions">
                            {(!arrived || left) && (
                              <>
                                <button
                                  className="checkin-btn primary"
                                  disabled={busy}
                                  onClick={() => mark(student.id, sess.sessionId, 'IN')}
                                >
                                  <LogIn size={14} /> {left ? 'Back in' : 'Check in'}
                                </button>
                                {!left && (
                                  <button
                                    className="checkin-btn ghost"
                                    disabled={busy}
                                    onClick={() => mark(student.id, sess.sessionId, 'IN', 'LATE')}
                                    title="Arrived after the class started"
                                  >
                                    Late
                                  </button>
                                )}
                              </>
                            )}
                            {arrived && !left && (
                              <button
                                className="checkin-btn"
                                disabled={busy}
                                onClick={() => mark(student.id, sess.sessionId, 'OUT')}
                              >
                                <LogOut size={14} /> Check out
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              ))}
            </div>

            <div className="fs-footer">
              <button className="scanner-btn" onClick={reset}>Scan another</button>
              <button className="scanner-btn scanner-btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FamilyScanner;
