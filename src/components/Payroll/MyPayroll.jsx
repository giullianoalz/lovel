import React, { useState, useEffect, useCallback } from 'react';
import { DollarSign, Calendar, Clock, BookOpen, Briefcase, TrendingUp, ChevronLeft, ChevronRight, MapPin, Video, Wallet } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import api from '../../lib/api';
import './MyPayroll.css';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const MyPayroll = () => {
  const { user } = useAuth();
  const [payrollData, setPayrollData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth() + 1);
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());

  const loadPayroll = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/users/${user.id}/payroll?month=${currentMonth}&year=${currentYear}`);
      setPayrollData(res.data);
    } catch {
      setError('Could not load payroll data.');
    } finally {
      setLoading(false);
    }
  }, [user?.id, currentMonth, currentYear]);

  useEffect(() => { loadPayroll(); }, [loadPayroll]);

  const handlePrevMonth = () => {
    if (currentMonth === 1) { setCurrentMonth(12); setCurrentYear(y => y - 1); }
    else setCurrentMonth(m => m - 1);
  };
  const handleNextMonth = () => {
    if (currentMonth === 12) { setCurrentMonth(1); setCurrentYear(y => y + 1); }
    else setCurrentMonth(m => m + 1);
  };

  const payroll = payrollData?.payroll;
  const classes = payrollData?.classes || [];
  const isHourly = payroll?.perSessionRate > 0;

  return (
    <div className="my-payroll">
      <div className="my-payroll-header">
        <Wallet size={28} />
        <div>
          <h1>My Payroll</h1>
          <p>Your earnings, sessions, and leave balances.</p>
        </div>
      </div>

      <div className="month-navigator">
        <button onClick={handlePrevMonth} className="month-nav-btn"><ChevronLeft size={18} /></button>
        <h3 className="month-label">{MONTH_NAMES[currentMonth - 1]} {currentYear}</h3>
        <button onClick={handleNextMonth} className="month-nav-btn"><ChevronRight size={18} /></button>
      </div>

      {loading ? (
        <div className="payroll-loading-page">Loading payroll...</div>
      ) : error ? (
        <div className="payroll-error-page">{error}</div>
      ) : payroll ? (
        <div className="my-payroll-grid">
          <div className="my-payroll-col">
            <div className="payroll-card earnings-card">
              <div className="payroll-card-header">
                <DollarSign size={20} />
                <span>{isHourly ? 'Total Earnings' : 'Monthly Salary'}</span>
              </div>
              <div className="payroll-big-number">
                ${(isHourly ? payroll.totalEarnings : payroll.baseSalary).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
              <div className="payroll-sessions-count">
                {isHourly
                  ? <><Calendar size={14} /> {payroll.totalSessionCount} sessions completed</>
                  : <><MapPin size={14} /> Fixed monthly salary</>}
              </div>
            </div>

            {isHourly ? (
              <div className="payroll-card">
                <h4><Briefcase size={16} /> Earnings Breakdown</h4>
                <div className="breakdown-row">
                  <span><Calendar size={14} /> {payroll.totalSessionCount} sessions × ${payroll.perSessionRate}/session</span>
                  <strong>${(payroll.sessionEarnings || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
                </div>
                {payroll.baseSalary > 0 && (
                  <div className="breakdown-row">
                    <span><MapPin size={14} /> Base Salary</span>
                    <strong>${payroll.baseSalary.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
                  </div>
                )}
                <div className="breakdown-divider" />
                <div className="breakdown-row total">
                  <span><TrendingUp size={14} /> Grand Total</span>
                  <strong>${payroll.totalEarnings.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
                </div>
                <p className="text-muted" style={{fontSize: 11, marginTop: 8}}>Charges are generated automatically when a session is scheduled.</p>
              </div>
            ) : (
              <div className="payroll-card">
                <h4><Briefcase size={16} /> Salary Info</h4>
                <div className="breakdown-row">
                  <span><MapPin size={14} /> Fixed Monthly Salary</span>
                  <strong>${payroll.baseSalary.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
                </div>
                <div className="breakdown-row">
                  <span><Calendar size={14} /> Sessions This Month</span>
                  <strong>{payroll.totalSessionCount}</strong>
                </div>
              </div>
            )}

            <div className="payroll-card">
              <h4>Leave Balances</h4>
              <div className="leave-bars">
                <div className="leave-item">
                  <div className="leave-label">
                    <span>PTO Days</span>
                    <span>{(payroll.totalPTODays || 12) - (payroll.usedPTODays || 0)} remaining</span>
                  </div>
                  <div className="leave-bar">
                    <div className="leave-bar-fill pto" style={{ width: `${((payroll.usedPTODays || 0) / (payroll.totalPTODays || 12)) * 100}%` }} />
                  </div>
                  <span className="leave-detail">{payroll.usedPTODays || 0} used of {payroll.totalPTODays || 12}</span>
                </div>
                <div className="leave-item">
                  <div className="leave-label">
                    <span>Sick Days</span>
                    <span>{(payroll.totalSickDays || 8) - (payroll.usedSickDays || 0)} remaining</span>
                  </div>
                  <div className="leave-bar">
                    <div className="leave-bar-fill sick" style={{ width: `${((payroll.usedSickDays || 0) / (payroll.totalSickDays || 8)) * 100}%` }} />
                  </div>
                  <span className="leave-detail">{payroll.usedSickDays || 0} used of {payroll.totalSickDays || 8}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="my-payroll-col">
            <div className="payroll-card">
              <h4><BookOpen size={16} /> Classes & Sessions</h4>
              {classes.length > 0 ? classes.map(cls => (
                <div key={cls.id} className="class-card-mini">
                  <div className="class-card-mini-header">
                    <span className={`class-type-dot ${cls.type === 'VIRTUAL' ? 'virtual' : 'in-person'}`} />
                    <strong>{cls.name}</strong>
                    <span className="session-count-badge">{cls.completedSessions} sessions</span>
                  </div>
                  <div className="class-card-mini-meta">
                    <span className="class-subject-tag">{cls.subject || 'General'}</span>
                    <span className="class-type-tag">{cls.type === 'VIRTUAL' ? 'Online' : 'In-Person'}</span>
                  </div>
                  {cls.sessions?.length > 0 && (
                    <div className="session-mini-list">
                      {cls.sessions.slice(0, 5).map(s => (
                        <div key={s.id} className="session-mini-row">
                          <Clock size={12} />
                          <span>{new Date(s.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        </div>
                      ))}
                      {cls.sessions.length > 5 && <span className="text-muted" style={{fontSize: 11}}>+{cls.sessions.length - 5} more</span>}
                    </div>
                  )}
                </div>
              )) : (
                <p className="text-muted">No classes assigned for this period.</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-muted" style={{textAlign: 'center', padding: 40}}>No payroll data available.</p>
      )}
    </div>
  );
};

export default MyPayroll;
