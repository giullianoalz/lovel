import React, { useEffect, useMemo, useState } from 'react';
import { X, Receipt, AlertTriangle } from 'lucide-react';
import { database } from '../../lib/database';
import { useToast } from '../Layout/ToastProvider';
import './SessionChargesPanel.css';

/** Today and a month back, as the default range — the window an admin is billing. */
const isoDay = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

/**
 * The meetings that have been given a price, and what they would charge.
 *
 * A price typed onto a calendar entry bills nobody on its own. It records what
 * the meeting costs; this is where it becomes money. That gap is deliberate —
 * a fat-fingered $4000 is caught on a review screen rather than on a family's
 * invoice — and it is the same shape as the quarterly tuition run, which is
 * also previewed before it is committed.
 *
 * Lines that cannot be raised are listed rather than hidden, with the reason:
 * already billed, or no family to bill. A line that silently vanished would
 * look exactly like one that was charged.
 */
const SessionChargesPanel = ({ onClose, onDone }) => {
  const toast = useToast();
  const [range, setRange] = useState({ from: isoDay(-30), to: isoDay(0) });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [raising, setRaising] = useState(false);
  // Which meetings to commit. Empty means all of them — the ordinary case, and
  // one fewer click for the admin who just wants to release the whole window.
  const [picked, setPicked] = useState(new Set());
  // Bill the students who joined after the meeting anyway. Off every time, and
  // only offered once specific meetings are picked — the server refuses it over
  // a whole range for the same reason.
  const [includeLate, setIncludeLate] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await database.fetchSessionCharges(range));
    } catch (err) {
      setError(err.response?.data?.message || err.userMessage || 'Could not load the priced meetings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [range.from, range.to]);

  // Memoised, not a bare `data?.lines || []`: that fallback is a fresh array on
  // every render, which would make every useMemo below recompute each time.
  const lines = useMemo(() => data?.lines || [], [data]);
  const summary = data?.summary;

  // Grouped by meeting: an admin thinks "the Saturday workshop", not "nine
  // separate charges that happen to share a date".
  const meetings = useMemo(() => {
    const byId = new Map();
    for (const line of lines) {
      const entry = byId.get(line.sessionId) || {
        sessionId: line.sessionId,
        date: line.date,
        className: line.className,
        description: line.description,
        amount: line.amount,
        lines: [],
      };
      entry.lines.push(line);
      byId.set(line.sessionId, entry);
    }
    return [...byId.values()];
  }, [lines]);

  const billableIds = useMemo(
    () => new Set(meetings.filter((m) => m.lines.some(isPickable)).map((m) => m.sessionId)),
    [meetings]
  );

  const toggle = (sessionId) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      // Un-picking back to "the whole range" takes the exception with it: it is
      // only ever a decision about meetings someone looked at.
      if (next.size === 0) setIncludeLate(false);
      return next;
    });
  };

  /** What the button will actually raise, given the current selection. */
  const allowLate = includeLate && picked.size > 0;
  const selected = picked.size > 0
    ? lines.filter((l) => isBillable(l, allowLate) && picked.has(l.sessionId))
    : lines.filter((l) => isBillable(l));
  const selectedTotal = Math.round(selected.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;

  // Held back in what the admin is looking at right now, not school-wide — the
  // checkbox has to say what ticking it would actually cost.
  const heldBack = lines.filter((l) => l.joinedLate && isPickable(l)
    && (picked.size === 0 || picked.has(l.sessionId)));
  const heldBackTotal = Math.round(heldBack.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;

  const raise = async () => {
    setRaising(true);
    try {
      const res = await database.raiseSessionCharges({
        ...range,
        sessionIds: picked.size > 0 ? [...picked] : undefined,
        includeJoinedLate: allowLate || undefined,
      });
      toast.success(res.message);
      setPicked(new Set());
      setIncludeLate(false);
      await load();
      onDone?.();
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not raise those charges.');
    } finally {
      setRaising(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content charges-panel" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}><X size={24} /></button>

        <header className="charges-header">
          <Receipt size={22} />
          <div>
            <h2>Charges priced on the calendar</h2>
            <p>
              Every meeting you gave a price to. Nothing here has been billed yet —
              approving raises the charge <strong>and its invoice</strong>, so the family
              can pay it. The invoice is not emailed; send it when you're ready.
            </p>
          </div>
        </header>

        <div className="charges-range">
          <label>
            From
            <input
              type="date"
              className="form-control"
              value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
            />
          </label>
          <label>
            To
            <input
              type="date"
              className="form-control"
              value={range.to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
            />
          </label>
        </div>

        {error && <p className="charges-error"><AlertTriangle size={15} /> {error}</p>}

        {loading ? (
          <p className="charges-empty">Loading…</p>
        ) : meetings.length === 0 ? (
          <p className="charges-empty">
            No meeting in this range has a price on it. Open a session on the calendar
            and put one in the price box to charge for it.
          </p>
        ) : (
          <>
            <div className="charges-list">
              {meetings.map((meeting) => {
                const canRaise = billableIds.has(meeting.sessionId);
                return (
                  <div className={`charges-meeting${canRaise ? '' : ' charges-meeting-done'}`} key={meeting.sessionId}>
                    <label className="charges-meeting-head">
                      <input
                        type="checkbox"
                        checked={picked.has(meeting.sessionId)}
                        onChange={() => toggle(meeting.sessionId)}
                        disabled={!canRaise}
                      />
                      <span className="charges-date">
                        {new Date(meeting.date).toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric', timeZone: 'UTC',
                        })}
                      </span>
                      <strong>{meeting.description}</strong>
                      <span className="charges-price">${meeting.amount.toFixed(2)} each</span>
                    </label>

                    {meeting.lines.map((line) => (
                      <div className="charges-row" key={`${line.sessionId}-${line.studentId}`}>
                        <span className="charges-student">{line.studentName}</span>
                        <span className="charges-amount">${line.amount.toFixed(2)}</span>
                        <span className="charges-flag">
                          {line.alreadyCharged
                            ? `Already billed${line.chargedAmount != null ? ` · $${line.chargedAmount.toFixed(2)}` : ''}`
                            : line.missingFamily
                              ? 'No family on file — nobody to bill'
                              : line.zeroAmount
                                ? 'Priced at $0 — nothing to raise'
                                : line.joinedLate
                                  ? `Enrolled ${new Date(line.enrolledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}, after this meeting${allowLate && picked.has(line.sessionId) ? ' — charging anyway' : ' — held back'}`
                                  : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            <footer className="charges-footer">
              <div className="charges-summary">
                {summary.alreadyCharged > 0 && (
                  <span>{summary.alreadyCharged} already billed</span>
                )}
                {summary.missingFamily > 0 && (
                  <span className="charges-warn">
                    <AlertTriangle size={13} /> {summary.missingFamily} with no family on file
                  </span>
                )}
                {heldBack.length > 0 && (
                  <label className="charges-late" title={picked.size === 0
                    ? 'Pick the meetings first — this cannot be applied to a whole range.'
                    : 'Only for students who really did attend; the log records who did this.'}>
                    <input
                      type="checkbox"
                      checked={allowLate}
                      disabled={picked.size === 0}
                      onChange={(e) => setIncludeLate(e.target.checked)}
                    />
                    <AlertTriangle size={13} />
                    Also charge {heldBack.length} enrolled after the meeting (${heldBackTotal.toFixed(2)})
                    {picked.size === 0 && ' — pick the meetings first'}
                  </label>
                )}
              </div>
              <button
                className="charges-raise"
                onClick={raise}
                disabled={raising || selected.length === 0}
              >
                {selected.length === 0
                  ? 'Nothing left to charge'
                  : `Charge ${selected.length} ${selected.length === 1 ? 'family' : 'families'} · $${selectedTotal.toFixed(2)}`}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
};

/**
 * Mirrors the server's rule, so the screen and the commit agree on what counts.
 * `allowJoinedLate` matches the same flag on the POST: held-back lines become
 * chargeable only once the admin has named the meetings and ticked the box.
 */
const isBillable = (line, allowJoinedLate = false) =>
  !line.alreadyCharged && !line.missingFamily && !line.zeroAmount
  && (allowJoinedLate || !line.joinedLate);

/** Could be raised, if the admin decides to — the wider net the checkboxes use. */
const isPickable = (line) => isBillable(line, true);

export default SessionChargesPanel;
