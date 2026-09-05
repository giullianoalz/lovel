import React, { useState, useEffect } from 'react';
import { X, Cookie, AlertCircle, ShoppingBag, History, FileText, Download, Eye, Search, Shell, Gift, Check, TrendingDown, CreditCard, AlertTriangle, HeartPulse, Pencil, Plus, Minus, MessageSquare } from 'lucide-react';
import { database } from '../../lib/database';
import api from '../../lib/api';
import SnackCabinetModal from './SnackCabinetModal';
import EditStudentModal from './EditStudentModal';
import EditFamilyModal from './EditFamilyModal';
import { useToast } from '../Layout/ToastProvider';
import { useAuth } from '../../context/AuthContext';
import './StudentProfileModal.css';

const StudentProfileModal = ({ student: initialStudent, onClose, onUpdate }) => {
  const toast = useToast();
  const { hasRole } = useAuth();
  // Teachers only see academic/behavioral info — parent contact and billing stay
  // inside the app so families can't be solicited directly outside of it.
  // The server is the authority on that and simply omits what this viewer may
  // not have, so the contact blocks follow the data: a teacher-parent looking at
  // her own child does get it back, without this component having to know why.
  const isTeacher = hasRole('TEACHER') && !hasRole('ADMIN');
  const [student, setStudent] = useState(initialStudent);
  const [, setLoading] = useState(true);
  const [showCabinet, setShowCabinet] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showEditFamily, setShowEditFamily] = useState(false);
  const [materialSearch, setMaterialSearch] = useState('');

  // Redeem state
  const [showRedeem, setShowRedeem] = useState(false);
  const [redeemItem, setRedeemItem] = useState('');
  const [redeemCost, setRedeemCost] = useState('');
  const [redeeming, setRedeeming] = useState(false);

  /* Remove state — shells coming off a balance with no prize handed over:
     a miscount, shells logged on the wrong student, a behaviour correction. */
  const [showRemove, setShowRemove] = useState(false);
  const [removeReason, setRemoveReason] = useState('');
  const [removeAmount, setRemoveAmount] = useState('');
  const [removing, setRemoving] = useState(false);

  /* ── Manual snack-punch adjustment (staff) ── */
  const canAdjustPunches = hasRole('ADMIN', 'TEACHER');
  const [adjustAmount, setAdjustAmount] = useState('1');
  const [adjusting, setAdjusting] = useState(false);

  /* ── Text the parent (admin/front desk) ── */
  const canTextParent = hasRole('ADMIN', 'RECEPTIONIST');
  const [showTextParent, setShowTextParent] = useState(false);
  const [textParentBody, setTextParentBody] = useState('');
  const [sendingTextParent, setSendingTextParent] = useState(false);

  const handleSendTextParent = async () => {
    if (!textParentBody.trim()) return;
    setSendingTextParent(true);
    try {
      await api.post('/sms/send-to-parent', { studentId: student.id, message: textParentBody.trim() });
      toast.success(`Text sent to ${student.parentPhone}.`);
      setShowTextParent(false);
      setTextParentBody('');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not send the text.');
    } finally {
      setSendingTextParent(false);
    }
  };

  /* ── Staff notes (admin only) ── */
  const [editingStaffNotes, setEditingStaffNotes] = useState(false);
  const [staffNotesDraft, setStaffNotesDraft] = useState('');
  const [savingStaffNotes, setSavingStaffNotes] = useState(false);

  const startEditStaffNotes = () => {
    setStaffNotesDraft(student.staffNotes || '');
    setEditingStaffNotes(true);
  };

  const handleSaveStaffNotes = async () => {
    setSavingStaffNotes(true);
    try {
      const res = await api.put(`/students/${student.id}/staff-notes`, { staffNotes: staffNotesDraft });
      const saved = res.data.student.staffNotes;
      setStudent(prev => ({ ...prev, staffNotes: saved }));
      setEditingStaffNotes(false);
      toast.success('Staff notes saved.');
      onUpdate?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save staff notes.');
    } finally {
      setSavingStaffNotes(false);
    }
  };

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

  /* Always hydrate the full student record by id when the modal opens — the
     roster objects passed in (from StudentsList or the Teacher Portal) never
     carry snack/prize history, only placeholder empty arrays, so there's no
     reliable "is this already complete" signal to check for. Uses the
     per-student detail endpoint (not the paginated list, which only returns
     counts) so snack/prize history actually populate. */
  useEffect(() => {
    let cancelled = false;
    if (!initialStudent?.id) { setLoading(false); return; }
    setLoading(true);
    (async () => {
      try {
        const res = await api.get(`/students/${initialStudent.id}`);
        const full = res.data?.student;
        if (full && !cancelled) {
          setStudent(prev => ({
            ...prev,
            ...full,
            name: full.fullName,
            status: full.status?.charAt(0).toUpperCase() + full.status?.slice(1).toLowerCase(),
            familyAddress: full.familyMembers?.[0]?.family?.address ?? prev.familyAddress ?? null,
            snackHistory: (full.snackPurchases || []).map(p => ({
              id: p.id,
              date: p.purchasedAt,
              snackName: p.snack?.name || 'Snack',
              cost: p.punchesUsed,
            })),
            seashellHistory: (full.prizeHistory || []).map(p => ({
              id: p.id,
              date: p.createdAt,
              reason: p.reason,
              type: p.type?.toLowerCase(),
              points: p.points,
            })),
          }));
        }
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

  /* Punch the card by hand: top-ups at the desk and corrections.
     Adding punches bills the family for them at the reload rate — the server
     raises the charge and tells us what it came to — so this asks first.
     Removing punches never charges anything. */
  const handleAdjustPunches = async (direction) => {
    const amount = parseInt(adjustAmount, 10);
    if (!Number.isInteger(amount) || amount <= 0) {
      toast.error('Enter how many punches to add or remove.');
      return;
    }
    if (direction > 0 && !window.confirm(
      `Add ${amount} punch${amount === 1 ? '' : 'es'} to ${student.name}'s card?

` +
      'The family will be charged for them at the reload rate.'
    )) return;
    setAdjusting(true);
    try {
      const res = await api.put(`/students/${student.id}/snack-punches`, {
        punches: direction * amount,
        action: 'add',
      });
      const balance = res.data.student.snackPunches;
      const charged = res.data.charge?.amount;
      const next = { ...student, snackPunches: balance };
      setStudent(next);
      onUpdate?.(next);
      toast.success(
        `${direction > 0 ? 'Added' : 'Removed'} ${amount} punch${amount === 1 ? '' : 'es'} — balance is now ${balance}.` +
        (charged ? ` Charged ${Number(charged).toFixed(2)} to the family.` : '')
      );
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not update the snack card.');
    } finally {
      setAdjusting(false);
    }
  };

  const filteredMaterials = (student.materials || []).filter(m => 
    m.name.toLowerCase().includes(materialSearch.toLowerCase()) ||
    m.subject.toLowerCase().includes(materialSearch.toLowerCase())
  );

  const redeemExceedsBalance = Number(redeemCost) > (student.seashells || 0);
  const removeExceedsBalance = Number(removeAmount) > (student.seashells || 0);

  /* `birthday` is a pure DATE column, so it arrives as UTC midnight. Feeding
     that straight to `new Date()` renders the day before anywhere west of
     Greenwich — anchor it at local noon instead, which never rolls over. */
  const formatBirthday = (value) => {
    if (!value) return null;
    const d = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    return isNaN(d) ? null : d.toLocaleDateString();
  };
  const birthdayLabel = formatBirthday(student.birthday);

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

  /* Take shells back off the balance without redeeming them. Nothing is handed
     over, so this asks for a reason and lands in prize history as REMOVED —
     the log has to say what actually happened. */
  const handleRemove = async () => {
    const points = parseInt(removeAmount, 10);
    if (!removeReason.trim() || !Number.isInteger(points) || points <= 0 || removing) return;
    if (removeExceedsBalance) return;
    if (!window.confirm(
      `Remove ${points} seashell${points === 1 ? '' : 's'} from ${student.name}?\n\n` +
      'No prize is handed over — this is a correction, and it is logged as one.'
    )) return;

    setRemoving(true);
    try {
      const result = await database.removeSeashells(student.id, removeReason.trim(), points);
      const next = {
        ...student,
        seashells: result?.newBalance ?? Math.max(0, (student.seashells || 0) - points),
        seashellHistory: [
          { id: `ssr_${Date.now()}`, date: new Date().toISOString(), reason: removeReason.trim(), points, type: 'removed' },
          ...(student.seashellHistory || []),
        ],
      };
      setStudent(next);
      onUpdate?.(next);
      setShowRemove(false);
      setRemoveReason('');
      setRemoveAmount('');
      toast.success(`Removed ${points} seashell${points === 1 ? '' : 's'} — balance is now ${next.seashells}.`);
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not remove the seashells.');
    } finally {
      setRemoving(false);
    }
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
              {birthdayLabel && <span className="text-muted" style={{fontSize: '12px'}}>🎂 {birthdayLabel}</span>}
              {student.status && (
                <span className={`status-tag ${student.status.replace(' ', '').toLowerCase()}`}>
                  {student.status}
                </span>
              )}
            </div>
          </div>
          <div className="profile-header-actions">
            {!isTeacher && (
              <button className="report-btn edit-report-btn" onClick={() => setShowEdit(true)}>
                <Pencil size={15} /> Edit
              </button>
            )}
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
              {student.createdAt && <p style={{ marginBottom: '4px' }}><strong>Registered:</strong> {new Date(student.createdAt).toLocaleDateString()}</p>}
              <p style={{ marginBottom: '4px' }}><strong>Date of Birth:</strong> {birthdayLabel || 'Not recorded'}</p>
              <p style={{ marginBottom: '4px' }}><strong>Age:</strong> {student.age ? `${student.age} years old` : 'Not recorded'}</p>
              <p style={{ marginBottom: '8px' }}><strong>Allergies:</strong> {student.allergies || 'None'}</p>

              {/* Contact details stay out of the teacher view — same reason the
                  parent block does: communication routes through the app. */}
              {!isTeacher && (
                <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-light)' }}>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: 'var(--text-main)' }}>Student Contact</h4>
                  <p style={{ marginBottom: '0' }}><strong>Phone:</strong> {student.phone || 'N/A'}</p>
                </div>
              )}

              {/* Shown whenever the server sent contact details — it withholds
                  them from teachers except for their own children, so following
                  the data is what lets a teacher-parent see her own family. */}
              {(!isTeacher || student.parentName) && (
                <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-light)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: 'var(--text-main)' }}>Parent / Guardian</h4>
                    {!isTeacher && student.familyId && (
                      <button className="staff-note-edit" onClick={() => setShowEditFamily(true)}>Edit</button>
                    )}
                  </div>
                  <p style={{ marginBottom: '4px' }}><strong>Name:</strong> {student.parentName || 'No Parent Assigned'}</p>
                  <p style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span><strong>Phone:</strong> {student.parentPhone || 'N/A'}</span>
                    {canTextParent && student.parentPhone && (
                      <button
                        className="staff-note-edit"
                        onClick={() => setShowTextParent(true)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <MessageSquare size={12} /> Text
                      </button>
                    )}
                  </p>
                  <p style={{ marginBottom: !isTeacher ? '4px' : '0' }}><strong>Email:</strong> {student.parentEmail || 'N/A'}</p>
                  {!isTeacher && (
                    <p style={{ marginBottom: '0' }}><strong>Address:</strong> {student.familyAddress || 'Not on file'}</p>
                  )}
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
                    // A removal is not a redemption — nothing was handed over,
                    // so it gets its own label instead of borrowing "redeemed".
                    const isRemoved = record.type === 'removed';
                    return (
                      <li key={record.id} className="history-item">
                        <div>
                          <strong>{record.reason}</strong>
                          <div className="text-muted" style={{fontSize: '12px'}}>
                            {dateObj.toLocaleDateString()} at {dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                            {isRemoved && ' · removed'}
                          </div>
                        </div>
                        <span className={`punch-cost ${isEarned ? 'earned' : (isRemoved ? 'removed' : 'redeemed')}`}>
                          {isEarned ? '+' : '−'}{record.points} pts
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

              {canAdjustPunches && (
                <div className="punch-adjust">
                  <span className="punch-adjust-label">Adjust punches</span>
                  <span className="punch-adjust-note">Adding punches charges the family.</span>
                  <div className="punch-adjust-row">
                    <button
                      className="punch-step"
                      onClick={() => handleAdjustPunches(-1)}
                      disabled={adjusting}
                      title="Subtract punches"
                      aria-label="Subtract punches"
                    >
                      <Minus size={16} />
                    </button>
                    <input
                      type="number"
                      min="1"
                      inputMode="numeric"
                      className="prize-input punch-adjust-input"
                      value={adjustAmount}
                      onChange={e => setAdjustAmount(e.target.value.replace(/[^0-9]/g, ''))}
                      aria-label="Number of punches"
                    />
                    <button
                      className="punch-step"
                      onClick={() => handleAdjustPunches(1)}
                      disabled={adjusting}
                      title="Add punches"
                      aria-label="Add punches"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
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
              
              {!showRedeem && !showRemove ? (
                <div className="prize-actions" style={{marginTop: '20px'}}>
                  <button
                    className="action-btn primary shop-btn prize-btn"
                    onClick={() => setShowRedeem(true)}
                    style={{width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(0,0,0,0.1)'}}
                  >
                    <Gift size={18} />
                    <span>Redeem Seashells</span>
                  </button>
                  {/* Corrections: shells come off with no prize handed over. */}
                  <button
                    className="action-btn shop-btn prize-btn remove-shells-btn"
                    onClick={() => setShowRemove(true)}
                    disabled={(student.seashells || 0) <= 0}
                    title={(student.seashells || 0) <= 0 ? 'No seashells to remove.' : 'Take seashells off without redeeming them'}
                  >
                    <Minus size={18} />
                    <span>Remove Seashells</span>
                  </button>
                </div>
              ) : showRemove ? (
                <div className="redeem-form">
                  <input
                    type="text"
                    placeholder="Reason (e.g. awarded by mistake)"
                    value={removeReason}
                    onChange={e => setRemoveReason(e.target.value)}
                    className="prize-input"
                  />
                  <div style={{display: 'flex', gap: '10px', alignItems: 'center'}}>
                    <input
                      type="number"
                      min="1"
                      placeholder="Points"
                      value={removeAmount}
                      onChange={e => setRemoveAmount(e.target.value)}
                      className="prize-input points"
                    />
                    <button
                      className="action-btn primary"
                      onClick={handleRemove}
                      disabled={removing || !removeReason.trim() || !removeAmount || removeExceedsBalance}
                    >
                      <Check size={16} /> Remove
                    </button>
                    <button className="icon-btn" onClick={() => setShowRemove(false)} style={{background: 'rgba(255,255,255,0.2)', color: 'white'}}>
                      <X size={16} />
                    </button>
                  </div>
                  {removeExceedsBalance && (
                    <p style={{ color: '#fecaca', fontSize: 12, margin: '6px 0 0' }}>
                      Only {student.seashells || 0} seashells available — lower the amount.
                    </p>
                  )}
                </div>
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

            {/* Notes panel — right side. The staff block is admin-only and
                always rendered for them, since it's the one note they write. */}
            {(student.medicalNotes || student.accommodationNotes || !isTeacher) && (
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
                {!isTeacher && (
                  <div className="note-block staff-note">
                    <div className="staff-note-head">
                      <span className="note-block-label">Staff / Billing</span>
                      {!editingStaffNotes && (
                        <button className="staff-note-edit" onClick={startEditStaffNotes}>
                          {student.staffNotes ? 'Edit' : 'Add'}
                        </button>
                      )}
                    </div>
                    <span className="staff-note-hint">Only admins see this. Teachers never do.</span>
                    {editingStaffNotes ? (
                      <>
                        <textarea
                          className="staff-note-input"
                          value={staffNotesDraft}
                          maxLength={2000}
                          rows={4}
                          placeholder="e.g. Flex 16 — invoiced quarterly"
                          onChange={e => setStaffNotesDraft(e.target.value)}
                        />
                        <div className="staff-note-actions">
                          <button className="action-btn primary" onClick={handleSaveStaffNotes} disabled={savingStaffNotes}>
                            {savingStaffNotes ? 'Saving…' : <><Check size={14} /> Save</>}
                          </button>
                          <button className="action-btn" onClick={() => setEditingStaffNotes(false)} disabled={savingStaffNotes}>
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className={student.staffNotes ? '' : 'staff-note-empty'}>
                        {student.staffNotes || 'No staff notes yet.'}
                      </p>
                    )}
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

        {showEdit && (
          <EditStudentModal
            student={student}
            onClose={() => setShowEdit(false)}
            onSaved={(saved) => {
              const next = {
                ...student,
                name: saved.fullName,
                email: saved.email,
                phone: saved.phone,
                status: saved.status?.charAt(0).toUpperCase() + saved.status?.slice(1).toLowerCase(),
                birthday: saved.birthday,
                allergies: saved.allergies,
                accommodationNotes: saved.accommodationNotes,
              };
              setStudent(next);
              onUpdate?.(next);
            }}
          />
        )}

        {showEditFamily && (
          <EditFamilyModal
            familyId={student.familyId}
            onClose={() => setShowEditFamily(false)}
            onSaved={async () => {
              // Guardian name/phone just changed server-side — re-pull this
              // student so the flattened parentName/parentPhone shown above
              // (and the roster behind this modal) catch up.
              try {
                const res = await api.get(`/students/${student.id}`);
                const full = res.data?.student;
                if (full) {
                  const next = {
                    ...student,
                    parentName: full.parentName,
                    parentPhone: full.parentPhone,
                    parentEmail: full.parentEmail,
                    familyAddress: full.familyMembers?.[0]?.family?.address ?? null,
                  };
                  setStudent(next);
                  onUpdate?.(next);
                }
              } catch {
                onUpdate?.();
              }
            }}
          />
        )}

        {showTextParent && (
          <div className="modal-overlay" onClick={() => !sendingTextParent && setShowTextParent(false)}>
            <div className="modal-content" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3><MessageSquare size={18} style={{ marginRight: '6px', verticalAlign: 'text-bottom' }} />Text {student.parentName || 'Parent'}</h3>
                <button className="close-btn" onClick={() => setShowTextParent(false)}><X size={20} /></button>
              </div>
              <div className="modal-body">
                <p className="text-muted" style={{ fontSize: '13px', marginTop: 0 }}>
                  Sends an SMS to {student.parentPhone}. Keep it short — long texts split into multiple messages.
                </p>
                <textarea
                  rows={4}
                  autoFocus
                  value={textParentBody}
                  onChange={(e) => setTextParentBody(e.target.value)}
                  placeholder="Type your message…"
                  style={{ width: '100%', resize: 'vertical' }}
                  maxLength={480}
                />
                <div className="text-muted" style={{ fontSize: '11px', textAlign: 'right' }}>{textParentBody.length}/480</div>
              </div>
              <div className="modal-footer">
                <button className="btn-secondary" onClick={() => setShowTextParent(false)} disabled={sendingTextParent}>Cancel</button>
                <button className="btn-primary" onClick={handleSendTextParent} disabled={sendingTextParent || !textParentBody.trim()}>
                  {sendingTextParent ? 'Sending…' : 'Send text'}
                </button>
              </div>
            </div>
          </div>
        )}

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
