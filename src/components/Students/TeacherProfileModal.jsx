import React, { useState, useEffect } from 'react';
import { X, DollarSign, Calendar, Clock, BookOpen, Briefcase, TrendingUp, ChevronLeft, ChevronRight, Mail, Phone, MapPin, Video } from 'lucide-react';
import { database } from '../../lib/database';
import './TeacherProfileModal.css';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const TeacherProfileModal = ({ teacher, onClose }) => {
  const [payrollData, setPayrollData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth() + 1);
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());

  const loadPayroll = async () => {
    setLoading(true);
    try {
      const data = await database.fetchTeacherPayroll(teacher.id, currentMonth, currentYear);
      setPayrollData(data);
    } catch (err) {
      console.error('Error loading payroll:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPayroll();
  }, [teacher.id, currentMonth, currentYear]);

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
                    <Calendar size={14} /> {payroll.totalSessionCount} sessions completed
                  </div>
                </div>

                {/* Breakdown */}
                <div className="payroll-breakdown">
                  <h4><Briefcase size={16} /> Earnings Breakdown</h4>
                  
                  <div className="breakdown-item">
                    <div className="breakdown-label">
                      <MapPin size={14} />
                      <span>In-Person Salary (Fixed)</span>
                    </div>
                    <div className="breakdown-value">
                      ${payroll.baseSalary.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                  </div>

                  <div className="breakdown-item">
                    <div className="breakdown-label">
                      <Video size={14} />
                      <span>Online Tutoring ({payroll.onlineSessionCount} sessions × ${payroll.perSessionRate})</span>
                    </div>
                    <div className="breakdown-value accent">
                      ${payroll.tutoringEarnings.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                  </div>

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
                  <h4>Rate Configuration</h4>
                  <div className="rate-row">
                    <span>Monthly Base Salary</span>
                    <strong>${payroll.baseSalary.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
                  </div>
                  <div className="rate-row">
                    <span>Per Tutoring Session</span>
                    <strong>${payroll.perSessionRate.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
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
