import React, { useState, useEffect } from 'react';
import { Calendar, Users, Settings, Plus, Play, ChevronDown, CheckCircle, Clock, Copy, User, X, Mail, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import './RegistrationAdmin.css';

const RegistrationAdmin = () => {
  const [activeTab, setActiveTab] = useState('terms');
  const [terms, setTerms] = useState([]);
  const [selectedTermForRoster, setSelectedTermForRoster] = useState('');
  
  const [pods, setPods] = useState([]);
  const [selectedPod, setSelectedPod] = useState(null);
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
  
  const [showPodModal, setShowPodModal] = useState(false);
  const [editingPod, setEditingPod] = useState(null);
  const [podForm, setPodForm] = useState({
    name: '',
    capacity: 15,
    meetingUrl: ''
  });
  
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [studentSearch, setStudentSearch] = useState('');
  const [allStudents, setAllStudents] = useState([]);
  
  const [appAlert, setAppAlert] = useState({ 
    isOpen: false, title: '', message: '', type: 'info', onConfirm: null 
  });

  const showAlert = (message, title = 'Notification', type = 'info', onConfirm = null) => {
    setAppAlert({ isOpen: true, title, message, type, onConfirm });
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
      setPods(res.data.classes);
    } catch (err) {
      console.error(err);
    }
  };

  const loadRoster = async (podId) => {
    try {
      const res = await api.get(`/registration/classes/${podId}/roster`);
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

  useEffect(() => {
    if (activeTab === 'rosters') {
      loadClasses();
    }
  }, [activeTab, selectedTermForRoster]);

  useEffect(() => {
    if (selectedPod) {
      loadRoster(selectedPod);
    }
  }, [selectedPod]);

  const formatDateForInput = (isoString) => {
    if (!isoString) return '';
    return new Date(isoString).toISOString().split('T')[0];
  };

  const formatDateForDisplay = (isoString) => {
    if (!isoString) return '';
    return new Date(isoString).toLocaleDateString();
  };

  const handleCreateTerm = async (e) => {
    e.preventDefault();
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
      const res = await api.post(`/registration/terms/${seedModal.targetTermId}/seed-priority`);
      setSeedModal({ isOpen: false, targetTermId: null, sourceTermId: '' });
      loadTerms();
      showAlert(res.data.message || 'Term Seeded', 'Term Seeded', 'info');
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error seeding term', 'Error', 'warning');
    }
  };

  const handleRevokeHold = async (studentId) => {
    try {
      await api.delete(`/registration/holds/${studentId}?classId=${selectedPod}`);
      loadRoster(selectedPod);
      loadClasses();
    } catch (error) {
      console.error(error);
    }
  };

  const handleSweepHolds = (podId) => {
    const holdsCount = rosterDetails.holds?.length || 0;
    if (holdsCount === 0) return showAlert('No expired holds to sweep.', 'Notice', 'warning');
    
    showAlert(`Are you sure you want to sweep (revoke) ${holdsCount} holds? This will release their spots.`, 'Sweep Holds', 'confirm', async () => {
      try {
        await api.post(`/registration/classes/${podId}/holds/sweep`);
        loadRoster(podId);
        loadClasses();
      } catch (error) {
        console.error(error);
      }
    });
  };

  const handleRemindAllHolds = async (podId) => {
    try {
      const res = await api.post(`/registration/classes/${podId}/holds/remind`);
      showAlert(res.data.message, 'Reminders Sent', 'info');
    } catch (error) {
      console.error(error);
    }
  };

  const handleForcePromote = async () => {
    if (!selectedPod) return;
    try {
      const res = await api.post(`/registration/promote/${selectedPod}`);
      showAlert(res.data.message || 'Promoted successfully.', 'Success', 'info');
      loadRoster(selectedPod);
      loadClasses();
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error promoting from waitlist', 'Error', 'warning');
    }
  };

  const handleOpenPodModal = (pod = null) => {
    if (pod) {
      setEditingPod(pod.id);
      setPodForm({ name: pod.name, capacity: pod.capacity, meetingUrl: pod.meetingUrl || '' });
    } else {
      setEditingPod(null);
      setPodForm({ name: '', capacity: 15, meetingUrl: '' });
    }
    setShowPodModal(true);
  };

  const handleSavePod = async (e) => {
    e.preventDefault();
    try {
      if (editingPod) {
        await api.put(`/classes/${editingPod}`, {
          name: podForm.name,
          maxStudents: parseInt(podForm.capacity),
          meetingUrl: podForm.meetingUrl
        });
      } else {
        await api.post(`/classes`, {
          name: podForm.name,
          maxStudents: parseInt(podForm.capacity),
          meetingUrl: podForm.meetingUrl,
          termId: selectedTermForRoster
        });
      }
      setShowPodModal(false);
      loadClasses();
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error saving class', 'Error', 'warning');
    }
  };

  const handleManualAddStudent = async (student) => {
    if (!selectedPod) return;
    try {
      await api.post(`/classes/${selectedPod}/enrollments`, { studentId: student.id });
      setShowAddStudentModal(false);
      setStudentSearch('');
      loadRoster(selectedPod);
      loadClasses();
    } catch (error) {
      showAlert(error.response?.data?.message || 'Error adding student', 'Error', 'warning');
    }
  };

  return (
    <div className="registration-admin">
      <div className="page-header">
        <div>
          <h1>Registration & Terms</h1>
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

        {activeTab === 'rosters' && !selectedPod && (
          <div className="rosters-view">
            <div className="filters-bar glass-card">
              <select className="form-control" style={{ width: '200px' }} value={selectedTermForRoster} onChange={(e) => setSelectedTermForRoster(e.target.value)}>
                {terms.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <div style={{ flex: 1 }}></div>
              <button className="btn-primary" style={{ marginRight: '12px' }} onClick={() => handleOpenPodModal()}>
                <Plus size={14} /> New Class
              </button>
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
                  {pods.map(pod => {
                    const totalOccupied = pod.enrolled + pod.holds;
                    const isFull = totalOccupied >= pod.capacity;
                    const canPromoteWaitlist = !isFull && pod.waitlist > 0;
                    const enrolledPercent = (pod.enrolled / pod.capacity) * 100;
                    const holdsPercent = (pod.holds / pod.capacity) * 100;

                    return (
                      <tr key={pod.id}>
                        <td className="font-semibold">{pod.name}</td>
                        <td>
                          <div className="progress-bar-container">
                            <div className="progress-fill active" style={{ width: `${enrolledPercent}%` }}></div>
                            <div className="progress-fill holds" style={{ width: `${holdsPercent}%` }}></div>
                          </div>
                          <div className="capacity-labels">
                            <span className="text-sm mt-1 block">{totalOccupied} / {pod.capacity} Reserved</span>
                            {isFull && <span className="text-xs text-muted block">(At Capacity)</span>}
                          </div>
                        </td>
                        <td>
                          {pod.holds > 0 ? (
                            <span className="badge pending">{pod.holds} unclaimed</span>
                          ) : (
                            <span className="text-muted text-sm">0</span>
                          )}
                        </td>
                        <td>
                          {pod.waitlist > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                              <span className="badge danger">{pod.waitlist} waiting</span>
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
                            <button className="btn-text" onClick={() => setSelectedPod(pod.id)}>Manage Class</button>
                            <button className="icon-btn" style={{ padding: '4px' }} onClick={() => handleOpenPodModal(pod)} title="Edit Class Details"><Settings size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {pods.length === 0 && (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>No classes found for this term.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'rosters' && selectedPod && (
          <div className="roster-detail-view">
            <div className="detail-header">
              <button className="btn-text" onClick={() => setSelectedPod(null)} style={{ padding: 0, marginBottom: '16px' }}>← Back to All Rosters</button>
              <div className="detail-title-row">
                <div>
                  <h2>{pods.find(p => p.id === selectedPod)?.name}</h2>
                  <p className="text-muted">Term: {terms.find(t => t.id === selectedTermForRoster)?.name}</p>
                </div>
                <button className="btn-outline" onClick={() => handleOpenPodModal(pods.find(p => p.id === selectedPod))}>
                  <Settings size={16} /> Class Settings
                </button>
              </div>
            </div>

            <div className="roster-sections-grid">
              <div className="roster-card glass-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3 style={{ margin: 0 }}>Active Roster ({rosterDetails.active?.length || 0})</h3>
                  <button className="btn-outline" style={{ fontSize: '12px', padding: '4px 8px' }} onClick={() => setShowAddStudentModal(true)}>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h3 style={{ margin: 0 }}>Unclaimed Priority Holds ({rosterDetails.holds?.length || 0})</h3>
                </div>
                {(rosterDetails.holds?.length || 0) > 0 && (
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                    <button className="btn-outline" style={{ fontSize: '12px', padding: '4px 8px' }} onClick={() => handleRemindAllHolds(selectedPod)}>
                      <Mail size={14} /> Remind All
                    </button>
                    <button className="btn-outline" style={{ fontSize: '12px', padding: '4px 8px', color: '#dc2626', borderColor: 'rgba(220, 38, 38, 0.2)' }} onClick={() => handleSweepHolds(selectedPod)}>
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
                      <button className="btn-text" style={{ fontSize: '12px' }} onClick={() => handleRevokeHold(student.id)}>Revoke Hold</button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="roster-card glass-card waitlist-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h3 style={{ margin: 0 }}>Waitlist Queue ({rosterDetails.waitlist?.length || 0})</h3>
                  {(rosterDetails.waitlist?.length || 0) > 0 && (
                    <button className="btn-outline" style={{ fontSize: '12px', padding: '4px 8px' }} onClick={handleForcePromote}>
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
      </div>

      {/* Edit Term Modal */}
      {editTermModal && editTermForm && (
        <div className="modal-overlay">
          <div className="modal-content glass-card" style={{ maxWidth: '500px' }}>
            <div className="registration-modal-header">
              <h2>Edit Term Configuration</h2>
              <button className="icon-btn" onClick={() => setEditTermModal(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleUpdateTerm} className="new-term-form" style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Term Name</label>
                <input 
                  type="text" 
                  className="form-control" 
                  required 
                  value={editTermForm.name}
                  onChange={(e) => setEditTermForm({...editTermForm, name: e.target.value})}
                  style={{ width: '100%' }}
                />
              </div>
              
              <div style={{ padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '14px' }}>Window 1: Early (Same Day)</h4>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <input type="date" required className="form-control" value={editTermForm.earlySameDayStart} onChange={(e) => setEditTermForm({...editTermForm, earlySameDayStart: e.target.value})} style={{ flex: 1 }} />
                  <input type="date" required className="form-control" value={editTermForm.earlySameDayEnd} onChange={(e) => setEditTermForm({...editTermForm, earlySameDayEnd: e.target.value})} style={{ flex: 1 }} />
                </div>
              </div>

              <div style={{ padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '14px' }}>Window 2: Public</h4>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <input type="date" required className="form-control" value={editTermForm.publicStart} onChange={(e) => setEditTermForm({...editTermForm, publicStart: e.target.value})} style={{ flex: 1 }} />
                  <input type="date" required className="form-control" value={editTermForm.publicEnd} onChange={(e) => setEditTermForm({...editTermForm, publicEnd: e.target.value})} style={{ flex: 1 }} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
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
          <div className="modal-content glass-card" style={{ maxWidth: '500px' }}>
            <div className="registration-modal-header">
              <h2>Create New Term</h2>
              <button className="icon-btn" onClick={() => setShowNewTermModal(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateTerm} className="new-term-form" style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Term Name</label>
                <input 
                  type="text" 
                  className="form-control" 
                  required 
                  placeholder="e.g. Fall 2026"
                  value={newTermForm.name}
                  onChange={(e) => setNewTermForm({...newTermForm, name: e.target.value})}
                  style={{ width: '100%' }}
                />
              </div>
              
              <div style={{ padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '14px' }}>Window 1: Early (Same Day)</h4>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <input type="date" required className="form-control" value={newTermForm.earlySameDayStart} onChange={(e) => setNewTermForm({...newTermForm, earlySameDayStart: e.target.value})} style={{ flex: 1 }} />
                  <input type="date" required className="form-control" value={newTermForm.earlySameDayEnd} onChange={(e) => setNewTermForm({...newTermForm, earlySameDayEnd: e.target.value})} style={{ flex: 1 }} />
                </div>
              </div>

              <div style={{ padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '14px' }}>Window 2: Public</h4>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <input type="date" required className="form-control" value={newTermForm.publicStart} onChange={(e) => setNewTermForm({...newTermForm, publicStart: e.target.value})} style={{ flex: 1 }} />
                  <input type="date" required className="form-control" value={newTermForm.publicEnd} onChange={(e) => setNewTermForm({...newTermForm, publicEnd: e.target.value})} style={{ flex: 1 }} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
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
          <div className="modal-content glass-card" style={{ maxWidth: '450px' }}>
            <div className="registration-modal-header">
              <h2>Seed Term Data</h2>
              <button className="icon-btn" onClick={() => setSeedModal({ isOpen: false, targetTermId: null, sourceTermId: '' })}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body" style={{ marginTop: '16px' }}>
              <p className="text-muted" style={{ marginBottom: '24px', lineHeight: '1.5' }}>
                This action will analyze the rosters of a past/current term and automatically generate <strong>Priority Holds (Guaranteed Spots)</strong> for all active students in the new term.
              </p>
              
              {terms.filter(t => t.id !== seedModal.targetTermId).length > 0 ? (
                <div className="form-group">
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>Source Term to Copy From:</label>
                  <select 
                    className="form-control" 
                    value={seedModal.sourceTermId}
                    onChange={(e) => setSeedModal({...seedModal, sourceTermId: e.target.value})}
                    style={{ width: '100%', marginBottom: '24px' }}
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

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button type="button" className="btn-text" onClick={() => setSeedModal({ isOpen: false, targetTermId: null, sourceTermId: '' })}>Cancel</button>
                <button type="button" className="btn-primary" onClick={handleConfirmSeed} disabled={terms.filter(t => t.id !== seedModal.targetTermId).length === 0}>
                  <Copy size={16} /> Generate Priority Holds
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New/Edit Pod Modal */}
      {showPodModal && (
        <div className="modal-overlay">
          <div className="modal-content glass-card" style={{ maxWidth: '500px' }}>
            <div className="registration-modal-header">
              <h2>{editingPod ? 'Edit Class Details' : 'Create New Class'}</h2>
              <button type="button" className="icon-btn" onClick={() => setShowPodModal(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSavePod} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Class / Pod Name</label>
                <input 
                  type="text" 
                  className="form-control" 
                  required 
                  placeholder="e.g. Maker Studio Monday"
                  value={podForm.name}
                  onChange={(e) => setPodForm({...podForm, name: e.target.value})}
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Capacity</label>
                <input 
                  type="number" 
                  className="form-control" 
                  required 
                  value={podForm.capacity}
                  onChange={(e) => setPodForm({...podForm, capacity: e.target.value})}
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Play size={14} color="#0ea5e9" /> Zoom / Meeting Link
                </label>
                <input 
                  type="url" 
                  className="form-control" 
                  placeholder="https://zoom.us/j/..."
                  value={podForm.meetingUrl}
                  onChange={(e) => setPodForm({...podForm, meetingUrl: e.target.value})}
                  style={{ width: '100%' }}
                />
                <p className="text-xs text-muted" style={{ marginTop: '4px' }}>This link will be visible to students in their dashboard.</p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
                <button type="button" className="btn-text" onClick={() => setShowPodModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">{editingPod ? 'Save Changes' : 'Create Class'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Student Modal */}
      {showAddStudentModal && (
        <div className="modal-overlay">
          <div className="modal-content glass-card" style={{ maxWidth: '450px' }}>
            <div className="registration-modal-header">
              <h2>Add Student to Roster</h2>
              <button className="icon-btn" onClick={() => { setShowAddStudentModal(false); setStudentSearch(''); }}>
                <X size={20} />
              </button>
            </div>
            <div style={{ marginTop: '16px' }}>
              <input 
                type="text" 
                className="form-control" 
                placeholder="Search student by name..." 
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                style={{ width: '100%', marginBottom: '16px' }}
                autoFocus
              />
              
              <div className="student-search-results" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {allStudents
                  .filter(s => s.fullName.toLowerCase().includes(studentSearch.toLowerCase()))
                  .map(student => (
                    <button 
                      key={student.id} 
                      className="search-result-item"
                      onClick={() => handleManualAddStudent(student)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px',
                        border: 'none',
                        background: 'none',
                        borderBottom: '1px solid var(--border-light)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background 0.2s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.02)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                    >
                      <div style={{ 
                        width: '32px', 
                        height: '32px', 
                        borderRadius: '50%', 
                        background: '#e0f2fe', 
                        color: '#0369a1', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        fontWeight: '700', 
                        fontSize: '12px' 
                      }}>
                        {student.fullName.split(' ').map(n => n[0]).join('').substring(0, 2)}
                      </div>
                      <span style={{ fontWeight: '500' }}>{student.fullName}</span>
                      <div style={{ flex: 1 }}></div>
                      <Plus size={16} className="text-muted" />
                    </button>
                  ))
                }
                {allStudents.filter(s => s.fullName.toLowerCase().includes(studentSearch.toLowerCase())).length === 0 && (
                  <p className="text-muted" style={{ textAlign: 'center', padding: '20px' }}>No students found matching "{studentSearch}"</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Alert Modal */}
      {appAlert.isOpen && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-content glass-card" style={{ maxWidth: '400px', textAlign: 'center', padding: '30px' }}>
            <div style={{ 
              width: '60px', 
              height: '60px', 
              borderRadius: '50%', 
              background: appAlert.type === 'confirm' ? '#e0f2fe' : (appAlert.type === 'warning' ? '#fef3c7' : '#f0fdf4'),
              color: appAlert.type === 'confirm' ? '#0369a1' : (appAlert.type === 'warning' ? '#d97706' : '#166534'),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px auto'
            }}>
              {appAlert.type === 'confirm' ? <Settings size={30} /> : (appAlert.type === 'warning' ? <Clock size={30} /> : <CheckCircle size={30} />)}
            </div>
            
            <h2 style={{ marginBottom: '12px', fontSize: '20px' }}>{appAlert.title}</h2>
            <p className="text-muted" style={{ marginBottom: '24px', lineHeight: '1.5' }}>{appAlert.message}</p>
            
            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
              {appAlert.type === 'confirm' && (
                <button className="btn-text" onClick={() => setAppAlert({ ...appAlert, isOpen: false })}>Cancel</button>
              )}
              <button 
                className="btn-primary" 
                onClick={() => {
                  if (appAlert.onConfirm) appAlert.onConfirm();
                  setAppAlert({ ...appAlert, isOpen: false });
                }}
                style={{ padding: '10px 30px' }}
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
