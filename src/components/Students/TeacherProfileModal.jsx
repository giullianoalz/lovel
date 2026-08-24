import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, DollarSign, Calendar, Clock, BookOpen, Briefcase, TrendingUp, ChevronLeft, ChevronRight, Mail, Phone, MapPin, Pencil, Save, Receipt, Coffee, Lock, LogIn } from 'lucide-react';
import { database } from '../../lib/database';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../Layout/ToastProvider';
import ErrorBanner from '../Layout/ErrorBanner';
import './TeacherProfileModal.css';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Why an hour was paid what it was, in as few words as fit next to the money.
 *
 * The rate cascade has five steps and an admin signing off pay should never
 * have to guess which one applied — "$30.00 · category rate" answers it on the
 * line itself.
 */
const RATE_SOURCE_TEXT = {
  event: 'set on this entry',
  flat: 'flat rate',
  teacher: 'personal rate',
  category: 'category rate',
  base: 'base rate',
  unset: 'no rate set',
  salaried: 'covered by salary',
  unpaid: 'draws no pay',
  // Stamped before the sources were recorded, or by a path that didn't name
  // one. Still a real frozen rate — just without the "why".
  frozen: 'rate at the time',
};

/**
 * How somebody is paid, as a choice rather than something inferred from
 * whatever is in the salary box.
 *
 * The box alone could not tell these apart: empty meant "nobody has said",
 * a figure meant a salary, and `0` meant — depending on who you asked — either
 * "the owners draw nothing" or "salaried at zero", which the engine read as
 * "your salary covers every hour you work" and paid the person nothing. Making
 * the arrangement the first thing the admin picks means the ambiguous state
 * cannot be typed.
 */
const ARRANGEMENTS = [
  {
    key: 'hourly',
    label: 'Paid by the hour',
    hint: 'Every hour on the calendar is priced by the kind of work it was.',
  },
  {
    key: 'salaried',
    label: 'On a salary',
    hint: 'The salary covers the hours worked — nothing is paid per hour on top.',
  },
  {
    key: 'unpaid',
    label: 'Draws no pay',
    hint: 'On the roster, but the academy pays them nothing. For the owners.',
  },
];

/** Which arrangement a saved payroll record represents. Mirrors `rateSetup`. */
const arrangementOf = (payroll) => {
  if (payroll?.rateSetup === 'salaried') return 'salaried';
  // An explicit zero with no hourly rate anywhere is somebody recorded as
  // taking nothing, not somebody nobody has got round to pricing.
  if (payroll?.salaryAmount === 0 && payroll?.hourlyRate == null && !payroll?.flatRateOnly
      && !(payroll?.categoryRates || []).some((c) => c.rate != null)) {
    return 'unpaid';
  }
  return 'hourly';
};

const num = (value) => {
  if (value == null || String(value).trim() === '') return null;
  const n = parseFloat(String(value).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * What one hour of a given category would pay under the rates currently typed
 * into the form — the server's cascade, run in the browser.
 *
 * Deliberately a copy, and deliberately only ever used to *show* a number:
 * payroll is computed on the server and stays that way. What this buys is that
 * an admin can see the consequence of a rate before saving it, instead of
 * saving, closing, re-reading the month and working out what changed. It is
 * kept in the same order as `resolveRate` in payroll.service.js so the two can
 * be read side by side.
 */
const previewRate = (categoryKey, form, categories) => {
  if (form.arrangement === 'salaried') return { rate: 0, source: 'salaried' };
  if (form.arrangement === 'unpaid') return { rate: 0, source: 'unpaid' };

  const hourly = num(form.hourlyRate);
  if (form.flatRateOnly && hourly != null) return { rate: hourly, source: 'flat' };

  const own = num(form.categoryRates[categoryKey]);
  if (own != null) return { rate: own, source: 'teacher' };

  const category = categories.find((c) => c.category === categoryKey);
  if (category?.categoryDefault != null) return { rate: category.categoryDefault, source: 'category' };

  if (hourly != null) return { rate: hourly, source: 'base' };
  return { rate: 0, source: 'unset' };
};

/** A TIME column comes back as an ISO timestamp on a placeholder day. */
const clock = (value) => {
  if (!value) return '';
  const d = new Date(value);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
};

const TeacherProfileModal = ({ teacher, onClose }) => {
  const { hasRole } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [payrollData, setPayrollData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth() + 1);
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());

  // Reading your own pay is fine; setting it is not — the server enforces the
  // same rule, this only keeps the controls out of a teacher's way.
  const canEditPay = hasRole('ADMIN');
  const [isEditingRates, setIsEditingRates] = useState(false);
  const [rateForm, setRateForm] = useState({ arrangement: 'hourly', baseSalary: '', salaryPeriod: 'MONTHLY', hourlyRate: '', flatRateOnly: false, categoryRates: {} });
  const [savingRates, setSavingRates] = useState(false);
  // The hours already on this person's calendar, so the editor can price them
  // live. Fetched once when the card is opened for editing rather than with the
  // month: it is a forecast, it does not change while somebody types, and
  // nobody reading their own payslip needs it.
  const [committed, setCommitted] = useState(null);

  const loadPayroll = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await database.fetchTeacherPayroll(teacher.id, currentMonth, currentYear);
      setPayrollData(data);
    } catch (err) {
      console.error('Error loading payroll:', err);
      setError(err.userMessage || 'Could not load payroll for this teacher.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPayroll();
  }, [teacher.id, currentMonth, currentYear]);

  const handleStartEditRates = () => {
    // Only the override itself goes into the form, never the effective rate:
    // prefilling an inherited $20 would turn "falls back to base" into a
    // hard-coded override the moment anyone pressed Save.
    const categoryRates = {};
    (payroll?.categoryRates || []).forEach(c => {
      categoryRates[c.category] = c.rate != null ? String(c.rate) : '';
    });
    setRateForm({
      arrangement: arrangementOf(payroll),
      // The agreed figure, not the month's share: someone hired at $63,000 a
      // year must see 63,000 here, or saving would file a twelfth of their
      // salary as the new yearly one. A zero prefills as "0" and reads as the
      // "draws no pay" arrangement, which is what it always meant.
      baseSalary: payroll?.salaryAmount ? String(payroll.salaryAmount) : '',
      salaryPeriod: payroll?.salaryPeriod || 'MONTHLY',
      hourlyRate: payroll?.hourlyRate != null ? String(payroll.hourlyRate) : '',
      flatRateOnly: Boolean(payroll?.flatRateOnly),
      categoryRates,
    });
    setIsEditingRates(true);

    // What this person is already booked for. Priced against whatever is in the
    // form, it turns "$50 an hour" — a number nobody can size — into "$11,900
    // between now and December", which is the number the decision is actually
    // about. Failing to load it costs the preview and nothing else, so it is
    // swallowed rather than shown as an error over a card that works.
    setCommitted(null);
    database.fetchMyProjectedPayroll(teacher.id, { weeks: 12 })
      .then((res) => setCommitted(res?.row ? res : null))
      .catch(() => setCommitted(null));
  };

  const handleSaveRates = async () => {
    // A salary of zero is the state that used to pay people nothing while
    // telling them a salary covered it. It is now unreachable rather than
    // merely discouraged: to say somebody takes nothing you pick "Draws no
    // pay", which is a different arrangement with different consequences.
    if (rateForm.arrangement === 'salaried' && !(num(rateForm.baseSalary) > 0)) {
      toast.error('A salary has to be more than zero. If this person takes nothing, choose "Draws no pay".');
      return;
    }
    setSavingRates(true);
    try {
      const categoryRates = {};
      Object.entries(rateForm.categoryRates).forEach(([k, v]) => { categoryRates[k] = v.trim(); });
      // The arrangement decides what gets sent, so the saved record can never
      // disagree with the choice on screen — an hourly person cannot keep a
      // stale salary, and somebody drawing no pay cannot keep an old rate that
      // would quietly start paying them again when a shift is scheduled.
      const arrangement = rateForm.arrangement;
      const blankRates = Object.fromEntries(Object.keys(categoryRates).map((k) => [k, '']));
      await database.updateTeacherPayroll(teacher.id, {
        // '' clears the field server-side rather than sending NaN. Zero is only
        // ever written for "draws no pay", where it is the record of a decision.
        baseSalary: arrangement === 'salaried' ? rateForm.baseSalary.trim()
          : arrangement === 'unpaid' ? '0'
            : '',
        salaryPeriod: rateForm.salaryPeriod,
        hourlyRate: arrangement === 'hourly' ? rateForm.hourlyRate.trim() : '',
        flatRateOnly: arrangement === 'hourly' && rateForm.flatRateOnly,
        categoryRates: arrangement === 'hourly' ? categoryRates : blankRates,
      });
      setIsEditingRates(false);
      // Reload rather than patch locally: the month's total is derived from
      // these rates, so the whole breakdown above is now stale.
      await loadPayroll();
      toast.success(`Pay rates updated for ${teacher.name}.`);
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not save the pay rates.');
    } finally {
      setSavingRates(false);
    }
  };

  const handlePrevMonth = () => {
    if (currentMonth === 1) {
      setCurrentMonth(12);
      setCurrentYear(y => y - 1);
    } else {
      setCurrentMonth(m => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 12) {
      setCurrentMonth(1);
      setCurrentYear(y => y + 1);
    } else {
      setCurrentMonth(m => m + 1);
    }
  };

  const payroll = payrollData?.payroll;
  const classes = payrollData?.classes || [];

  /**
   * The hours already booked for this person over the next twelve weeks,
   * repriced against whatever is currently typed into the form.
   *
   * This is the whole point of the editor being more than four boxes. A rate is
   * abstract — $50 an hour is neither large nor small until you know it is
   * attached to 238 hours somebody already put on the calendar. Grouped by the
   * kind of work, because that is the unit the rates are set in, so raising the
   * in-person rate visibly moves the in-person line and nothing else.
   */
  const commitment = (() => {
    if (!committed?.row || !payroll) return null;
    const lines = committed.row.upcomingLines || [];
    if (lines.length === 0) return null;

    const byCategory = new Map();
    for (const line of lines) {
      const key = line.category || null;
      const bucket = byCategory.get(key) || { key, label: line.categoryLabel || 'Uncategorised', color: line.categoryColor, hours: 0, coTaughtHours: 0 };
      bucket.hours += line.hours;
      if (line.role === 'co-teacher') bucket.coTaughtHours += line.hours;
      byCategory.set(key, bucket);
    }

    const groups = [...byCategory.values()]
      .map((b) => {
        const { rate, source } = previewRate(b.key, rateForm, payroll.categoryRates || []);
        return {
          ...b,
          hours: Math.round(b.hours * 100) / 100,
          // Rounded here as well as in the total: summing float hours leaves
          // "67.91999999999997 h as co-teacher" on screen otherwise.
          coTaughtHours: Math.round(b.coTaughtHours * 100) / 100,
          rate,
          source,
          amount: b.hours * rate,
        };
      })
      .sort((a, b) => b.amount - a.amount || b.hours - a.hours);

    return {
      groups,
      hours: Math.round(groups.reduce((n, g) => n + g.hours, 0) * 100) / 100,
      total: groups.reduce((n, g) => n + g.amount, 0),
      // Hours in this window spent covering somebody else's class. Shown
      // separately because it is bought on top of a teacher who is already
      // being paid for the same hour, and nothing else on the screen says so.
      coTaughtHours: Math.round(groups.reduce((n, g) => n + g.coTaughtHours, 0) * 100) / 100,
      from: committed.startDate,
      to: committed.endDate,
    };
  })();

  // Only an admin can open somebody else's portal, and only for someone who
  // actually teaches — a salaried front-desk account has no roster to show.
  const teacherRoles = teacher.role ? [teacher.role, ...(teacher.secondaryRoles || [])] : ['TEACHER'];
  const canOpenPortal = hasRole('ADMIN') && teacherRoles.includes('TEACHER');

  // Jump into their day exactly as they see it. The portal reads ?teacherId=
  // and the server re-checks that the caller is allowed to look, so this is a
  // view of their roster rather than a session as them.
  const openTeacherPortal = () => {
    onClose();
    navigate(`/portal/teacher?teacherId=${teacher.id}`);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content profile-modal teacher-profile-modal" onClick={e => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}><X size={24} /></button>

        {/* Header */}
        <header className="profile-header teacher-header">
          <div className="student-main-info">
            <div className="teacher-avatar-lg">{teacher.name[0]}</div>
            <div>
              <h2 className="student-name" style={{ fontSize: '24px', margin: '0 0 4px 0' }}>{teacher.name}</h2>
              <span className={`status-tag ${teacher.status?.replace(' ', '').toLowerCase()}`}>
                {teacher.status}
              </span>
              {/* Every hat this person wears, not a hardcoded "Teacher": the
                  payroll roster now includes front desk and salaried admins,
                  and mislabelling somebody on their own pay card is how an
                  admin starts doubting the figure beside it. */}
              {(teacher.role
                ? [teacher.role, ...(teacher.secondaryRoles || [])]
                : ['TEACHER']
              ).map(r => (
                <span className="role-badge" key={r}>
                  {r === 'RECEPTIONIST' ? 'Front Desk' : r.charAt(0) + r.slice(1).toLowerCase()}
                </span>
              ))}
            </div>
          </div>
          <div className="teacher-contact-bar">
            <span><Mail size={14} /> {teacher.email}</span>
            <span><Phone size={14} /> {teacher.phone}</span>
            {canOpenPortal && (
              <button type="button" className="teacher-portal-jump" onClick={openTeacherPortal}>
                <LogIn size={14} /> Open their portal
              </button>
            )}
          </div>
        </header>

        <div className="teacher-profile-body">
          {/* Left: Payroll Summary */}
          <div className="profile-col">
            {/* Month Navigator */}
            <div className="month-navigator">
              <button onClick={handlePrevMonth} className="month-nav-btn"><ChevronLeft size={18} /></button>
              <h3 className="month-label">{MONTH_NAMES[currentMonth - 1]} {currentYear}</h3>
              <button onClick={handleNextMonth} className="month-nav-btn"><ChevronRight size={18} /></button>
            </div>

            {loading ? (
              <div className="payroll-loading">Calculating payroll...</div>
            ) : error ? (
              <ErrorBanner message={error} onRetry={loadPayroll} />
            ) : payroll ? (
              <>
                {/* Total Earnings Card */}
                <div className="payroll-total-card">
                  <div className="payroll-total-header">
                    <DollarSign size={22} />
                    <span>Total Earnings</span>
                  </div>
                  <div className="payroll-total-amount">
                    ${payroll.totalEarnings.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                  <div className="payroll-total-sessions">
                    <Calendar size={14} /> {payroll.totalHours} h across {payroll.totalSessionCount} session{payroll.totalSessionCount === 1 ? '' : 's'}
                    {payroll.totalShiftCount > 0 && <> and {payroll.totalShiftCount} shift{payroll.totalShiftCount === 1 ? '' : 's'}</>}
                  </div>
                </div>

                {/* Breakdown */}
                <div className="payroll-breakdown">
                  <h4><Briefcase size={16} /> Earnings Breakdown</h4>
                  
                  {payroll.baseSalary > 0 && (
                    <div className="breakdown-item">
                      <div className="breakdown-label">
                        <MapPin size={14} />
                        <span>Base Salary (Fixed)</span>
                      </div>
                      <div className="breakdown-value">
                        ${payroll.baseSalary.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                  )}

                  {/* One line per kind of work, so the hours behind the total
                      are readable without opening the rate settings. */}
                  {(payroll.breakdown || []).map(b => (
                    <div className="breakdown-item" key={b.category || 'none'}>
                      <div className="breakdown-label">
                        <span className="cat-dot" style={b.color ? { background: b.color } : undefined} />
                        <span>
                          {b.label} ({b.hours} h × {b.mixedRates ? 'mixed rates' : money(b.rate)})
                        </span>
                      </div>
                      <div className="breakdown-value accent">
                        {money(b.amount)}
                      </div>
                    </div>
                  ))}

                  {/* A month with real teaching and a $0 total is nearly always
                      a missing rate, not a teacher who did nothing. Say so. */}
                  {payroll.unratedHours > 0 && (
                    <div className="breakdown-warning">
                      {payroll.unratedHours} h taught with no rate set — those hours are
                      counted as $0. Set an hourly rate below.
                    </div>
                  )}

                  <div className="breakdown-divider" />

                  <div className="breakdown-item total">
                    <div className="breakdown-label">
                      <TrendingUp size={14} />
                      <span>Grand Total</span>
                    </div>
                    <div className="breakdown-value total">
                      ${payroll.totalEarnings.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>

                {/* Rate Info */}
                <div className="rate-info-card">
                  <div className="rate-card-header">
                    <h4>Rate Configuration</h4>
                    {canEditPay && !isEditingRates && (
                      <button className="rate-edit-btn" onClick={handleStartEditRates} title="Edit pay rates">
                        <Pencil size={14} /> Edit
                      </button>
                    )}
                  </div>

                  {isEditingRates ? (
                    <>
                      {/* The first decision, and the one everything else hangs
                          off. It used to be implied by whatever was in the
                          salary box, which is how "0" came to mean two opposite
                          things at once. */}
                      <h5 className="rate-subhead rate-subhead-first">How is this person paid?</h5>
                      <div className="rate-arrangement" role="radiogroup" aria-label="Pay arrangement">
                        {ARRANGEMENTS.map(a => (
                          <button
                            key={a.key}
                            type="button"
                            role="radio"
                            aria-checked={rateForm.arrangement === a.key}
                            className={`rate-arrangement-opt${rateForm.arrangement === a.key ? ' is-active' : ''}`}
                            onClick={() => setRateForm(f => ({ ...f, arrangement: a.key }))}
                          >
                            <strong>{a.label}</strong>
                            <small>{a.hint}</small>
                          </button>
                        ))}
                      </div>

                      {rateForm.arrangement === 'salaried' && (
                        <>
                          <label className="rate-edit-row">
                            <span>Salary</span>
                            <div className="rate-input-wrap rate-input-wrap-split">
                              <span className="rate-currency">$</span>
                              <input
                                type="number" min="0" step="0.01" inputMode="decimal"
                                className="form-control"
                                value={rateForm.baseSalary}
                                onChange={e => setRateForm(f => ({ ...f, baseSalary: e.target.value }))}
                                placeholder="0.00"
                                autoFocus
                              />
                              {/* Enter the figure the person was hired on.
                                  Payroll runs monthly and divides a yearly
                                  salary by 12 — typing the yearly number into a
                                  monthly field is how $63,000 a year became
                                  $63,000 a month. */}
                              <select
                                className="form-control rate-period-select"
                                value={rateForm.salaryPeriod}
                                onChange={e => setRateForm(f => ({ ...f, salaryPeriod: e.target.value }))}
                                aria-label="Salary period"
                              >
                                <option value="MONTHLY">per month</option>
                                <option value="ANNUAL">per year</option>
                              </select>
                            </div>
                          </label>
                          <p className="rate-hint rate-hint-tight">
                            {num(rateForm.baseSalary) > 0 ? (
                              <>
                                {rateForm.salaryPeriod === 'ANNUAL'
                                  ? <>Paid as <strong>{money(num(rateForm.baseSalary) / 12)}</strong> a month. </>
                                  : <>Paid as <strong>{money(num(rateForm.baseSalary) * 12)}</strong> a year. </>}
                                Every hour they teach or cover is paid by this salary and adds
                                nothing on top — payslip lines will read “covered by salary”.
                              </>
                            ) : (
                              <>Enter the salary as agreed. If this person takes nothing, pick
                                “Draws no pay” instead — a salary of zero is not the same thing,
                                and saving one would stop paying them for hours they work.</>
                            )}
                          </p>
                        </>
                      )}

                      {rateForm.arrangement === 'unpaid' && (
                        <p className="rate-hint rate-hint-tight">
                          Recorded as taking no pay — no salary, no hourly rate. They stay on the
                          payroll screen with a total of $0, so the zero reads as a decision rather
                          than a rate somebody forgot to set.
                        </p>
                      )}

                      {rateForm.arrangement === 'hourly' && (
                        <>
                          {/* "She gets $17.50 an hour, whatever she's doing."
                              With this on, the category rates below stop
                              applying — only a rate typed onto one calendar
                              entry still wins. */}
                          <label className="rate-flat-toggle">
                            <input
                              type="checkbox"
                              checked={rateForm.flatRateOnly}
                              onChange={e => setRateForm(f => ({ ...f, flatRateOnly: e.target.checked }))}
                            />
                            <span>
                              <strong>Same rate for every kind of work</strong>
                              <small>One rate whatever they are doing — front desk, teaching, planning.</small>
                            </span>
                          </label>

                          <label className="rate-edit-row">
                            <span>{rateForm.flatRateOnly ? 'Their rate' : 'Fallback hourly rate'}</span>
                            <div className="rate-input-wrap">
                              <span className="rate-currency">$</span>
                              <input
                                type="number" min="0" step="0.01" inputMode="decimal"
                                className="form-control"
                                value={rateForm.hourlyRate}
                                onChange={e => setRateForm(f => ({ ...f, hourlyRate: e.target.value }))}
                                placeholder="0.00"
                                autoFocus
                              />
                            </div>
                          </label>

                          {!rateForm.flatRateOnly && (
                            <>
                              <h5 className="rate-subhead">What each kind of work pays them</h5>
                              {(payroll.categoryRates || []).filter(c => c.active !== false).map(c => {
                                const { rate, source } = previewRate(c.category, rateForm, payroll.categoryRates || []);
                                const own = num(rateForm.categoryRates[c.category]) != null;
                                return (
                                  <label className="rate-edit-row" key={c.category}>
                                    <span>
                                      <span className="cat-dot" style={c.color ? { background: c.color } : undefined} />
                                      {c.label}
                                    </span>
                                    <div className="rate-edit-side">
                                      <div className="rate-input-wrap">
                                        <span className="rate-currency">$</span>
                                        <input
                                          type="number" min="0" step="0.01" inputMode="decimal"
                                          className="form-control"
                                          value={rateForm.categoryRates[c.category] ?? ''}
                                          onChange={e => setRateForm(f => ({
                                            ...f,
                                            categoryRates: { ...f.categoryRates, [c.category]: e.target.value },
                                          }))}
                                          placeholder={c.categoryDefault != null ? String(c.categoryDefault) : '—'}
                                        />
                                      </div>
                                      {/* The number that will actually be paid,
                                          not the box that may be empty. An
                                          empty box is the commonest state on
                                          this screen and it still costs money —
                                          leaving it blank and silent is how
                                          everybody ended up on the category
                                          default without anyone deciding it. */}
                                      <span className={`rate-effective${own ? ' is-own' : ''}`}>
                                        {source === 'unset'
                                          ? <em>no rate — pays $0</em>
                                          : <>pays {money(rate)}/hr · {RATE_SOURCE_TEXT[source] || source}</>}
                                      </span>
                                    </div>
                                  </label>
                                );
                              })}
                              <p className="rate-hint">
                                Leave a box empty to use the category's own rate — fill one in only to
                                pay this person differently from everyone else for that work. The kind
                                of work is picked on the calendar entry, so the same person can be at
                                the desk at 10 and teaching at 1 on two different rates.
                              </p>
                            </>
                          )}
                        </>
                      )}

                      {/* What the decision above actually costs, against hours
                          that are already booked. A rate on its own is a number
                          nobody can size; the same rate multiplied by the
                          timetable somebody already built is the thing being
                          decided. */}
                      {commitment && (
                        <div className="rate-commitment">
                          <div className="rate-commitment-head">
                            {/* First name only: the modal header already says
                                who this is, and "Already booked for Georges"
                                fits where the full name would wrap. */}
                            <span>Already booked for {teacher.name?.split(' ')[0] || 'them'}</span>
                            {/* On an hourly arrangement the headline is the
                                money, because that is the decision. On the
                                others it is the hours: a bold "$0.00" over a
                                calendar full of work reads as a fault, not as
                                "the salary covers this". */}
                            <strong>
                              {rateForm.arrangement === 'hourly' ? money(commitment.total) : `${commitment.hours} h`}
                            </strong>
                          </div>
                          <p className="rate-commitment-sub">
                            {commitment.hours} h booked between{' '}
                            {new Date(commitment.from).toLocaleDateString('en-US', { timeZone: 'UTC', day: 'numeric', month: 'short' })} and{' '}
                            {new Date(commitment.to).toLocaleDateString('en-US', { timeZone: 'UTC', day: 'numeric', month: 'short' })}
                            {rateForm.arrangement === 'hourly'
                              ? ', priced at the rates above.'
                              : rateForm.arrangement === 'salaried'
                                ? ' — all covered by the salary, nothing paid per hour on top.'
                                : ' — none of it paid, on this arrangement.'}
                          </p>
                          <ul className="rate-commitment-list">
                            {commitment.groups.map(g => (
                              <li key={g.key || '__none__'}>
                                <span>
                                  <span className="cat-dot" style={g.color ? { background: g.color } : undefined} />
                                  {g.label}
                                  {g.coTaughtHours > 0 && (
                                    <em className="rate-commitment-co" title="Hours covering a class that is somebody else's — the other teacher is paid for the same hour too">
                                      {g.coTaughtHours} h as co-teacher
                                    </em>
                                  )}
                                </span>
                                <span>
                                  {/* "79.92 h × $0.00 = $0.00" is arithmetic
                                      nobody needs: on a salary the hours are
                                      not being multiplied by anything, they are
                                      being covered. */}
                                  {rateForm.arrangement === 'hourly'
                                    ? <>{g.hours} h × {money(g.rate)} = <strong>{money(g.amount)}</strong></>
                                    : <>{g.hours} h</>}
                                </span>
                              </li>
                            ))}
                          </ul>
                          <p className="rate-hint rate-hint-tight">
                            A forecast, not a bill: it moves when classes are added, cancelled or
                            rescheduled. Hours already worked keep the rate they were worked at —
                            changing a rate here never rewrites a month already paid.
                          </p>
                        </div>
                      )}

                      <div className="rate-edit-actions">
                        <button className="cancel-btn" onClick={() => setIsEditingRates(false)} disabled={savingRates}>
                          Cancel
                        </button>
                        <button className="save-btn" onClick={handleSaveRates} disabled={savingRates}>
                          <Save size={14} /> {savingRates ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* One sentence saying how this person is paid, before
                          any figure. Reading two rows — a salary and an hourly
                          rate, either of which might be blank — and working out
                          which one governs was the step where an admin could
                          walk away with the wrong idea. */}
                      <div className={`rate-arrangement-badge is-${payroll.rateSetup || 'unset'}`}>
                        {payroll.rateSetup === 'salaried' ? (
                          <>
                            <strong>On a salary</strong>
                            <span>
                              {payroll.salaryPeriod === 'ANNUAL'
                                ? <>{money(payroll.salaryAmount)}/yr · {money(payroll.baseSalary)} a month</>
                                : <>{money(payroll.baseSalary)} a month</>}
                              {' '}— hours worked are covered by it, nothing is paid per hour on top.
                            </span>
                          </>
                        /* `arrangementOf`, not a predicate written out again
                           here: the editor opens on that answer, and a card
                           that says "draws no pay" over an editor showing
                           hourly rates is worse than either alone. It caught a
                           real case — somebody on a $0 salary with a $20
                           online rate, which this screen called unpaid and the
                           editor called hourly. */
                        ) : arrangementOf(payroll) === 'unpaid' ? (
                          <>
                            <strong>Draws no pay</strong>
                            <span>Recorded as taking nothing from the academy — not a missing rate.</span>
                          </>
                        ) : payroll.rateSetup === 'default' ? (
                          <>
                            <strong>Paid by the hour, at the category rates</strong>
                            {/* The state that pays real money nobody agreed to.
                                Everyone without a personal rate lands here and
                                the screen used to look identical to a deliberate
                                arrangement. */}
                            <span>
                              Nobody has set a rate for this person, so their hours are priced at
                              whatever the category charges. It pays — it just isn't a decision
                              anyone has made about them.
                            </span>
                          </>
                        ) : payroll.rateSetup === 'unset' ? (
                          <>
                            <strong>No rate set</strong>
                            <span>Hours worked will be priced at $0 until a rate exists.</span>
                          </>
                        ) : (
                          <>
                            <strong>Paid by the hour</strong>
                            <span>
                              {payroll.flatRateOnly
                                ? <>{money(payroll.hourlyRate)}/hr for every kind of work.</>
                                : <>Priced by the kind of work, set on the calendar entry.</>}
                            </span>
                          </>
                        )}
                      </div>
                      {payroll.rateSetup !== 'salaried' && payroll.hourlyRate != null && !payroll.flatRateOnly && (
                        <div className="rate-row">
                          <span>Fallback hourly rate</span>
                          <strong>{money(payroll.hourlyRate)}/hr</strong>
                        </div>
                      )}
                      {payroll.flatRateOnly ? (
                        <p className="rate-hint rate-hint-tight">
                          Paid this rate for every kind of work. Category rates don't apply — only a
                          rate set on a single calendar entry does.
                        </p>
                      ) : (
                        (payroll.categoryRates || []).filter(c => c.active !== false).map(c => (
                          <div className="rate-row rate-row-sub" key={c.category}>
                            <span>
                              <span className="cat-dot" style={c.color ? { background: c.color } : undefined} />
                              {c.label}
                            </span>
                            <strong>
                              {c.rate != null
                                ? `${money(c.rate)}/hr`
                                : <span className="rate-inherited">
                                    {c.source === 'unset'
                                      ? 'not set'
                                      : `${money(c.effectiveRate)}/hr (${RATE_SOURCE_TEXT[c.source] || c.source})`}
                                  </span>}
                            </strong>
                          </div>
                        ))
                      )}
                    </>
                  )}
                </div>

                {/* Leave Balances */}
                <div className="rate-info-card" style={{marginTop: 16}}>
                  <h4>Leave Balances</h4>
                  <div className="rate-row">
                    <span>PTO Days Remaining</span>
                    <strong>{(payroll.totalPTODays || 12) - (payroll.usedPTODays || 0)} / {payroll.totalPTODays || 12}</strong>
                  </div>
                  <div className="rate-row">
                    <span>Sick Days Remaining</span>
                    <strong>{(payroll.totalSickDays || 8) - (payroll.usedSickDays || 0)} / {payroll.totalSickDays || 8}</strong>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-muted">No payroll data available.</p>
            )}
          </div>

          {/* Right: the statement — every paid hour, and what it paid.
              A total nobody can reconstruct is a total nobody can defend, so
              this is the line-by-line an admin reads before releasing money. */}
          <div className="profile-col">
            {payroll?.lineItems?.length > 0 && (
              <div className="statement-section">
                <h3><Receipt size={18} /> What this month paid for</h3>
                <div className="statement-list">
                  {payroll.lineItems.map(item => (
                    <div className={`statement-row${item.rateSource === 'unset' ? ' statement-row-flagged' : ''}`} key={`${item.kind}-${item.id}`}>
                      <div className="statement-when">
                        <strong>{new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</strong>
                        <small>{clock(item.startTime)}–{clock(item.endTime)}</small>
                      </div>
                      <div className="statement-what">
                        <span className="statement-title">
                          {item.kind === 'shift' ? <Coffee size={12} /> : <BookOpen size={12} />}
                          {item.title}
                        </span>
                        <span className="statement-cat">
                          <span className="cat-dot" style={item.categoryColor ? { background: item.categoryColor } : undefined} />
                          {item.categoryLabel}
                        </span>
                      </div>
                      <div className="statement-math">
                        <span>{item.hours} h × {money(item.rate)}</span>
                        <small>
                          {/* Locked means this hour has passed and its rate was
                              written down: changing the rate today cannot move
                              it. An unlocked line still prices live. */}
                          {item.locked && <Lock size={9} className="statement-lock" />}
                          {RATE_SOURCE_TEXT[item.rateSource] || item.rateSource}
                        </small>
                      </div>
                      <div className="statement-amount">{money(item.amount)}</div>
                    </div>
                  ))}
                </div>
                <div className="statement-total">
                  <span>{payroll.totalHours} h worked</span>
                  <strong>{money(payroll.hourlyEarnings)}</strong>
                </div>
              </div>
            )}

            <div className="class-history-section">
              <h3><BookOpen size={18} /> Classes & Sessions</h3>

              {classes.length > 0 ? (
                <div className="class-history-list">
                  {classes.map(cls => (
                    <div key={cls.id} className="class-history-card">
                      <div className="class-history-header">
                        <div className="class-history-name">
                          <span className={`class-type-dot ${cls.type === 'VIRTUAL' ? 'virtual' : 'in-person'}`} />
                          {cls.name}
                        </div>
                        <span className="class-session-count">
                          {cls.completedSessions} session{cls.completedSessions !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="class-history-meta">
                        <span className="class-subject-tag">{cls.subject || 'General'}</span>
                        <span className="class-type-tag">{cls.type === 'VIRTUAL' ? 'Online' : 'In-Person'}</span>
                      </div>
                      {cls.sessions && cls.sessions.length > 0 && (
                        <div className="session-mini-list">
                          {cls.sessions.slice(0, 5).map(s => (
                            <div key={s.id} className="session-mini-item">
                              <Clock size={12} />
                              <span>{new Date(s.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                              <span className="session-status-dot completed" />
                            </div>
                          ))}
                          {cls.sessions.length > 5 && (
                            <div className="session-mini-more">+{cls.sessions.length - 5} more</div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="no-classes-message">
                  <BookOpen size={32} />
                  <p>No classes assigned for this period.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TeacherProfileModal;
