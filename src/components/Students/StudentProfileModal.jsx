import React, { useState, useEffect } from 'react';
import { X, Cookie, AlertCircle, ShoppingBag, History, FileText, Download, Eye, Search, Shell, Gift, Check, TrendingDown, CreditCard, AlertTriangle, HeartPulse } from 'lucide-react';
import { database } from '../../lib/database';
import api from '../../lib/api';
import SnackCabinetModal from './SnackCabinetModal';
import { useToast } from '../Layout/ToastProvider';
import { useAuth } from '../../context/AuthContext';
import './StudentProfileModal.css';

const StudentProfileModal = ({ student: initialStudent, onClose, onUpdate }) => {
  const toast = useToast();
  const { role } = useAuth();
  // Teachers only see academic/behavioral info — parent contact and billing stay
  // inside the app so families can't be solicited directly outside of it.
  const isTeacher = role === 'TEACHER';
  const [student, setStudent] = useState(initialStudent);
  const [, setLoading] = useState(true);
  const [showCabinet, setShowCabinet] = useState(false);
  const [materialSearch, setMaterialSearch] = useState('');

  // Redeem state
  const [showRedeem, setShowRedeem] = useState(false);
  const [redeemItem, setRedeemItem] = useState('');
  const [redeemCost, setRedeemCost] = useState('');
  const [redeeming, setRedeeming] = useState(false);

  /* ── Report (medical / behavior) ── */
  const [reportType, setReportType] = useState(null); // 'medical' | 'behavior' | null
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [medForm, setMedForm] = useState({ time: new Date().toISOString().slice(0, 16), place: '', description: '', actionsTaken: '', sentHome: false });
  const [behForm, setBehForm] = useState({ place: '', ruleBroken: '', category: '', description: '' });

  const handleSubmitReport = async () => {
    setReportSubmitting(true);
    try {
      if (reportType === 'medical') {
        await api.post('/medical', { studentId: student.id, ...medForm });
      } else {
        await api.post('/behavior', { studentId: student.id, type: 'WARNING', ...behForm });
      }
      toast.success(`${reportType === 'medical' ? 'Medical' : 'Behavior'} report submitted`);
      setReportType(null);
    } catch {
      toast.error('Error submitting report');
    }
    setReportSubmitting(false);
  };

  const isLowBalance = student.snackPunches < 7;
  const isNegative = student.snackPunches < 0;

  /* Hydrate the full student record by id when the modal is opened with a
     partial object (e.g. the minimal roster object from the Teacher Portal). */
  useEffect(() => {
    let cancelled = false;
    const isPartial = !initialStudent?.snackHistory || !initialStudent?.materials || initialStudent?.status === undefined;
    if (!initialStudent?.id || !isPartial) { setLoading(false); return; }
    setLoading(true);
    (async () => {
      try {
        const all = await database.fetchStudents();
        const full = all.find(s => s.id === initialStudent.id);
        if (full && !cancelled) setStudent(prev => ({ ...prev, ...full }));
      } catch (e) {
        console.error('Could not hydrate student profile:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [initialStudent?.id]);

  /* Update local state immediately after a purchase/redeem */
  const handlePurchaseUpdate = (result, snack) => {
    if (!result?.success) return;
    const next = {
      ...student,
      snackPunches: result.newBalance,
      snackHistory: [
        { id: `sh_${Date.now()}`, date: new Date().toISOString(), snackName: snack.name, cost: snack.costPunches },
        ...(student.snackHistory || []),
      ],
    };
    setStudent(next);
    onUpdate?.(next);
  };

  const filteredMaterials = (student.materials || []).filter(m => 
    m.name.toLowerCase().includes(materialSearch.toLowerCase()) ||
    m.subject.toLowerCase().includes(materialSearch.toLowerCase())
  );

  const redeemExceedsBalance = Number(redeemCost) > (student.seashells || 0);

  const handleRedeem = async () => {
    if (!redeemItem || !redeemCost || redeeming || redeemExceedsBalance) return;
    setRedeeming(true);
    const cost = Number(redeemCost);
    const result = await database.redeemSeashells(student.id, redeemItem, cost);
    if (result && result.success) {
      const next = {
        ...student,
        seashells: result.newBalance ?? Math.max(0, (student.seashells || 0) - cost),
        seashellHistory: [
          { id: `ssh_${Date.now()}`, date: new Date().toISOString(), reason: redeemItem, points: -cost, type: 'redeemed' },
          ...(student.seashellHistory || []),
        ],
      };
      setStudent(next);
      onUpdate?.(next);
      setShowRedeem(false);
      setRedeemItem('');
      setRedeemCost('');
    } else {
      toast.error('Redeem error: ' + (result?.error || 'Unknown error'));
    }
    setRedeeming(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content profile-modal" onClick={e => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}><X size={24} /></button>
        
        <header className="profile-header">
          <div className="student-main-info">
            <div className="student-avatar large">{(student.name || '?')[0]}</div>
            <div>
              <h2 className="student-name" style={{fontSize: '24px', margin: '0 0 4px 0'}}>{student.name || 'Student'}</h2>
              {student.birthday && <span className="text-muted" style={{fontSize: '12px'}}>🎂 {new Date(student.birthday).toLocaleDateString()}</span>}
              {student.status && (
                <span className={`status-tag ${student.status.replace(' ', '').toLowerCase()}`}>
                  {student.status}
                </span>
              )}
            </div>
          </div>
          <div className="profile-header-actions">
            <button className="report-btn medical-report-btn" onClick={() => setReportType('medical')}>
              <HeartPulse size={15} /> Medical
            </button>
            <button className="report-btn behavior-report-btn" onClick={() => setReportType('behavior')}>
              <AlertTriangle size={15} /> Behavior
            </button>
          </div>
        </header>

        {/* ── Inline Report Form ── */}
        {reportType && (
          <div className="inline-report-form">
            <div className="report-form-header">
              <h3>{reportType === 'medical' ? '🩺 Medical Incident' : '📝 Behavior Incident'} — {student.name}</h3>
              <button className="icon-btn" onClick={() => setReportType(null)}><X size={16} /></button>
            </div>
            {reportType === 'medical' ? (
              <div className="report-fields">
                <input type="datetime-local" value={medForm.time} onChange={e => setMedForm(p => ({...p, time: e.target.value}))} />
                <input type="text" placeholder="Place (e.g. Classroom)" value={medForm.place} onChange={e => setMedForm(p => ({...p, place: e.target.value}))} />
                <textarea placeholder="Description of incident..." value={medForm.description} onChange={e => setMedForm(p => ({...p, description: e.target.value}))} />
                <textarea placeholder="Actions taken (bandaid, first aid...)" value={medForm.actionsTaken} onChange={e => setMedForm(p => ({...p, actionsTaken: e.target.value}))} />
                <label style={{display:'flex',alignItems:'center',gap:6,fontSize:13}}><input type="checkbox" checked={medForm.sentHome} onChange={e => setMedForm(p => ({...p, sentHome: e.target.checked}))} /> Sent home</label>
              </div>
            ) : (
              <div className="report-fields">
                <input type="text" placeholder="Place (e.g. Classroom)" value={behForm.place} onChange={e => setBehForm(p => ({...p, place: e.target.value}))} />
                <select value={behForm.category} onChange={e => setBehForm(p => ({...p, category: e.target.value}))}>
                  <option value="">Select category...</option>
                  <option value="DISRESPECT">Disrespect</option>
                  <option value="DISRUPTION">Disruption</option>
                  <option value="AGGRESSION">Aggression</option>
                  <option value="LANGUAGE">Inappropriate Language</option>
                  <option value="SAFETY">Safety Violation</option>
                  <option value="OTHER">Other</option>
                </select>
                <input type="text" placeholder="Rule broken" value={behForm.ruleBroken} onChange={e => setBehForm(p => ({...p, ruleBroken: e.target.value}))} />
                <textarea placeholder="Description of incident..." value={behForm.description} onChange={e => setBehForm(p => ({...p, description: e.target.value}))} />
                <p className="report-hint">The severity level is set by an administrator during review.</p>
              </div>
            )}
            <button className="action-btn primary" onClick={handleSubmitReport} disabled={reportSubmitting} style={{marginTop:10}}>
              {reportSubmitting ? 'Submitting...' : 'Submit Report'}
            </button>
          </div>
        )}

        <div className="profile-body">
          {/* Left Column: Details & History */}
          <div className="profile-col">
            <div className="info-card">
              <h3>Health & Details</h3>
              <p style={{ marginBottom: '8px' }}><strong>Allergies:</strong> {student.allergies || 'None'}</p>

              {!isTeacher && (
                <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-light)' }}>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: 'var(--text-main)' }}>Parent / Guardian</h4>
                  <p style={{ marginBottom: '4px' }}><strong>Name:</strong> {student.parentName || 'N/A'}</p>
                  <p style={{ marginBottom: '4px' }}><strong>Phone:</strong> {student.parentPhone || 'N/A'}</p>
                  <p style={{ marginBottom: '0' }}><strong>Email:</strong> {student.parentEmail || 'N/A'}</p>
                </div>
              )}
            </div>

            <div className="info-card history-card">
              <h3 style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                <History size={18} /> Snack History
              </h3>
              {student.snackHistory && student.snackHistory.length > 0 ? (
                <ul className="snack-history-list">
                  {student.snackHistory.map(record => {
                    const dateObj = new Date(record.date);
                    return (
                      <li key={record.id} className="history-item">
                        <div>
                          <strong>{record.snackName}</strong>
                          <div className="text-muted" style={{fontSize: '12px'}}>
                            {dateObj.toLocaleDateString()} at {dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                          </div>
                        </div>
                        <span className="punch-cost">-{record.cost} Punches</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-muted">No snacks consumed yet.</p>
              )}
            </div>

            <div className="info-card history-card" style={{marginTop: '20px'}}>
              <h3 style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                <Shell size={18} color="#fbbf24" /> Prize History
              </h3>
              {student.seashellHistory && student.seashellHistory.length > 0 ? (
                <ul className="snack-history-list">
                  {student.seashellHistory.map(record => {
                    const dateObj = new Date(record.date);
                    const isEarned = record.type === 'earned';
                    return (
                      <li key={record.id} className="history-item">
                        <div>
                          <strong>{record.reason}</strong>
                          <div className="text-muted" style={{fontSize: '12px'}}>
                            {dateObj.toLocaleDateString()} at {dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                          </div>
                        </div>
                        <span className={`punch-cost ${isEarned ? 'earned' : 'redeemed'}`}>
                          {isEarned ? '+' : ''}{record.points} pts
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-muted">No prize points earned yet.</p>
              )}
            </div>
          </div>

          {/* Right Column: Snack Card & Academic Materials */}
          <div className="profile-col">
            <div className={`snack-card-container ${isNegative ? 'negative' : (isLowBalance ? 'warning' : 'healthy')}`}>
              <div className="snack-balance-header">
                <h3><Cookie size={20} /> Snack Card</h3>
                <div className="punch-balance">
                  <span className="punch-number">{student.snackPunches}</span>
                  <span className="punch-label">Punches</span>
                </div>
              </div>
              
              {isNegative && (
                <div className="snack-alert error">
                  <AlertCircle size={16} /> Balance is negative. Charges will be added to the next invoice.
                </div>
              )}
              {(!isNegative && isLowBalance) && (
                <div className="snack-alert warning">
                  <AlertCircle size={16} /> Low balance! Parent will be prompted to reload on the next cycle.
                </div>
              )}

              <button 
                className="action-btn primary shop-btn" 
                onClick={() => setShowCabinet(true)}
                style={{marginTop: '20px', width: '100%', background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)', backdropFilter: 'blur(10px)'}}
              >
                <ShoppingBag size={18} />
                <span>Shop Snacks</span>
              </button>
            </div>

            <div className="snack-card-container prize-card">
              <div className="snack-balance-header">
                <h3><Shell size={20} /> Seashells</h3>
                <div className="punch-balance">
                  <span className="punch-number">{student.seashells || 0}</span>
                  <span className="punch-label">Total Points</span>
                </div>
              </div>
              <div className="seashell-tiers">
                <span className="tier-item" title="1 Seahorse = 100 Seashells">🐴 {Math.floor((student.seashells || 0) / 100)} seahorse{Math.floor((student.seashells || 0) / 100) !== 1 ? 's' : ''}</span>
                <span className="tier-item" title="1 Starfish = 10 Seashells">⭐ {Math.floor(((student.seashells || 0) % 100) / 10)} starfish</span>
                <span className="tier-item" title="Remaining Seashells">🐚 {(student.seashells || 0) % 10} shells</span>
              </div>
              
              {!showRedeem ? (
                <button 
                  className="action-btn primary shop-btn prize-btn" 
                  onClick={() => setShowRedeem(true)}
                  style={{marginTop: '20px', width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(0,0,0,0.1)'}}
                >
                  <Gift size={18} />
                  <span>Redeem Seashells</span>
                </button>
              ) : (
                <div className="redeem-form">
                  <input
                    type="text"
                    placeholder="Physical Prize (e.g. Teddy Bear)"
                    value={redeemItem}
                    onChange={e => setRedeemItem(e.target.value)}
                    className="prize-input"
                  />
                  <div style={{display: 'flex', gap: '10px', alignItems: 'center'}}>
                    <input
                      type="number"
                      placeholder="Points"
                      value={redeemCost}
                      onChange={e => setRedeemCost(e.target.value)}
                      className="prize-input points"
                    />
                    <button className="action-btn primary" onClick={handleRedeem} disabled={redeeming || !redeemItem || !redeemCost || redeemExceedsBalance}>
                      <Check size={16} /> Confirm
                    </button>
                    <button className="icon-btn" onClick={() => setShowRedeem(false)} style={{background: 'rgba(255,255,255,0.2)', color: 'white'}}>
                      <X size={16} />
                    </button>
                  </div>
                  {redeemExceedsBalance && (
                    <p style={{ color: '#fecaca', fontSize: 12, margin: '6px 0 0' }}>
                      Only {student.seashells || 0} seashells available — lower the amount.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Notes panel — right side */}
            {(student.medicalNotes || student.accommodationNotes) && (
              <div className="info-card notes-panel-card">
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>📋 Notes</h3>
                {student.medicalNotes && (
                  <div className="note-block medical-note">
                    <span className="note-block-label">Medical</span>
                    <p>{student.medicalNotes}</p>
                  </div>
                )}
                {student.accommodationNotes && (
                  <div className="note-block accommodation-note">
                    <span className="note-block-label">Accommodation</span>
                    <p>{student.accommodationNotes}</p>
                  </div>
                )}
              </div>
            )}

            {/* Payment summary — admin only */}
            {!isTeacher && (
              <div className="info-card payment-card">
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <CreditCard size={18} /> Account Balance
                </h3>
                {student.familyId ? (
                  <div className="payment-summary">
                    <div className="payment-row">
                      <span>Balance owing</span>
                      <span className={`payment-amount ${(student.balanceOwing || 0) > 0 ? 'owing' : 'clear'}`}>
                        {(student.balanceOwing || 0) > 0 ? `$${student.balanceOwing.toFixed(2)}` : 'Paid up ✓'}
                      </span>
                    </div>
                    {student.nextInvoiceDate && (
                      <div className="payment-row">
                        <span>Next invoice</span>
                        <span className="payment-date">{new Date(student.nextInvoiceDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      </div>
                    )}
                    <button
                      className="view-billing-btn"
                      onClick={() => window.location.href = `/billing?family=${student.familyId}`}
                    >
                      <CreditCard size={14} /> View Full Account
                    </button>
                  </div>
                ) : (
                  <p className="text-muted" style={{ fontSize: '13px' }}>No family account linked.</p>
                )}
              </div>
            )}

            <div className="info-card materials-card">
              <header className="section-header-row">
                <h3 style={{display: 'flex', alignItems: 'center', gap: '8px', margin: 0}}>
                  <FileText size={18} /> Academic Materials
                </h3>
                <div className="mini-search">
                  <Search size={14} />
                  <input 
                    type="text" 
                    placeholder="Filter by subject or name..." 
                    value={materialSearch}
                    onChange={(e) => setMaterialSearch(e.target.value)}
                  />
                </div>
              </header>

              <div className="materials-list">
                {filteredMaterials.length > 0 ? (
                  filteredMaterials.map(item => (
                    <div key={item.id} className="material-item">
                      <div className="material-info">
                        <span className="material-name">{item.name}</span>
                        <div className="material-meta">
                          <span className="subject-tag">{item.subject}</span>
                          <span className="divider">•</span>
                          <span>{item.date}</span>
                        </div>
                      </div>
                      <div className="material-actions">
                        <button 
                          className="icon-btn tiny" 
                          title="Preview" 
                          onClick={() => window.open(item.fileUrl, '_blank')}
                        >
                          <Eye size={16} />
                        </button>
                        <a 
                          href={item.fileUrl} 
                          download 
                          className="icon-btn tiny" 
                          title="Download"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Download size={16} />
                        </a>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-muted" style={{padding: '20px 0', textAlign: 'center'}}>
                    No materials found matching your search.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Snack Cabinet Pop-up Overlay */}
        {showCabinet && (
          <SnackCabinetModal
            mode="purchase"
            student={student}
            onClose={() => setShowCabinet(false)}
            onUpdate={handlePurchaseUpdate}
          />
        )}
      </div>
    </div>
  );
};

export default StudentProfileModal;
