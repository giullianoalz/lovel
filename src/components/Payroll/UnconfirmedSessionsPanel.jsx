import React, { useMemo, useState } from 'react';
import { X, AlertTriangle, Check } from 'lucide-react';
import { database } from '../../lib/database';
import { useToast } from '../Layout/ToastProvider';
import './UnconfirmedSessionsPanel.css';

// Mirrors UNCONFIRMED_REASON_LABELS on the server.
const REASONS = {
  no_attendance: 'marked complete, no register saved',
  not_completed: 'never marked complete',
};

/**
 * Paying for classes nobody closed out.
 *
 * A class normally reaches payroll because the teacher confirmed it — marked it
 * complete and saved the register. Teachers forget, and the hour was still
 * taught, so payroll flags it and refuses to pay: the money then has to be
 * settled outside the system, where nothing records it.
 *
 * This is the way back in. It is deliberately a review screen and not a single
 * "pay everything" button: the admin is vouching that each of these classes ran
 * with nothing to prove it, and that claim is made per class, per teacher.
 */
const UnconfirmedSessionsPanel = ({ rows, month, monthName, year, onClose, onDone }) => {
  const toast = useToast();
  const [selected, setSelected] = useState(() => new Set());
  const [saving, setSaving] = useState(false);

  // Only the people who actually have something outstanding.
  const people = useMemo(
    () => rows.filter((r) => (r.unconfirmedSessions || []).length > 0),
    [rows]
  );

  const allIds = useMemo(
    () => people.flatMap((p) => p.unconfirmedSessions.map((s) => s.id)),
    [people]
  );

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const togglePerson = (person) => {
    const ids = person.unconfirmedSessions.map((s) => s.id);
    const allOn = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const selectedHours = useMemo(() => {
    let h = 0;
    people.forEach((p) => p.unconfirmedSessions.forEach((s) => {
      if (selected.has(s.id)) h += s.hours;
    }));
    return Math.round(h * 100) / 100;
  }, [people, selected]);

  const handleApprove = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      const res = await database.setSessionPayApproval([...selected], true);
      toast.success(res.message || 'Approved.');
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not approve those classes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content unconf-panel" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}><X size={24} /></button>

        <header className="unconf-header">
          <AlertTriangle size={22} />
          <div>
            <h2>Classes nobody closed out</h2>
            <p>
              {monthName} {year} — these hours are on the calendar but were never confirmed, so
              payroll is not paying for them. Tick the ones you know ran.
            </p>
          </div>
        </header>

        {people.length === 0 ? (
          <p className="unconf-empty">Everything this month has been closed out.</p>
        ) : (
          <>
            <div className="unconf-list">
              {people.map((person) => {
                const ids = person.unconfirmedSessions.map((s) => s.id);
                const allOn = ids.every((id) => selected.has(id));
                return (
                  <div className="unconf-person" key={person.teacher.id}>
                    <div className="unconf-person-head">
                      <label>
                        <input type="checkbox" checked={allOn} onChange={() => togglePerson(person)} />
                        <strong>{person.teacher.fullName}</strong>
                      </label>
                      <span className="unconf-person-sum">
                        {person.unconfirmedCount} class{person.unconfirmedCount === 1 ? '' : 'es'} · {person.unconfirmedHours} h
                      </span>
                    </div>
                    {person.unconfirmedSessions.map((s) => (
                      <label className="unconf-row" key={s.id}>
                        <input
                          type="checkbox"
                          checked={selected.has(s.id)}
                          onChange={() => toggle(s.id)}
                        />
                        <span className="unconf-date">
                          {new Date(s.date).toLocaleDateString('en-US', {
                            month: 'short', day: 'numeric', timeZone: 'UTC',
                          })}
                        </span>
                        <span className="unconf-title">{s.title}</span>
                        <span className="unconf-hours">{s.hours} h</span>
                        <span className="unconf-reason">{REASONS[s.reason] || s.reason}</span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>

            <footer className="unconf-footer">
              <button
                className="unconf-selectall"
                onClick={() => setSelected((prev) => (prev.size === allIds.length ? new Set() : new Set(allIds)))}
              >
                {selected.size === allIds.length ? 'Clear all' : 'Select all'}
              </button>
              <span className="unconf-count">
                {selected.size === 0
                  ? 'Nothing selected'
                  : `${selected.size} class${selected.size === 1 ? '' : 'es'} · ${selectedHours} h`}
              </span>
              <button className="save-btn" onClick={handleApprove} disabled={saving || selected.size === 0}>
                <Check size={14} /> {saving ? 'Confirming…' : 'These ran — pay them'}
              </button>
            </footer>

            {/* Said plainly, because it is the whole weight of this screen: the
                approval is the only evidence these hours existed. */}
            <p className="unconf-note">
              Confirming records your name against each class. The hours are then paid at the
              rate in force today, and the payslip shows they were paid on your approval rather
              than on a register.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default UnconfirmedSessionsPanel;
