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
  // Stamped before the sources were recorded, or by a path that didn't name
  // one. Still a real frozen rate — just without the "why".
  frozen: 'rate at the time',
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
  const [rateForm, setRateForm] = useState({ baseSalary: '', salaryPeriod: 'MONTHLY', hourlyRate: '', flatRateOnly: false, categoryRates: {} });
  const [savingRates, setSavingRates] = useState(false);

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
      // The agreed figure, not the month's share: someone hired at $63,000 a
      // year must see 63,000 here, or saving would file a twelfth of their
      // salary as the new yearly one.
      // `!= null`, not truthiness: an agreed salary of zero has to prefill as
      // "0", or opening the card and saving would silently downgrade it to
      // "not set" — which is a different thing, even though both pay nothing.
      baseSalary: payroll?.salaryAmount != null ? String(payroll.salaryAmount) : '',
      salaryPeriod: payroll?.salaryPeriod || 'MONTHLY',
      hourlyRate: payroll?.hourlyRate != null ? String(payroll.hourlyRate) : '',
      flatRateOnly: Boolean(payroll?.flatRateOnly),
      categoryRates,
    });
    setIsEditingRates(true);
  };

  const handleSaveRates = async () => {
    setSavingRates(true);
    try {
      const categoryRates = {};
      Object.entries(rateForm.categoryRates).forEach(([k, v]) => { categoryRates[k] = v.trim(); });
      await database.updateTeacherPayroll(teacher.id, {
        // '' clears the rate server-side rather than sending NaN.
        baseSalary: rateForm.baseSalary.trim(),
        salaryPeriod: rateForm.salaryPeriod,
        hourlyRate: rateForm.hourlyRate.trim(),
        flatRateOnly: rateForm.flatRateOnly,
        categoryRates,
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
                      <label className="rate-edit-row">
                        <span>Base Salary</span>
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
                          {/* Enter the figure the person was hired on. Payroll
                              runs monthly and divides a yearly salary by 12 —
                              typing the yearly number into a monthly field is
                              how $63,000 a year became $63,000 a month. */}
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
                      {rateForm.salaryPeriod === 'ANNUAL' && parseFloat(rateForm.baseSalary) > 0 && (
                        <p className="rate-hint rate-hint-tight">
                          Paid as ${(parseFloat(rateForm.baseSalary) / 12).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per month.
                        </p>
                      )}
                      <label className="rate-edit-row">
                        <span>Hourly Rate</span>
                        <div className="rate-input-wrap">
                          <span className="rate-currency">$</span>
                          <input
                            type="number" min="0" step="0.01" inputMode="decimal"
                            className="form-control"
                            value={rateForm.hourlyRate}
                            onChange={e => setRateForm(f => ({ ...f, hourlyRate: e.target.value }))}
                            placeholder="0.00"
                          />
                        </div>
                      </label>

                      {/* "She gets $17.50 an hour, whatever she's doing." With
                          this on, the category rates below stop applying — only
                          a rate typed onto one calendar entry still wins. */}
                      <label className="rate-flat-toggle">
                        <input
                          type="checkbox"
                          checked={rateForm.flatRateOnly}
                          onChange={e => setRateForm(f => ({ ...f, flatRateOnly: e.target.checked }))}
                        />
                        <span>
                          <strong>Same rate for everything</strong>
                          <small>Pay the hourly rate above for every kind of work, ignoring the rates below.</small>
                        </span>
                      </label>

                      <h5 className="rate-subhead">Rate by kind of work</h5>
                      {(payroll.categoryRates || []).filter(c => c.active !== false).map(c => (
                        <label className={`rate-edit-row${rateForm.flatRateOnly ? ' rate-edit-row-muted' : ''}`} key={c.category}>
                          <span>
                            <span className="cat-dot" style={c.color ? { background: c.color } : undefined} />
                            {c.label}
                          </span>
                          <div className="rate-input-wrap">
                            <span className="rate-currency">$</span>
                            <input
                              type="number" min="0" step="0.01" inputMode="decimal"
                              className="form-control"
                              value={rateForm.categoryRates[c.category] ?? ''}
                              disabled={rateForm.flatRateOnly}
                              onChange={e => setRateForm(f => ({
                                ...f,
                                categoryRates: { ...f.categoryRates, [c.category]: e.target.value },
                              }))}
                              // What this hour would pay if the box is left
                              // empty — the category's own rate first, because
                              // that is what the cascade actually reaches for.
                              placeholder={
                                c.categoryDefault != null
                                  ? `${c.categoryDefault} (category)`
                                  : rateForm.hourlyRate ? `${rateForm.hourlyRate} (base)` : '0.00'
                              }
                            />
                          </div>
                        </label>
                      ))}

                      <p className="rate-hint">
                        Pay is per hour worked, at the rate for that kind of work. A box left empty
                        falls back to the category's own rate, then to the hourly rate above — fill
                        one in only to pay this person differently from everyone else for that work.
                        The kind of work is chosen on the calendar entry, so the same person can be
                        at the front desk at 10 and teaching at 1 on two different rates.
                      </p>
                      <p className="rate-hint">
                        Changing a rate here only affects work that hasn't been confirmed yet. Hours
                        already marked complete keep the rate they were worked at, so a new contract
                        never rewrites a month that was already signed off.
                      </p>
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
                      <div className="rate-row">
                        <span>Base Salary</span>
                        <strong>
                          {/* Nothing agreed, an agreed zero, or a real figure —
                              three different answers. The owners draw no
                              salary, so "no salary" has to be sayable. */}
                          {payroll.salaryAmount == null
                            ? <span className="rate-unset">not set</span>
                            : payroll.salaryAmount === 0
                              ? <>{money(0)} <span className="rate-inherited">(no salary)</span></>
                              : payroll.salaryPeriod === 'ANNUAL'
                                ? <>
                                    {money(payroll.salaryAmount)}/yr
                                    {' '}<span className="rate-inherited">({money(payroll.baseSalary)}/mo)</span>
                                  </>
                                : <>{money(payroll.baseSalary)}/mo</>}
                        </strong>
                      </div>
                      <div className="rate-row">
                        <span>Hourly Rate</span>
                        <strong>
                          {payroll.hourlyRate != null
                            ? `$${payroll.hourlyRate.toLocaleString('en-US', { minimumFractionDigits: 2 })}/hr`
                            : <span className="rate-unset">not set</span>}
                        </strong>
                      </div>
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
                          {/* No register stands behind this hour — it is paid
                              because an admin said it ran. Named on the line so
                              a payslip can be read back months later without
                              anyone having to remember. */}
                          {item.payApproved && (
                            <span
                              className="statement-vouched"
                              title={item.payApprovedBy ? `Approved by ${item.payApprovedBy}` : 'Approved by an admin'}
                            >
                              approved{item.payApprovedBy ? ` by ${item.payApprovedBy}` : ''}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="statement-math">
                        <span>{item.hours} h × {money(item.rate)}</span>
                        <small>
                          {/* Locked means this hour was confirmed and its rate
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
