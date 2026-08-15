import React, { useMemo, useState } from 'react';
import { X, UserX, Undo2 } from 'lucide-react';
import { database } from '../../lib/database';
import { useToast } from '../Layout/ToastProvider';
import './AbsencesPanel.css';

/**
 * The hours this period deliberately did not pay for.
 *
 * Pay accrues from the calendar: an hour that has passed is an hour that is
 * owed, and nobody is asked to confirm it class by class. The one exception is
 * somebody marking "they didn't turn up" on the calendar entry — which takes
 * money off a payslip, silently, without the person it belongs to ever seeing
 * the moment it happened.
 *
 * So every one of those is listed here before payroll is released, with the
 * reason given and the name of whoever marked it, and each can be put back with
 * one click. This is the review screen for the only manual decision left in the
 * whole engine — the review exists because it is manual, not because it is
 * common.
 */
const AbsencesPanel = ({ rows, periodLabel, onClose, onDone }) => {
  const toast = useToast();
  const [busyId, setBusyId] = useState(null);

  // Only the people who actually lost an hour this period.
  const people = useMemo(
    () => rows.filter((r) => (r.absences || []).length > 0),
    [rows]
  );

  const totalHours = useMemo(
    () => Math.round(people.reduce((n, p) => n + p.absenceHours, 0) * 100) / 100,
    [people]
  );

  /** Puts one entry back on payroll. Sessions and shifts take different routes. */
  const restore = async (entry) => {
    setBusyId(entry.id);
    try {
      const res = entry.kind === 'shift'
        ? await database.setShiftAbsence([entry.id], false)
        : await database.setSessionAbsence([entry.id], false);
      toast.success(res.message);
      onDone?.();
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not put those hours back.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content absence-panel" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}><X size={24} /></button>

        <header className="absence-header">
          <UserX size={22} />
          <div>
            <h2>Hours not being paid</h2>
            <p>
              {periodLabel} — every other hour on the calendar is paid the moment it ends.
              These {totalHours} h were struck off because somebody said the person wasn't there.
            </p>
          </div>
        </header>

        {people.length === 0 ? (
          <p className="absence-empty">
            Nothing was struck off this period — every hour on the calendar is being paid.
          </p>
        ) : (
          <div className="absence-list">
            {people.map((person) => (
              <div className="absence-person" key={person.teacher.id}>
                <div className="absence-person-head">
                  <strong>{person.teacher.fullName}</strong>
                  <span className="absence-person-sum">
                    {person.absenceCount} {person.absenceCount === 1 ? 'entry' : 'entries'} · {person.absenceHours} h unpaid
                  </span>
                </div>
                {person.absences.map((entry) => (
                  <div className="absence-row" key={`${entry.kind}-${entry.id}`}>
                    <span className="absence-date">
                      {new Date(entry.date).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', timeZone: 'UTC',
                      })}
                    </span>
                    <span className="absence-title">
                      {entry.title}
                      {entry.kind === 'shift' && <em className="absence-kind">shift</em>}
                    </span>
                    <span className="absence-hours">{entry.hours} h</span>
                    <span className="absence-reason">
                      {entry.reason || 'No reason given'}
                      {entry.markedBy && <small> · marked by {entry.markedBy}</small>}
                    </span>
                    <button
                      className="absence-restore"
                      onClick={() => restore(entry)}
                      disabled={busyId === entry.id}
                      title="Put these hours back on payroll"
                    >
                      <Undo2 size={13} /> Pay it
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AbsencesPanel;
