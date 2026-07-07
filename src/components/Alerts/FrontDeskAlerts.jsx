import React, { useState, useEffect, useRef } from 'react';
import { Bell, Clock, User, CheckCircle, Shield, AlertCircle, LogOut, LifeBuoy, ExternalLink, Ban, DollarSign } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import io from 'socket.io-client';
import api from '../../lib/api';
import './FrontDeskAlerts.css';

const configuredApiUrl = import.meta.env.VITE_API_URL;
const SOCKET_URL = (!configuredApiUrl || configuredApiUrl === 'http://localhost:4000/api')
  ? `http://${window.location.hostname}:4000`
  : configuredApiUrl.replace(/\/api\/?$/, '');

const ALERT_TYPES = {
  'Student out': { icon: LogOut, color: '#eab308' }, // Yellow
  'Class support': { icon: LifeBuoy, color: '#f97316' }, // Orange
  'Medic': { icon: AlertCircle, color: '#ef4444' } // Red
};

const FrontDeskAlerts = () => {
  const [alerts, setAlerts] = useState([]);
  const [historyAlerts, setHistoryAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'history'
  const socketRef = useRef(null);
  const navigate = useNavigate();

  /* Cancellation-charge review queue */
  const [cancellations, setCancellations] = useState([]);
  const [resolveTarget, setResolveTarget] = useState(null); // cancellation object
  const [resolvePercent, setResolvePercent] = useState(50);
  const [resolveAmount, setResolveAmount] = useState('');
  const [resolveSubmitting, setResolveSubmitting] = useState(false);

  const loadAlerts = async (status = 'active') => {
    setLoading(true);
    try {
      const response = await api.get('/alerts', { params: { status } });
      if (status === 'active') {
        setAlerts(response.data.alerts);
      } else {
        setHistoryAlerts(response.data.alerts);
      }
    } catch (error) {
      console.error('Error loading alerts:', error);
    }
    setLoading(false);
  };

  const loadCancellations = async () => {
    try {
      const response = await api.get('/sessions/cancellations', { params: { status: 'PENDING_REVIEW' } });
      setCancellations(response.data.cancellations);
    } catch (error) {
      console.error('Error loading pending cancellations:', error);
    }
  };

  useEffect(() => {
    loadAlerts('active');
    loadAlerts('resolved');
    loadCancellations();

    // Connect to Socket.IO for real-time alerts
    socketRef.current = io(SOCKET_URL);
    socketRef.current.emit('join_admin');

    socketRef.current.on('class_alert', (alertData) => {
      setAlerts(prev => [alertData, ...prev]);
    });

    socketRef.current.on('class_alert_update', (updateData) => {
      setAlerts(prev => prev.filter(a => a.id !== updateData.id));
      // Refresh history
      loadAlerts('resolved');
    });

    socketRef.current.on('cancellation_pending', (data) => {
      setCancellations(prev => [data, ...prev]);
    });

    socketRef.current.on('cancellation_resolved', ({ id }) => {
      setCancellations(prev => prev.filter(c => c.id !== id));
    });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  const handleMarkResolved = async (id) => {
    try {
      await api.patch(`/alerts/${id}`, { status: 'resolved' });
      setAlerts(prev => prev.filter(a => a.id !== id));
      await loadAlerts('resolved');
    } catch (error) {
      console.error('Error updating alert:', error);
    }
  };

  const openResolveModal = (cancellation) => {
    setResolvePercent(cancellation.suggestedChargePercent);
    setResolveAmount('');
    setResolveTarget(cancellation);
  };

  const handleResolveCancellation = async () => {
    if (!resolveTarget) return;
    setResolveSubmitting(true);
    try {
      await api.patch(`/sessions/cancellations/${resolveTarget.id}/resolve`, {
        finalChargePercent: parseInt(resolvePercent) || 0,
        chargeAmount: resolveAmount ? parseFloat(resolveAmount) : null,
      });
      setCancellations(prev => prev.filter(c => c.id !== resolveTarget.id));
      setResolveTarget(null);
    } catch (error) {
      console.error('Error resolving cancellation:', error);
    } finally {
      setResolveSubmitting(false);
    }
  };

  const getElapsedTime = (createdAt) => {
    const now = new Date();
    const left = new Date(createdAt);
    const diffMs = now - left;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const hrs = Math.floor(diffMins / 60);
    return `${hrs}h ${diffMins % 60}m ago`;
  };

  const URGENCY_RANK = { low: 0, medium: 1, high: 2, critical: 3 };
  // Medical alerts are urgent the instant they're raised — they should never
  // display as "low" just because they were reported seconds ago.
  const URGENCY_FLOOR_BY_TYPE = { 'Medic': 'critical', 'Class support': 'medium' };

  const getUrgency = (createdAt, alertType) => {
    const diffMins = Math.floor((new Date() - new Date(createdAt)) / 60000);
    let timeUrgency = 'low';
    if (diffMins >= 15) timeUrgency = 'critical';
    else if (diffMins >= 10) timeUrgency = 'high';
    else if (diffMins >= 5) timeUrgency = 'medium';

    const floor = URGENCY_FLOOR_BY_TYPE[alertType];
    if (floor && URGENCY_RANK[floor] > URGENCY_RANK[timeUrgency]) return floor;
    return timeUrgency;
  };

  return (
    <div className="regulation-container">
      <header className="regulation-header">
        <div className="header-title-row">
          <div className="header-icon-pulse">
            <Bell size={22} />
            {alerts.length > 0 && <span className="pulse-dot" />}
          </div>
          <div>
            <h1>Front Desk Alerts</h1>
            <p className="text-muted">Real-time alerts for student absences, class support, and medical needs.</p>
          </div>
        </div>
        {alerts.length > 0 && (
          <div className="active-count-badge">
            <span>{alerts.length}</span>
            Active
          </div>
        )}
      </header>

      {/* Cancellation-charge review queue */}
      {cancellations.length > 0 && (
        <div className="cancellation-queue">
          <h2 className="cancellation-queue-title"><Ban size={16} /> Cancellations Needing a Decision ({cancellations.length})</h2>
          <div className="cancellation-queue-grid">
            {cancellations.map(c => (
              <div key={c.id} className="cancellation-card">
                <div className="cancellation-card-top">
                  <button
                    className="alert-student-name-link"
                    onClick={() => navigate(`/students?highlight=${c.studentId || c.student?.id}`)}
                  >
                    {c.studentName || c.student?.fullName}
                    <ExternalLink size={12} />
                  </button>
                  <span className="cancellation-suggested-badge">Suggested {c.suggestedChargePercent}%</span>
                </div>
                <p className="cancellation-meta">
                  {c.className || c.session?.class?.name} · cancelled with {Number(c.hoursBeforeClass).toFixed(1)}h notice
                </p>
                {c.reason && <p className="cancellation-reason">"{c.reason}"</p>}
                <button className="cancellation-resolve-btn" onClick={() => openResolveModal(c)}>
                  <DollarSign size={14} /> Decide Charge
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="reg-tabs">
        <button className={`reg-tab ${activeTab === 'active' ? 'active' : ''}`} onClick={() => setActiveTab('active')}>
          <Bell size={14} /> Active Alerts ({alerts.length})
        </button>
        <button className={`reg-tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => { setActiveTab('history'); loadAlerts('resolved'); }}>
          <Clock size={14} /> History
        </button>
      </div>

      {/* Active Alerts */}
      {activeTab === 'active' && (
        <div className="alerts-panel">
          {alerts.length === 0 ? (
            <div className="no-alerts">
              <Shield size={48} />
              <h3>All Clear</h3>
              <p>No active alerts right now.</p>
            </div>
          ) : (
            <div className="active-alerts-grid">
              {alerts.map(alert => {
                const urgency = getUrgency(alert.createdAt, alert.alertType);
                const TypeIcon = ALERT_TYPES[alert.alertType]?.icon || Bell;
                const typeColor = ALERT_TYPES[alert.alertType]?.color || '#888';

                return (
                  <div key={alert.id} className={`alert-card urgency-${urgency}`} style={{ borderTop: `4px solid ${typeColor}` }}>
                    <div className="alert-card-top">
                      <div className="alert-student-info">
                        <div className="alert-avatar" style={{ backgroundColor: `${typeColor}20`, color: typeColor }}>
                          <TypeIcon size={20} />
                        </div>
                        <div>
                          {alert.studentName ? (
                            <button
                              className="alert-student-name-link"
                              onClick={() => navigate(`/students?highlight=${alert.studentId}`)}
                              title="View student profile"
                            >
                              {alert.studentName}
                              <ExternalLink size={12} />
                            </button>
                          ) : (
                            <h3 className="alert-student-name">Class Alert</h3>
                          )}
                          <span className="alert-type-badge" style={{ backgroundColor: `${typeColor}15`, color: typeColor, border: `1px solid ${typeColor}30`, fontSize: '0.75rem', padding: '2px 6px', borderRadius: '4px', fontWeight: '600' }}>
                            {alert.alertType}
                          </span>
                        </div>
                      </div>
                      <div className={`urgency-indicator ${urgency}`}>
                        <Clock size={14} />
                        <span>{getElapsedTime(alert.createdAt)}</span>
                      </div>
                    </div>

                    <div className="alert-body-row">
                      <div className="alert-details">
                        <div className="alert-detail-row">
                          <User size={13} />
                          <span>Reported by <strong>{alert.teacherName}</strong></span>
                        </div>
                        {alert.reason && (
                          <div className="alert-reason">
                            <span>{alert.reason}</span>
                          </div>
                        )}
                      </div>

                      {(alert.student?.medicalNotes || alert.student?.accommodationNotes || alert.student?.allergies) && (
                        <div className="alert-notes-panel">
                          {alert.student?.allergies && (
                            <div className="alert-note-item allergy">
                              <span className="note-label">⚠️ Allergy</span>
                              <span>{alert.student.allergies}</span>
                            </div>
                          )}
                          {alert.student?.medicalNotes && (
                            <div className="alert-note-item medical">
                              <span className="note-label">🏥 Medical</span>
                              <span>{alert.student.medicalNotes}</span>
                            </div>
                          )}
                          {alert.student?.accommodationNotes && (
                            <div className="alert-note-item accommodation">
                              <span className="note-label">📋 Accommodation</span>
                              <span>{alert.student.accommodationNotes}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <button className="return-btn" onClick={() => handleMarkResolved(alert.id)}>
                      <CheckCircle size={16} />
                      Mark as Resolved
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* History */}
      {activeTab === 'history' && (
        <div className="history-panel">
          {historyAlerts.length === 0 ? (
            <div className="no-alerts">
              <Clock size={40} />
              <p>No alert history to display.</p>
            </div>
          ) : (
            <table className="history-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Student</th>
                  <th>Reported By</th>
                  <th>Reason</th>
                  <th>Alert Time</th>
                  <th>Resolved Time</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {historyAlerts.map(alert => {
                  const left = new Date(alert.createdAt);
                  const returned = alert.resolvedAt ? new Date(alert.resolvedAt) : null;
                  const duration = returned ? Math.floor((returned - left) / 60000) : '—';
                  const TypeIcon = ALERT_TYPES[alert.alertType]?.icon || Bell;
                  const typeColor = ALERT_TYPES[alert.alertType]?.color || '#888';

                  return (
                    <tr key={alert.id}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: typeColor, fontWeight: '600', fontSize: '0.85rem' }}>
                           <TypeIcon size={14} /> {alert.alertType}
                        </span>
                      </td>
                      <td>
                        <div className="student-cell">
                          {alert.student?.fullName ? (
                            <>
                              <div className="student-avatar-mini">{alert.student.fullName[0]}</div>
                              <span>{alert.student.fullName}</span>
                            </>
                          ) : '—'}
                        </div>
                      </td>
                      <td>{alert.reportedBy?.fullName}</td>
                      <td className="reason-cell">{alert.reason || '—'}</td>
                      <td>{left.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                      <td>{returned ? returned.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                      <td>
                        {typeof duration === 'number' ? (
                          <span className={`duration-badge ${duration > 15 ? 'long' : duration > 10 ? 'medium' : 'short'}`}>
                            {duration}m
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Resolve cancellation-charge modal */}
      {resolveTarget && (
        <div className="cancel-modal-overlay" onClick={() => !resolveSubmitting && setResolveTarget(null)}>
          <div className="cancel-modal" onClick={e => e.stopPropagation()}>
            <h3><DollarSign size={18} /> Decide the charge</h3>
            <p>
              {(resolveTarget.studentName || resolveTarget.student?.fullName)} cancelled{' '}
              {resolveTarget.className || resolveTarget.session?.class?.name} with{' '}
              {Number(resolveTarget.hoursBeforeClass).toFixed(1)}h notice (suggested {resolveTarget.suggestedChargePercent}%).
            </p>
            <label className="cancel-modal-label">Final charge percent</label>
            <input
              type="number"
              min="0"
              max="100"
              value={resolvePercent}
              onChange={e => setResolvePercent(e.target.value)}
            />
            <label className="cancel-modal-label" style={{ marginTop: 12 }}>Charge amount ($, optional — creates the transaction now)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Leave blank to decide later"
              value={resolveAmount}
              onChange={e => setResolveAmount(e.target.value)}
            />
            <div className="cancel-modal-actions">
              <button className="cancel-modal-back" disabled={resolveSubmitting} onClick={() => setResolveTarget(null)}>
                Cancel
              </button>
              <button className="cancel-modal-confirm" disabled={resolveSubmitting} onClick={handleResolveCancellation}>
                {resolveSubmitting ? 'Saving...' : 'Confirm Decision'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FrontDeskAlerts;
