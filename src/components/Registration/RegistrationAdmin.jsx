import React, { useState } from 'react';
import { Calendar, Users, Settings, Plus, Play, ChevronDown, CheckCircle, Clock, Copy } from 'lucide-react';
import './RegistrationAdmin.css';

const MOCK_TERMS = [
  {
    id: 1,
    name: 'Fall 2026',
    status: 'Upcoming', // Active, Upcoming, Past
    windows: {
      earlySameDay: { start: '2026-05-01', end: '2026-05-07' },
      earlySwitching: { start: '2026-05-08', end: '2026-05-14' },
      public: { start: '2026-05-15', end: '2026-08-01' }
    },
    seeded: false
  },
  {
    id: 2,
    name: 'Spring 2026',
    status: 'Active',
    windows: {
      earlySameDay: { start: '2025-11-01', end: '2025-11-07' },
      earlySwitching: { start: '2025-11-08', end: '2025-11-14' },
      public: { start: '2025-11-15', end: '2026-01-01' }
    },
    seeded: true
  }
];

const MOCK_PODS = [
  { id: 101, name: 'Maker Studio Monday', capacity: 15, enrolled: 12, waitlist: 2, holds: 3 },
  { id: 102, name: 'Life Skills Lab Tuesday', capacity: 15, enrolled: 15, waitlist: 5, holds: 0 },
  { id: 103, name: 'Minecraft IRL (Elective)', capacity: 12, enrolled: 8, waitlist: 0, holds: 4 },
];

const MOCK_ROSTER_DETAILS = {
  101: {
    active: [
      { id: 1, name: 'Emma Smith', status: 'Active', date: '2026-05-02' },
      { id: 2, name: 'Liam Johnson', status: 'Active', date: '2026-05-02' }
    ],
    holds: [
      { id: 3, name: 'Noah Brown', status: 'Priority Hold', expires: '2026-05-07' }
    ],
    waitlist: [
      { id: 4, name: 'Ava Jones', status: 'Waitlisted', requestedAt: '2026-05-08 09:15 AM' },
      { id: 5, name: 'William Garcia', status: 'Waitlisted', requestedAt: '2026-05-08 10:30 AM' }
    ]
  }
};

const RegistrationAdmin = () => {
  const [activeTab, setActiveTab] = useState('terms');
  const [terms, setTerms] = useState(MOCK_TERMS);
  const [selectedPod, setSelectedPod] = useState(null);
  
  const handleSeedTerm = (termId) => {
    setTerms(terms.map(t => t.id === termId ? { ...t, seeded: true } : t));
    alert('Priority Holds created for all current students. Parent portals will display "Guaranteed Spot" during Window 1.');
  };

  return (
    <div className="registration-admin">
      <div className="page-header">
        <div>
          <h1>Registration & Terms</h1>
          <p className="text-muted">Manage academic terms, registration windows, and priority holds.</p>
        </div>
        <button className="btn-primary">
          <Plus size={16} /> New Term
        </button>
      </div>

      <div className="admin-tabs">
        <button className={`tab ${activeTab === 'terms' ? 'active' : ''}`} onClick={() => setActiveTab('terms')}>
          Terms Management
        </button>
        <button className={`tab ${activeTab === 'rosters' ? 'active' : ''}`} onClick={() => setActiveTab('rosters')}>
          Live Rosters & Waitlists
        </button>
      </div>

      <div className="tab-content">
        {activeTab === 'terms' && (
          <div className="terms-grid">
            {terms.map(term => (
              <div key={term.id} className="term-card glass-card">
                <div className="term-card-header">
                  <div>
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0, fontSize: '18px' }}>
                      {term.name}
                      <span className={`status-badge ${term.status.toLowerCase()}`}>{term.status}</span>
                    </h2>
                  </div>
                  <button className="icon-btn"><Settings size={18} /></button>
                </div>
                
                <div className="windows-timeline">
                  <div className="window-step">
                    <div className="step-marker"><span className="step-num">1</span></div>
                    <div className="step-details">
                      <h4>Early — Same Day</h4>
                      <p>Guaranteed spots for returning students</p>
                      <span className="date-range">{term.windows.earlySameDay.start} to {term.windows.earlySameDay.end}</span>
                    </div>
                  </div>
                  <div className="window-step">
                    <div className="step-marker"><span className="step-num">2</span></div>
                    <div className="step-details">
                      <h4>Early — Switching</h4>
                      <p>Open spots for current students changing days</p>
                      <span className="date-range">{term.windows.earlySwitching.start} to {term.windows.earlySwitching.end}</span>
                    </div>
                  </div>
                  <div className="window-step">
                    <div className="step-marker"><span className="step-num">3</span></div>
                    <div className="step-details">
                      <h4>Public</h4>
                      <p>Open to everyone (Waitlists active)</p>
                      <span className="date-range">{term.windows.public.start} to {term.windows.public.end}</span>
                    </div>
                  </div>
                </div>

                <div className="term-actions">
                  {!term.seeded ? (
                    <button className="btn-outline seed-btn" onClick={() => handleSeedTerm(term.id)}>
                      <Copy size={16} /> Seed Term (Create Holds)
                    </button>
                  ) : (
                    <div className="seeded-status">
                      <CheckCircle size={16} color="var(--primary)" /> Term Seeded
                    </div>
                  )}
                  <button className="btn-outline">View Config</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'rosters' && !selectedPod && (
          <div className="rosters-view">
            <div className="filters-bar glass-card">
              <select className="form-control" style={{ width: '200px' }}>
                <option>Fall 2026</option>
                <option>Spring 2026</option>
              </select>
              <div style={{ flex: 1 }}></div>
              <input type="text" placeholder="Search class or student..." className="form-control" style={{ width: '250px' }} />
            </div>

            <div className="rosters-table-container glass-card">
              <table className="rosters-table">
                <thead>
                  <tr>
                    <th>Class / Pod Day</th>
                    <th>Enrolled</th>
                    <th>Priority Holds</th>
                    <th>Waitlist</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {MOCK_PODS.map(pod => (
                    <tr key={pod.id}>
                      <td className="font-semibold">{pod.name}</td>
                      <td>
                        <div className="progress-bar-container">
                          <div className="progress-fill" style={{ width: `${(pod.enrolled / pod.capacity) * 100}%` }}></div>
                        </div>
                        <span className="text-sm mt-1 block">{pod.enrolled} / {pod.capacity}</span>
                      </td>
                      <td>
                        {pod.holds > 0 ? (
                          <span className="badge pending">{pod.holds} unclaimed</span>
                        ) : (
                          <span className="text-muted">0</span>
                        )}
                      </td>
                      <td>
                        {pod.waitlist > 0 ? (
                          <span className="badge danger">{pod.waitlist} waiting</span>
                        ) : (
                          <span className="text-muted">Empty</span>
                        )}
                      </td>
                      <td>
                        <button className="btn-text" onClick={() => setSelectedPod(pod.id)}>View Details</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'rosters' && selectedPod && (
          <div className="roster-detail-view">
            <div className="detail-header">
              <button className="btn-text" onClick={() => setSelectedPod(null)} style={{ padding: 0, marginBottom: '16px' }}>← Back to All Rosters</button>
              <h2>{MOCK_PODS.find(p => p.id === selectedPod)?.name}</h2>
              <p className="text-muted">Term: Fall 2026</p>
            </div>

            <div className="roster-sections-grid">
              <div className="roster-card glass-card">
                <h3>Active Roster ({MOCK_ROSTER_DETAILS[selectedPod]?.active.length || 0})</h3>
                <ul className="student-list">
                  {(MOCK_ROSTER_DETAILS[selectedPod]?.active || []).map(student => (
                    <li key={student.id}>
                      <div className="student-info">
                        <User size={16} className="text-muted" />
                        <span>{student.name}</span>
                      </div>
                      <span className="badge active">Enrolled</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="roster-card glass-card">
                <h3>Unclaimed Priority Holds ({MOCK_ROSTER_DETAILS[selectedPod]?.holds.length || 0})</h3>
                <p className="text-xs text-muted mb-4">These spots are reserved until the end of the Early window.</p>
                <ul className="student-list">
                  {(MOCK_ROSTER_DETAILS[selectedPod]?.holds || []).map(student => (
                    <li key={student.id}>
                      <div className="student-info">
                        <Clock size={16} className="text-warning" />
                        <span>{student.name}</span>
                      </div>
                      <button className="btn-text" style={{ fontSize: '12px' }}>Revoke Hold</button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="roster-card glass-card waitlist-card">
                <h3>Waitlist Queue ({MOCK_ROSTER_DETAILS[selectedPod]?.waitlist.length || 0})</h3>
                <p className="text-xs text-muted mb-4">Promotions happen automatically when seats open.</p>
                <ul className="student-list ordered">
                  {(MOCK_ROSTER_DETAILS[selectedPod]?.waitlist || []).map((student, idx) => (
                    <li key={student.id}>
                      <div className="student-info">
                        <span className="queue-num">{idx + 1}</span>
                        <div>
                          <span>{student.name}</span>
                          <p className="text-xs text-muted" style={{ margin: 0 }}>Requested: {student.requestedAt}</p>
                        </div>
                      </div>
                      <button className="btn-outline" style={{ fontSize: '12px', padding: '4px 8px' }}>Force Promote</button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RegistrationAdmin;
