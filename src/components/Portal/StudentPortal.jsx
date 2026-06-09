import React, { useState, useEffect } from 'react';
import { Star, Gift, BookOpen, Calendar, Award, AlertTriangle, ThumbsUp, Clock, TrendingUp } from 'lucide-react';
import api from '../../lib/api';
import ErrorBanner from '../Layout/ErrorBanner';
import './StudentPortal.css';

const StudentPortal = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/portal/student');
      setData(response.data);
    } catch (err) {
      setError(err.userMessage || 'No se pudo cargar el portal. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="portal-loading">Loading your portal...</div>;
  if (error) return <div className="portal-loading"><ErrorBanner message={error} onRetry={load} /></div>;
  if (!data) return null;

  const { student, enrollments, prizeHistory, behaviorSummary, materials, announcements } = data;

  return (
    <div className="student-portal">
      {/* Welcome Banner */}
      <div className="welcome-banner">
        <div className="welcome-avatar">{student.fullName?.[0] || '?'}</div>
        <div className="welcome-text">
          <h1>Welcome back, {student.fullName?.split(' ')[0]}! 🎉</h1>
          <p>Here's your academy dashboard — keep earning those points!</p>
        </div>
      </div>

      {/* Points Overview */}
      <div className="points-grid">
        <div className="points-card prize-card">
          <div className="points-icon"><Star size={28} fill="#fbbf24" color="#fbbf24" /></div>
          <div className="points-value">{student.prizePoints || 0}</div>
          <div className="points-label">Prize Points</div>
          <div className="points-bar">
            <div className="points-bar-fill" style={{ width: `${Math.min((student.prizePoints || 0) / 100 * 100, 100)}%` }} />
          </div>
          <span className="points-hint">{Math.max(100 - (student.prizePoints || 0), 0)} to next reward level</span>
        </div>
        <div className="points-card snack-card">
          <div className="points-icon">🍪</div>
          <div className="points-value">{student.snackPunches || 0}</div>
          <div className="points-label">Snack Punches</div>
        </div>
        <div className="points-card behavior-summary-card">
          <div className="behavior-split">
            <div className="b-stat positive">
              <ThumbsUp size={18} />
              <span className="b-count">{behaviorSummary.positives}</span>
              <span className="b-label">Positive Notes</span>
            </div>
            <div className="b-divider" />
            <div className="b-stat warning">
              <AlertTriangle size={18} />
              <span className="b-count">{behaviorSummary.warnings}</span>
              <span className="b-label">Warnings</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="portal-grid">
        {/* My Schedule */}
        <div className="portal-section">
          <h2><Calendar size={20} /> My Classes</h2>
          <div className="classes-list">
            {enrollments.length === 0 ? (
              <p className="empty-text">No active enrollments.</p>
            ) : (
              enrollments.map((e, i) => (
                <div key={i} className="class-item">
                  <div className="class-info">
                    <h4>{e.className}</h4>
                    <span className="teacher-name">with {e.teacherName}</span>
                  </div>
                  {e.upcomingSessions?.length > 0 && (
                    <div className="next-session">
                      <Clock size={12} />
                      <span>Next: {new Date(e.upcomingSessions[0].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Prize History */}
        <div className="portal-section">
          <h2><Gift size={20} /> Recent Rewards</h2>
          <div className="prize-list">
            {prizeHistory.length === 0 ? (
              <p className="empty-text">No rewards yet — keep going!</p>
            ) : (
              prizeHistory.slice(0, 8).map((p, i) => (
                <div key={i} className="prize-item">
                  <div className="prize-info">
                    <span className="prize-reason">{p.reason}</span>
                    <span className="prize-date">{new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  </div>
                  <span className={`prize-points ${p.type === 'EARNED' ? 'earned' : 'redeemed'}`}>
                    {p.type === 'EARNED' ? '+' : '-'}{p.points} pts
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Materials */}
        <div className="portal-section">
          <h2><BookOpen size={20} /> My Materials</h2>
          <div className="materials-list">
            {materials.length === 0 ? (
              <p className="empty-text">No materials assigned yet.</p>
            ) : (
              materials.slice(0, 6).map((m, i) => (
                <a key={i} href={m.fileUrl} target="_blank" rel="noopener noreferrer" className="material-link">
                  <div className="material-icon">📄</div>
                  <div>
                    <span className="material-name">{m.name}</span>
                    <span className="material-subject">{m.subject}</span>
                  </div>
                </a>
              ))
            )}
          </div>
        </div>

        {/* Announcements */}
        <div className="portal-section">
          <h2><Award size={20} /> Announcements</h2>
          <div className="announcements-list">
            {announcements.length === 0 ? (
              <p className="empty-text">No announcements right now.</p>
            ) : (
              announcements.slice(0, 5).map((a, i) => (
                <div key={i} className="announcement-item">
                  <h4>{a.title}</h4>
                  <p>{a.body.substring(0, 120)}{a.body.length > 120 ? '...' : ''}</p>
                  <span className="announcement-date">
                    {new Date(a.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {a.author && ` — ${a.author.fullName}`}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default StudentPortal;
