import React, { useState, useEffect } from 'react';
import { Star, Gift, BookOpen, Calendar, Award, AlertTriangle, ThumbsUp, Clock, Heart, Users, MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import './ParentPortal.css';

const ParentPortal = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeChild, setActiveChild] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const load = async () => {
      try {
        const response = await api.get('/portal/parent');
        setData(response.data);
      } catch (error) {
        console.error('Error loading parent portal:', error);
      }
      setLoading(false);
    };
    load();
  }, []);

  if (loading) return <div className="portal-loading">Loading your family portal...</div>;
  if (!data) return <div className="portal-loading">Unable to load portal data.</div>;

  const { children, announcements } = data;
  const child = children[activeChild] || null;

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
        <button className="chat-shortcut" onClick={() => navigate('/chat')}>
          <MessageSquare size={16} />
          Chat with Teachers
        </button>
      </div>

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
              <h3><Calendar size={18} /> Classes & Schedule</h3>
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
    </div>
  );
};

export default ParentPortal;
