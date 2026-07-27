import React from 'react';
import { X, Shell, ThumbsUp, AlertTriangle, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import './StatHistoryModal.css';

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// Builds the list + header for each stat kind from the raw portal data.
// Returns { title, subtitle, accent, icon, rows } where each row is
// { id, title, detail, meta, delta, tone }.
const buildView = (kind, { prizeHistory = [], punchHistory = [], behaviorHistory = [] }) => {
  switch (kind) {
    case 'seashells':
      return {
        title: 'Seashells history',
        subtitle: 'Every time seashells were earned or redeemed — and why.',
        accent: '#0ea5e9',
        icon: <Shell size={20} />,
        empty: 'No seashell activity yet.',
        rows: prizeHistory.map((p) => ({
          id: p.id,
          title: p.reason || (p.type === 'EARNED' ? 'Seashells earned' : 'Seashells redeemed'),
          meta: fmtDate(p.createdAt),
          delta: `${p.type === 'EARNED' ? '+' : '−'}${p.points}`,
          tone: p.type === 'EARNED' ? 'pos' : 'neg',
          rowAccent: p.type === 'EARNED' ? '#15803d' : '#b45309',
        })),
      };
    case 'punches':
      return {
        title: 'Snack punches history',
        subtitle: 'Punches added from card reloads and spent on snacks.',
        accent: '#d97706',
        icon: <span style={{ fontSize: 18 }}>🍪</span>,
        empty: 'No snack punch activity yet.',
        rows: punchHistory.map((h) => ({
          id: h.id,
          title: h.reason,
          meta: fmtDate(h.date),
          delta: `${h.kind === 'added' ? '+' : '−'}${h.amount}`,
          tone: h.kind === 'added' ? 'pos' : 'neg',
          rowAccent: h.kind === 'added' ? '#15803d' : '#b45309',
        })),
      };
    case 'positive':
      return {
        title: 'Positive notes',
        subtitle: 'Recognition from teachers — and the reason behind each one.',
        accent: '#10b981',
        icon: <ThumbsUp size={20} />,
        empty: 'No positive notes yet.',
        rows: behaviorHistory
          .filter((b) => b.type === 'POSITIVE')
          .map((b) => ({
            id: b.id,
            title: b.category || 'Positive note',
            detail: b.description,
            meta: `${b.teacherName} · ${fmtDate(b.createdAt)}`,
            tone: 'pos',
            rowAccent: '#10b981',
            rowIcon: <ThumbsUp size={14} />,
          })),
      };
    case 'warnings':
      return {
        title: 'Warnings',
        subtitle: 'Behavior notes from teachers — and why they were given.',
        accent: '#f59e0b',
        icon: <AlertTriangle size={20} />,
        empty: 'No warnings — great job!',
        rows: behaviorHistory
          .filter((b) => ['WARNING', 'SLIP'].includes(b.type))
          .map((b) => ({
            id: b.id,
            title: b.category || (b.type === 'SLIP' ? 'Disciplinary slip' : 'Warning'),
            detail: [b.description, b.ruleBroken ? `Rule: ${b.ruleBroken}` : null]
              .filter(Boolean)
              .join(' — '),
            meta: `${b.teacherName} · ${fmtDate(b.createdAt)}`,
            tone: 'neg',
            rowAccent: b.type === 'SLIP' ? '#ef4444' : '#f59e0b',
            rowIcon: <AlertTriangle size={14} />,
          })),
      };
    default:
      return null;
  }
};

const StatHistoryModal = ({ kind, studentName, data, onClose }) => {
  if (!kind) return null;
  const view = buildView(kind, data || {});
  if (!view) return null;

  return (
    <div className="shm-overlay" onClick={onClose}>
      <div className="shm-modal" onClick={(e) => e.stopPropagation()} style={{ '--shm-accent': view.accent }}>
        <header className="shm-header">
          <div className="shm-header-icon">{view.icon}</div>
          <div className="shm-header-text">
            <h3>{view.title}</h3>
            <p>{studentName ? `${studentName} · ` : ''}{view.subtitle}</p>
          </div>
          <button className="shm-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </header>

        <div className="shm-body">
          {view.rows.length === 0 ? (
            <div className="shm-empty">{view.empty}</div>
          ) : (
            <ul className="shm-list">
              {view.rows.map((row) => (
                <li key={row.id} className="shm-row" style={{ '--row-accent': row.rowAccent || view.accent }}>
                  <div className="shm-row-main">
                    <span className="shm-row-title">{row.title}</span>
                    {row.detail && <span className="shm-row-detail">{row.detail}</span>}
                    {row.meta && <span className="shm-row-meta">{row.meta}</span>}
                  </div>
                  {row.delta ? (
                    <span className={`shm-delta ${row.tone}`}>
                      {row.tone === 'pos' ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                      {row.delta}
                    </span>
                  ) : row.rowIcon ? (
                    <span className={`shm-tone-chip ${row.tone}`}>{row.rowIcon}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default StatHistoryModal;
