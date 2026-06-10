import React, { useState, useEffect, useRef } from 'react';
import { Bell, Clock, User, CheckCircle, Shield, AlertCircle, LogOut, LifeBuoy, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import io from 'socket.io-client';
import api from '../../lib/api';
import './FrontDeskAlerts.css';

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

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

  useEffect(() => {
    loadAlerts('active');
    loadAlerts('resolved');

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

  const getUrgency = (createdAt) => {
    const diffMins = Math.floor((new Date() - new Date(createdAt)) / 60000);
    if (diffMins >= 15) return 'critical';
    if (diffMins >= 10) return 'high';
    if (diffMins >= 5) return 'medium';
    return 'low';
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
                const urgency = getUrgency(alert.createdAt);
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
    </div>
  );
};

export default FrontDeskAlerts;
