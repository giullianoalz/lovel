import React, { useState, useEffect } from 'react';
import { AlertTriangle, ThumbsUp, Filter, Search, Plus, X, ChevronDown, Clock, User, ShieldCheck, ArrowDownCircle, Send } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../Layout/ToastProvider';
import './BehaviorTracker.css';

const CLASSIFICATIONS = ['Verbal Warning', 'Mediation Needed'];

const CATEGORIES = ['Disruptive', 'Disrespectful', 'Unsafe', 'Dress Code', 'Tardy', 'Positive Behavior', 'Excellent Work', 'Helping Others', 'Other'];
const TYPES = [
  { value: 'WARNING', label: 'Warning', icon: <AlertTriangle size={14} />, color: '#f59e0b' },
  { value: 'SLIP', label: 'Disciplinary Slip', icon: <AlertTriangle size={14} />, color: '#ef4444' },
  { value: 'POSITIVE', label: 'Positive Note', icon: <ThumbsUp size={14} />, color: '#10b981' },
];
const SEVERITIES = ['MINOR', 'MODERATE', 'SEVERE'];

const BehaviorTracker = () => {
  const toast = useToast();
  const { role } = useAuth();
  const [reviewLog, setReviewLog] = useState(null);
  const [classification, setClassification] = useState('Verbal Warning');
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [logs, setLogs] = useState([]);
  const [, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [students, setStudents] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');

  // Form state
  const [form, setForm] = useState({
    studentId: '',
    type: 'WARNING',
    category: '',
    description: '',
    severity: 'MINOR',
  });
  const [submitting, setSubmitting] = useState(false);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterType) params.type = filterType;
      if (filterSeverity) params.severity = filterSeverity;
      const response = await api.get('/behavior', { params });
      setLogs(response.data.logs);
      setTotal(response.data.total);
    } catch (error) {
      console.error('Error loading behavior logs:', error);
    }
    setLoading(false);
  };

  const loadStudents = async () => {
    try {
      const response = await api.get('/students');
      setStudents(response.data.students || []);
    } catch (error) {
      console.error('Error loading students:', error);
    }
  };

  useEffect(() => {
    loadLogs();
    loadStudents();
  }, [filterType, filterSeverity]);

  const handleSubmit = async () => {
    if (!form.studentId || !form.category || !form.description) return;
    setSubmitting(true);
    try {
      await api.post('/behavior', form);
      setShowModal(false);
      setForm({ studentId: '', type: 'WARNING', category: '', description: '', severity: 'MINOR' });
      await loadLogs();
    } catch (error) {
      console.error('Error creating behavior log:', error);
      toast.error('Could not save the behavior entry.');
    }
    setSubmitting(false);
  };

  const openReview = (log) => {
    setReviewLog(log);
    setClassification('Verbal Warning');
    setReviewNotes(log.managerNotes || '');
  };

  const handleReviewAction = async (status) => {
    if (!reviewLog) return;
    setReviewSubmitting(true);
    try {
      const notesWithClassification = `[${classification}] ${reviewNotes}`.trim();
      await api.put(`/behavior/${reviewLog.id}/status`, { status, managerNotes: notesWithClassification });
      setReviewLog(null);
      await loadLogs();
      toast.success(status === 'SENT_TO_PARENT' ? 'Sent to parent' : 'Incident downgraded');
    } catch {
      toast.error('Could not update the incident.');
    }
    setReviewSubmitting(false);
  };

  const filteredLogs = logs.filter(log => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      log.student?.fullName?.toLowerCase().includes(q) ||
      log.teacher?.fullName?.toLowerCase().includes(q) ||
      log.category?.toLowerCase().includes(q) ||
      log.description?.toLowerCase().includes(q)
    );
  });

  const typeConfig = (type) => TYPES.find(t => t.value === type) || TYPES[0];

  return (
    <div className="behavior-container">
      <header className="behavior-header">
        <div>
          <h1>Behavior Tracking</h1>
          <p className="text-muted">Log warnings, disciplinary slips, and positive notes for students.</p>
        </div>
        <button className="behavior-add-btn" onClick={() => setShowModal(true)}>
          <Plus size={18} />
          Log Behavior
        </button>
      </header>

      {/* Quick Stats */}
      <div className="behavior-stats">
        <div className="stat-card stat-warning">
          <AlertTriangle size={20} />
          <div>
            <span className="stat-count">{logs.filter(l => l.type === 'WARNING').length}</span>
            <span className="stat-label">Warnings</span>
          </div>
        </div>
        <div className="stat-card stat-slip">
          <AlertTriangle size={20} />
          <div>
            <span className="stat-count">{logs.filter(l => l.type === 'SLIP').length}</span>
            <span className="stat-label">Slips</span>
          </div>
        </div>
        <div className="stat-card stat-positive">
          <ThumbsUp size={20} />
          <div>
            <span className="stat-count">{logs.filter(l => l.type === 'POSITIVE').length}</span>
            <span className="stat-label">Positive</span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="behavior-filters">
        <div className="search-input">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search by student, teacher, or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="filter-select">
          <option value="">All Types</option>
          {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value)} className="filter-select">
          <option value="">All Severity</option>
          {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Logs Table */}
      <div className="behavior-table-container">
        {loading ? (
          <div className="behavior-loading">Loading behavior logs...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="behavior-empty">
            <AlertTriangle size={32} />
            <p>No behavior logs found. Start by logging a new entry.</p>
          </div>
        ) : (
          <table className="behavior-table">
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Student</th>
                <th>Type</th>
                <th>Category</th>
                <th>Severity</th>
                <th>Description</th>
                <th>Logged By</th>
                {role === 'ADMIN' && <th>Status</th>}
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map(log => {
                const tc = typeConfig(log.type);
                const date = new Date(log.createdAt);
                const isReviewable = role === 'ADMIN' && log.type !== 'POSITIVE';
                return (
                  <tr
                    key={log.id}
                    className={`behavior-row type-${log.type.toLowerCase()} ${isReviewable ? 'reviewable' : ''}`}
                    onClick={() => isReviewable && openReview(log)}
                  >
                    <td className="date-cell">
                      <div className="date-display">
                        <span className="date-str">{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        <span className="time-str">{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </td>
                    <td>
                      <div className="student-cell">
                        <div className="student-avatar-mini">{log.student?.fullName?.[0] || '?'}</div>
                        <span>{log.student?.fullName || 'Unknown'}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`type-badge ${log.type.toLowerCase()}`} style={{ '--type-color': tc.color }}>
                        {tc.icon} {tc.label}
                      </span>
                    </td>
                    <td><span className="category-pill">{log.category}</span></td>
                    <td>
                      <span className={`severity-badge ${log.severity.toLowerCase()}`}>
                        {log.severity}
                      </span>
                    </td>
                    <td className="desc-cell">{log.description}</td>
                    <td className="teacher-cell">{log.teacher?.fullName || 'System'}</td>
                    {role === 'ADMIN' && (
                      <td>
                        {log.type !== 'POSITIVE' && (
                          <span className={`behavior-status-badge ${(log.status || 'RECORDED').toLowerCase()}`}>
                            {(log.status || 'RECORDED').replace('_', ' ')}
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Log Behavior Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="behavior-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Log Behavior Entry</h3>
              <button onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>

            {/* Type Selector */}
            <div className="type-selector">
              {TYPES.map(t => (
                <button
                  key={t.value}
                  className={`type-option ${form.type === t.value ? 'active' : ''}`}
                  style={{ '--type-color': t.color }}
                  onClick={() => setForm({ ...form, type: t.value })}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>

            <div className="modal-form">
              <div className="form-group">
                <label>Student</label>
                <select
                  className="form-control"
                  value={form.studentId}
                  onChange={(e) => setForm({ ...form, studentId: e.target.value })}
                >
                  <option value="">Select a student...</option>
                  {students.map(s => (
                    <option key={s.id} value={s.id}>{s.fullName}</option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Category</label>
                  <select
                    className="form-control"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                  >
                    <option value="">Select category...</option>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                {form.type !== 'POSITIVE' && (
                  <div className="form-group">
                    <label>Severity</label>
                    <select
                      className="form-control"
                      value={form.severity}
                      onChange={(e) => setForm({ ...form, severity: e.target.value })}
                    >
                      {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  className="form-control"
                  rows="3"
                  placeholder="Describe the behavior incident or positive note..."
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowModal(false)}>Cancel</button>
              <button
                className="btn-send"
                onClick={handleSubmit}
                disabled={submitting || !form.studentId || !form.category || !form.description}
              >
                {submitting ? 'Saving...' : 'Log Entry'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manager Review Modal */}
      {reviewLog && (
        <div className="modal-overlay" onClick={() => setReviewLog(null)}>
          <div className="behavior-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3><ShieldCheck size={18} /> Review Incident</h3>
              <button onClick={() => setReviewLog(null)}><X size={20} /></button>
            </div>

            <div className="modal-form">
              <div className="review-summary">
                <strong>{reviewLog.student?.fullName}</strong>
                <span className="text-muted"> — {reviewLog.category} ({reviewLog.severity})</span>
                <p className="text-muted" style={{ marginTop: 6 }}>{reviewLog.description}</p>
                <span className="text-muted" style={{ fontSize: 12 }}>Reported by {reviewLog.teacher?.fullName}</span>
              </div>

              <div className="form-group">
                <label>Classification</label>
                <select className="form-control" value={classification} onChange={(e) => setClassification(e.target.value)}>
                  {CLASSIFICATIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label>Manager Notes</label>
                <textarea
                  className="form-control"
                  rows="3"
                  placeholder="Add notes about how this was handled..."
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                />
              </div>

              {reviewLog.status && reviewLog.status !== 'RECORDED' && (
                <p className="text-muted" style={{ fontSize: 12 }}>
                  Current status: <strong>{reviewLog.status.replace('_', ' ')}</strong>
                </p>
              )}
            </div>

            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => handleReviewAction('DOWNGRADED')} disabled={reviewSubmitting}>
                <ArrowDownCircle size={16} /> Downgrade
              </button>
              <button className="btn-send" onClick={() => handleReviewAction('SENT_TO_PARENT')} disabled={reviewSubmitting}>
                <Send size={16} /> {reviewSubmitting ? 'Sending...' : 'Send to Parent'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BehaviorTracker;
