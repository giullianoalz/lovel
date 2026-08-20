import React, { useState, useEffect, useCallback } from 'react';
import { LogIn, LogOut, Clock, DoorOpen, CheckCircle2, Phone, QrCode, Users, ScrollText } from 'lucide-react';
import api from '../../lib/api';
import ErrorBanner from '../Layout/ErrorBanner';
import UniversalScanner from './UniversalScanner';
import AttendanceLog from './AttendanceLog';
import './CheckInBoard.css';

/**
 * The door, as a screen: today's classes, each with its roster, and one tap to
 * record that a child arrived or left.
 *
 * Deliberately not the teacher's attendance sheet. The desk may only write
 * PRESENT/LATE and a departure stamp — ABSENT stays with the teacher who held
 * the slot, because marking a child absent is what opens a suggested no-show
 * charge against the family. See checkInStudent on the server.
 */

// Reception is a shared machine that nobody is looking at between arrivals, so
// the board refreshes itself rather than waiting for someone to hit reload.
const REFRESH_MS = 60_000;

const fmtTime = (value) => {
  if (!value) return '';
  // startTime/endTime are TIME columns, which arrive as 1970-01-01T:HH:MM:SSZ.
  // Read them in UTC — treating them as local shifts every class by the
  // browser's offset and puts the morning block at 4am.
  const d = new Date(value);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  });
};

const fmtStamp = (value) =>
  value ? new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';

const CheckInBoard = ({ canSeeParentPhone = false }) => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Keyed by `${sessionId}:${studentId}` so two taps on different children
  // don't disable each other's buttons.
  const [pending, setPending] = useState({});
  const [phones, setPhones] = useState({});
  const [scanning, setScanning] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/sessions/check-in-board');
      setSessions(data.sessions);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load today’s check-in board.');
    } finally {
      setLoading(false);
    }
  }, []);

  // The guardian's number comes from the directory, which is the only place the
  // desk is given it. Loaded once and held by student id so a "not picked up
  // yet" row can offer a call without a second lookup.
  const loadPhones = useCallback(async () => {
    if (!canSeeParentPhone) return;
    try {
      const { data } = await api.get('/students', { params: { status: 'ACTIVE', limit: 500 } });
      setPhones(Object.fromEntries(
        data.students.filter(s => s.parentPhone).map(s => [s.id, { name: s.parentName, phone: s.parentPhone }])
      ));
    } catch {
      // A missing phone book shouldn't cost the desk its check-in board.
    }
  }, [canSeeParentPhone]);

  useEffect(() => {
    load();
    loadPhones();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, loadPhones]);

  const mark = async (sessionId, studentId, action, status = 'PRESENT') => {
    const key = `${sessionId}:${studentId}`;
    setPending(prev => ({ ...prev, [key]: true }));
    try {
      const { data } = await api.post(`/sessions/${sessionId}/check-in`, { studentId, action, status });
      // Patch the one row rather than refetching the board: the desk is often
      // mid-conversation with a parent, and a full reload loses their place.
      setSessions(prev => prev.map(s => s.id !== sessionId ? s : {
        ...s,
        roster: s.roster.map(r => r.studentId !== studentId ? r : {
          ...r,
          status: data.attendance.status,
          checkedAt: data.attendance.checkedAt,
          checkedOutAt: data.attendance.checkedOutAt,
          checkedOutTo: data.attendance.checkedOutTo,
        }),
      }));
      setError(null);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not record that. Try again.');
    } finally {
      setPending(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  if (loading) return <div className="checkin-loading">Loading today&rsquo;s classes&hellip;</div>;

  return (
    <div className="checkin-panel">
      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="checkin-toolbar">
        <button className="checkin-btn primary" onClick={() => setScanning(true)}>
          <QrCode size={15} /> Scan QR code
        </button>
        {/* Mounted only while open: it fetches on mount, and the log is read
            when a question comes up, not watched all afternoon. */}
        <button className="checkin-btn ghost" onClick={() => setShowLog((v) => !v)}>
          <ScrollText size={15} /> {showLog ? 'Hide log' : 'Attendance log'}
        </button>
      </div>

      {showLog && <AttendanceLog />}

      {scanning && (
        <UniversalScanner
          onClose={() => setScanning(false)}
          onChanged={load}
        />
      )}

      {sessions.length === 0 ? (
        <div className="checkin-empty">
          <DoorOpen size={48} />
          <h3>Nothing on today</h3>
          <p>No classes are scheduled for today, so there is nobody to check in.</p>
        </div>
      ) : (
        sessions.map(session => {
          const inBuilding = session.roster.filter(r => r.checkedAt && !r.checkedOutAt).length;

          return (
            <section key={session.id} className="checkin-class">
              <header className="checkin-class-head">
                <div>
                  <h3>{session.className || 'Class'}</h3>
                  <p className="checkin-class-meta">
                    <Clock size={13} />
                    {fmtTime(session.startTime)} &ndash; {fmtTime(session.endTime)}
                    {session.teacherName && <> &middot; {session.teacherName}</>}
                  </p>
                </div>
                <span className="checkin-count">
                  {inBuilding}/{session.roster.length} in
                </span>
              </header>

              <ul className="checkin-roster">
                {session.roster.map(student => {
                  const key = `${session.id}:${student.studentId}`;
                  const busy = !!pending[key];
                  const arrived = !!student.checkedAt;
                  const left = !!student.checkedOutAt;
                  const guardian = phones[student.studentId];

                  return (
                    <li
                      key={student.studentId}
                      className={`checkin-row ${left ? 'is-out' : arrived ? 'is-in' : ''}`}
                    >
                      <div className="checkin-who">
                        <span className="checkin-name">{student.fullName}</span>
                        <span className="checkin-state">
                          {left ? (
                            <>
                              Picked up {fmtStamp(student.checkedOutAt)}
                              {student.checkedOutTo && ` by ${student.checkedOutTo}`}
                            </>
                          ) : arrived ? (
                            <>
                              <CheckCircle2 size={12} />
                              {student.status === 'LATE' ? 'Late' : 'In'} since {fmtStamp(student.checkedAt)}
                            </>
                          ) : (
                            'Not arrived'
                          )}
                        </span>
                      </div>

                      <div className="checkin-actions">
                        {guardian?.phone && (
                          <a
                            className="checkin-btn ghost"
                            href={`tel:${guardian.phone}`}
                            title={`Call ${guardian.name || 'guardian'}`}
                          >
                            <Phone size={14} />
                          </a>
                        )}
                        {(!arrived || left) && (
                          <>
                            <button
                              className="checkin-btn primary"
                              disabled={busy}
                              onClick={() => mark(session.id, student.studentId, 'IN')}
                            >
                              <LogIn size={14} /> {left ? 'Back in' : 'Check in'}
                            </button>
                            {!left && (
                              <button
                                className="checkin-btn ghost"
                                disabled={busy}
                                onClick={() => mark(session.id, student.studentId, 'IN', 'LATE')}
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
                            onClick={() => mark(session.id, student.studentId, 'OUT')}
                          >
                            <LogOut size={14} /> Check out
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
};

export default CheckInBoard;
