import React, { useEffect, useMemo, useState } from 'react';
import { X, Clock, Trash2, CheckCircle2, Plus, Repeat, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';
import { database } from '../../lib/database';
import { useToast } from '../Layout/ToastProvider';
import './ShiftScheduler.css';

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Hours between two "HH:MM" strings, or 0 if they don't make sense. */
const hoursBetween = (start, end) => {
  const [sh, sm] = (start || '').split(':').map(Number);
  const [eh, em] = (end || '').split(':').map(Number);
  if ([sh, sm, eh, em].some((n) => !Number.isFinite(n))) return 0;
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  return mins > 0 ? Math.round((mins / 60) * 100) / 100 : 0;
};

/** A TIME column comes back as an ISO timestamp on a placeholder day. */
const clock = (value) => {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
};

/**
 * Scheduling paid hours that aren't a class.
 *
 * "Lisa tomorrow 10 to 1 on front desk, then 1 to 2 for the Junior Jams class."
 * Two blocks, two kinds of work, two rates — and the point of doing it here is
 * that the cost is decided while the rota is, not reconstructed at month end.
 * So the form says what the block will pay, in dollars, before it is saved.
 */
const ShiftScheduler = ({ onClose, onSaved, defaultDate }) => {
  const toast = useToast();

  const [staff, setStaff] = useState([]);
  const [categories, setCategories] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    staffId: '',
    date: defaultDate || today,
    startTime: '10:00',
    endTime: '13:00',
    payCategoryKey: '',
    payRateOverride: '',
    title: '',
    notes: '',
    repeatWeeks: 1,
  });

  // Four weeks around the chosen day: enough to see the rota taking shape and
  // to catch "she's already booked then" before the server has to say it.
  const range = useMemo(() => {
    const anchor = new Date(`${form.date || today}T00:00:00Z`);
    const from = new Date(anchor); from.setUTCDate(from.getUTCDate() - 7);
    const to = new Date(anchor); to.setUTCDate(to.getUTCDate() + 21);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }, [form.date, today]);

  const loadShifts = async () => {
    try {
      setShifts(await database.fetchShifts({ from: range.from, to: range.to }));
    } catch {
      // The list is context, not the job — a failure here must not block
      // scheduling, so the panel stays usable with an empty list.
      setShifts([]);
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [teacherRes, adminRes, deskRes, cats] = await Promise.all([
          api.get('/users?role=TEACHER&status=ACTIVE&limit=200'),
          api.get('/users?role=ADMIN&status=ACTIVE&limit=200'),
          api.get('/users?role=RECEPTIONIST&status=ACTIVE&limit=200'),
          database.fetchPayCategories({ activeOnly: true }),
        ]);
        if (!alive) return;
        // One person can hold several roles, so the three lists overlap.
        const byId = new Map();
        [...teacherRes.data.users, ...adminRes.data.users, ...deskRes.data.users]
          .forEach((u) => byId.set(u.id, u));
        setStaff([...byId.values()].sort((a, b) => (a.fullName || '').localeCompare(b.fullName || '')));
        setCategories(cats);
      } catch (err) {
        if (alive) toast.error(err.userMessage || 'Could not load staff and pay categories.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => { loadShifts(); }, [range.from, range.to]);

  const selectedPerson = staff.find((s) => s.id === form.staffId);
  const selectedCategory = categories.find((c) => c.key === form.payCategoryKey);
  const hours = hoursBetween(form.startTime, form.endTime);

  // What this block will pay, worked out the same way payroll will: a rate
  // typed here wins, otherwise the category's rate. A person's own rate and
  // their base rate live on the server, so when neither of those two is set the
  // honest answer is "their usual rate" rather than a number invented here.
  const explicitRate = form.payRateOverride.trim() !== ''
    ? parseFloat(form.payRateOverride)
    : (selectedCategory?.defaultRate ?? null);
  const cost = explicitRate != null && Number.isFinite(explicitRate) ? hours * explicitRate : null;

  const handleSubmit = async () => {
    if (!form.staffId) return toast.error('Pick who is working.');
    if (hours <= 0) return toast.error('The shift has to end after it starts.');

    setSaving(true);
    try {
      const res = await database.createShift({
        staffId: form.staffId,
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        payCategoryKey: form.payCategoryKey || null,
        payRateOverride: form.payRateOverride.trim(),
        title: form.title.trim() || null,
        notes: form.notes.trim() || null,
        repeatWeeks: Number(form.repeatWeeks) || 1,
      });
      toast.success(res.message || 'Scheduled.');
      // The person and the hours usually stay the same for the next block of
      // the day — only what they're doing changes. Clearing the whole form
      // would make "10–1 desk, then 1–2 class" twice the typing.
      setForm((f) => ({
        ...f,
        startTime: f.endTime,
        endTime: '',
        payCategoryKey: '',
        payRateOverride: '',
        title: '',
        notes: '',
        repeatWeeks: 1,
      }));
      await loadShifts();
      onSaved?.();
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not schedule that shift.');
    } finally {
      setSaving(false);
    }
  };

  const markWorked = async (shift) => {
    setBusyId(shift.id);
    try {
      await database.updateShift(shift.id, { status: 'COMPLETED' });
      await loadShifts();
      onSaved?.();
      toast.success('Marked as worked — it will be paid in that month.');
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not update that shift.');
    } finally {
      setBusyId(null);
    }
  };

  const removeShift = async (shift) => {
    setBusyId(shift.id);
    try {
      const res = await database.deleteShift(shift.id);
      await loadShifts();
      onSaved?.();
      toast.success(res.message || 'Removed.');
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not remove that shift.');
    } finally {
      setBusyId(null);
    }
  };

  const grouped = useMemo(() => {
    const map = new Map();
    shifts.forEach((s) => {
      const key = new Date(s.date).toISOString().slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [shifts]);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="shift-scheduler" onClick={(e) => e.stopPropagation()}>
        <header className="shift-header">
          <div>
            <h2><Clock size={20} /> Work shifts</h2>
            <p>Paid hours that aren't a class — reception, planning, meetings. The kind of work sets the rate.</p>
          </div>
          <button className="close-modal" onClick={onClose}><X size={20} /></button>
        </header>

        {loading ? (
          <div className="shift-state">
            <div className="app-loader"><div className="app-spinner" /><span className="app-loader-text">Loading…</span></div>
          </div>
        ) : (
          <div className="shift-body">
            <div className="shift-form">
              <label className="shift-field">
                <span>Who</span>
                <select
                  className="form-control"
                  value={form.staffId}
                  onChange={(e) => setForm((f) => ({ ...f, staffId: e.target.value }))}
                >
                  <option value="">Pick someone…</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>{s.fullName}</option>
                  ))}
                </select>
              </label>

              <div className="shift-field-row">
                <label className="shift-field">
                  <span>Date</span>
                  <input
                    type="date" className="form-control"
                    value={form.date}
                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  />
                </label>
                <label className="shift-field shift-field-sm">
                  <span>From</span>
                  <input
                    type="time" className="form-control"
                    value={form.startTime}
                    onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
                  />
                </label>
                <label className="shift-field shift-field-sm">
                  <span>To</span>
                  <input
                    type="time" className="form-control"
                    value={form.endTime}
                    onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
                  />
                </label>
              </div>

              <label className="shift-field">
                <span>Kind of work</span>
                <select
                  className="form-control"
                  value={form.payCategoryKey}
                  onChange={(e) => setForm((f) => ({ ...f, payCategoryKey: e.target.value }))}
                >
                  <option value="">No category (paid at their base rate)</option>
                  {categories.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}{c.defaultRate != null ? ` — ${money(c.defaultRate)}/hr` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <div className="shift-field-row">
                <label className="shift-field">
                  <span>Rate just for this shift <small>optional</small></span>
                  <div className="shift-rate-input">
                    <span>$</span>
                    <input
                      type="number" min="0" step="0.01" inputMode="decimal"
                      className="form-control"
                      value={form.payRateOverride}
                      onChange={(e) => setForm((f) => ({ ...f, payRateOverride: e.target.value }))}
                      placeholder={selectedCategory?.defaultRate != null ? String(selectedCategory.defaultRate) : 'usual rate'}
                    />
                    <span>/hr</span>
                  </div>
                </label>
                <label className="shift-field shift-field-sm">
                  <span><Repeat size={12} /> Repeat</span>
                  <select
                    className="form-control"
                    value={form.repeatWeeks}
                    onChange={(e) => setForm((f) => ({ ...f, repeatWeeks: e.target.value }))}
                  >
                    <option value={1}>Just once</option>
                    <option value={4}>4 weeks</option>
                    <option value={8}>8 weeks</option>
                    <option value={12}>12 weeks</option>
                  </select>
                </label>
              </div>

              <label className="shift-field">
                <span>Label <small>optional — shown on the calendar</small></span>
                <input
                  className="form-control"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder={selectedCategory?.label || 'e.g. Front desk — morning'}
                />
              </label>

              {/* The whole point of scheduling here: the cost is visible while
                  the rota is being built, not worked out at month end. */}
              <div className="shift-preview">
                {hours > 0 ? (
                  <>
                    <strong>{hours} h</strong>
                    {cost != null ? (
                      <> × {money(explicitRate)} = <strong className="shift-cost">{money(cost)}</strong></>
                    ) : (
                      <> at {selectedPerson ? `${selectedPerson.fullName}'s` : 'their'} usual rate</>
                    )}
                    {Number(form.repeatWeeks) > 1 && cost != null && (
                      <span className="shift-preview-total">
                        {form.repeatWeeks} weeks — {money(cost * Number(form.repeatWeeks))} in total
                      </span>
                    )}
                  </>
                ) : (
                  <span className="shift-preview-empty">Set a start and end time.</span>
                )}
              </div>

              <button className="shift-submit" onClick={handleSubmit} disabled={saving}>
                <Plus size={15} /> {saving ? 'Scheduling…' : 'Schedule it'}
              </button>
            </div>

            <div className="shift-list">
              <h3>Scheduled {range.from} → {range.to}</h3>
              {grouped.length === 0 ? (
                <p className="shift-empty">Nothing scheduled in these four weeks.</p>
              ) : (
                grouped.map(([date, rows]) => (
                  <div className="shift-day" key={date}>
                    <div className="shift-day-label">
                      {new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
                        weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
                      })}
                    </div>
                    {rows.map((s) => (
                      <div className={`shift-item shift-item-${s.status.toLowerCase()}`} key={s.id}>
                        <span className="shift-item-dot" style={s.categoryColor ? { background: s.categoryColor } : undefined} />
                        <div className="shift-item-main">
                          <strong>{s.staff?.fullName}</strong>
                          <span>{clock(s.startTime)}–{clock(s.endTime)} · {s.categoryLabel || 'No category'}</span>
                        </div>
                        <div className="shift-item-meta">
                          <span>{s.hours} h</span>
                          {s.payRateOverride != null && <small>{money(s.payRateOverride)}/hr</small>}
                        </div>
                        <div className="shift-item-actions">
                          {s.status === 'SCHEDULED' ? (
                            <button
                              className="shift-mark"
                              onClick={() => markWorked(s)}
                              disabled={busyId === s.id}
                              title="Confirm it happened — this is what makes it pay"
                            >
                              <CheckCircle2 size={14} /> Worked
                            </button>
                          ) : (
                            <span className="shift-done"><CheckCircle2 size={13} /> Worked</span>
                          )}
                          <button
                            className="shift-remove"
                            onClick={() => removeShift(s)}
                            disabled={busyId === s.id}
                            title={s.status === 'COMPLETED' ? 'Cancel — it stops counting towards pay' : 'Remove'}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}

              <p className="shift-footnote">
                <AlertTriangle size={13} />
                A shift only reaches payroll once it's marked worked — scheduling somebody never
                creates money on its own.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ShiftScheduler;
