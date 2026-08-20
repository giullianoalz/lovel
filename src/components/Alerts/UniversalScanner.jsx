import React, { useState, useCallback } from 'react';
import { X, QrCode, Users, AlertTriangle, CameraOff, LogIn, LogOut, CheckCircle2, Clock, ShieldCheck } from 'lucide-react';
import api from '../../lib/api';
import { useQrScanner, readToken } from './useQrScanner';
import './PickupScanner.css';
import './CheckInBoard.css';
import './FamilyScanner.css';

const fmtTime = (value) => {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  });
};

const fmtStamp = (value) =>
  value ? new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';

const UniversalScanner = ({ onClose, onChanged }) => {
  const [family, setFamily] = useState(null);
  const [pickupResult, setPickupResult] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState({});
  const [actionError, setActionError] = useState(null);
  const [manual, setManual] = useState('');

  const handleScan = useCallback(async (raw) => {
    setError(null);
    setActionError(null);
    const token = readToken(raw, ['code', 'family', 'token']);
    
    // We don't know if this is a family code or a pickup code.
    // Let's try pickup scan first. If it fails, try family scan.
    try {
      const { data } = await api.post('/sessions/pickup/scan', { token });
      setPickupResult(data);
      if (onChanged) onChanged(); 
      return;
    } catch (err) {
      try {
        const { data } = await api.post('/sessions/front-desk/scan', { code: token });
        setFamily(data);
      } catch (err2) {
        setError('That code could not be read or verified as either a pickup or family code.');
      }
    }
  }, [onChanged]);

  const { videoRef, canvasRef, cameraError } = useQrScanner({
    onScan: handleScan,
    active: !family && !pickupResult && !error,
  });

  const reset = () => {
    setFamily(null);
    setPickupResult(null);
    setError(null);
    setActionError(null);
    setManual('');
  };

  const markFamily = async (studentId, sessionId, action, status = 'PRESENT') => {
    const key = `${sessionId}:${studentId}`;
    setPending((prev) => ({ ...prev, [key]: true }));
    setActionError(null);
    try {
      const { data } = await api.post(`/sessions/${sessionId}/check-in`, {
        studentId, action, status, source: 'FAMILY_QR',
      });
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

  const fmtTimeLocal = (v) =>
    v ? new Date(v).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="scanner-modal family-scanner">
        <button className="modal-close" onClick={onClose}><X size={18} /></button>

        <div className="scanner-header">
          <div className="scanner-icon"><QrCode size={22} /></div>
          <div>
            <h2>Scan QR Code</h2>
            <p>Scan a family code for check-in or a pickup code for check-out.</p>
          </div>
        </div>

        {!family && !pickupResult && !error && (
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

            <form
              className="fs-manual"
              onSubmit={(e) => { e.preventDefault(); if (manual.trim()) handleScan(manual.trim()); }}
            >
              <input
                type="text"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Or type the code manually"
                aria-label="Manual code"
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

        {/* --- PICKUP RESULT UI --- */}
        {pickupResult && (
          <div className="scanner-result scanner-result-good">
            <div className="scanner-badge"><ShieldCheck size={18} /> Authorised</div>
            <h3 className="scanner-person">{pickupResult.pickupPerson}</h3>
            {pickupResult.relationship && <p className="scanner-relationship">{pickupResult.relationship}</p>}
            {pickupResult.authorisedBy && (
              <p className="scanner-authorised-by">Authorised by {pickupResult.authorisedBy}</p>
            )}

            {pickupResult.released.length > 0 && (
              <div className="scanner-list">
                <p className="scanner-list-label">Checked out</p>
                {pickupResult.released.map((s) => (
                  <div key={s.studentId} className="scanner-list-row">
                    <span>{s.fullName}</span>
                    <span className="scanner-stamp">{fmtTimeLocal(s.checkedOutAt)}</span>
                  </div>
                ))}
              </div>
            )}

            {pickupResult.alreadyOut.length > 0 && (
              <div className="scanner-list scanner-list-muted">
                <p className="scanner-list-label">Already picked up</p>
                {pickupResult.alreadyOut.map((s) => (
                  <div key={s.studentId} className="scanner-list-row">
                    <span>{s.fullName}</span>
                    <span className="scanner-stamp">
                      {s.checkedOutTo ? `${s.checkedOutTo}, ` : ''}{fmtTimeLocal(s.checkedOutAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            
            <div className="fs-footer" style={{marginTop: '20px'}}>
              <button className="scanner-btn" onClick={reset}>Scan another</button>
              <button className="scanner-btn scanner-btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        )}

        {/* --- FAMILY RESULT UI --- */}
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
                                  onClick={() => markFamily(student.id, sess.sessionId, 'IN')}
                                >
                                  <LogIn size={14} /> {left ? 'Back in' : 'Check in'}
                                </button>
                                {!left && (
                                  <button
                                    className="checkin-btn ghost"
                                    disabled={busy}
                                    onClick={() => markFamily(student.id, sess.sessionId, 'IN', 'LATE')}
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
                                onClick={() => markFamily(student.id, sess.sessionId, 'OUT')}
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

export default UniversalScanner;
