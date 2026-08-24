import React, { useEffect, useState } from 'react';
import { X, Layers, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';
import { database } from '../../lib/database';
import { useToast } from '../Layout/ToastProvider';
import './BlockBillingPanel.css';

const isoDay = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

const shortDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
  month: 'short', day: 'numeric', timeZone: 'UTC',
});

/**
 * Billing a block of classes to a whole roster, before those classes are taught.
 *
 * The per-family version of this lives on a family's ledger and answers "this
 * family wants to settle the next eight weeks". This one answers the question a
 * term actually poses: a cove runs for eight weeks, thirty families are on it,
 * and billing them one ledger at a time is thirty passes over the same decision.
 *
 * The price named here is what ONE family pays, not a total to divide — the same
 * rule as a price typed onto a calendar entry. It is said on screen because the
 * opposite reading would be an expensive misunderstanding.
 *
 * Students already billed for a meeting are shown and skipped rather than
 * hidden: a row that silently vanished would look exactly like one this screen
 * had decided not to charge.
 */
const BlockBillingPanel = ({ onClose, onDone }) => {
  const toast = useToast();
  const [classes, setClasses] = useState([]);
  const [pickedClasses, setPickedClasses] = useState(new Set());
  const [range, setRange] = useState({ from: isoDay(0), to: isoDay(90) });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [billing, setBilling] = useState(false);

  // Which meetings the block covers, and who is on it. Both start as
  // "everything that came back" — narrowing is the point, and an admin who
  // wants the whole window should not have to tick thirty boxes to get it.
  const [pickedSessions, setPickedSessions] = useState(new Set());
  const [pickedStudents, setPickedStudents] = useState(new Set());

  const [priceMode, setPriceMode] = useState('each'); // 'each' | 'total'
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');

  useEffect(() => {
    api.get('/classes?limit=1000')
      .then((r) => setClasses(r.data.classes || []))
      .catch(() => setError('Could not load the class list.'));
  }, []);

  const classKey = [...pickedClasses].sort().join(',');

  useEffect(() => {
    if (!classKey) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    database.fetchBlockRoster({ classIds: classKey, from: range.from, to: range.to })
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setPickedSessions(new Set(res.sessions.map((s) => s.id)));
        // Students with no family have nothing to bill to — they stay on the
        // sheet, unticked, with the reason next to them.
        setPickedStudents(new Set(res.students.filter((s) => s.familyId).map((s) => s.studentId)));
      })
      .catch((err) => { if (!cancelled) setError(err.userMessage || 'Could not load the roster for those classes.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [classKey, range.from, range.to]);

  const amountNum = parseFloat(amount);
  const hasAmount = Number.isFinite(amountNum) && amountNum > 0;

  /** One student's block under the current selection and price. */
  const planFor = (student) => {
    const sessions = student.sessions.filter((s) => pickedSessions.has(s.sessionId) && !s.alreadyCharged);
    const alreadyBilled = student.sessions.filter((s) => pickedSessions.has(s.sessionId) && s.alreadyCharged).length;
    let total = null;
    if (sessions.length > 0) {
      if (hasAmount) {
        // A total is per family, not split across the roster — see the header.
        total = priceMode === 'each' ? Math.round(amountNum * sessions.length * 100) / 100 : amountNum;
      } else if (sessions.every((s) => s.price != null && s.price > 0)) {
        total = Math.round(sessions.reduce((sum, s) => sum + s.price, 0) * 100) / 100;
      }
    }
    return { sessions, alreadyBilled, total };
  };

  // Not memoised: `planFor` closes over the price fields, so it changes on
  // every keystroke anyway, and a roster is tens of rows of arithmetic.
  const rows = (data?.students ?? []).map((student) => ({ ...student, ...planFor(student) }));

  const chosen = rows.filter((r) => pickedStudents.has(r.studentId) && r.familyId && r.sessions.length > 0);
  const unpriced = chosen.filter((r) => r.total == null);
  const grandTotal = chosen.reduce((sum, r) => sum + (r.total || 0), 0);
  const familyCount = new Set(chosen.map((r) => r.familyId)).size;

  const toggleIn = (setter) => (id) => setter((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const toggleClass = toggleIn(setPickedClasses);
  const toggleSession = toggleIn(setPickedSessions);
  const toggleStudent = toggleIn(setPickedStudents);

  const run = async () => {
    setBilling(true);
    try {
      const res = await database.createBlockInvoices({
        students: chosen.map((r) => ({ studentId: r.studentId, sessionIds: r.sessions.map((s) => s.sessionId) })),
        unitAmount: priceMode === 'each' && hasAmount ? amountNum : undefined,
        blockAmount: priceMode === 'total' && hasAmount ? amountNum : undefined,
        description: description.trim() || undefined,
        dueDate: dueDate || undefined,
      });
      toast.success(`${res.billed} invoice${res.billed === 1 ? '' : 's'} created — $${res.total.toFixed(2)} billed in advance.`);
      if (res.skipped?.length) {
        toast.info(`${res.skipped.length} student${res.skipped.length === 1 ? ' was' : 's were'} skipped: ${res.skipped.map((s) => s.name).join(', ')}.`);
      }
      onDone?.();
      onClose?.();
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not create those invoices.');
    } finally {
      setBilling(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content blkb-panel" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}><X size={24} /></button>

        <header className="blkb-header">
          <Layers size={22} />
          <div>
            <h2>Bill a block to several families</h2>
            <p>
              One invoice per student for a run of classes, charged <strong>before they are
              taught</strong>. Each class is billed against its own calendar entry, so approving
              it later in Calendar Charges will not bill anyone twice. Invoices are created
              as drafts and are not emailed.
            </p>
          </div>
        </header>

        <div className="blkb-section">
          <label className="blkb-label">Classes in the block</label>
          <div className="blkb-classes">
            {classes.length === 0 && <span className="blkb-muted">Loading classes…</span>}
            {classes.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`blkb-chip ${pickedClasses.has(c.id) ? 'active' : ''}`}
                onClick={() => toggleClass(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div className="blkb-range">
          <label>
            From
            <input type="date" className="form-control" value={range.from} max={range.to}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
          </label>
          <label>
            To
            <input type="date" className="form-control" value={range.to} min={range.from}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
          </label>
        </div>

        {error && <p className="blkb-error"><AlertTriangle size={15} /> {error}</p>}

        {pickedClasses.size === 0 ? (
          <p className="blkb-empty">Pick one or more classes to see who is on them.</p>
        ) : loading ? (
          <p className="blkb-empty">Loading the roster…</p>
        ) : !data || data.sessions.length === 0 ? (
          <p className="blkb-empty">
            No scheduled meetings for those classes in this window. Widen the dates.
          </p>
        ) : (
          <>
            <div className="blkb-section">
              <label className="blkb-label">
                Meetings in the block — {pickedSessions.size} of {data.sessions.length} selected
              </label>
              <div className="blkb-sessions">
                {data.sessions.map((s) => (
                  <label key={s.id} className={`blkb-session ${pickedSessions.has(s.id) ? 'picked' : ''}`}>
                    <input type="checkbox" checked={pickedSessions.has(s.id)} onChange={() => toggleSession(s.id)} />
                    <span className="blkb-sdate">{shortDate(s.date)}</span>
                    <span className="blkb-sname">{s.className}</span>
                    {s.price != null && <span className="blkb-sprice">${s.price.toFixed(2)}</span>}
                  </label>
                ))}
              </div>
            </div>

            <div className="blkb-section">
              <label className="blkb-label">Price the block — per family, not split between them</label>
              <div className="blkb-price">
                <div className="blkb-modes">
                  {[
                    { key: 'each', label: 'Per class' },
                    { key: 'total', label: 'Whole block' },
                  ].map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      className={`blkb-mode ${priceMode === m.key ? 'active' : ''}`}
                      onClick={() => setPriceMode(m.key)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  className="form-control"
                  min="0"
                  step="0.01"
                  placeholder={priceMode === 'each'
                    ? 'Amount per class, per family (empty = each class’s own price)'
                    : 'Total per family for the whole block'}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            </div>

            <div className="blkb-section">
              <label className="blkb-label">
                Who gets billed — {chosen.length} of {rows.length} students
                {familyCount > 0 && ` · ${familyCount} famil${familyCount === 1 ? 'y' : 'ies'}`}
              </label>
              <div className="blkb-students">
                {rows.map((r) => {
                  const billable = Boolean(r.familyId) && r.sessions.length > 0;
                  return (
                    <label key={r.studentId} className={`blkb-student ${billable ? '' : 'blocked'} ${pickedStudents.has(r.studentId) && billable ? 'picked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={pickedStudents.has(r.studentId) && billable}
                        disabled={!billable}
                        onChange={() => toggleStudent(r.studentId)}
                      />
                      <span className="blkb-name">{r.name}</span>
                      <span className="blkb-family">{r.familyName || 'No family on file'}</span>
                      <span className="blkb-count">
                        {r.sessions.length} class{r.sessions.length === 1 ? '' : 'es'}
                        {r.alreadyBilled > 0 && ` · ${r.alreadyBilled} already billed`}
                      </span>
                      <strong className={r.total == null && billable ? 'blkb-danger' : ''}>
                        {!r.familyId
                          ? 'Nobody to bill'
                          : r.sessions.length === 0
                            ? 'Nothing left'
                            : r.total == null
                              ? 'No price'
                              : `$${r.total.toFixed(2)}`}
                      </strong>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="blkb-range">
              <label>
                What the invoice is for (optional)
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. Anchored — Fall block, Sep–Oct"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <label>
                Due date (optional)
                <input type="date" className="form-control" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </label>
            </div>

            {unpriced.length > 0 && (
              <p className="blkb-error">
                <AlertTriangle size={15} /> {unpriced.length} selected student{unpriced.length === 1 ? ' has' : 's have'} meetings
                with no price on the calendar. Name an amount above, or untick them.
              </p>
            )}

            <footer className="blkb-footer">
              <div className="blkb-total">
                <span>{chosen.length} invoice{chosen.length === 1 ? '' : 's'}</span>
                <strong>${grandTotal.toFixed(2)}</strong>
              </div>
              <button
                className="blkb-run"
                onClick={run}
                disabled={billing || chosen.length === 0 || unpriced.length > 0}
              >
                {billing
                  ? 'Creating…'
                  : chosen.length === 0
                    ? 'Nobody selected'
                    : `Create ${chosen.length} invoice${chosen.length === 1 ? '' : 's'} · $${grandTotal.toFixed(2)}`}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
};

export default BlockBillingPanel;
