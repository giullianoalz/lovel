import React, { useState, useEffect } from 'react';
import { Heart, Search, X, ClipboardCheck, Send, Home, CheckCircle } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../Layout/ToastProvider';
import './MedicalIncidents.css';

const STAT_CARDS = [
  { key: 'total', label: 'Total Reports', bg: '#eef2ff', color: '#6366f1' },
  { key: 'unreviewed', label: 'Unreviewed', bg: '#fef2f2', color: '#ef4444' },
  { key: 'reviewed', label: 'Reviewed', bg: '#f0fdf4', color: '#10b981' },
  { key: 'sentHome', label: 'Sent Home', bg: '#fffbeb', color: '#f59e0b' },
];

const MedicalIncidents = () => {
  const toast = useToast();
  const { role } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [reviewLog, setReviewLog] = useState(null);
  const [managerNotes, setManagerNotes] = useState('');
  const [notifyParent, setNotifyParent] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterStatus) params.status = filterStatus;
      const res = await api.get('/medical', { params });
      setLogs(res.data.logs || []);
    } catch {
      toast.error('Could not load medical incidents.');
    }
    setLoading(false);
  };

  useEffect(() => { loadLogs(); }, [filterStatus]);

  const openReview = (log) => {
    setReviewLog(log);
    setManagerNotes(log.managerNotes || '');
    setNotifyParent(false);
  };

  const handleReview = async () => {
    if (!reviewLog) return;
    setReviewSubmitting(true);
    try {
      await api.put(`/medical/${reviewLog.id}`, { managerNotes, notifyParent });
      toast.success(notifyParent ? 'Reviewed and parent notified.' : 'Incident reviewed.');
      setReviewLog(null);
      await loadLogs();
    } catch {
      toast.error('Could not update the incident.');
    }
    setReviewSubmitting(false);
  };

  const filtered = logs.filter(log => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      log.student?.fullName?.toLowerCase().includes(q) ||
      log.teacher?.fullName?.toLowerCase().includes(q) ||
      log.description?.toLowerCase().includes(q) ||
      log.place?.toLowerCase().includes(q)
    );
  });

  const unreviewedCount = logs.filter(l => l.status === 'RECORDED').length;
  const statCounts = {
    total: logs.length,
    unreviewed: unreviewedCount,
    reviewed: logs.filter(l => l.status === 'REVIEWED').length,
    sentHome: logs.filter(l => l.sentHome).length,
  };

  return (
    <div className="mi-page">
      <div className="mi-header">
        <div>
          <h1 className="mi-title">Medical Incidents</h1>
          <p className="mi-subtitle">Review and follow up on student medical incidents reported by teachers.</p>
        </div>
        {unreviewedCount > 0 && (
          <div className="mi-unreviewed-badge">
            <Heart size={16} />
            {unreviewedCount} unreviewed
          </div>
        )}
      </div>

      <div className="mi-stats">
        {STAT_CARDS.map(({ key, label, bg, color }) => (
          <div key={key} className="mi-stat-card" style={{ background: bg, borderColor: `${color}22` }}>
            <div className="mi-stat-count" style={{ color }}>{statCounts[key]}</div>
            <div className="mi-stat-label">{label}</div>
          </div>
        ))}
      </div>

      <div className="mi-filters">
        <div className="mi-search-box">
          <Search size={16} color="var(--text-muted)" />
          <input
            type="text"
            placeholder="Search by student, teacher, or description..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <select className="mi-status-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All Statuses</option>
          <option value="RECORDED">Unreviewed</option>
          <option value="REVIEWED">Reviewed</option>
        </select>
      </div>

      <div className="mi-card">
        {loading ? (
          <div className="mi-empty"><span className="app-inline-loader"><span className="app-spinner-sm" />Loading medical incidents…</span></div>
        ) : filtered.length === 0 ? (
          <div className="mi-empty">
            <Heart size={32} />
            <p>No medical incidents found.</p>
          </div>
        ) : (
          <table className="mi-table">
            <thead>
              <tr>
                {['Date & Time', 'Student', 'Place', 'Description', 'Actions Taken', 'Sent Home', 'Reported By', 'Reviewed By', 'Status'].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(log => {
                const date = new Date(log.time);
                const isUnreviewed = log.status === 'RECORDED';
                return (
                  <tr
                    key={log.id}
                    onClick={() => role === 'ADMIN' && openReview(log)}
                    className={`${role === 'ADMIN' ? 'mi-row-clickable' : ''} ${isUnreviewed ? 'mi-row-unreviewed' : 'mi-row-reviewed'}`}
                  >
                    <td>
                      <div className="mi-td-date-main">{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                      <div className="mi-td-date-time">{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </td>
                    <td>
                      <div className="mi-student-cell">
                        <div className="mi-student-avatar">{log.student?.fullName?.[0] || '?'}</div>
                        <span className="mi-student-name">{log.student?.fullName || 'Unknown'}</span>
                      </div>
                    </td>
                    <td><span className="mi-place-pill">{log.place}</span></td>
                    <td className="mi-td-ellipsis">{log.description}</td>
                    <td className="mi-td-ellipsis">{log.actionsTaken}</td>
                    <td className="mi-td-center">
                      {log.sentHome ? <Home size={16} color="#f59e0b" title="Sent home" /> : <span className="mi-td-muted">—</span>}
                    </td>
                    <td className="mi-td-muted">{log.teacher?.fullName || 'System'}</td>
                    <td className="mi-td-muted">{log.reviewedBy?.fullName || '—'}</td>
                    <td>
                      <span className={`mi-status-pill ${isUnreviewed ? 'unreviewed' : 'reviewed'}`}>
                        {isUnreviewed ? 'Unreviewed' : 'Reviewed'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {reviewLog && (
        <div className="mi-modal-overlay" onClick={() => setReviewLog(null)}>
          <div className="mi-modal" onClick={e => e.stopPropagation()}>
            <div className="mi-modal-header">
              <h3><ClipboardCheck size={18} /> Review Medical Incident</h3>
              <button onClick={() => setReviewLog(null)} className="mi-modal-close">
                <X size={20} />
              </button>
            </div>

            <div className="mi-modal-body">
              <div className="mi-incident-summary">
                <div className="mi-incident-summary-title">{reviewLog.student?.fullName}</div>
                <div className="mi-incident-summary-meta">
                  {new Date(reviewLog.time).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} · {reviewLog.place}
                  {reviewLog.sentHome && <span className="mi-sent-home-tag">· Sent home</span>}
                </div>
                <p><strong>Incident:</strong> {reviewLog.description}</p>
                <p><strong>Actions taken:</strong> {reviewLog.actionsTaken}</p>
                <div className="mi-reported-by">Reported by {reviewLog.teacher?.fullName}</div>
              </div>

              <div className="mi-field">
                <label className="mi-field-label">Manager Notes</label>
                <textarea
                  rows={3}
                  placeholder="Add notes about how this was handled, any follow-up actions..."
                  value={managerNotes}
                  onChange={e => setManagerNotes(e.target.value)}
                  className="mi-notes-input"
                />
              </div>

              <label className={`mi-notify-toggle ${notifyParent ? 'active' : ''}`}>
                <input
                  type="checkbox"
                  checked={notifyParent}
                  onChange={e => setNotifyParent(e.target.checked)}
                />
                <div>
                  <div className="mi-notify-title">Notify Parent</div>
                  <div className="mi-notify-desc">Send a push notification to the student's parent(s)</div>
                </div>
                {notifyParent && <Send size={14} className="mi-notify-icon" />}
              </label>

              {reviewLog.status === 'REVIEWED' && reviewLog.managerNotes && (
                <div className="mi-previously-reviewed">
                  <CheckCircle size={12} />
                  Previously reviewed. Updating notes will overwrite.
                </div>
              )}
            </div>

            <div className="mi-modal-footer">
              <button onClick={() => setReviewLog(null)} className="mi-btn-cancel">
                Cancel
              </button>
              <button onClick={handleReview} disabled={reviewSubmitting} className="mi-btn-review">
                <ClipboardCheck size={16} />
                {reviewSubmitting ? 'Saving...' : notifyParent ? 'Review & Notify Parent' : 'Mark Reviewed'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MedicalIncidents;
