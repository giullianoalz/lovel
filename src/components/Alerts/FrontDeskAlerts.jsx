import React, { useState, useEffect, useRef } from 'react';
import { Bell, Clock, User, CheckCircle, Shield, AlertCircle, LogOut, LifeBuoy, ExternalLink, Ban, DollarSign, Cookie, AlertTriangle, FileWarning } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { useAuth } from '../../context/AuthContext';
import './FrontDeskAlerts.css';

const ALERT_TYPES = {
  'Student out': { icon: LogOut, color: '#eab308' }, // Yellow
  'Class support': { icon: LifeBuoy, color: '#f97316' }, // Orange
  'Medic': { icon: AlertCircle, color: '#ef4444' } // Red
};

// Behavior tracking feeds this screen too: the front desk is where a parent
// asks about an incident, so warnings and slips have to be readable here.
// Positive notes are deliberately left out — nothing for the desk to handle.
const BEHAVIOR_TYPES = {
  WARNING: { label: 'Warning', icon: AlertTriangle, color: '#f59e0b' },
  SLIP: { label: 'Disciplinary Slip', icon: FileWarning, color: '#ef4444' },
};

const FrontDeskAlerts = () => {
  // This screen mixes queues that answer to different endpoints, so each block
  // is gated by the roles its own endpoint accepts — one blanket flag would
  // either hide work the front desk may do or show buttons that 403.
  const { hasRole } = useAuth();
  const canResolveAlerts = hasRole('ADMIN', 'RECEPTIONIST');   // PATCH /alerts/:id
  const canReviewCancellations = hasRole('ADMIN');             // /sessions/cancellations
  const canHandleSnacks = hasRole('ADMIN', 'TEACHER');         // /rewards/snacks/*
  const canOpenStudent = hasRole('ADMIN', 'TEACHER', 'RECEPTIONIST'); // /students directory
  const canSeeBehavior = hasRole('ADMIN', 'RECEPTIONIST', 'TEACHER'); // GET /behavior
  const [alerts, setAlerts] = useState([]);
  const [historyAlerts, setHistoryAlerts] = useState([]);
  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'behavior' | 'history'
  const socketRef = useRef(null);
  const navigate = useNavigate();

  /* Cancellation-charge review queue */
  const [cancellations, setCancellations] = useState([]);
  const [resolveTarget, setResolveTarget] = useState(null); // cancellation object
  const [resolvePercent, setResolvePercent] = useState(50);
  const [resolveAmount, setResolveAmount] = useState('');
  const [resolveSubmitting, setResolveSubmitting] = useState(false);

  /* Snack reload queue (parent-approved, awaiting top-up + charge) */
  const [reloads, setReloads] = useState([]);
  const [reloadFulfilling, setReloadFulfilling] = useState(null);

  /* Behavior tracking — warnings + slips, read-only from this screen */
  const [behaviorLogs, setBehaviorLogs] = useState([]);
  const [behaviorLoading, setBehaviorLoading] = useState(true);

  /**
   * The same alert reaches this screen in two shapes: the socket event sends
   * flat `teacherName` / `studentName`, GET /alerts sends nested `reportedBy` /
   * `student`. The cards render the flat shape, so anything loaded over REST —
   * i.e. every alert still open after a page refresh — showed "Reported by"
   * with no name and "Class Alert" instead of the student. Flatten on the way in.
   */
  const normalizeAlert = (alert) => ({
    ...alert,
    teacherName: alert.teacherName || alert.reportedBy?.fullName,
    studentName: alert.studentName || alert.student?.fullName,
    studentId: alert.studentId || alert.student?.id,
  });

  const loadAlerts = async (status = 'active') => {
    try {
      const response = await api.get('/alerts', { params: { status } });
      const alerts = response.data.alerts.map(normalizeAlert);
      if (status === 'active') {
        setAlerts(alerts);
      } else {
        setHistoryAlerts(alerts);
      }
    } catch (error) {
      console.error('Error loading alerts:', error);
    }
  };

  const loadCancellations = async () => {
    try {
      const response = await api.get('/sessions/cancellations', { params: { status: 'PENDING_REVIEW' } });
      setCancellations(response.data.cancellations);
    } catch (error) {
      console.error('Error loading pending cancellations:', error);
    }
  };

  const loadReloads = async () => {
    try {
      const response = await api.get('/rewards/snacks/reload-requests', { params: { status: 'APPROVED' } });
      setReloads(response.data.requests);
    } catch (error) {
      console.error('Error loading snack reload requests:', error);
    }
  };

  /**
   * Same two-shapes problem as alerts: the `behavior_logged` socket event sends
   * flat names, GET /behavior sends nested student/teacher. Flatten on the way in
   * so one row renderer covers both.
   */
  const normalizeBehavior = (log) => ({
    ...log,
    studentName: log.studentName || log.student?.fullName,
    studentId: log.studentId || log.student?.id,
    teacherName: log.teacherName || log.teacher?.fullName,
    status: log.status || 'RECORDED',
  });

  /**
   * The API filters by a single type, so ask for warnings and slips separately
   * and merge — cheaper than pulling every positive note just to drop it here.
   */
  const loadBehavior = async () => {
    setBehaviorLoading(true);
    try {
      const responses = await Promise.all(
        Object.keys(BEHAVIOR_TYPES).map(type =>
          api.get('/behavior', { params: { type, limit: 25 } })
        )
      );
      const merged = responses
        .flatMap(r => r.data.logs)
        .map(normalizeBehavior)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setBehaviorLogs(merged);
    } catch (error) {
      console.error('Error loading behavior logs:', error);
    } finally {
      setBehaviorLoading(false);
    }
  };

  const handleFulfillReload = async (id) => {
    setReloadFulfilling(id);
    try {
      await api.post(`/rewards/snacks/reload-requests/${id}/fulfill`);
      setReloads(prev => prev.filter(r => r.id !== id));
    } catch (error) {
      console.error('Error fulfilling snack reload:', error);
    } finally {
      setReloadFulfilling(null);
    }
  };

  useEffect(() => {
    loadAlerts('active');
    loadAlerts('resolved');
    if (canReviewCancellations) loadCancellations();
    if (canHandleSnacks) loadReloads();
    if (canSeeBehavior) loadBehavior();

    // Share the app-wide authenticated socket (also used by chat + the
    // notification bell) instead of opening a second, unauthenticated one.
    const socket = getSocket();
    socketRef.current = socket;
    socket.emit('join_admin');

    const onClassAlert = (alertData) => setAlerts(prev => [alertData, ...prev]);
    const onClassAlertUpdate = (updateData) => {
      setAlerts(prev => prev.filter(a => a.id !== updateData.id));
      loadAlerts('resolved'); // refresh history
    };
    const onCancellationPending = (data) => setCancellations(prev => [data, ...prev]);
    const onCancellationResolved = ({ id }) => setCancellations(prev => prev.filter(c => c.id !== id));
    const onBehaviorLogged = (log) => {
      // Positive notes go to the Behavior module only; the desk queue is
      // warnings and slips. Guard against a duplicate id in case a refetch
      // raced the event.
      if (!BEHAVIOR_TYPES[log.type]) return;
      setBehaviorLogs(prev =>
        prev.some(l => l.id === log.id) ? prev : [normalizeBehavior(log), ...prev]
      );
    };

    socket.on('class_alert', onClassAlert);
    socket.on('class_alert_update', onClassAlertUpdate);
    socket.on('cancellation_pending', onCancellationPending);
    socket.on('cancellation_resolved', onCancellationResolved);
    socket.on('behavior_logged', onBehaviorLogged);

    return () => {
      // Detach only our own listeners — the socket is shared, so never
      // disconnect it here or chat/notifications lose their connection.
      socket.off('class_alert', onClassAlert);
      socket.off('class_alert_update', onClassAlertUpdate);
      socket.off('cancellation_pending', onCancellationPending);
      socket.off('cancellation_resolved', onCancellationResolved);
      socket.off('behavior_logged', onBehaviorLogged);
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

  // "Pending" = logged but no admin has set a severity / decided on it yet.
  const pendingBehaviorCount = behaviorLogs.filter(l => l.status === 'RECORDED').length;

  return (
    <div className="regulation-container">
      <header className="regulation-header">
        <div className="header-title-row">
          <div className="header-icon-pulse">
            <Bell size={22} />
            {alerts.length > 0 && <span className="pulse-dot" />}
          </div>
          <div>
            <p className="text-muted">Real-time alerts for student absences, class support, and medical needs — plus behavior warnings and slips.</p>
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
      {canReviewCancellations && cancellations.length > 0 && (
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

      {/* Snack reload queue — parent-approved, awaiting top-up + charge */}
      {canHandleSnacks && reloads.length > 0 && (
        <div className="cancellation-queue">
          <h2 className="cancellation-queue-title"><Cookie size={16} /> Snack Reloads Approved ({reloads.length})</h2>
          <div className="cancellation-queue-grid">
            {reloads.map(r => (
              <div key={r.id} className="cancellation-card">
                <div className="cancellation-card-top">
                  <button
                    className="alert-student-name-link"
                    onClick={() => navigate(`/students?highlight=${r.studentId}`)}
                  >
                    {r.studentName}
                    <ExternalLink size={12} />
                  </button>
                  <span className="cancellation-suggested-badge">{r.punchCount} punches · ${r.price.toFixed(2)}</span>
                </div>
                <p className="cancellation-meta">
                  Parent approved a paid reload{r.familyName ? ` · ${r.familyName}` : ''}
                </p>
                <button
                  className="cancellation-resolve-btn"
                  disabled={reloadFulfilling === r.id}
                  onClick={() => handleFulfillReload(r.id)}
                >
                  <DollarSign size={14} /> {reloadFulfilling === r.id ? 'Processing...' : 'Reload & charge'}
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
        {canSeeBehavior && (
          <button
            className={`reg-tab ${activeTab === 'behavior' ? 'active' : ''}`}
            onClick={() => { setActiveTab('behavior'); loadBehavior(); }}
          >
            <AlertTriangle size={14} /> Warnings & Slips ({behaviorLogs.length})
            {pendingBehaviorCount > 0 && <span className="reg-tab-pending">{pendingBehaviorCount} pending</span>}
          </button>
        )}
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
                            canOpenStudent ? (
                              <button
                                className="alert-student-name-link"
                                onClick={() => navigate(`/students?highlight=${alert.studentId}`)}
                                title="View student profile"
                              >
                                {alert.studentName}
                                <ExternalLink size={12} />
                              </button>
                            ) : (
                              <h3 className="alert-student-name">{alert.studentName}</h3>
                            )
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

                    {canResolveAlerts && (
                      <button className="return-btn" onClick={() => handleMarkResolved(alert.id)}>
                        <CheckCircle size={16} />
                        Mark as Resolved
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Behavior — warnings and slips from the Behavior Tracking module */}
      {activeTab === 'behavior' && canSeeBehavior && (
        <div className="history-panel">
          {behaviorLoading ? (
            <div className="behavior-desk-loading">
              <span className="app-inline-loader"><span className="app-spinner-sm" />Loading warnings and slips…</span>
            </div>
          ) : behaviorLogs.length === 0 ? (
            <div className="no-alerts">
              <Shield size={40} />
              <h3>Nothing logged</h3>
              <p>No warnings or disciplinary slips have been recorded.</p>
            </div>
          ) : (
            <table className="history-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Student</th>
                  <th>Category</th>
                  <th>Severity</th>
                  <th>Description</th>
                  <th>Logged By</th>
                  <th>When</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {behaviorLogs.map(log => {
                  const config = BEHAVIOR_TYPES[log.type] || BEHAVIOR_TYPES.WARNING;
                  const TypeIcon = config.icon;
                  const when = new Date(log.createdAt);
                  const pending = log.status === 'RECORDED';

                  return (
                    <tr key={log.id}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: config.color, fontWeight: '600', fontSize: '0.85rem' }}>
                          <TypeIcon size={14} /> {config.label}
                        </span>
                      </td>
                      <td>
                        <div className="student-cell">
                          <div className="student-avatar-mini">{log.studentName?.[0] || '?'}</div>
                          {canOpenStudent && log.studentId ? (
                            <button
                              className="alert-student-name-link"
                              onClick={() => navigate(`/students?highlight=${log.studentId}`)}
                              title="View student profile"
                            >
                              {log.studentName || 'Unknown'}
                              <ExternalLink size={12} />
                            </button>
                          ) : (
                            <span>{log.studentName || 'Unknown'}</span>
                          )}
                        </div>
                      </td>
                      <td><span className="behavior-desk-pill">{log.category}</span></td>
                      <td>
                        {/* Severity is only meaningful once an admin has reviewed it —
                            before that the stored value is just the schema default. */}
                        {pending ? (
                          <span className="behavior-desk-badge pending">Pending</span>
                        ) : (
                          <span className={`behavior-desk-badge sev-${(log.severity || 'minor').toLowerCase()}`}>
                            {log.severity}
                          </span>
                        )}
                      </td>
                      <td className="reason-cell" title={log.description}>{log.description}</td>
                      <td>{log.teacherName || 'System'}</td>
                      <td title={when.toLocaleString()}>
                        {when.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td>
                        <span className={`behavior-desk-badge status-${log.status.toLowerCase()}`}>
                          {log.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
