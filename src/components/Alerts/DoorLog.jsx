import React, { useState, useEffect, useCallback } from 'react';
import { ScrollText, LogIn, LogOut, QrCode, Users, Hand } from 'lucide-react';
import api from '../../lib/api';
import ErrorBanner from '../Layout/ErrorBanner';
import './DoorLog.css';

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
};

const fmtStamp = (value) =>
  new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

const DoorLog = ({ date }) => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/sessions/door-log', { params: date ? { date } : {} });
      setEvents(data.events);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load the door log.');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="dl-loading">Loading the door log&hellip;</div>;

  return (
    <section className="dl-panel">
      {error && <ErrorBanner message={error} onRetry={load} />}

      <header className="dl-head">
        <ScrollText size={15} />
        <h3>Door log</h3>
        <span className="dl-count">{events.length} event{events.length === 1 ? '' : 's'}</span>
      </header>

      {events.length === 0 ? (
        <p className="dl-empty">Nothing has been recorded at the door yet.</p>
      ) : (
        <ul className="dl-list">
          {events.map((e) => {
            const out = e.direction === 'OUT';
            const meta = SOURCE_META[e.source] || SOURCE_META.MANUAL;
            const SourceIcon = meta.icon;

            return (
              <li key={e.id} className={`dl-row ${out ? 'is-out' : 'is-in'}`}>
                <span className="dl-time">{fmtStamp(e.at)}</span>
                <span className={`dl-dir ${out ? 'out' : 'in'}`}>
                  {out ? <LogOut size={13} /> : <LogIn size={13} />}
                  {out ? 'Out' : e.status === 'LATE' ? 'In (late)' : 'In'}
                </span>
                <span className="dl-who">
                  <strong>{e.studentName || 'Unknown student'}</strong>
                  {e.className && <span className="dl-class">{e.className}</span>}
                </span>
                <span className="dl-source"><SourceIcon size={12} /> {meta.label}</span>
                <span className="dl-by">
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

export default DoorLog;
