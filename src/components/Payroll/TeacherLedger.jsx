import React, { useState } from 'react';
import { X, Plus, Wallet, Clock, DollarSign, AlertTriangle, Pencil, Trash2, Check } from 'lucide-react';
import { database } from '../../lib/database';
import { useAsyncData } from '../../lib/useAsyncData';
import { useToast } from '../Layout/ToastProvider';
import ErrorBanner from '../Layout/ErrorBanner';
import './TeacherLedger.css';

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * A `YYYY-MM-DD` read the way somebody reads a calendar.
 *
 * Parsed and formatted in UTC. The academy runs on wall-clock dates with no
 * conversion, and letting the browser read a bare date in its own zone puts
 * every line on the previous evening for anyone west of the building.
 */
const pretty = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});

/** "3:00 PM" from a 24-hour "15:00", without going near the browser's zone. */
const prettyTime = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const METHODS = [
  ['', 'Not recorded'],
  ['CASH', 'Cash'],
  ['CHECK', 'Check'],
  ['ZELLE', 'Zelle'],
  ['VENMO', 'Venmo'],
  ['PAYPAL', 'PayPal'],
  ['DIRECT_DEPOSIT', 'Direct deposit'],
  ['OTHER', 'Other'],
];

const emptyForm = (amount) => ({
  kind: 'PAYMENT',
  amount: amount > 0 ? amount.toFixed(2) : '',
  paidAt: todayIso(),
  method: '',
  reference: '',
  notes: '',
});

/**
 * One person's payroll statement, and the only place money is recorded as paid.
 *
 * Every other payroll screen shows a period — August, this week, the next four
 * weeks — and a period can never reach zero. This one shows the running
 * account: every hour earned, every payment made, and what is left after each.
 *
 * The hours are not stored anywhere. They are priced from the calendar on every
 * read, which is what makes correcting a session correct the pay it produced,
 * here and everywhere else, without anybody reconciling anything. The payments
 * are the one thing written down, and they are the rows with an edit button.
 */
const TeacherLedger = ({ teacher, onClose, onChanged }) => {
  const toast = useToast();
  const { data, loading, error, retry } = useAsyncData(
    () => database.fetchTeacherLedger(teacher.id),
    [teacher.id]
  );

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyForm(0));
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);

  const summary = data?.summary;
  const entries = data?.entries || [];

  // Reloads this statement and tells the roster behind it, whose balance
  // column has just changed too.
  const refresh = () => {
    retry();
    onChanged?.();
  };

  const openForm = (kind = 'PAYMENT') => {
    setEditing(null);
    setForm({ ...emptyForm(kind === 'PAYMENT' ? (summary?.balance || 0) : 0), kind });
    setAdding(true);
  };

  const openEdit = (entry) => {
    setAdding(false);
    setEditing(entry.id);
    setForm({
      kind: entry.paymentKind,
      // Adjustments are signed, and the sign is the thing being edited, so it
      // is shown rather than hidden behind an absolute value.
      amount: String(entry.amount),
      paidAt: entry.date,
      method: entry.method || '',
      reference: entry.reference || '',
      notes: entry.notes || '',
    });
  };

  const closeForm = () => {
    setAdding(false);
    setEditing(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      toast.error('Enter an amount.');
      return;
    }
    if (form.kind === 'PAYMENT' && amount <= 0) {
      toast.error('A payment has to be more than $0. To take money off a balance, record an adjustment.');
      return;
    }
    if (form.kind === 'ADJUSTMENT' && !form.notes.trim()) {
      toast.error('An adjustment needs a note saying what it is for.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        kind: form.kind,
        amount,
        paidAt: form.paidAt,
        method: form.method || null,
        reference: form.reference.trim() || null,
        notes: form.notes.trim() || null,
      };
      if (editing) {
        await database.updateTeacherPayment(editing, payload);
        toast.success('Payment updated.');
      } else {
        await database.recordTeacherPayment(teacher.id, payload);
        toast.success(
          form.kind === 'PAYMENT'
            ? `${money(amount)} recorded for ${teacher.fullName}.`
            : 'Adjustment recorded.'
        );
      }
      closeForm();
      refresh();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'That could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (entry) => {
    setRemoving(entry.id);
    try {
      await database.deleteTeacherPayment(entry.id);
      toast.success('Payment removed.');
      refresh();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'That could not be removed.');
    } finally {
      setRemoving(null);
    }
  };

  const formOpen = adding || editing;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content teacher-ledger" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose} aria-label="Close"><X size={24} /></button>

        <div className="tl-header">
          <Wallet size={24} />
          <div>
            <h2>{teacher.fullName}</h2>
            <p>Everything earned, everything paid, and what is left.</p>
          </div>
        </div>

        <div className="tl-body">
          {loading ? (
            <div className="app-loader"><div className="app-spinner" /><span className="app-loader-text">Adding it all up…</span></div>
          ) : error ? (
            <ErrorBanner message={error} onRetry={retry} />
          ) : (
            <>
              <div className="tl-stat-row">
                <div className={`tl-stat tl-stat-primary${summary.balance > 0 ? '' : ' is-settled'}`}>
                  <span className="tl-stat-label"><DollarSign size={14} /> Balance remaining</span>
                  <strong className="tl-stat-value">{money(summary.balance)}</strong>
                  <span className="tl-stat-sub">
                    as of {pretty(data.asOf)}
                    {summary.balance <= 0 && <> · nothing outstanding</>}
                  </span>
                </div>
                <div className="tl-stat">
                  <span className="tl-stat-label"><Clock size={14} /> Earned</span>
                  <strong className="tl-stat-value">{money(summary.earned)}</strong>
                  <span className="tl-stat-sub">
                    {summary.totalHours} h
                    {summary.salaryEarned > 0 && <> + {money(summary.salaryEarned)} salary</>}
                  </span>
                </div>
                <div className="tl-stat">
                  <span className="tl-stat-label"><Check size={14} /> Paid</span>
                  <strong className="tl-stat-value">{money(summary.paid)}</strong>
                  <span className="tl-stat-sub">
                    {summary.paymentCount === 0
                      ? 'no payments recorded yet'
                      : `${summary.paymentCount} payment${summary.paymentCount === 1 ? '' : 's'}, last ${pretty(summary.lastPaidAt)}`}
                  </span>
                </div>
              </div>

              {/* An unpriced hour sits in the ledger at $0, which on this
                  screen looks exactly like a debt already settled. Said out
                  loud rather than left inside the balance. */}
              {summary.unratedHours > 0 && (
                <div className="tl-warning">
                  <AlertTriangle size={16} />
                  <span>
                    <strong>{summary.unratedHours} h</strong> here were worked with no rate set, so
                    they count as $0. The balance above is short until those rates exist.
                  </span>
                </div>
              )}

              {/* The salary lines are the one part of this statement the system
                  guessed at, so the guess is stated where the money is. */}
              {summary.salaryEarned > 0 && (
                <div className="tl-warning tl-warning-quiet">
                  <AlertTriangle size={16} />
                  <span>
                    Salary is accrued from the month of their first hour on the calendar, because
                    nothing records when the salary itself started. If it began later, record an
                    adjustment for the difference rather than editing the lines.
                  </span>
                </div>
              )}

              <div className="tl-actions">
                <button className="tl-add-btn" onClick={() => openForm('PAYMENT')} disabled={formOpen}>
                  <Plus size={15} /> Record a payment
                </button>
                <button className="tl-adjust-btn" onClick={() => openForm('ADJUSTMENT')} disabled={formOpen}>
                  Adjustment
                </button>
              </div>

              {formOpen && (
                <form className="tl-form" onSubmit={submit}>
                  <div className="tl-form-title">
                    {editing
                      ? 'Correcting a recorded line'
                      : form.kind === 'PAYMENT'
                        ? `Money paid to ${teacher.fullName}`
                        : 'An adjustment, for what no hour accounts for'}
                  </div>
                  {form.kind === 'ADJUSTMENT' && (
                    <p className="tl-form-hint">
                      A positive amount adds to what is owed — a bonus, or an opening balance from
                      before any of this existed. A negative one takes it away.
                    </p>
                  )}
                  <div className="tl-form-grid">
                    <label>
                      <span>Amount</span>
                      <input
                        type="number" step="0.01" autoFocus
                        value={form.amount}
                        onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                        placeholder="0.00"
                      />
                    </label>
                    <label>
                      <span>Date the money moved</span>
                      <input
                        type="date"
                        value={form.paidAt}
                        onChange={(e) => setForm((f) => ({ ...f, paidAt: e.target.value }))}
                      />
                    </label>
                    {form.kind === 'PAYMENT' && (
                      <>
                        <label>
                          <span>How</span>
                          <select
                            value={form.method}
                            onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
                          >
                            {METHODS.map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Reference</span>
                          <input
                            type="text" maxLength={120}
                            value={form.reference}
                            onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                            placeholder="Check #1042"
                          />
                        </label>
                      </>
                    )}
                    <label className="tl-form-wide">
                      <span>{form.kind === 'ADJUSTMENT' ? 'What is this for' : 'Note'}</span>
                      <input
                        type="text"
                        value={form.notes}
                        onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                        placeholder={form.kind === 'ADJUSTMENT' ? 'Opening balance carried over from TutorBird' : 'Optional'}
                      />
                    </label>
                  </div>
                  <div className="tl-form-actions">
                    <button type="button" className="tl-cancel" onClick={closeForm} disabled={saving}>
                      Cancel
                    </button>
                    <button type="submit" className="tl-save" disabled={saving}>
                      {saving ? 'Saving…' : editing ? 'Save the correction' : 'Record it'}
                    </button>
                  </div>
                </form>
              )}

              {entries.length === 0 ? (
                <p className="tl-empty">
                  Nothing has been earned or paid yet. Hours appear here on their own, the moment
                  each one ends on the calendar.
                </p>
              ) : (
                <div className="tl-table-wrap">
                  <table className="tl-table">
                    <thead>
                      <tr>
                        <th>Date &amp; time</th>
                        <th>Description</th>
                        <th className="num">Income</th>
                        <th className="num">Payment</th>
                        <th className="num">Balance</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry) => (
                        <tr key={`${entry.kind}-${entry.id}`} className={entry.payment ? 'tl-row-payment' : ''}>
                          <td>
                            {pretty(entry.date)}
                            {entry.time && <span className="tl-time"> {prettyTime(entry.time)}</span>}
                          </td>
                          <td>
                            <span className="tl-desc">{entry.description}</span>
                            {entry.detail && <span className="tl-detail">{entry.detail}</span>}
                          </td>
                          <td className="num">{entry.income ? money(entry.income) : '–'}</td>
                          <td className="num tl-paid">{entry.payment ? money(entry.payment) : '–'}</td>
                          <td className="num tl-balance">{money(entry.balance)}</td>
                          <td className="tl-row-actions">
                            {/* Only the recorded rows. An hour is corrected on
                                the calendar, which is the whole point of never
                                storing it here. */}
                            {entry.editable && (
                              <>
                                <button
                                  className="tl-icon-btn" onClick={() => openEdit(entry)}
                                  aria-label="Edit this line" title="Edit"
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  className="tl-icon-btn tl-icon-danger"
                                  onClick={() => remove(entry)}
                                  disabled={removing === entry.id}
                                  aria-label="Remove this line" title="Remove"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="tl-footnote">
                The hours on this statement are priced from the calendar every time it is opened —
                they are not stored, so fixing a session or a rate fixes the pay it produced, here
                and on every other screen. Payments are the only thing written down.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default TeacherLedger;
