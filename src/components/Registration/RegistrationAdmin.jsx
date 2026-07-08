import React, { useState, useEffect } from 'react';
import { Calendar, Users, Settings, Plus, Play, ChevronDown, CheckCircle, Clock, Copy, User, X, Mail, Trash2, RefreshCw, AlertCircle } from 'lucide-react';
import api from '../../lib/api';
import './RegistrationAdmin.css';

const RegistrationAdmin = () => {
  const [activeTab, setActiveTab] = useState('terms');
  const [terms, setTerms] = useState([]);
  const [selectedTermForRoster, setSelectedTermForRoster] = useState('');
  
  const [coves, setCoves] = useState([]);
  const [rosterSearchQuery, setRosterSearchQuery] = useState('');
  const [selectedCove, setSelectedCove] = useState(null);
  const [rosterDetails, setRosterDetails] = useState({ active: [], holds: [], waitlist: [] });
  
  const [showNewTermModal, setShowNewTermModal] = useState(false);
  const [editTermModal, setEditTermModal] = useState(false);
  const [editTermForm, setEditTermForm] = useState(null);
  const [seedModal, setSeedModal] = useState({ isOpen: false, targetTermId: null, sourceTermId: '' });
  
  const [newTermForm, setNewTermForm] = useState({
    name: '',
    earlySameDayStart: '', earlySameDayEnd: '',
    publicStart: '', publicEnd: ''
  });
  
  const [showCoveModal, setShowCoveModal] = useState(false);
  const [editingCove, setEditingCove] = useState(null);
  const [coveForm, setCoveForm] = useState({
    name: '',
    capacity: 15,
    meetingUrl: ''
  });
  
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [studentSearch, setStudentSearch] = useState('');
  const [allStudents, setAllStudents] = useState([]);

  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleMode, setScheduleMode] = useState('recurring'); // 'recurring' | 'single'
  const [scheduleForm, setScheduleForm] = useState({ startDate: '', endDate: '', weekdays: [], startTime: '10:00', endTime: '11:00' });
  const [scheduling, setScheduling] = useState(false);
  const WEEKDAY_OPTIONS = [
    { value: 0, label: 'Sun' }, { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' },
    { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
  ];
  
  const [appAlert, setAppAlert] = useState({
    isOpen: false, title: '', message: '', type: 'info', onConfirm: null
  });

  const [billingRequests, setBillingRequests] = useState([]);
  const [billingLoading, setBillingLoading] = useState(false);
  const [resendingId, setResendingId] = useState(null);

  // ── Manual Registration state ──────────────────────────────────────────────
  const [manualTermElectives, setManualTermElectives] = useState([]);
  const [manualTermClasses, setManualTermClasses] = useState([]);
  const [manualForm, setManualForm] = useState({
    termId: '',
    studentId: '',
    firstChoiceClassId: '',
    secondChoiceClassId: '',
    electiveIds: [],
    ixlPlan: 'NONE',
    skipEmail: false,
  });
  const [manualStudentSearch, setManualStudentSearch] = useState('');
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualPreview, setManualPreview] = useState(null); // billing preview
  const [manualResult, setManualResult] = useState(null);  // success result

  const showAlert = (message, title = 'Notification', type = 'info', onConfirm = null) => {
    setAppAlert({ isOpen: true, title, message, type, onConfirm });
  };

  // Recalculate billing preview client-side whenever the manual form changes.
  // Mirrors registrationPricing.service.js so the admin sees the exact totals
  // before submitting — no extra round-trip needed.
  const recalcManualPreview = (form, classes, electives) => {
    const cls = classes.find(c => c.id === form.firstChoiceClassId);
    const term = terms.find(t => t.id === form.termId);
    if (!cls || !term) { setManualPreview(null); return; }

    const IXL_PRICES = { NONE: 0, CORE: 5, CORE_SPANISH: 10 };
    const baseRate = cls.groupType === 'ANCHORED' ? Number(term.anchoredRate || 0) : Number(term.regularRate || 0);
    const selectedElectives = electives.filter(e => form.electiveIds.includes(e.id));
    const electivesTotal = selectedElectives.reduce((s, e) => s + Number(e.price || 130), 0);
    const ixlTotal = IXL_PRICES[form.ixlPlan] ?? 0;
    const totalQuarterly = baseRate + electivesTotal + ixlTotal;
    const depositAmount = Math.round(totalQuarterly * 0.15 * 100) / 100;
    setManualPreview({ baseRate, electivesTotal, ixlTotal, totalQuarterly, depositAmount });
  };

  const updateManualForm = (patch) => {
    setManualForm(prev => {
      const next = { ...prev, ...patch };
      recalcManualPreview(next, manualTermClasses, manualTermElectives);
      return next;
    });
  };

  // When term changes, load its classes and electives
  const handleManualTermChange = async (termId) => {
    updateManualForm({ termId, firstChoiceClassId: '', secondChoiceClassId: '', electiveIds: [] });
    setManualPreview(null);
    if (!termId) { setManualTermClasses([]); setManualTermElectives([]); return; }
    try {
      const [classRes, electiveRes] = await Promise.all([
        api.get(`/registration/classes?termId=${termId}`),
        api.get(`/registration/terms/${termId}/electives`).catch(() => ({ data: { electives: [] } })),
      ]);
      setManualTermClasses(classRes.data.classes || []);
      setManualTermElectives(electiveRes.data.electives || []);
    } catch (e) {
      console.error(e);
    }
  };

  const handleManualElectiveToggle = (id) => {
    updateManualForm({
      electiveIds: manualForm.electiveIds.includes(id)
        ? manualForm.electiveIds.filter(x => x !== id)
        : [...manualForm.electiveIds, id],
    });
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    if (!manualForm.termId || !manualForm.studentId || !manualForm.firstChoiceClassId) return;
    setManualSubmitting(true);
    try {
      const res = await api.post('/registration/admin-register', manualForm);
      setManualResult(res.data);
      // Reset form
      setManualForm({ termId: '', studentId: '', firstChoiceClassId: '', secondChoiceClassId: '', electiveIds: [], ixlPlan: 'NONE', skipEmail: false });
      setManualPreview(null);
      setManualStudentSearch('');
      // Reload billing summary to reflect the new registration
      if (activeTab === 'billing') loadBillingSummary();
    } catch (err) {
      showAlert(err.response?.data?.message || 'Error procesando el registro.', 'Error', 'warning');
    } finally {
      setManualSubmitting(false);
    }
  };

  const loadTerms = async () => {
    try {
      const res = await api.get('/registration/terms');
      setTerms(res.data.terms);
      if (res.data.terms.length > 0 && !selectedTermForRoster) {
        setSelectedTermForRoster(res.data.terms[0].id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadClasses = async () => {
    if (!selectedTermForRoster) return;
    try {
      const res = await api.get(`/registration/classes?termId=${selectedTermForRoster}`);
      setCoves(res.data.classes);
    } catch (err) {
      console.error(err);
    }
  };

  const loadRoster = async (coveId) => {
    try {
      const res = await api.get(`/registration/classes/${coveId}/roster`);
      setRosterDetails(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const loadAllStudents = async () => {
    try {
      const res = await api.get('/students');
      setAllStudents(res.data.students);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    loadTerms();
    loadAllStudents();
  }, []);

  const loadBillingSummary = async () => {
    if (!selectedTermForRoster) return;
    setBillingLoading(true);
    try {
      const res = await api.get(`/registration/billing-summary?termId=${selectedTermForRoster}`);
      setBillingRequests(res.data.requests);
    } catch (err) {
      console.error(err);
    } finally {
      setBillingLoading(false);
    }
  };

  const handleResendEmail = async (requestId) => {
    setResendingId(requestId);
    try {
      await api.post(`/registration/requests/${requestId}/resend-email`);
      showAlert('Email resent successfully.', 'Success', 'info');
      loadBillingSummary();
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error resending the email', 'Error', 'warning');
    } finally {
      setResendingId(null);
    }
  };

  useEffect(() => {
    if (activeTab === 'rosters') {
      loadClasses();
    }
    if (activeTab === 'billing') {
      loadBillingSummary();
    }
  }, [activeTab, selectedTermForRoster]);

  useEffect(() => {
    if (selectedCove) {
      loadRoster(selectedCove);
    }
  }, [selectedCove]);

  const formatDateForInput = (isoString) => {
    if (!isoString) return '';
    return new Date(isoString).toISOString().split('T')[0];
  };

  const formatDateForDisplay = (isoString) => {
    if (!isoString) return '';
    return new Date(isoString).toLocaleDateString();
  };

  // Windows must run in chronological order: Early opens -> Early ends/Public
  // opens -> Public opens -> Registration closes. Returns an error string, or
  // null if the order is valid.
  const validateWindowOrder = (form) => {
    const [d1, d2, d3, d4] = [form.earlySameDayStart, form.earlySameDayEnd, form.publicStart, form.publicEnd].map(d => new Date(d));
    if (d1 >= d2) return 'The Early window must open before it ends.';
    if (d2 >= d3) return 'The Public window must open after the Early window ends.';
    if (d3 >= d4) return 'Registration must close after the Public window opens.';
    return null;
  };

  const handleCreateTerm = async (e) => {
    e.preventDefault();
    const orderError = validateWindowOrder(newTermForm);
    if (orderError) return showAlert(orderError, 'Invalid Dates', 'warning');
    try {
      await api.post('/registration/terms', {
        name: newTermForm.name,
        startDate: newTermForm.earlySameDayStart,
        endDate: newTermForm.publicEnd,
        window1OpensAt: new Date(newTermForm.earlySameDayStart).toISOString(),
        window2OpensAt: new Date(newTermForm.earlySameDayEnd).toISOString(),
        window3OpensAt: new Date(newTermForm.publicStart).toISOString(),
        registrationCloses: new Date(newTermForm.publicEnd).toISOString(),
      });
      setShowNewTermModal(false);
      setNewTermForm({ name: '', earlySameDayStart: '', earlySameDayEnd: '', publicStart: '', publicEnd: '' });
      loadTerms();
      showAlert('Term created successfully.', 'Success', 'info');
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error creating term', 'Error', 'warning');
    }
  };

  const handleViewConfig = (term) => {
    setEditTermForm({
      id: term.id,
      name: term.name,
      earlySameDayStart: formatDateForInput(term.window1OpensAt),
      earlySameDayEnd: formatDateForInput(term.window2OpensAt),
      publicStart: formatDateForInput(term.window3OpensAt),
      publicEnd: formatDateForInput(term.registrationCloses)
    });
    setEditTermModal(true);
  };

  const handleUpdateTerm = async (e) => {
    e.preventDefault();
    const orderError = validateWindowOrder(editTermForm);
    if (orderError) return showAlert(orderError, 'Invalid Dates', 'warning');
    try {
      await api.put(`/registration/terms/${editTermForm.id}`, {
        name: editTermForm.name,
        window1OpensAt: new Date(editTermForm.earlySameDayStart).toISOString(),
        window2OpensAt: new Date(editTermForm.earlySameDayEnd).toISOString(),
        window3OpensAt: new Date(editTermForm.publicStart).toISOString(),
        registrationCloses: new Date(editTermForm.publicEnd).toISOString(),
      });
      setEditTermModal(false);
      loadTerms();
      showAlert('Term updated successfully.', 'Success', 'info');
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error updating term', 'Error', 'warning');
    }
  };

  const handleOpenSeedModal = (termId) => {
    const availableSources = terms.filter(t => t.id !== termId);
    setSeedModal({ isOpen: true, targetTermId: termId, sourceTermId: availableSources.length > 0 ? availableSources[0].id : '' });
  };

  const handleConfirmSeed = async () => {
    try {
      const res = await api.post(`/registration/terms/${seedModal.targetTermId}/seed-priority`, {
        sourceTermId: seedModal.sourceTermId || undefined,
      });
      setSeedModal({ isOpen: false, targetTermId: null, sourceTermId: '' });
      loadTerms();
      showAlert(res.data.message || 'Term Seeded', 'Term Seeded', 'info');
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error seeding term', 'Error', 'warning');
    }
  };

  const handleRevokeHold = async (studentId) => {
    try {
      await api.delete(`/registration/holds/${studentId}?classId=${selectedCove}`);
      loadRoster(selectedCove);
      loadClasses();
    } catch (error) {
      console.error(error);
    }
  };

  const handleSweepHolds = (coveId) => {
    const holdsCount = rosterDetails.holds?.length || 0;
    if (holdsCount === 0) return showAlert('No expired holds to sweep.', 'Notice', 'warning');
    
    showAlert(`Are you sure you want to sweep (revoke) ${holdsCount} holds? This will release their spots.`, 'Sweep Holds', 'confirm', async () => {
      try {
        await api.post(`/registration/classes/${coveId}/holds/sweep`);
        loadRoster(coveId);
        loadClasses();
      } catch (error) {
        console.error(error);
      }
    });
  };

  const handleRemindAllHolds = async (coveId) => {
    try {
      const res = await api.post(`/registration/classes/${coveId}/holds/remind`);
      showAlert(res.data.message, 'Reminders Sent', 'info');
    } catch (error) {
      console.error(error);
    }
  };

  const handleForcePromote = async () => {
    if (!selectedCove) return;
    try {
      const res = await api.post(`/registration/promote/${selectedCove}`);
      showAlert(res.data.message || 'Promoted successfully.', 'Success', 'info');
      loadRoster(selectedCove);
      loadClasses();
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error promoting from waitlist', 'Error', 'warning');
    }
  };

  const toggleScheduleWeekday = (value) => {
    setScheduleForm(p => ({
      ...p,
      weekdays: p.weekdays.includes(value) ? p.weekdays.filter(w => w !== value) : [...p.weekdays, value],
    }));
  };

  const handleScheduleSessions = async (e) => {
    e.preventDefault();
    setScheduling(true);
    try {
      if (scheduleMode === 'single') {
        await api.post('/sessions', {
          classId: selectedCove,
          date: scheduleForm.startDate,
          startTime: scheduleForm.startTime,
          endTime: scheduleForm.endTime,
        });
        showAlert('Session scheduled.', 'Session Scheduled', 'info');
      } else {
        const res = await api.post('/sessions/bulk', { classId: selectedCove, ...scheduleForm });
        showAlert(res.data.message, 'Sessions Scheduled', 'info');
      }
      setShowScheduleModal(false);
      setScheduleForm({ startDate: '', endDate: '', weekdays: [], startTime: '10:00', endTime: '11:00' });
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error scheduling sessions', 'Error', 'warning');
    } finally {
      setScheduling(false);
    }
  };

  const handleOpenCoveModal = (cove = null) => {
    if (cove) {
      setEditingCove(cove.id);
      setCoveForm({ name: cove.name, capacity: cove.capacity, meetingUrl: cove.meetingUrl || '' });
    } else {
      setEditingCove(null);
      setCoveForm({ name: '', capacity: 15, meetingUrl: '' });
    }
    setShowCoveModal(true);
  };

  const handleSaveCove = async (e) => {
    e.preventDefault();
    try {
      if (editingCove) {
        await api.put(`/classes/${editingCove}`, {
          name: coveForm.name,
          maxStudents: parseInt(coveForm.capacity),
          meetingUrl: coveForm.meetingUrl
        });
      } else {
        await api.post(`/classes`, {
          name: coveForm.name,
          maxStudents: parseInt(coveForm.capacity),
          meetingUrl: coveForm.meetingUrl,
          termId: selectedTermForRoster
        });
      }
      setShowCoveModal(false);
      loadClasses();
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error saving class', 'Error', 'warning');
    }
  };

  const handleManualAddStudent = async (student) => {
    if (!selectedCove) return;
    try {
      await api.post(`/classes/${selectedCove}/enrollments`, { studentId: student.id });
      setShowAddStudentModal(false);
      setStudentSearch('');
      loadRoster(selectedCove);
      loadClasses();
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error adding student', 'Error', 'warning');
    }
  };

  return (
    <div className="registration-admin">
      <div className="page-header">
        <div>
          <p className="text-muted">Manage academic terms, registration windows, and priority holds.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowNewTermModal(true)}>
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
        <button className={`tab ${activeTab === 'billing' ? 'active' : ''}`} onClick={() => setActiveTab('billing')}>
          Billing
        </button>
        <button className={`tab ${activeTab === 'manual' ? 'active' : ''}`} onClick={() => setActiveTab('manual')}>
          ✍️ Manual Registration
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
                  <button className="icon-btn" onClick={() => handleViewConfig(term)}><Settings size={18} /></button>
                </div>
                
                <div className="windows-timeline">
                  <div className="window-step">
                    <div className="step-marker"><span className="step-num">1</span></div>
                    <div className="step-details">
                      <h4>Early — Same Day</h4>
                      <p>Guaranteed spots for returning students</p>
                      <span className="date-range">{formatDateForDisplay(term.window1OpensAt)} to {formatDateForDisplay(term.window2OpensAt)}</span>
                    </div>
                  </div>
                  <div className="window-step">
                    <div className="step-marker"><span className="step-num">2</span></div>
                    <div className="step-details">
                      <h4>Public</h4>
                      <p>Open to everyone (Waitlists active)</p>
                      <span className="date-range">{formatDateForDisplay(term.window3OpensAt)} to {formatDateForDisplay(term.registrationCloses)}</span>
                    </div>
                  </div>
                </div>

                <div className="term-actions">
                  {!term.seeded ? (
                    <button className="btn-outline seed-btn" onClick={() => handleOpenSeedModal(term.id)}>
                      <Copy size={16} /> Seed Term (Create Holds)
                    </button>
                  ) : (
                    <div className="seeded-status">
                      <CheckCircle size={16} color="var(--primary)" /> Term Seeded
                    </div>
                  )}
                </div>
              </div>
            ))}
            {terms.length === 0 && (
              <div style={{ padding: '20px', color: 'var(--text-muted)' }}>No terms created yet. Create one to get started!</div>
            )}
          </div>
        )}

        {/* ── MANUAL REGISTRATION TAB ─────────────────────────────────────── */}
        {activeTab === 'manual' && (
          <div className="manual-reg-view">
            {manualResult && (
              <div className="manual-reg-success glass-card">
                <CheckCircle size={28} color="var(--primary)" />
                <div>
                  <h3>Registration Complete</h3>
                  <p className="text-muted">
                    Status: <strong>{manualResult.result?.status?.replace(/_/g, ' ')}</strong>
                    {' · '}Class: <strong>{manualResult.result?.className}</strong>
                    {' · '}Email: <strong>{manualResult.emailSent ? '✅ Sent' : '⚠️ Not sent'}</strong>
                  </p>
                </div>
                <button className="btn-outline" onClick={() => setManualResult(null)}>Register Another</button>
              </div>
            )}

            <div className="manual-reg-grid">
              {/* ── FORM ── */}
              <div className="glass-card manual-reg-form-card">
                <h2 className="manual-reg-title">Register on Behalf of a Parent</h2>
                <p className="text-muted manual-reg-subtitle">
                  Bypasses registration windows. Runs the full pricing engine and can send the billing confirmation email automatically.
                </p>

                <form onSubmit={handleManualSubmit} className="reg-form">

                  {/* STUDENT SEARCH */}
                  <div className="manual-reg-section">
                    <label className="reg-form-label">1. Select Student</label>
                    <input
                      type="text"
                      className="form-control reg-input-full"
                      placeholder="Search by name..."
                      value={manualStudentSearch}
                      onChange={e => setManualStudentSearch(e.target.value)}
                    />
                    {manualStudentSearch.length > 1 && (
                      <div className="manual-reg-student-list">
                        {allStudents
                          .filter(s => s.fullName.toLowerCase().includes(manualStudentSearch.toLowerCase()))
                          .map(s => (
                            <button
                              key={s.id}
                              type="button"
                              className={`manual-reg-student-item ${manualForm.studentId === s.id ? 'selected' : ''}`}
                              onClick={() => { updateManualForm({ studentId: s.id }); setManualStudentSearch(s.fullName); }}
                            >
                              <div className="reg-search-avatar">{s.fullName.split(' ').map(n => n[0]).join('').substring(0,2)}</div>
                              <span>{s.fullName}</span>
                              {manualForm.studentId === s.id && <CheckCircle size={16} color="var(--primary)" />}
                            </button>
                          ))
                        }
                      </div>
                    )}
                    {manualForm.studentId && (
                      <div className="manual-reg-selected-badge">
                        <CheckCircle size={14} color="var(--primary)" />
                        {allStudents.find(s => s.id === manualForm.studentId)?.fullName}
                        <button type="button" className="btn-text" style={{ marginLeft: 'auto', fontSize: '12px' }}
                          onClick={() => { updateManualForm({ studentId: '' }); setManualStudentSearch(''); }}>
                          Change
                        </button>
                      </div>
                    )}
                  </div>

                  {/* TERM */}
                  <div className="manual-reg-section">
                    <label className="reg-form-label">2. Term</label>
                    <select
                      className="form-control reg-input-full"
                      value={manualForm.termId}
                      onChange={e => handleManualTermChange(e.target.value)}
                      required
                    >
                      <option value="">— Select a term —</option>
                      {terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>

                  {/* FIRST CHOICE CLASS */}
                  {manualForm.termId && (
                    <div className="manual-reg-section">
                      <label className="reg-form-label">3. First Choice Class</label>
                      <select
                        className="form-control reg-input-full"
                        value={manualForm.firstChoiceClassId}
                        onChange={e => updateManualForm({ firstChoiceClassId: e.target.value, secondChoiceClassId: '' })}
                        required
                      >
                        <option value="">— Select a class —</option>
                        {manualTermClasses.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.enrolled}/{c.capacity} enrolled{c.enrolled >= c.capacity ? ' · FULL' : ''})
                          </option>
                        ))}
                      </select>
                      {manualForm.firstChoiceClassId && (() => {
                        const cls = manualTermClasses.find(c => c.id === manualForm.firstChoiceClassId);
                        const isFull = cls && cls.enrolled >= cls.capacity;
                        return isFull ? (
                          <p className="manual-reg-warn">⚠️ This class is full. The student will be added to the waitlist.</p>
                        ) : null;
                      })()}
                    </div>
                  )}

                  {/* SECOND CHOICE CLASS */}
                  {manualForm.firstChoiceClassId && (
                    <div className="manual-reg-section">
                      <label className="reg-form-label">4. Second Choice Class <span className="text-muted">(optional — backup if first is full)</span></label>
                      <select
                        className="form-control reg-input-full"
                        value={manualForm.secondChoiceClassId}
                        onChange={e => updateManualForm({ secondChoiceClassId: e.target.value })}
                      >
                        <option value="">— None —</option>
                        {manualTermClasses
                          .filter(c => c.id !== manualForm.firstChoiceClassId)
                          .map(c => (
                            <option key={c.id} value={c.id}>
                              {c.name} ({c.enrolled}/{c.capacity})
                            </option>
                          ))}
                      </select>
                    </div>
                  )}

                  {/* ELECTIVES */}
                  {manualTermElectives.length > 0 && (
                    <div className="manual-reg-section">
                      <label className="reg-form-label">5. Electives <span className="text-muted">(each $130)</span></label>
                      <div className="manual-reg-electives">
                        {manualTermElectives.map(e => (
                          <button
                            key={e.id}
                            type="button"
                            className={`badge manual-reg-elective-btn ${manualForm.electiveIds.includes(e.id) ? 'active' : ''}`}
                            onClick={() => handleManualElectiveToggle(e.id)}
                          >
                            {e.name} — ${Number(e.price || 130).toFixed(0)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* IXL PLAN */}
                  <div className="manual-reg-section">
                    <label className="reg-form-label">{manualTermElectives.length > 0 ? '6.' : '5.'} IXL Plan</label>
                    <div className="manual-reg-ixl-options">
                      {[{ value: 'NONE', label: 'None', price: '$0' }, { value: 'CORE', label: 'Core', price: '+$5/mo' }, { value: 'CORE_SPANISH', label: 'Core + Spanish', price: '+$10/mo' }].map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`manual-reg-ixl-btn ${manualForm.ixlPlan === opt.value ? 'selected' : ''}`}
                          onClick={() => updateManualForm({ ixlPlan: opt.value })}
                        >
                          <span>{opt.label}</span>
                          <span className="manual-reg-ixl-price">{opt.price}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* EMAIL TOGGLE */}
                  <div className="manual-reg-section">
                    <label className="manual-reg-email-toggle">
                      <input
                        type="checkbox"
                        checked={!manualForm.skipEmail}
                        onChange={e => updateManualForm({ skipEmail: !e.target.checked })}
                      />
                      <span>Send billing confirmation email to parent</span>
                    </label>
                  </div>

                  <div className="reg-form-actions" style={{ marginTop: '8px' }}>
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={manualSubmitting || !manualForm.termId || !manualForm.studentId || !manualForm.firstChoiceClassId}
                      style={{ width: '100%', justifyContent: 'center' }}
                    >
                      {manualSubmitting ? 'Processing...' : '✍️ Complete Manual Registration'}
                    </button>
                  </div>
                </form>
              </div>

              {/* ── BILLING PREVIEW ── */}
              <div className="glass-card manual-reg-preview-card">
                <h3 className="manual-reg-preview-title">Billing Preview</h3>
                {manualPreview ? (
                  <div className="manual-reg-preview-content">
                    <div className="manual-reg-preview-row">
                      <span>Base Rate</span>
                      <span>${manualPreview.baseRate.toFixed(2)}</span>
                    </div>
                    <div className="manual-reg-preview-row">
                      <span>Electives</span>
                      <span>${manualPreview.electivesTotal.toFixed(2)}</span>
                    </div>
                    <div className="manual-reg-preview-row">
                      <span>IXL ({manualForm.ixlPlan})</span>
                      <span>${manualPreview.ixlTotal.toFixed(2)}/mo</span>
                    </div>
                    <div className="manual-reg-preview-divider" />
                    <div className="manual-reg-preview-row total">
                      <span>Total Quarterly</span>
                      <span>${manualPreview.totalQuarterly.toFixed(2)}</span>
                    </div>
                    <div className="manual-reg-preview-row deposit">
                      <span>15% Deposit</span>
                      <span>${manualPreview.depositAmount.toFixed(2)}</span>
                    </div>
                    <p className="manual-reg-preview-note">These amounts will be saved to the student's registration record and included in the billing email.</p>
                  </div>
                ) : (
                  <div className="manual-reg-preview-empty">
                    <Users size={32} style={{ opacity: 0.3 }} />
                    <p>Select a student, term, and class to see the billing breakdown.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'rosters' && !selectedCove && (
          <div className="rosters-view">
            <div className="filters-bar glass-card">
              <select className="form-control" style={{ width: '200px' }} value={selectedTermForRoster} onChange={(e) => setSelectedTermForRoster(e.target.value)}>
                {terms.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <div style={{ flex: 1 }}></div>
              <button className="btn-primary" style={{ marginRight: '12px' }} onClick={() => handleOpenCoveModal()}>
                <Plus size={14} /> New Class
              </button>
              <input
                type="text"
                placeholder="Search by class name..."
                className="form-control"
                style={{ width: '250px' }}
                value={rosterSearchQuery}
                onChange={(e) => setRosterSearchQuery(e.target.value)}
              />
            </div>

            <div className="rosters-table-container glass-card">
              <table className="rosters-table">
                <thead>
                  <tr>
                    <th>Class / Cove Day</th>
                    <th>Enrolled</th>
                    <th>Priority Holds</th>
                    <th>Waitlist</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rosterSearchQuery && coves.length > 0 && coves.filter(cove => cove.name.toLowerCase().includes(rosterSearchQuery.toLowerCase())).length === 0 && (
                    <tr><td colSpan={5} style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>No classes match "{rosterSearchQuery}".</td></tr>
                  )}
                  {coves.filter(cove => cove.name.toLowerCase().includes(rosterSearchQuery.toLowerCase())).map(cove => {
                    const totalOccupied = cove.enrolled + cove.holds;
                    const isFull = totalOccupied >= cove.capacity;
                    const canPromoteWaitlist = !isFull && cove.waitlist > 0;
                    const enrolledPercent = (cove.enrolled / cove.capacity) * 100;
                    const holdsPercent = (cove.holds / cove.capacity) * 100;

                    return (
                      <tr key={cove.id}>
                        <td className="font-semibold">{cove.name}</td>
                        <td>
                          <div className="progress-bar-container">
                            <div className="progress-fill active" style={{ width: `${enrolledPercent}%` }}></div>
                            <div className="progress-fill holds" style={{ width: `${holdsPercent}%` }}></div>
                          </div>
                          <div className="capacity-labels">
                            <span className="text-sm mt-1 block">{totalOccupied} / {cove.capacity} Reserved</span>
                            {isFull && <span className="text-xs text-muted block">(At Capacity)</span>}
                          </div>
                        </td>
                        <td>
                          {cove.holds > 0 ? (
                            <span className="badge pending">{cove.holds} unclaimed</span>
                          ) : (
                            <span className="text-muted text-sm">0</span>
                          )}
                        </td>
                        <td>
                          {cove.waitlist > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                              <span className="badge danger">{cove.waitlist} waiting</span>
                              {canPromoteWaitlist && (
                                <span className="action-required-alert">Promote Waitlist!</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted text-sm">Empty</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button className="btn-text" onClick={() => setSelectedCove(cove.id)}>Manage Class</button>
                            <button className="icon-btn" style={{ padding: '4px' }} onClick={() => handleOpenCoveModal(cove)} title="Edit Class Details"><Settings size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {coves.length === 0 && (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>No classes found for this term.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'rosters' && selectedCove && (
          <div className="roster-detail-view">
            <div className="detail-header">
              <button className="btn-text reg-back-btn" onClick={() => setSelectedCove(null)}>← Back to All Rosters</button>
              <div className="detail-title-row">
                <div>
                  <h2>{coves.find(p => p.id === selectedCove)?.name}</h2>
                  <p className="text-muted">Term: {terms.find(t => t.id === selectedTermForRoster)?.name}</p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn-primary" onClick={() => { setScheduleMode('recurring'); setShowScheduleModal(true); }}>
                    <Calendar size={16} /> Schedule Sessions
                  </button>
                  <button className="btn-outline" onClick={() => handleOpenCoveModal(coves.find(p => p.id === selectedCove))}>
                    <Settings size={16} /> Class Settings
                  </button>
                </div>
              </div>
            </div>

            <div className="roster-sections-grid">
              <div className="roster-card glass-card">
                <div className="reg-roster-card-head">
                  <h3>Active Roster ({rosterDetails.active?.length || 0})</h3>
                  <button className="btn-outline reg-btn-sm" onClick={() => setShowAddStudentModal(true)}>
                    <Plus size={14} /> Add Student
                  </button>
                </div>
                <ul className="student-list">
                  {(rosterDetails.active || []).map(student => (
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
                <div className="reg-roster-card-head">
                  <h3>Unclaimed Priority Holds ({rosterDetails.holds?.length || 0})</h3>
                </div>
                {(rosterDetails.holds?.length || 0) > 0 && (
                  <div className="reg-roster-actions">
                    <button className="btn-outline reg-btn-sm" onClick={() => handleRemindAllHolds(selectedCove)}>
                      <Mail size={14} /> Remind All
                    </button>
                    <button className="btn-outline reg-btn-sm reg-btn-danger" onClick={() => handleSweepHolds(selectedCove)}>
                      <Trash2 size={14} /> Sweep Expired
                    </button>
                  </div>
                )}
                <p className="text-xs text-muted mb-4">These spots are reserved until the end of the Early window.</p>
                <ul className="student-list">
                  {(rosterDetails.holds || []).map(student => (
                    <li key={student.id}>
                      <div className="student-info">
                        <Clock size={16} className="text-warning" />
                        <span>{student.name}</span>
                      </div>
                      <button className="btn-text reg-btn-sm" onClick={() => handleRevokeHold(student.id)}>Revoke Hold</button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="roster-card glass-card waitlist-card">
                <div className="reg-roster-card-head">
                  <h3>Waitlist Queue ({rosterDetails.waitlist?.length || 0})</h3>
                  {(rosterDetails.waitlist?.length || 0) > 0 && (
                    <button className="btn-outline reg-btn-sm" onClick={handleForcePromote}>
                      Promote Next
                    </button>
                  )}
                </div>
                <p className="text-xs text-muted mb-4">Promotions happen automatically when seats open.</p>
                <ul className="student-list ordered">
                  {(rosterDetails.waitlist || []).map((student, idx) => (
                    <li key={student.id}>
                      <div className="student-info">
                        <span className="queue-num">{idx + 1}</span>
                        <div>
                          <span>{student.name}</span>
                          <p className="text-xs text-muted" style={{ margin: 0 }}>Requested: {formatDateForDisplay(student.requestedAt)}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'billing' && (
          <div className="billing-view">
            <div className="filters-bar glass-card">
              <select className="form-control" style={{ width: '200px' }} value={selectedTermForRoster} onChange={(e) => setSelectedTermForRoster(e.target.value)}>
                {terms.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <div style={{ flex: 1 }}></div>
              <button className="btn-outline" onClick={loadBillingSummary} disabled={billingLoading}>
                <RefreshCw size={14} /> Refresh
              </button>
            </div>

            <div className="rosters-table-container glass-card">
              <table className="rosters-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Class / Group</th>
                    <th>Electives</th>
                    <th>IXL</th>
                    <th>Total / Deposit</th>
                    <th>Deposit Due</th>
                    <th>Email Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {billingRequests.map(r => (
                    <tr key={r.id}>
                      <td className="font-semibold">{r.studentName}</td>
                      <td>{r.className} <span className="text-xs text-muted">({r.groupType})</span></td>
                      <td>{r.electiveNames.length ? r.electiveNames.join(', ') : '—'}</td>
                      <td>{r.ixlPlan === 'NONE' ? '—' : r.ixlPlan}</td>
                      <td>
                        <div>${r.totalQuarterly.toFixed(2)}</div>
                        <div className="text-xs text-muted">Deposit: ${r.depositAmount.toFixed(2)}</div>
                      </td>
                      <td>{r.depositDueDate ? formatDateForDisplay(r.depositDueDate) : '—'}</td>
                      <td>
                        {r.emailStatus === 'SENT' && <span className="badge active"><CheckCircle size={12} /> Sent</span>}
                        {r.emailStatus === 'FAILED' && <span className="badge danger"><AlertCircle size={12} /> Failed</span>}
                        {r.emailStatus === 'PENDING' && <span className="badge pending"><Clock size={12} /> Pending</span>}
                      </td>
                      <td>
                        <button
                          className="btn-text"
                          disabled={resendingId === r.id}
                          onClick={() => handleResendEmail(r.id)}
                        >
                          <Mail size={14} /> {resendingId === r.id ? 'Sending...' : 'Resend'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!billingLoading && billingRequests.length === 0 && (
                    <tr>
                      <td colSpan="8" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>No registration requests for this term yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Edit Term Modal */}
      {editTermModal && editTermForm && (
        <div className="modal-overlay">
          <div className="modal-content glass-card reg-modal-lg">
            <div className="registration-modal-header">
              <h2>Edit Term Configuration</h2>
              <button className="icon-btn" onClick={() => setEditTermModal(false)} aria-label="Close">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleUpdateTerm} className="new-term-form reg-form">
              <div>
                <label className="reg-form-label">Term Name</label>
                <input
                  type="text"
                  className="form-control reg-input-full"
                  required
                  value={editTermForm.name}
                  onChange={(e) => setEditTermForm({...editTermForm, name: e.target.value})}
                />
              </div>

              <div className="reg-window-box">
                <h4>Window 1: Early (Same Day)</h4>
                <div className="reg-date-row">
                  <input type="date" required className="form-control" value={editTermForm.earlySameDayStart} onChange={(e) => setEditTermForm({...editTermForm, earlySameDayStart: e.target.value})} />
                  <input type="date" required className="form-control" value={editTermForm.earlySameDayEnd} onChange={(e) => setEditTermForm({...editTermForm, earlySameDayEnd: e.target.value})} />
                </div>
              </div>

              <div className="reg-window-box">
                <h4>Window 2: Public</h4>
                <div className="reg-date-row">
                  <input type="date" required className="form-control" value={editTermForm.publicStart} onChange={(e) => setEditTermForm({...editTermForm, publicStart: e.target.value})} />
                  <input type="date" required className="form-control" value={editTermForm.publicEnd} onChange={(e) => setEditTermForm({...editTermForm, publicEnd: e.target.value})} />
                </div>
              </div>

              <div className="reg-form-actions">
                <button type="button" className="btn-text" onClick={() => setEditTermModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Term Modal */}
      {showNewTermModal && (
        <div className="modal-overlay">
          <div className="modal-content glass-card reg-modal-lg">
            <div className="registration-modal-header">
              <h2>Create New Term</h2>
              <button className="icon-btn" onClick={() => setShowNewTermModal(false)} aria-label="Close">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateTerm} className="new-term-form reg-form">
              <div>
                <label className="reg-form-label">Term Name</label>
                <input
                  type="text"
                  className="form-control reg-input-full"
                  required
                  placeholder="e.g. Fall 2026"
                  value={newTermForm.name}
                  onChange={(e) => setNewTermForm({...newTermForm, name: e.target.value})}
                />
              </div>

              <div className="reg-window-box">
                <h4>Window 1: Early (Same Day)</h4>
                <div className="reg-date-row">
                  <input type="date" required className="form-control" value={newTermForm.earlySameDayStart} onChange={(e) => setNewTermForm({...newTermForm, earlySameDayStart: e.target.value})} />
                  <input type="date" required className="form-control" value={newTermForm.earlySameDayEnd} onChange={(e) => setNewTermForm({...newTermForm, earlySameDayEnd: e.target.value})} />
                </div>
              </div>

              <div className="reg-window-box">
                <h4>Window 2: Public</h4>
                <div className="reg-date-row">
                  <input type="date" required className="form-control" value={newTermForm.publicStart} onChange={(e) => setNewTermForm({...newTermForm, publicStart: e.target.value})} />
                  <input type="date" required className="form-control" value={newTermForm.publicEnd} onChange={(e) => setNewTermForm({...newTermForm, publicEnd: e.target.value})} />
                </div>
              </div>

              <div className="reg-form-actions">
                <button type="button" className="btn-text" onClick={() => setShowNewTermModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Create Term</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Seed Term Modal */}
      {seedModal.isOpen && (
        <div className="modal-overlay">
          <div className="modal-content glass-card reg-modal-md">
            <div className="registration-modal-header">
              <h2>Seed Term Data</h2>
              <button className="icon-btn" onClick={() => setSeedModal({ isOpen: false, targetTermId: null, sourceTermId: '' })} aria-label="Close">
                <X size={20} />
              </button>
            </div>
            <div className="modal-body reg-modal-body">
              <p className="text-muted reg-modal-text">
                This action will analyze the rosters of a past/current term and automatically generate <strong>Priority Holds (Guaranteed Spots)</strong> for all active students in the new term.
              </p>

              {terms.filter(t => t.id !== seedModal.targetTermId).length > 0 ? (
                <div className="form-group">
                  <label className="reg-label-strong">Source Term to Copy From:</label>
                  <select
                    className="form-control reg-input-full"
                    value={seedModal.sourceTermId}
                    onChange={(e) => setSeedModal({...seedModal, sourceTermId: e.target.value})}
                    style={{ marginBottom: '24px' }}
                  >
                    {terms.filter(t => t.id !== seedModal.targetTermId).map(t => (
                      <option key={t.id} value={t.id}>{t.name} ({t.status})</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="form-group" style={{ marginBottom: '24px', color: '#b91c1c' }}>
                  No past terms available to copy from.
                </div>
              )}

              <div className="reg-form-actions" style={{ marginTop: 0 }}>
                <button type="button" className="btn-text" onClick={() => setSeedModal({ isOpen: false, targetTermId: null, sourceTermId: '' })}>Cancel</button>
                <button type="button" className="btn-primary" onClick={handleConfirmSeed} disabled={terms.filter(t => t.id !== seedModal.targetTermId).length === 0}>
                  <Copy size={16} /> Generate Priority Holds
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Sessions Modal */}
      {showScheduleModal && (
        <div className="modal-overlay">
          <div className="modal-content glass-card reg-modal-lg">
            <div className="registration-modal-header">
              <h2>Schedule Sessions</h2>
              <button type="button" className="icon-btn" onClick={() => setShowScheduleModal(false)} aria-label="Close">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleScheduleSessions} className="reg-form">
              <div className="reg-schedule-mode-toggle">
                <button
                  type="button"
                  className={`badge ${scheduleMode === 'recurring' ? 'active' : ''}`}
                  style={{ cursor: 'pointer', border: '1px solid var(--border-light)' }}
                  onClick={() => setScheduleMode('recurring')}
                >
                  Recurring (weekdays)
                </button>
                <button
                  type="button"
                  className={`badge ${scheduleMode === 'single' ? 'active' : ''}`}
                  style={{ cursor: 'pointer', border: '1px solid var(--border-light)' }}
                  onClick={() => setScheduleMode('single')}
                >
                  Single date
                </button>
              </div>

              {scheduleMode === 'single' ? (
                <p className="text-muted" style={{ marginTop: 0 }}>
                  Creates one real session for <strong>{coves.find(p => p.id === selectedCove)?.name}</strong> on a specific date.
                </p>
              ) : (
                <p className="text-muted" style={{ marginTop: 0 }}>
                  Creates real sessions for <strong>{coves.find(p => p.id === selectedCove)?.name}</strong> on the chosen weekdays, within the date range. Re-running this for the same dates won't create duplicates.
                </p>
              )}

              {scheduleMode === 'single' ? (
                <div>
                  <label className="reg-form-label">Date</label>
                  <input type="date" required className="form-control" value={scheduleForm.startDate}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, startDate: e.target.value })} />
                </div>
              ) : (
                <div className="reg-date-row">
                  <div>
                    <label className="reg-form-label">Start Date</label>
                    <input type="date" required className="form-control" value={scheduleForm.startDate}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, startDate: e.target.value })} />
                  </div>
                  <div>
                    <label className="reg-form-label">End Date</label>
                    <input type="date" required className="form-control" value={scheduleForm.endDate}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, endDate: e.target.value })} />
                  </div>
                </div>
              )}

              {scheduleMode === 'recurring' && (
                <div>
                  <label className="reg-form-label">Repeat on</label>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {WEEKDAY_OPTIONS.map(w => (
                      <button
                        key={w.value}
                        type="button"
                        className={`badge ${scheduleForm.weekdays.includes(w.value) ? 'active' : ''}`}
                        style={{ cursor: 'pointer', border: '1px solid var(--border-light)' }}
                        onClick={() => toggleScheduleWeekday(w.value)}
                      >
                        {w.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="reg-date-row">
                <div>
                  <label className="reg-form-label">Start Time</label>
                  <input type="time" required className="form-control" value={scheduleForm.startTime}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, startTime: e.target.value })} />
                </div>
                <div>
                  <label className="reg-form-label">End Time</label>
                  <input type="time" required className="form-control" value={scheduleForm.endTime}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, endTime: e.target.value })} />
                </div>
              </div>

              <div className="reg-form-actions">
                <button type="button" className="btn-text" onClick={() => setShowScheduleModal(false)}>Cancel</button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={scheduling || !scheduleForm.startDate || (scheduleMode === 'recurring' && (scheduleForm.weekdays.length === 0 || !scheduleForm.endDate))}
                >
                  {scheduling ? 'Scheduling...' : scheduleMode === 'single' ? 'Schedule Session' : 'Schedule Sessions'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New/Edit Cove Modal */}
      {showCoveModal && (
        <div className="modal-overlay">
          <div className="modal-content glass-card reg-modal-lg">
            <div className="registration-modal-header">
              <h2>{editingCove ? 'Edit Class Details' : 'Create New Class'}</h2>
              <button type="button" className="icon-btn" onClick={() => setShowCoveModal(false)} aria-label="Close">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSaveCove} className="reg-form">
              <div>
                <label className="reg-form-label">Class / Cove Name</label>
                <input
                  type="text"
                  className="form-control reg-input-full"
                  required
                  placeholder="e.g. Maker Studio Monday"
                  value={coveForm.name}
                  onChange={(e) => setCoveForm({...coveForm, name: e.target.value})}
                />
              </div>

              <div>
                <label className="reg-form-label">Capacity</label>
                <input
                  type="number"
                  className="form-control reg-input-full"
                  required
                  value={coveForm.capacity}
                  onChange={(e) => setCoveForm({...coveForm, capacity: e.target.value})}
                />
              </div>

              <div>
                <label className="reg-form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Play size={14} color="#0ea5e9" /> Zoom / Meeting Link
                </label>
                <input
                  type="url"
                  className="form-control reg-input-full"
                  placeholder="https://zoom.us/j/..."
                  value={coveForm.meetingUrl}
                  onChange={(e) => setCoveForm({...coveForm, meetingUrl: e.target.value})}
                />
                <p className="text-xs text-muted" style={{ marginTop: '4px' }}>This link will be visible to students in their dashboard.</p>
              </div>

              <div className="reg-form-actions">
                <button type="button" className="btn-text" onClick={() => setShowCoveModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">{editingCove ? 'Save Changes' : 'Create Class'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Student Modal */}
      {showAddStudentModal && (
        <div className="modal-overlay">
          <div className="modal-content glass-card reg-modal-md">
            <div className="registration-modal-header">
              <h2>Add Student to Roster</h2>
              <button className="icon-btn" onClick={() => { setShowAddStudentModal(false); setStudentSearch(''); }} aria-label="Close">
                <X size={20} />
              </button>
            </div>
            <div className="reg-modal-body">
              <input
                type="text"
                className="form-control reg-search-input"
                placeholder="Search student by name..."
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                autoFocus
              />

              <div className="student-search-results reg-search-results">
                {allStudents
                  .filter(s => s.fullName.toLowerCase().includes(studentSearch.toLowerCase()))
                  .map(student => (
                    <button
                      key={student.id}
                      className="search-result-item"
                      onClick={() => handleManualAddStudent(student)}
                    >
                      <div className="reg-search-avatar">
                        {student.fullName.split(' ').map(n => n[0]).join('').substring(0, 2)}
                      </div>
                      <span className="reg-search-name">{student.fullName}</span>
                      <div className="reg-search-spacer"></div>
                      <Plus size={16} className="text-muted" />
                    </button>
                  ))
                }
                {allStudents.filter(s => s.fullName.toLowerCase().includes(studentSearch.toLowerCase())).length === 0 && (
                  <p className="text-muted reg-search-empty">No students found matching "{studentSearch}"</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Alert Modal */}
      {appAlert.isOpen && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-content glass-card reg-alert-modal">
            <div className={`reg-alert-icon ${appAlert.type}`}>
              {appAlert.type === 'confirm' ? <Settings size={30} /> : (appAlert.type === 'warning' ? <Clock size={30} /> : <CheckCircle size={30} />)}
            </div>

            <h2>{appAlert.title}</h2>
            <p className="text-muted reg-modal-text">{appAlert.message}</p>

            <div className="reg-alert-actions">
              {appAlert.type === 'confirm' && (
                <button className="btn-text" onClick={() => setAppAlert({ ...appAlert, isOpen: false })}>Cancel</button>
              )}
              <button
                className="btn-primary reg-alert-confirm-btn"
                onClick={() => {
                  if (appAlert.onConfirm) appAlert.onConfirm();
                  setAppAlert({ ...appAlert, isOpen: false });
                }}
              >
                {appAlert.type === 'confirm' ? 'Confirm' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RegistrationAdmin;
