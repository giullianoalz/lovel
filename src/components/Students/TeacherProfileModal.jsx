import React, { useState, useEffect } from 'react';
import { X, DollarSign, Calendar, Clock, BookOpen, Briefcase, TrendingUp, ChevronLeft, ChevronRight, Mail, Phone, MapPin, Video, Pencil, Save } from 'lucide-react';
import { database } from '../../lib/database';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../Layout/ToastProvider';
import ErrorBanner from '../Layout/ErrorBanner';
import './TeacherProfileModal.css';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const TeacherProfileModal = ({ teacher, onClose }) => {
  const { hasRole } = useAuth();
  const toast = useToast();
  const [payrollData, setPayrollData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth() + 1);
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());

  // Reading your own pay is fine; setting it is not — the server enforces the
  // same rule, this only keeps the controls out of a teacher's way.
  const canEditPay = hasRole('ADMIN');
  const [isEditingRates, setIsEditingRates] = useState(false);
  const [rateForm, setRateForm] = useState({ baseSalary: '', hourlyRate: '', categoryRates: {} });
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
      baseSalary: payroll?.baseSalary ? String(payroll.baseSalary) : '',
      hourlyRate: payroll?.hourlyRate != null ? String(payroll.hourlyRate) : '',
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
        hourlyRate: rateForm.hourlyRate.trim(),
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
              <span className="role-badge">Teacher</span>
            </div>
          </div>
          <div className="teacher-contact-bar">
            <span><Mail size={14} /> {teacher.email}</span>
            <span><Phone size={14} /> {teacher.phone}</span>
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
                    <div className="breakdown-item" key={b.category}>
                      <div className="breakdown-label">
                        {b.category === 'ONLINE' ? <Video size={14} /> : <MapPin size={14} />}
                        <span>
                          {b.category === 'ONLINE' ? 'Online' : 'In-person'} ({b.hours} h × ${b.rate.toFixed(2)})
                        </span>
                      </div>
                      <div className="breakdown-value accent">
                        ${b.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
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
                        <span>Monthly Base Salary</span>
                        <div className="rate-input-wrap">
                          <span className="rate-currency">$</span>
                          <input
                            type="number" min="0" step="0.01" inputMode="decimal"
                            className="form-control"
                            value={rateForm.baseSalary}
                            onChange={e => setRateForm(f => ({ ...f, baseSalary: e.target.value }))}
                            placeholder="0.00"
                            autoFocus
                          />
                        </div>
                      </label>
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

                      <h5 className="rate-subhead">Rate by type of session</h5>
                      {(payroll.categoryRates || []).map(c => (
                        <label className="rate-edit-row" key={c.category}>
                          <span>{c.label}</span>
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
                              placeholder={rateForm.hourlyRate ? `${rateForm.hourlyRate} (base)` : '0.00'}
                            />
                          </div>
                        </label>
                      ))}

                      <p className="rate-hint">
                        Paid per hour actually taught. A type left empty falls back to the hourly
                        rate above; set one to pay a different amount for that kind of session.
                        Whether a session counts as online is decided per meeting, so a class that
                        meets in person on Monday and over Zoom on Tuesday pays each at its own rate.
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
                        <span>Monthly Base Salary</span>
                        <strong>${payroll.baseSalary.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
                      </div>
                      <div className="rate-row">
                        <span>Hourly Rate</span>
                        <strong>
                          {payroll.hourlyRate != null
                            ? `$${payroll.hourlyRate.toLocaleString('en-US', { minimumFractionDigits: 2 })}/hr`
                            : <span className="rate-unset">not set</span>}
                        </strong>
                      </div>
                      {(payroll.categoryRates || []).map(c => (
                        <div className="rate-row rate-row-sub" key={c.category}>
                          <span>{c.label}</span>
                          <strong>
                            {c.rate != null
                              ? `$${c.rate.toLocaleString('en-US', { minimumFractionDigits: 2 })}/hr`
                              : <span className="rate-inherited">
                                  {c.source === 'base' ? `$${c.effectiveRate.toFixed(2)}/hr (base)` : 'not set'}
                                </span>}
                          </strong>
                        </div>
                      ))}
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

          {/* Right: Class History */}
          <div className="profile-col">
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
