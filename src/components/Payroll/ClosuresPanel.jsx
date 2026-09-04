import React, { useState, useEffect } from 'react';
import {
  X, CalendarOff, Plus, Trash2, AlertTriangle, Users, Clock, DollarSign, Receipt,
} from 'lucide-react';
import { database } from '../../lib/database';
import { useAsyncData } from '../../lib/useAsyncData';
import { useToast } from '../Layout/ToastProvider';
import ErrorBanner from '../Layout/ErrorBanner';
import './ClosuresPanel.css';

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * A `YYYY-MM-DD` shown the way somebody reads a calendar.
 *
 * Parsed as UTC and formatted in UTC. The academy runs on wall-clock dates with
 * no conversion, and letting the browser read a bare date in its own zone puts
 * every closure on the previous evening for anyone west of the building.
 */
const pretty = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Declaring the days the academy does not open.
 *
 * Pay accrues from the calendar with nobody in the loop, which is right for a
 * working week and wrong for Thanksgiving: the meetings sit on the timetable,
 * nobody comes in, and every one of them pays and bills itself. Before this
 * existed the only defence was cancelling each session by hand.
 *
 * The screen is built around one idea: closing a day takes money off other
 * people's payslips, so the cost is shown *before* it is done, never discovered
 * afterwards. The preview is the point of the form, not a nicety on it.
 */
const ClosuresPanel = ({ onClose }) => {
  const toast = useToast();
  const { data, loading, error, retry } = useAsyncData(() => database.fetchClosures(), []);
  const closures = data || [];

  const { data: conflictData, retry: retryConflicts } = useAsyncData(
    () => database.fetchClosureConflicts(), []
  );
  const conflicts = conflictData || [];

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ startDate: todayIso(), endDate: '', label: '', notes: '' });
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(null);

  // The preview follows the dates rather than waiting for a button: an admin
  // who has to ask for the number will skip asking. Debounced because the dates
  // change on every keystroke of a typed year.
  useEffect(() => {
    if (!adding || !form.startDate) { setPreview(null); return undefined; }
    let cancelled = false;
    setPreviewing(true);
    const timer = setTimeout(async () => {
      try {
        const result = await database.previewClosure({
          startDate: form.startDate,
          endDate: form.endDate || undefined,
        });
        if (!cancelled) setPreview(result);
      } catch {
        // A preview that fails is not worth an error banner over an unsaved
        // form — the range is probably still half-typed. The create call
        // validates properly and says why.
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [adding, form.startDate, form.endDate]);

  const resetForm = () => {
    setForm({ startDate: todayIso(), endDate: '', label: '', notes: '' });
    setPreview(null);
    setAdding(false);
  };

  const handleCreate = async () => {
    if (!form.label.trim() || !form.startDate) return;
    setSaving(true);
    try {
      const res = await database.createClosure({
        startDate: form.startDate,
        endDate: form.endDate || undefined,
        label: form.label.trim(),
        notes: form.notes.trim() || undefined,
      });
      resetForm();
      await Promise.all([retry(), retryConflicts()]);
      toast.success(
        `${res.created} day${res.created === 1 ? '' : 's'} closed.`
        + (res.skipped ? ` ${res.skipped} already were.` : '')
        // Unfreezing is the part nobody expects, so it is said out loud rather
        // than left for someone to notice on a payslip later.
        + (res.unfrozen ? ` ${res.unfrozen} already-priced hour${res.unfrozen === 1 ? '' : 's'} released.` : '')
      );
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not declare that closure.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c) => {
    setRemoving(c.id);
    try {
      const res = await database.deleteClosure(c.id);
      await Promise.all([retry(), retryConflicts()]);
      toast.success(res.message || 'That day is open again.');
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not reopen that day.');
    } finally {
      setRemoving(null);
    }
  };

  const conflictFor = (iso) => conflicts.find((c) => c.date === iso);
  const upcoming = closures.filter((c) => c.date >= todayIso());
  const past = closures.filter((c) => c.date < todayIso());

  const renderRow = (c) => {
    const clash = conflictFor(c.date);
    return (
      <div className="closure-row" key={c.id}>
        <div className="closure-date">
          <span className="closure-day">{pretty(c.date)}</span>
          <span className="closure-label">{c.label}</span>
          {c.notes && <span className="closure-notes">{c.notes}</span>}
        </div>

        {/* Closing a day stops it paying but leaves the classes on the
            calendar, where families still see them. Surfaced here because
            nothing else in the app would ever mention it. */}
        {clash && (
          <span className="closure-clash" title={clash.sessions.map((s) => s.className).join(', ')}>
            <AlertTriangle size={13} />
            {clash.sessions.length} class{clash.sessions.length === 1 ? '' : 'es'} still scheduled
            {clash.sessions.some((s) => s.priced) && ' · priced'}
          </span>
        )}

        <button
          className="closure-remove"
          onClick={() => handleDelete(c)}
          disabled={removing === c.id}
          title="The academy is open that day after all"
        >
          <Trash2 size={15} />
        </button>
      </div>
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content closures-panel" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}><X size={24} /></button>

        <header className="closures-header">
          <CalendarOff size={22} />
          <div>
            <h2>Closed days</h2>
            <p>
              Days the academy does not open. Hours on them pay nobody and bill nobody,
              and new sessions are never generated onto them.
            </p>
          </div>
        </header>

        {loading ? (
          <div className="closures-state">
            <div className="app-loader"><div className="app-spinner" /><span className="app-loader-text">Loading the calendar…</span></div>
          </div>
        ) : error ? (
          <ErrorBanner message={error} onRetry={retry} />
        ) : (
          <div className="closures-body">
            {adding ? (
              <div className="closure-form">
                <div className="closure-form-dates">
                  <label>
                    <span>From</span>
                    <input
                      type="date" className="form-control"
                      value={form.startDate}
                      onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                    />
                  </label>
                  <label>
                    <span>To <em>(optional)</em></span>
                    <input
                      type="date" className="form-control"
                      value={form.endDate}
                      min={form.startDate}
                      onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                    />
                  </label>
                </div>

                <label className="closure-form-field">
                  <span>What to call it</span>
                  <input
                    className="form-control"
                    placeholder="Thanksgiving, Winter break…"
                    value={form.label}
                    onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  />
                </label>

                <label className="closure-form-field">
                  <span>Notes <em>(optional)</em></span>
                  <input
                    className="form-control"
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </label>

                {/* The whole reason this form is not just two inputs and a
                    button. Closing a day is a subtraction from somebody's pay,
                    and it should never be a silent one. */}
                <div className={`closure-preview${previewing ? ' is-loading' : ''}`}>
                  {preview ? (
                    <>
                      <div className="closure-preview-head">
                        Closing <strong>{preview.days.length}</strong> day{preview.days.length === 1 ? '' : 's'} would drop:
                      </div>
                      <div className="closure-preview-stats">
                        <span><Clock size={13} /> {preview.impact.hours} h</span>
                        <span>{preview.impact.sessions} class{preview.impact.sessions === 1 ? '' : 'es'}</span>
                        {preview.impact.shifts > 0 && <span>{preview.impact.shifts} shift{preview.impact.shifts === 1 ? '' : 's'}</span>}
                        {preview.impact.frozenPay > 0 && (
                          <span className="closure-preview-money">
                            <DollarSign size={13} /> {money(preview.impact.frozenPay)} already priced
                          </span>
                        )}
                        {preview.impact.pricedSessions > 0 && (
                          <span className="closure-preview-billing">
                            <Receipt size={13} /> {preview.impact.pricedSessions} would have billed families
                          </span>
                        )}
                      </div>
                      {preview.impact.people.length > 0 && (
                        <div className="closure-preview-people">
                          <Users size={13} /> {preview.impact.people.join(', ')}
                        </div>
                      )}
                      {preview.alreadyClosed.length > 0 && (
                        <div className="closure-preview-note">
                          {preview.alreadyClosed.length} of these {preview.alreadyClosed.length === 1 ? 'is' : 'are'} already closed and will be left alone.
                        </div>
                      )}
                      {preview.impact.sessions === 0 && preview.impact.shifts === 0 && (
                        <div className="closure-preview-note">Nothing is scheduled on {preview.days.length === 1 ? 'it' : 'those days'}.</div>
                      )}
                    </>
                  ) : (
                    <div className="closure-preview-note">Pick the dates to see what it costs.</div>
                  )}
                </div>

                <div className="closure-form-actions">
                  <button className="btn-secondary" onClick={resetForm} disabled={saving}>Cancel</button>
                  <button
                    className="btn-primary"
                    onClick={handleCreate}
                    disabled={saving || !form.label.trim() || !form.startDate}
                  >
                    {saving ? 'Closing…' : 'Close these days'}
                  </button>
                </div>
              </div>
            ) : (
              <button className="closure-add" onClick={() => setAdding(true)}>
                <Plus size={16} /> Declare a closed day
              </button>
            )}

            {closures.length === 0 && !adding && (
              <p className="closures-empty">
                No closed days yet, so every day on the calendar pays and bills as a normal one.
              </p>
            )}

            {upcoming.length > 0 && (
              <section className="closures-group">
                <h3>Coming up</h3>
                {upcoming.map(renderRow)}
              </section>
            )}

            {past.length > 0 && (
              <section className="closures-group closures-group-past">
                <h3>Already passed</h3>
                {past.map(renderRow)}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ClosuresPanel;
