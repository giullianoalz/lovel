import React, { useState, useEffect } from 'react';
import { Heart, Search, X, ClipboardCheck, Send, Home, CheckCircle, Clock } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../Layout/ToastProvider';

const STATUS_LABELS = { RECORDED: 'Recorded', REVIEWED: 'Reviewed' };

const MedicalIncidents = () => {
  const toast = useToast();
  const { role } = useAuth();
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
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
      setTotal(res.data.total || 0);
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

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-main)', margin: '0 0 4px' }}>Medical Incidents</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>Review and follow up on student medical incidents reported by teachers.</p>
        </div>
        {unreviewedCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, color: '#991b1b', fontSize: 13, fontWeight: 600 }}>
            <Heart size={16} />
            {unreviewedCount} unreviewed
          </div>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Total Reports', count: logs.length, color: '#6366f1', bg: '#eef2ff' },
          { label: 'Unreviewed', count: logs.filter(l => l.status === 'RECORDED').length, color: '#ef4444', bg: '#fef2f2' },
          { label: 'Reviewed', count: logs.filter(l => l.status === 'REVIEWED').length, color: '#10b981', bg: '#f0fdf4' },
          { label: 'Sent Home', count: logs.filter(l => l.sentHome).length, color: '#f59e0b', bg: '#fffbeb' },
        ].map(({ label, count, color, bg }) => (
          <div key={label} style={{ padding: '16px 20px', background: bg, borderRadius: 12, border: `1px solid ${color}22` }}>
            <div style={{ fontSize: 28, fontWeight: 700, color }}>{count}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: '1px solid var(--border-light)', borderRadius: 10, padding: '8px 14px', flex: 1, minWidth: 240 }}>
          <Search size={16} color="var(--text-muted)" />
          <input
            type="text"
            placeholder="Search by student, teacher, or description..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ border: 'none', outline: 'none', fontSize: 14, width: '100%', background: 'transparent', color: 'var(--text-main)' }}
          />
        </div>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: '8px 14px', border: '1px solid var(--border-light)', borderRadius: 10, background: 'white', fontSize: 13, color: 'var(--text-main)', outline: 'none' }}
        >
          <option value="">All Statuses</option>
          <option value="RECORDED">Unreviewed</option>
          <option value="REVIEWED">Reviewed</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ background: 'white', borderRadius: 14, border: '1px solid var(--border-light)', overflowX: 'auto', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
        {loading ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading medical incidents...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <Heart size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
            <p>No medical incidents found.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Date & Time', 'Student', 'Place', 'Description', 'Actions Taken', 'Sent Home', 'Reported By', 'Reviewed By', 'Status'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', background: '#f8fafc', borderBottom: '1px solid var(--border-light)', whiteSpace: 'nowrap' }}>{h}</th>
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
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      cursor: role === 'ADMIN' ? 'pointer' : 'default',
                      borderLeft: `3px solid ${isUnreviewed ? '#ef4444' : '#10b981'}`,
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fafbff'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}
                  >
                    <td style={{ padding: '12px 16px', fontSize: 13 }}>
                      <div style={{ fontWeight: 600 }}>{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, #ef4444, #f97316)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                          {log.student?.fullName?.[0] || '?'}
                        </div>
                        <span style={{ fontWeight: 500 }}>{log.student?.fullName || 'Unknown'}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13 }}><span style={{ padding: '3px 10px', background: '#f1f5f9', borderRadius: 12, fontSize: 12 }}>{log.place}</span></td>
                    <td style={{ padding: '12px 16px', fontSize: 13, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.description}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.actionsTaken}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, textAlign: 'center' }}>
                      {log.sentHome ? <Home size={16} color="#f59e0b" title="Sent home" /> : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)' }}>{log.teacher?.fullName || 'System'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)' }}>{log.reviewedBy?.fullName || '—'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                        background: isUnreviewed ? '#fef2f2' : '#dcfce7',
                        color: isUnreviewed ? '#991b1b' : '#166534',
                      }}>
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

      {/* Manager Review Modal */}
      {reviewLog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setReviewLog(null)}>
          <div style={{ background: 'white', borderRadius: 16, width: '95%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid var(--border-light)' }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <ClipboardCheck size={18} /> Review Medical Incident
              </h3>
              <button onClick={() => setReviewLog(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 8, color: 'var(--text-muted)' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '16px 24px' }}>
              {/* Incident Summary */}
              <div style={{ padding: 14, background: '#fef2f2', borderRadius: 10, marginBottom: 16, borderLeft: '3px solid #ef4444' }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{reviewLog.student?.fullName}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
                  {new Date(reviewLog.time).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} · {reviewLog.place}
                  {reviewLog.sentHome && <span style={{ marginLeft: 8, color: '#f59e0b', fontWeight: 600 }}>· Sent home</span>}
                </div>
                <p style={{ margin: '0 0 6px', fontSize: 13 }}><strong>Incident:</strong> {reviewLog.description}</p>
                <p style={{ margin: 0, fontSize: 13 }}><strong>Actions taken:</strong> {reviewLog.actionsTaken}</p>
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>Reported by {reviewLog.teacher?.fullName}</div>
              </div>

              {/* Manager Notes */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: 6, color: 'var(--text-main)' }}>Manager Notes</label>
                <textarea
                  rows={3}
                  placeholder="Add notes about how this was handled, any follow-up actions..."
                  value={managerNotes}
                  onChange={e => setManagerNotes(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-light)', borderRadius: 10, fontSize: 14, color: 'var(--text-main)', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                  onFocus={e => e.target.style.borderColor = '#6366f1'}
                  onBlur={e => e.target.style.borderColor = 'var(--border-light)'}
                />
              </div>

              {/* Notify Parent */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 14px', background: notifyParent ? '#f0fdf4' : '#f8fafc', borderRadius: 10, border: `1px solid ${notifyParent ? '#86efac' : 'var(--border-light)'}`, transition: 'all 0.15s' }}>
                <input
                  type="checkbox"
                  checked={notifyParent}
                  onChange={e => setNotifyParent(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-main)' }}>Notify Parent</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Send a push notification to the student's parent(s)</div>
                </div>
                {notifyParent && <Send size={14} color="#166534" style={{ marginLeft: 'auto' }} />}
              </label>

              {reviewLog.status === 'REVIEWED' && reviewLog.managerNotes && (
                <div style={{ marginTop: 12, padding: '8px 12px', background: '#f0fdf4', borderRadius: 8, fontSize: 12, color: '#166534' }}>
                  <CheckCircle size={12} style={{ marginRight: 4 }} />
                  Previously reviewed. Updating notes will overwrite.
                </div>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: '1px solid var(--border-light)' }}>
              <button onClick={() => setReviewLog(null)} style={{ padding: '10px 20px', border: '1px solid var(--border-light)', background: 'white', borderRadius: 10, fontSize: 14, fontWeight: 500, cursor: 'pointer', color: 'var(--text-main)' }}>
                Cancel
              </button>
              <button
                onClick={handleReview}
                disabled={reviewSubmitting}
                style={{ padding: '10px 20px', background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: reviewSubmitting ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 6 }}
              >
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
