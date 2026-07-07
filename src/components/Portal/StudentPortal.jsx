import React, { useState, useEffect } from 'react';
import {
  Shell, Gift, BookOpen, Calendar, Award, AlertTriangle, ThumbsUp,
  Clock, Download, Eye, FileText, Bell, TrendingUp, Star, ChevronRight,
} from 'lucide-react';
import api from '../../lib/api';
import ErrorBanner from '../Layout/ErrorBanner';
import './StudentPortal.css';

const TABS = [
  { id: 'home',      label: 'Home',       icon: <Star size={16} /> },
  { id: 'classes',   label: 'My Classes', icon: <Calendar size={16} /> },
  { id: 'rewards',   label: 'Rewards',    icon: <Gift size={16} /> },
  { id: 'materials', label: 'Materials',  icon: <BookOpen size={16} /> },
];

const fmt = (iso) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const StudentPortal = () => {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [tab, setTab]         = useState('home');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/portal/student');
      setData(res.data);
    } catch (err) {
      setError(err.userMessage || 'Could not load the portal.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="sp-loading"><span className="sp-spinner" />Loading your portal...</div>;
  if (error)   return <div className="sp-loading"><ErrorBanner message={error} onRetry={load} /></div>;
  if (!data)   return null;

  const { student, enrollments, prizeHistory: seashellHistory, behaviorSummary, materials, announcements } = data;
  const firstName = student.fullName?.split(' ')[0] || 'Student';
  const initials  = student.fullName?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';

  const earned   = seashellHistory.filter(p => p.type === 'EARNED').reduce((a, p) => a + p.points, 0);
  const redeemed = seashellHistory.filter(p => p.type !== 'EARNED').reduce((a, p) => a + p.points, 0);

  return (
    <div className="sp-root">
      {/* ── Top hero ── */}
      <div className="sp-hero">
        <div className="sp-hero-bg" />
        <div className="sp-hero-content">
          <div className="sp-avatar">{initials}</div>
          <div className="sp-hero-text">
            <h1>Hi, {firstName}! 👋</h1>
            <p>Keep earning seashells and shine in class</p>
          </div>
        </div>

        {/* Stat pills */}
        <div className="sp-hero-stats">
          <div className="sp-stat-pill shells">
            <Shell size={18} />
            <span className="sp-stat-num">{student.seashells || 0}</span>
            <span className="sp-stat-lbl">Seashells</span>
          </div>
          <div className="sp-stat-pill snack">
            <span style={{ fontSize: 18 }}>🍪</span>
            <span className="sp-stat-num">{student.snackPunches || 0}</span>
            <span className="sp-stat-lbl">Punches</span>
          </div>
          <div className="sp-stat-pill pos">
            <ThumbsUp size={18} />
            <span className="sp-stat-num">{behaviorSummary.positives}</span>
            <span className="sp-stat-lbl">Positive</span>
          </div>
          {behaviorSummary.warnings > 0 && (
            <div className="sp-stat-pill warn">
              <AlertTriangle size={18} />
              <span className="sp-stat-num">{behaviorSummary.warnings}</span>
              <span className="sp-stat-lbl">Warnings</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="sp-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`sp-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="sp-body">
        {/* ────────── HOME ────────── */}
        {tab === 'home' && (
          <div className="sp-home">
            {/* Seashell progress card */}
            <div className="sp-progress-card">
              <div className="sp-progress-header">
                <Shell size={22} color="#0ea5e9" />
                <div>
                  <h3>My Seashells</h3>
                  <p>{student.seashells || 0} total points</p>
                </div>
                <div className="sp-progress-nums">
                  <span className="sp-earned">+{earned} earned</span>
                  {redeemed > 0 && <span className="sp-redeemed">−{redeemed} redeemed</span>}
                </div>
              </div>
              <div className="sp-progress-bar-wrap">
                <div
                  className="sp-progress-bar-fill"
                  style={{ width: `${Math.min(((student.seashells || 0) % 100) / 100 * 100, 100)}%` }}
                />
              </div>
              <div className="sp-progress-hint">
                <TrendingUp size={13} />
                {Math.max(100 - ((student.seashells || 0) % 100), 0)} seashells to next level
              </div>
            </div>

            {/* Quick grid: next class + recent reward + announcements */}
            <div className="sp-quick-grid">
              {/* Next class */}
              <div className="sp-quick-card">
                <h4><Calendar size={16} /> Next Class</h4>
                {enrollments.length > 0 ? (() => {
                  const next = enrollments
                    .flatMap(e => (e.upcomingSessions || []).map(s => ({ ...s, className: e.className, teacherName: e.teacherName })))
                    .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
                  return next ? (
                    <div className="sp-next-class">
                      <span className="sp-next-name">{next.className}</span>
                      <span className="sp-next-teacher">with {next.teacherName}</span>
                      <div className="sp-next-date">
                        <Clock size={13} />
                        {fmt(next.date)}
                        {next.startTime && ` · ${next.startTime}`}
                      </div>
                    </div>
                  ) : <p className="sp-empty">No upcoming sessions</p>;
                })() : <p className="sp-empty">No active classes</p>}
              </div>

              {/* Latest reward */}
              <div className="sp-quick-card">
                <h4><Gift size={16} /> Latest Reward</h4>
                {seashellHistory.length > 0 ? (
                  <div className="sp-latest-reward">
                    <div className="sp-reward-icon">🏆</div>
                    <div>
                      <span className="sp-reward-reason">{seashellHistory[0].reason}</span>
                      <span className="sp-reward-pts earned">+{seashellHistory[0].points} pts</span>
                      <span className="sp-reward-date">{fmt(seashellHistory[0].createdAt)}</span>
                    </div>
                  </div>
                ) : <p className="sp-empty">No rewards yet — keep it up!</p>}
              </div>
            </div>

            {/* Announcements */}
            {announcements.length > 0 && (
              <div className="sp-announcements">
                <h3><Bell size={18} /> Announcements</h3>
                <div className="sp-ann-list">
                  {announcements.slice(0, 4).map((a, i) => (
                    <div key={i} className="sp-ann-item">
                      <div className="sp-ann-dot" />
                      <div className="sp-ann-body">
                        <h4>{a.title}</h4>
                        <p>{a.body.substring(0, 140)}{a.body.length > 140 ? '…' : ''}</p>
                        <span className="sp-ann-meta">
                          {fmt(a.publishedAt)}{a.author && ` — ${a.author.fullName}`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ────────── CLASSES ────────── */}
        {tab === 'classes' && (
          <div className="sp-section">
            <h2><Calendar size={20} /> My Classes</h2>
            {enrollments.length === 0 ? (
              <div className="sp-empty-state">
                <Calendar size={40} />
                <p>You don't have any active classes right now.</p>
              </div>
            ) : (
              <div className="sp-classes-list">
                {enrollments.map((e, i) => (
                  <div key={i} className="sp-class-card">
                    <div className="sp-class-header">
                      <div className="sp-class-dot" />
                      <div>
                        <h3>{e.className}</h3>
                        <span>with {e.teacherName}</span>
                      </div>
                    </div>
                    {e.upcomingSessions?.length > 0 && (
                      <div className="sp-sessions-list">
                        <p className="sp-sessions-title">Upcoming sessions</p>
                        {e.upcomingSessions.slice(0, 5).map((s, j) => (
                          <div key={j} className="sp-session-row">
                            <Clock size={13} />
                            <span>{fmt(s.date)}</span>
                            {s.startTime && <span className="sp-sess-time">{s.startTime}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ────────── REWARDS ────────── */}
        {tab === 'rewards' && (
          <div className="sp-section">
            <div className="sp-rewards-header">
              <div className="sp-rewards-balance">
                <Shell size={28} color="#0ea5e9" />
                <div>
                  <span className="sp-balance-num">{student.seashells || 0}</span>
                  <span className="sp-balance-lbl">Available seashells</span>
                </div>
              </div>
            </div>
            <h2><Gift size={20} /> Rewards History</h2>
            {seashellHistory.length === 0 ? (
              <div className="sp-empty-state">
                <Gift size={40} />
                <p>No rewards yet! Keep participating in class.</p>
              </div>
            ) : (
              <div className="sp-reward-list">
                {seashellHistory.map((p, i) => (
                  <div key={i} className={`sp-reward-item ${p.type === 'EARNED' ? 'earned' : 'redeemed'}`}>
                    <div className="sp-reward-info">
                      <span className="sp-reward-reason">{p.reason}</span>
                      <span className="sp-reward-date">{fmt(p.createdAt)}</span>
                    </div>
                    <span className={`sp-reward-pts ${p.type === 'EARNED' ? 'earned' : 'redeemed'}`}>
                      {p.type === 'EARNED' ? '+' : '−'}{p.points} pts
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ────────── MATERIALS ────────── */}
        {tab === 'materials' && (
          <div className="sp-section">
            <h2><BookOpen size={20} /> My Materials</h2>
            {materials.length === 0 ? (
              <div className="sp-empty-state">
                <FileText size={40} />
                <p>No materials assigned yet.</p>
              </div>
            ) : (
              <div className="sp-materials-list">
                {materials.map((m, i) => (
                  <div key={i} className="sp-material-item">
                    <div className="sp-mat-icon"><FileText size={20} /></div>
                    <div className="sp-mat-info">
                      <span className="sp-mat-name">{m.name}</span>
                      <div className="sp-mat-meta">
                        {m.subject && <span className="sp-mat-subject">{m.subject}</span>}
                        {m.uploadedAt && <span>{fmt(m.uploadedAt)}</span>}
                      </div>
                    </div>
                    <div className="sp-mat-actions">
                      <a href={m.fileUrl} target="_blank" rel="noopener noreferrer" className="sp-mat-btn" title="View">
                        <Eye size={16} />
                      </a>
                      <a href={m.fileUrl} download className="sp-mat-btn" title="Download">
                        <Download size={16} />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentPortal;
