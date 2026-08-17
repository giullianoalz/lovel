import React, { useState, useEffect, useCallback } from 'react';
import { ScrollText, LogIn, LogOut, QrCode, Users, Hand, ClipboardList } from 'lucide-react';
import api from '../../lib/api';
import ErrorBanner from '../Layout/ErrorBanner';
import './AttendanceLog.css';

/**
 * The door, read back.
 *
 * The board above it shows where everyone stands now; this shows what happened,
 * in order, including the trips out and back that the board overwrites. Every
 * row names the staff member who recorded it — that is the question this exists
 * to answer, and the reason it is worth a screen rather than a database query.
 */

const SOURCE_META = {
  FAMILY_QR: { label: 'Family QR', icon: Users },
  PICKUP_QR: { label: 'Pickup QR', icon: QrCode },
  MANUAL: { label: 'By hand', icon: Hand },
  SHEET: { label: 'Class sheet', icon: ClipboardList },
};

/**
 * A MARK is the teacher's sheet, not a movement, and it has to read that way —
 * "Marked absent", never "Out". The status is the whole content of the event.
 */
const markLabel = (status) => {
  if (status === 'PRESENT') return 'Marked present';
  if (status === 'LATE') return 'Marked late';
  if (status === 'ABSENT') return 'Marked absent';
  if (status === 'EXCUSED') return 'Marked excused';
  return 'Marked';
};

const fmtStamp = (value) =>
  new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

const AttendanceLog = ({ date }) => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/sessions/attendance-log', { params: date ? { date } : {} });
      setEvents(data.events);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load the door log.');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="al-loading">Loading the door log&hellip;</div>;

  return (
    <section className="al-panel">
      {error && <ErrorBanner message={error} onRetry={load} />}

      <header className="al-head">
        <ScrollText size={15} />
        <h3>Door log</h3>
        <span className="al-count">{events.length} event{events.length === 1 ? '' : 's'}</span>
      </header>

      {events.length === 0 ? (
        <p className="al-empty">Nothing has been recorded at the door yet.</p>
      ) : (
        <ul className="al-list">
          {events.map((e) => {
            const out = e.direction === 'OUT';
            const marked = e.direction === 'MARK';
            const meta = SOURCE_META[e.source] || SOURCE_META.MANUAL;
            const SourceIcon = meta.icon;
            const kind = marked ? 'mark' : out ? 'out' : 'in';

            return (
              <li key={e.id} className={`al-row is-${kind}`}>
                <span className="al-time">{fmtStamp(e.at)}</span>
                <span className={`al-dir ${kind}`}>
                  {marked ? <ClipboardList size={13} /> : out ? <LogOut size={13} /> : <LogIn size={13} />}
                  {marked ? markLabel(e.status) : out ? 'Out' : e.status === 'LATE' ? 'In (late)' : 'In'}
                </span>
                <span className="al-who">
                  <strong>{e.studentName || 'Unknown student'}</strong>
                  {e.className && <span className="al-class">{e.className}</span>}
                </span>
                <span className="al-source"><SourceIcon size={12} /> {meta.label}</span>
                <span className="al-by">
                  {/* A missing name and a missing account read differently, and
                      only the parts that exist are joined — a bare separator in
                      front of the staff name looked like a dropped field. */}
                  {[
                    e.releasedTo ? `to ${e.releasedTo}` : null,
                    e.byName || 'staff no longer on record',
                  ].filter(Boolean).join(' · ')}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default AttendanceLog;
