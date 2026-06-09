import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Star, Gift, BookOpen, Calendar, Award, AlertTriangle, ThumbsUp,
  Clock, Heart, Users, MessageSquare, QrCode, Plus, X, Trash2, ShieldCheck
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import ErrorBanner from '../Layout/ErrorBanner';
import './ParentPortal.css';

const RELATIONSHIPS = ['Parent', 'Guardian', 'Grandparent', 'Aunt/Uncle', 'Sibling', 'Family Friend', 'Other'];

const PickupModal = ({ children, onClose, onCreated }) => {
  const [form, setForm] = useState({ pickupPerson: '', relationship: 'Parent', validDate: '', studentId: '' });
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState(null);

  const today = new Date().toISOString().split('T')[0];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.pickupPerson || !form.validDate) return;
    setSubmitting(true);
    try {
      const res = await api.post('/portal/parent/pickup', {
        pickupPerson: form.pickupPerson,
        relationship: form.relationship,
        validDate: form.validDate,
        studentName: children.find(c => c.id === form.studentId)?.fullName || '',
      });
      setCreated(res.data);
      onCreated(res.data);
    } catch (err) {
      console.error('Failed to create pickup auth:', err);
    }
    setSubmitting(false);
  };

  const qrPayload = created
    ? JSON.stringify({ token: created.qrCodeHash, person: created.pickupPerson, valid: created.validDate })
    : null;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pickup-modal">
        <button className="modal-close" onClick={onClose}><X size={18} /></button>

        {!created ? (
          <>
            <div className="modal-header">
              <div className="modal-icon"><QrCode size={22} /></div>
              <div>
                <h2>Authorize Pickup</h2>
                <p>Generate a QR code for a trusted person to pick up your child.</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="pickup-form">
              {children.length > 1 && (
                <div className="form-group">
                  <label>Student</label>
                  <select value={form.studentId} onChange={e => setForm(f => ({ ...f, studentId: e.target.value }))}>
                    <option value="">All Children</option>
                    {children.map(c => <option key={c.id} value={c.id}>{c.fullName}</option>)}
                  </select>
                </div>
              )}

              <div className="form-group">
                <label>Authorized Person's Name *</label>
                <input
                  type="text"
                  placeholder="Full name"
                  value={form.pickupPerson}
                  onChange={e => setForm(f => ({ ...f, pickupPerson: e.target.value }))}
                  required
                />
              </div>

              <div className="form-group">
                <label>Relationship</label>
                <select value={form.relationship} onChange={e => setForm(f => ({ ...f, relationship: e.target.value }))}>
                  {RELATIONSHIPS.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label>Valid Date *</label>
                <input
                  type="date"
                  min={today}
                  value={form.validDate}
                  onChange={e => setForm(f => ({ ...f, validDate: e.target.value }))}
                  required
                />
              </div>

              <button type="submit" className="generate-btn" disabled={submitting}>
                {submitting ? 'Generating...' : <><QrCode size={16} /> Generate QR Code</>}
              </button>
            </form>
          </>
        ) : (
          <div className="qr-result">
            <div className="qr-success-badge"><ShieldCheck size={20} /> Authorization Created</div>
            <h3>{created.pickupPerson}</h3>
            <p className="qr-valid-date">
              Valid for: <strong>{new Date(created.validDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</strong>
            </p>

            <div className="qr-wrapper">
              <QRCodeSVG
                value={qrPayload}
                size={200}
                bgColor="#ffffff"
                fgColor="#1e293b"
                level="M"
                includeMargin={true}
              />
            </div>

            <p className="qr-instructions">
              Show this QR code at the front desk. Staff will scan it to verify the pickup authorization.
            </p>

            <div className="qr-actions">
              <button className="qr-new-btn" onClick={() => setCreated(null)}>Create Another</button>
              <button className="qr-done-btn" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const ParentPortal = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeChild, setActiveChild] = useState(0);
  const [pickupAuths, setPickupAuths] = useState([]);
  const [showPickupModal, setShowPickupModal] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [portalRes, pickupRes] = await Promise.all([
        api.get('/portal/parent'),
        api.get('/portal/parent/pickup'),
      ]);
      setData(portalRes.data);
      setPickupAuths(pickupRes.data);
    } catch (err) {
      setError(err.userMessage || 'No se pudo cargar el portal familiar. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handlePickupCreated = (auth) => {
    setPickupAuths(prev => [auth, ...prev]);
  };

  const handleDeleteAuth = async (id) => {
    try {
      await api.delete(`/portal/parent/pickup/${id}`);
      setPickupAuths(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      console.error('Failed to delete auth:', err);
    }
  };

  if (loading) return <div className="portal-loading">Loading your family portal...</div>;
  if (error) return <div className="portal-loading"><ErrorBanner message={error} onRetry={load} /></div>;
  if (!data) return null;

  const { children, announcements } = data;
  const child = children[activeChild] || null;

  const today = new Date().toDateString();
  const activeAuths = pickupAuths.filter(a => new Date(a.validDate) >= new Date(new Date().setHours(0,0,0,0)));

  return (
    <div className="parent-portal">
      {/* Header */}
      <div className="parent-header">
        <div className="parent-header-content">
          <Heart size={24} />
          <div>
            <h1>Family Portal</h1>
            <p>Track your children's progress, points, and academy updates.</p>
          </div>
        </div>
        <div className="header-actions">
          <button className="pickup-shortcut" onClick={() => setShowPickupModal(true)}>
            <QrCode size={16} />
            Pickup Auth
            {activeAuths.length > 0 && <span className="auth-badge">{activeAuths.length}</span>}
          </button>
          <button className="chat-shortcut" onClick={() => navigate('/chat')}>
            <MessageSquare size={16} />
            Chat with Teachers
          </button>
        </div>
      </div>

      {/* Active Pickup Authorizations Strip */}
      {activeAuths.length > 0 && (
        <div className="pickup-strip">
          <div className="pickup-strip-label">
            <ShieldCheck size={15} />
            Active Pickup Authorizations
          </div>
          <div className="pickup-chips">
            {activeAuths.map(auth => (
              <div key={auth.id} className="pickup-chip">
                <QrCode size={13} />
                <span className="chip-name">{auth.pickupPerson}</span>
                <span className="chip-date">
                  {new Date(auth.validDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
                <button className="chip-delete" onClick={() => handleDeleteAuth(auth.id)} title="Revoke">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <button className="pickup-add-mini" onClick={() => setShowPickupModal(true)}>
            <Plus size={14} /> Add
          </button>
        </div>
      )}

      {/* Children Tabs */}
      {children.length > 1 && (
        <div className="children-tabs">
          {children.map((c, i) => (
            <button
              key={c.id}
              className={`child-tab ${activeChild === i ? 'active' : ''}`}
              onClick={() => setActiveChild(i)}
            >
              <div className="child-tab-avatar">{c.fullName?.[0]}</div>
              <span>{c.fullName?.split(' ')[0]}</span>
            </button>
          ))}
        </div>
      )}

      {child ? (
        <>
          {/* Child Overview */}
          <div className="child-overview">
            <div className="child-profile-card">
              <div className="child-avatar-large">{child.fullName?.[0]}</div>
              <div className="child-details">
                <h2>{child.fullName}</h2>
                {child.age && <span className="child-age">Age {child.age}</span>}
                <span className={`child-status ${child.status?.toLowerCase()}`}>{child.status}</span>
              </div>
            </div>

            <div className="child-stats">
              <div className="child-stat">
                <Star size={20} fill="#fbbf24" color="#fbbf24" />
                <div className="stat-info">
                  <span className="stat-number">{child.prizePoints || 0}</span>
                  <span className="stat-text">Prize Points</span>
                </div>
              </div>
              <div className="child-stat">
                <span style={{ fontSize: '20px' }}>🍪</span>
                <div className="stat-info">
                  <span className="stat-number">{child.snackPunches || 0}</span>
                  <span className="stat-text">Snack Punches</span>
                </div>
              </div>
              <div className="child-stat positive-stat">
                <ThumbsUp size={20} />
                <div className="stat-info">
                  <span className="stat-number">{child.behaviorSummary?.positives || 0}</span>
                  <span className="stat-text">Positives</span>
                </div>
              </div>
              <div className="child-stat warning-stat">
                <AlertTriangle size={20} />
                <div className="stat-info">
                  <span className="stat-number">{child.behaviorSummary?.warnings || 0}</span>
                  <span className="stat-text">Warnings</span>
                </div>
              </div>
            </div>
          </div>

          {/* Health Info Banner */}
          {(child.allergies || child.medicalNotes) && (
            <div className="health-banner">
              <AlertTriangle size={16} />
              <div>
                {child.allergies && <span><strong>Allergies:</strong> {child.allergies}</span>}
                {child.medicalNotes && <span><strong>Medical:</strong> {child.medicalNotes}</span>}
              </div>
            </div>
          )}

          {/* Content Grid */}
          <div className="parent-grid">
            {/* Classes */}
            <div className="parent-section">
              <h3><Calendar size={18} /> Classes &amp; Schedule</h3>
              {child.enrollments?.length === 0 ? (
                <p className="empty-text">No active classes.</p>
              ) : (
                <div className="parent-classes">
                  {child.enrollments?.map((e, i) => (
                    <div key={i} className="parent-class-item">
                      <div>
                        <h4>{e.className}</h4>
                        <span>with {e.teacherName}</span>
                      </div>
                      {e.upcomingSessions?.[0] && (
                        <div className="next-badge">
                          <Clock size={11} />
                          {new Date(e.upcomingSessions[0].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Rewards */}
            <div className="parent-section">
              <h3><Gift size={18} /> Recent Rewards</h3>
              {child.prizeHistory?.length === 0 ? (
                <p className="empty-text">No rewards yet.</p>
              ) : (
                <div className="reward-list">
                  {child.prizeHistory?.slice(0, 6).map((p, i) => (
                    <div key={i} className="reward-item">
                      <span className="reward-reason">{p.reason}</span>
                      <span className={`reward-pts ${p.type === 'EARNED' ? 'pos' : 'neg'}`}>
                        {p.type === 'EARNED' ? '+' : '-'}{p.points}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Materials */}
            <div className="parent-section">
              <h3><BookOpen size={18} /> Study Materials</h3>
              {child.materials?.length === 0 ? (
                <p className="empty-text">No materials assigned.</p>
              ) : (
                <div className="parent-materials">
                  {child.materials?.slice(0, 5).map((m, i) => (
                    <a key={i} href={m.fileUrl} target="_blank" rel="noopener noreferrer" className="parent-material-link">
                      📄 {m.name}
                      <span className="mat-subject">{m.subject}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* Pickup Authorizations section */}
            <div className="parent-section pickup-section">
              <h3><QrCode size={18} /> Pickup Authorizations</h3>
              {pickupAuths.length === 0 ? (
                <div className="pickup-empty">
                  <p className="empty-text">No authorizations yet.</p>
                  <button className="create-pickup-btn" onClick={() => setShowPickupModal(true)}>
                    <Plus size={14} /> Authorize Someone
                  </button>
                </div>
              ) : (
                <div className="pickup-list">
                  {pickupAuths.slice(0, 5).map(auth => {
                    const isPast = new Date(auth.validDate) < new Date(new Date().setHours(0,0,0,0));
                    return (
                      <div key={auth.id} className={`pickup-item ${isPast ? 'expired' : 'valid'}`}>
                        <div className="pickup-item-info">
                          <span className="pickup-person">{auth.pickupPerson}</span>
                          <span className="pickup-date">
                            {new Date(auth.validDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        </div>
                        <div className="pickup-item-actions">
                          <span className={`pickup-status-badge ${isPast ? 'expired' : 'valid'}`}>
                            {isPast ? 'Expired' : 'Active'}
                          </span>
                          {!isPast && (
                            <button className="revoke-btn" onClick={() => handleDeleteAuth(auth.id)}>
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <button className="create-pickup-btn mt-8" onClick={() => setShowPickupModal(true)}>
                    <Plus size={14} /> New Authorization
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="no-children">
          <Users size={40} />
          <h3>No Students Found</h3>
          <p>Your family account doesn't have any students linked yet.</p>
        </div>
      )}

      {/* Announcements */}
      {announcements.length > 0 && (
        <div className="parent-announcements">
          <h3><Award size={18} /> Academy Announcements</h3>
          <div className="announcement-cards">
            {announcements.slice(0, 4).map((a, i) => (
              <div key={i} className="ann-card">
                {a.isPinned && <span className="pinned-badge">📌 Pinned</span>}
                <h4>{a.title}</h4>
                <p>{a.body.substring(0, 150)}{a.body.length > 150 ? '...' : ''}</p>
                <span className="ann-date">{new Date(a.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pickup Auth Modal */}
      {showPickupModal && (
        <PickupModal
          children={children}
          onClose={() => setShowPickupModal(false)}
          onCreated={handlePickupCreated}
        />
      )}
    </div>
  );
};

export default ParentPortal;
