import React, { useState, useEffect } from 'react';
import { 
  Bell, 
  Video,
  Calendar, 
  MessageSquare, 
  BookOpen, 
  CreditCard, 
  ChevronRight,
  Image as ImageIcon,
  Paperclip,
  Radio
} from 'lucide-react';
import { database } from '../../lib/database';
import { useNavigate } from 'react-router-dom';
import ErrorBanner from '../Layout/ErrorBanner';
import './Dashboard.css';

const Dashboard = () => {
  const [role, setRole] = useState('student'); // 'student' or 'parent'
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  // Helper: check if a session time string is currently live
  const isSessionLive = (timeStr) => {
    if (!timeStr) return false;
    // For demo purposes, mark "Today" sessions at specific simulated times as live
    // In production this would compare real clock vs session time range
    return timeStr.toLowerCase().startsWith('today');
  };

  const loadDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const studentData = await database.fetchStudentData('stu_123');
      setData(studentData);
    } catch (err) {
      console.error('Error loading dashboard:', err);
      setError(err.userMessage || 'Could not load your dashboard. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  if (error) {
    return (
      <div className="dashboard-container">
        <ErrorBanner message={error} onRetry={loadDashboard} />
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="dashboard-container">
        <div className="glass-card" style={{ textAlign: 'center', padding: '100px' }}>
          <div className="dashboard-spinner"></div>
          <p>Loading your academy experience...</p>
        </div>
      </div>
    );
  }



  return (
    <div className="dashboard-container">
      {/* Header with Notifications */}
      <header className="dashboard-header">
        <div className="welcome-section">
          <h1>Welcome Back! 👋</h1>
          <p>You have {data.upcomingSessions.length} class{data.upcomingSessions.length !== 1 ? 'es' : ''} scheduled this week.</p>
        </div>
        
        <div className="header-actions">
          <div className="role-toggle">
            <button 
              className={`role-btn ${role === 'student' ? 'active' : ''}`}
              onClick={() => setRole('student')}
            >
              Student
            </button>
            <button 
              className={`role-btn ${role === 'parent' ? 'active' : ''}`}
              onClick={() => setRole('parent')}
            >
              Parent
            </button>
          </div>
        </div>
      </header>

      <div className="dashboard-grid">
        {/* Main Content Area */}
        <div className="main-col">
          {/* Upcoming Schedule List */}
          <div className="glass-card list-section">
            <div className="section-header">
              <h2>Upcoming Classes</h2>
              <button className="text-link" onClick={() => navigate('/calendar')}>View Full Calendar</button>
            </div>
            <div className="compact-list">
              {data.upcomingSessions.map(session => {
                const live = isSessionLive(session.time);
                return (
                  <div key={session.id} className={`list-item ${live ? 'session-live' : ''}`}>
                    <div className="item-main">
                      <div className={`item-icon ${live ? 'live-icon' : ''}`}>
                        {live ? <Radio size={18} /> : <Calendar size={18} />}
                      </div>
                      <div className="item-text">
                        <h4>{session.subject}</h4>
                        <p>{session.teacher}</p>
                      </div>
                    </div>
                    <div className="item-side">
                      <div style={{ textAlign: 'right' }}>
                        {live && <span className="live-badge">● LIVE NOW</span>}
                        <div style={{ fontWeight: '600', color: live ? 'var(--primary)' : 'var(--text-main)', marginBottom: '4px' }}>{session.time}</div>
                        {session.meetingUrl && (
                          <button 
                            className="join-zoom-btn"
                            onClick={() => window.open(session.meetingUrl, '_blank')}
                          >
                            <Video size={14} />
                            <span>{live ? 'Join Now' : 'Join Zoom'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Lessons Review Section */}
          <div className="glass-card list-section lesson-review-section">
            <div className="section-header">
              <h2>Recent Lesson Materials</h2>
              <p className="section-subtitle">Review notes and files shared by your teachers</p>
            </div>
            <div className="lessons-grid">
              {data.recentSessions.map(session => (
                <div key={session.id} className="lesson-card">
                  <div className="lesson-badge">{session.subject}</div>
                  <div className="lesson-header">
                    <h4>{session.teacher}</h4>
                    <span className="date-tag">{session.date}</span>
                  </div>
                  <p className="lesson-notes">{session.notes}</p>
                  <div className="lesson-materials">
                    {session.materials.map((file, idx) => (
                      <div key={idx} className="material-chip">
                        {file.type.includes('image') ? <ImageIcon size={14} /> : <Paperclip size={14} />}
                        <span>{file.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar Area */}
        <div className="side-col">
          {/* Quick Access Menu */}
          <div className="glass-card list-section">
            <h2>Quick Actions</h2>
            <div className="compact-list">
              <button className="list-item action-row chat-action" onClick={() => navigate('/chat')}>
                <div className="item-main">
                  <div className="item-icon chat-icon"><MessageSquare size={18} /></div>
                  <div className="item-text">
                    <h4>Academy Chat</h4>
                    <p>Contact your teacher</p>
                  </div>
                </div>
                <ChevronRight size={16} />
              </button>
              
              <button className="list-item action-row study-action">
                <div className="item-main">
                  <div className="item-icon study-icon"><BookOpen size={18} /></div>
                  <div className="item-text">
                    <h4>Study Materials</h4>
                    <p>Review last lesson</p>
                  </div>
                </div>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {/* Role-Specific Card: Parent Billing */}
          {role === 'parent' && (
            <div className="glass-card billing-card" style={{ background: '#f0fdf4', borderColor: '#bbf7d0' }}>
              <div className="billing-head">
                <div style={{ display:'flex', alignItems:'center', gap: '8px', color: '#166534', fontWeight:'700'}}>
                  <CreditCard size={20} />
                  <span>Pending Invoice</span>
                </div>
                <span style={{ color:'#166534', fontWeight:'800'}}>{data.billing.nextPayment}</span>
              </div>
              <p style={{ fontSize:'12px', color:'#166534', opacity: 0.8 }}>Due date: {data.billing.dueDate}</p>
              
              <div style={{ marginTop:'12px', padding:'10px', background:'white', borderRadius:'8px', fontSize:'11px'}}>
                {data.billing.pendingCharges.map((charge, i) => (
                  <div key={i} style={{ display:'flex', justifyContent:'space-between', color: '#4b5563'}}>
                    <span>{charge.item}</span>
                    <span style={{ fontWeight:'600'}}>{charge.amount}</span>
                  </div>
                ))}
              </div>

              <button className="pay-btn" style={{ background:'#166534'}}>
                Pay Tuition Now
              </button>
            </div>
          )}

          {/* Recent Activity / Notifications */}
          <div className="glass-card list-section" style={{ marginTop: '24px' }}>
            <h2>Notifications</h2>
            <div className="compact-list">
              {data.notifications.map(notif => (
                <div key={notif.id} className="list-item" style={{ border:'none', padding:'10px 0', background:'none'}}>
                  <div className="item-main">
                    <div className="item-text">
                      <p style={{ color: 'var(--text-main)', fontWeight:'500'}}>{notif.text}</p>
                      <span style={{ fontSize:'10px', opacity: 0.7 }}>{notif.date}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
