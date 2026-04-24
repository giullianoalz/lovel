import React, { useState, useEffect } from 'react';
import { 
  Bell, 
  Video, 
  Calendar, 
  MessageSquare, 
  BookOpen, 
  CreditCard, 
  Clock, 
  User, 
  ChevronRight,
  TrendingUp,
  FileText,
  Image as ImageIcon,
  Paperclip
} from 'lucide-react';
import { database } from '../../lib/database';
import { useNavigate } from 'react-router-dom';
import './Dashboard.css';

const Dashboard = () => {
  const [role, setRole] = useState('student'); // 'student' or 'parent'
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const loadDashboard = async () => {
      setLoading(true);
      const studentData = await database.fetchStudentData('stu_123');
      setData(studentData);
      setLoading(false);
    };
    loadDashboard();
  }, []);

  if (loading || !data) {
    return (
      <div className="dashboard-container">
        <div className="glass-card" style={{ textAlign: 'center', padding: '100px' }}>
          <p>Loading your academy experience...</p>
        </div>
      </div>
    );
  }

  const nextClass = data.upcomingSessions[0];

  return (
    <div className="dashboard-container">
      {/* Header with Notifications */}
      <header className="dashboard-header">
        <div className="welcome-section">
          <h1>Good Morning, Maria! 👋</h1>
          <p>You have {data.upcomingSessions.length} classes scheduled for this week.</p>
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
          
          <button className="notif-bell">
            <Bell size={20} />
            <span className="notif-badge">2</span>
          </button>
        </div>
      </header>

      <div className="dashboard-grid">
        {/* Main Content Area */}
        <div className="main-col">
          {/* Featured Next Class Card */}
          <div className="glass-card next-class-card">
            <h2>Next Up</h2>
            <div className="next-class-info">
              <div className="class-details">
                <h3>{nextClass.subject}</h3>
                <p><User size={14} style={{display:'inline', marginRight: '6px'}} /> {nextClass.teacher}</p>
                <p><Clock size={14} style={{display:'inline', marginRight: '6px'}} /> {nextClass.time} ({nextClass.type})</p>
              </div>
              <button className="join-btn" onClick={() => window.open('#', '_blank')}>
                <Video size={20} />
                <span>Join Virtual Class</span>
              </button>
            </div>
          </div>

          {/* Quick Metrics Row */}
          <div className="stats-row">
            <div className="glass-card stat-item">
              <span className="stat-value">12</span>
              <span className="stat-label">Hours Completed</span>
            </div>
            <div className={`glass-card stat-item ${role === 'parent' ? 'highlight' : ''}`}>
              <span className="stat-value">{role === 'parent' ? data.billing.nextPayment : '94%'}</span>
              <span className="stat-label">{role === 'parent' ? 'Next Payment' : 'Attendance Rate'}</span>
            </div>
            <div className="glass-card stat-item">
              <span className="stat-value">{data.recentSessions.length}</span>
              <span className="stat-label">Resources Available</span>
            </div>
          </div>

          {/* Lessons Review Section */}
          <div className="glass-card list-section lesson-review-section">
            <div className="section-header">
              <h2>Recent Lesson Materials</h2>
              <p className="text-muted" style={{fontSize: '13px'}}>Review notes and files shared by your teachers</p>
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

          {/* Upcoming Schedule List */}
          <div className="glass-card list-section">
            <div className="section-header" style={{ display:'flex', justifyContent:'space-between', marginBottom:'16px'}}>
              <h2>Upcoming Classes</h2>
              <button className="text-link" onClick={() => navigate('/calendar')} style={{ background:'none', border:'none', color:'var(--primary)', fontWeight:'600', cursor:'pointer'}}>View Full Calendar</button>
            </div>
            <div className="compact-list">
              {data.upcomingSessions.slice(1).map(session => (
                <div key={session.id} className="list-item">
                  <div className="item-main">
                    <div className="item-icon"><Calendar size={18} /></div>
                    <div className="item-text">
                      <h4>{session.subject}</h4>
                      <p>{session.teacher}</p>
                    </div>
                  </div>
                  <div className="item-side">{session.time}</div>
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
              <button className="list-item action-row" onClick={() => navigate('/chat')} style={{ width:'100%', border:'none', background:'rgba(255,255,255,0.5)', cursor:'pointer' }}>
                <div className="item-main">
                  <div className="item-icon" style={{ background:'#e0f2fe', color:'#0ea5e9'}}><MessageSquare size={18} /></div>
                  <div className="item-text" style={{ textAlign:'left'}}>
                    <h4>Academy Chat</h4>
                    <p>Contact your teacher</p>
                  </div>
                </div>
                <ChevronRight size={16} />
              </button>
              
              <button className="list-item action-row" style={{ width:'100%', border:'none', background:'rgba(255,255,255,0.5)', cursor:'pointer' }}>
                <div className="item-main">
                  <div className="item-icon" style={{ background:'#fef3c7', color:'#d97706'}}><BookOpen size={18} /></div>
                  <div className="item-text" style={{ textAlign:'left'}}>
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
