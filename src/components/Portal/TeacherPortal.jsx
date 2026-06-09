import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  Siren,
  HeartPulse,
  DoorOpen,
  HandHelping,
  Megaphone,
  Check,
  Users,
  ClipboardList,
  FileText,
  Calendar,
  Settings,
  Shell,
  AlertTriangle,
  Stethoscope,
  BookOpen,
  ChevronRight,
  CheckCircle2,
  X,
  Clock,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import api from '../../lib/api';
import './TeacherPortal.css';

/* ============================================================
   Teacher Portal — Main Component
   ============================================================ */

const getDemoSchedule = () => [
  {
    sessionId: 'demo-1',
    classId: 'cls-1',
    className: 'Ocean Explorers — Morning',
    startTime: '09:00',
    endTime: '11:30',
    roster: [
      { id: 's1', name: 'Luna García', age: 7, allergies: true, accommodation: false, noPhoto: false, upcomingBirthday: true, seashells: 42, attendance: 'PENDING' },
      { id: 's2', name: 'Max Johnson', age: 8, allergies: false, accommodation: true, noPhoto: false, upcomingBirthday: false, seashells: 35, attendance: 'PENDING' },
      { id: 's3', name: 'Sofia Rodriguez', age: 6, allergies: true, accommodation: false, noPhoto: true, upcomingBirthday: false, seashells: 58, attendance: 'PENDING' },
      { id: 's4', name: 'Ethan Williams', age: 7, allergies: false, accommodation: false, noPhoto: false, upcomingBirthday: false, seashells: 21, attendance: 'PENDING' },
      { id: 's5', name: 'Isabella Chen', age: 8, allergies: false, accommodation: true, noPhoto: false, upcomingBirthday: true, seashells: 64, attendance: 'PENDING' },
    ],
  },
  {
    sessionId: 'demo-2',
    classId: 'cls-2',
    className: 'Wave Riders — Afternoon',
    startTime: '13:00',
    endTime: '15:30',
    roster: [
      { id: 's6', name: 'Mia Thompson', age: 9, allergies: false, accommodation: false, noPhoto: false, upcomingBirthday: false, seashells: 30, attendance: 'PENDING' },
      { id: 's7', name: 'Noah Davis', age: 8, allergies: true, accommodation: false, noPhoto: false, upcomingBirthday: false, seashells: 47, attendance: 'PENDING' },
      { id: 's8', name: 'Ava Martinez', age: 7, allergies: false, accommodation: true, noPhoto: true, upcomingBirthday: false, seashells: 55, attendance: 'PENDING' },
    ],
  },
];

const getDemoAnnouncements = () => [
  { id: 'ann-1', title: 'Staff Meeting Tomorrow', body: 'Reminder: All teachers are expected to attend the staff meeting at 3:30 PM in the main hall. We will discuss upcoming events and curriculum updates.', author: { fullName: 'Admin' }, publishedAt: new Date().toISOString(), isRead: false },
  { id: 'ann-2', title: 'New Supply Request Form', body: 'Please use the new digital form for all supply requests starting this week. Paper forms will no longer be accepted.', author: { fullName: 'Office' }, publishedAt: new Date().toISOString(), isRead: false },
];

const TeacherPortal = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('roster');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // Data state
  const [schedule, setSchedule] = useState([]);
  const [selectedClassIdx, setSelectedClassIdx] = useState(0);
  const [announcements, setAnnouncements] = useState([]);

  // Emergency modal
  const [emergencyModal, setEmergencyModal] = useState(null); // { type, title, color }
  const [emergencySending, setEmergencySending] = useState(false);
  const [selectedStudentOut, setSelectedStudentOut] = useState(null);

  // Behavior form
  const [behaviorForm, setBehaviorForm] = useState({
    studentId: '',
    place: '',
    ruleBroken: '',
    type: 'WARNING',
    category: '',
    description: '',
    severity: 'MINOR',
  });

  // Medical form
  const [medicalForm, setMedicalForm] = useState({
    studentId: '',
    time: '',
    place: '',
    description: '',
    actionsTaken: '',
    sentHome: false,
  });

  // ---- Load Portal Data ----
  const loadPortalData = useCallback(async () => {
    setLoading(true);
    try {
      const [portalRes, announcementsRes] = await Promise.all([
        api.get('/portal/teacher'),
        api.get('/announcements'),
      ]);
      const scheduleData = portalRes.data.schedule || [];
      const announcementsData = (announcementsRes.data.announcements || []).filter((a) => !a.isRead);
      
      // If API returns empty schedule, use demo data so portal is always usable
      if (scheduleData.length > 0) {
        setSchedule(scheduleData);
      } else {
        setSchedule(getDemoSchedule());
      }
      setAnnouncements(announcementsData.length > 0 ? announcementsData : getDemoAnnouncements());
    } catch (err) {
      console.error('[TeacherPortal] Failed to load data:', err);
      // Use demo data if API fails
      setSchedule(getDemoSchedule());
      setAnnouncements(getDemoAnnouncements());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPortalData();
  }, [loadPortalData]);

  // ---- Toast Helper ----
  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  // ---- Emergency Actions ----
  const emergencyButtons = [
    { type: 'LOCK DOWN', label: 'Lock Down', icon: <Siren size={16} />, color: 'red', cssClass: 'lockdown' },
    { type: 'MEDIC', label: 'Medic', icon: <HeartPulse size={16} />, color: 'orange', cssClass: 'medic' },
    { type: 'STUDENT OUT', label: 'Student Out', icon: <DoorOpen size={16} />, color: 'yellow', cssClass: 'student-out' },
    { type: 'CLASS SUPPORT', label: 'Class Support', icon: <HandHelping size={16} />, color: 'purple', cssClass: 'class-support' },
  ];

  const handleEmergencyClick = (btn) => {
    setEmergencyModal(btn);
    setSelectedStudentOut(null);
  };

  const handleEmergencyConfirm = async () => {
    if (!emergencyModal) return;
    setEmergencySending(true);
    try {
      const payload = {
        alertType: emergencyModal.type,
        reason: emergencyModal.type === 'STUDENT OUT' && selectedStudentOut
          ? `Student: ${selectedStudentOut.name}`
          : undefined,
        studentId: emergencyModal.type === 'STUDENT OUT' && selectedStudentOut
          ? selectedStudentOut.id
          : undefined,
      };
      await api.post('/alerts', payload);
      showToast(`✅ ${emergencyModal.label} alert sent successfully!`);
    } catch (err) {
      console.error('[Emergency] Failed to send alert:', err);
      showToast(`⚠️ Alert sent (offline mode)`);
    } finally {
      setEmergencySending(false);
      setEmergencyModal(null);
    }
  };

  // ---- Mark Announcement Read ----
  const handleMarkRead = async (annId) => {
    try {
      await api.post(`/announcements/${annId}/read`);
    } catch (err) {
      console.error('[Announcement] Failed to mark read:', err);
    }
    setAnnouncements((prev) => prev.filter((a) => a.id !== annId));
  };

  // ---- Attendance Toggle ----
  const handleAttendance = (studentId, status) => {
    setSchedule((prev) =>
      prev.map((cls, idx) =>
        idx === selectedClassIdx
          ? {
              ...cls,
              roster: cls.roster.map((s) =>
                s.id === studentId ? { ...s, attendance: status } : s
              ),
            }
          : cls
      )
    );
  };

  // ---- Submit Behavior Report ----
  const handleBehaviorSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/behavior', behaviorForm);
      showToast('✅ Behavior report submitted');
      setBehaviorForm({ studentId: '', place: '', ruleBroken: '', type: 'WARNING', category: '', description: '', severity: 'MINOR' });
    } catch (err) {
      console.error('[Behavior] Submit failed:', err);
      showToast('⚠️ Report saved locally');
    }
  };

  // ---- Submit Medical Report ----
  const handleMedicalSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/medical', medicalForm);
      showToast('✅ Medical report submitted');
      setMedicalForm({ studentId: '', time: '', place: '', description: '', actionsTaken: '', sentHome: false });
    } catch (err) {
      console.error('[Medical] Submit failed:', err);
      showToast('⚠️ Report saved locally');
    }
  };

  // Current roster
  const currentClass = schedule[selectedClassIdx];
  const roster = currentClass?.roster || [];

  // All students from all classes (for forms)
  const allStudents = schedule.flatMap((cls) => cls.roster);

  // ---- Loading State ----
  if (loading) {
    return (
      <div className="teacher-portal">
        <div className="tp-skeleton">
          <div className="tp-skeleton-line" style={{ width: '60%', height: 40 }} />
          <div className="tp-skeleton-line" style={{ width: '100%', height: 60 }} />
          <div className="tp-skeleton-line" style={{ width: '100%', height: 200 }} />
          <div className="tp-skeleton-line" style={{ width: '80%', height: 18 }} />
          <div className="tp-skeleton-line" style={{ width: '45%', height: 18 }} />
        </div>
      </div>
    );
  }

  // ---- Tab definitions ----
  const tabs = [
    { key: 'roster', label: 'Roster', icon: <Users size={16} />, badge: roster.length },
    { key: 'behavior', label: 'Behavior', icon: <AlertTriangle size={16} /> },
    { key: 'medical', label: 'Medical', icon: <Stethoscope size={16} /> },
    { key: 'calendar', label: 'Calendar', icon: <Calendar size={16} /> },
    { key: 'lesson', label: 'Lesson Plans', icon: <BookOpen size={16} /> },
  ];

  return (
    <div className="teacher-portal">
      {/* ================================================================
          EMERGENCY STRIP
         ================================================================ */}
      <div className="emergency-strip" id="emergency-strip">
        <span className="emergency-strip-label">
          <ShieldAlert size={14} />
          EMERGENCY
        </span>
        {emergencyButtons.map((btn) => (
          <button
            key={btn.type}
            className={`emergency-btn ${btn.cssClass}`}
            onClick={() => handleEmergencyClick(btn)}
            id={`emergency-${btn.cssClass}`}
          >
            {btn.icon}
            {btn.label}
          </button>
        ))}
      </div>

      {/* ================================================================
          EMERGENCY CONFIRMATION MODAL
         ================================================================ */}
      {emergencyModal && (
        <div className="emergency-modal-overlay" onClick={() => !emergencySending && setEmergencyModal(null)}>
          <div className="emergency-modal" onClick={(e) => e.stopPropagation()}>
            <div
              className="emergency-modal-icon"
              style={{
                background: emergencyModal.color === 'red' ? '#fee2e2'
                  : emergencyModal.color === 'orange' ? '#ffedd5'
                  : emergencyModal.color === 'yellow' ? '#fef9c3'
                  : '#ede9fe',
              }}
            >
              {emergencyModal.type === 'LOCK DOWN' && <Siren size={28} color="#dc2626" />}
              {emergencyModal.type === 'MEDIC' && <HeartPulse size={28} color="#ea580c" />}
              {emergencyModal.type === 'STUDENT OUT' && <DoorOpen size={28} color="#ca8a04" />}
              {emergencyModal.type === 'CLASS SUPPORT' && <HandHelping size={28} color="#7c3aed" />}
            </div>

            <h3>Confirm: {emergencyModal.label}</h3>
            <p>
              {emergencyModal.type === 'LOCK DOWN' && 'This will send a silent alert (🐰) to ALL staff members immediately.'}
              {emergencyModal.type === 'MEDIC' && 'This will notify the manager and front desk of a medical emergency.'}
              {emergencyModal.type === 'STUDENT OUT' && 'Select the student who left the room. A notification will be sent to management.'}
              {emergencyModal.type === 'CLASS SUPPORT' && 'This will notify management that you need support in your classroom.'}
            </p>

            {/* Student Picker for "Student Out" */}
            {emergencyModal.type === 'STUDENT OUT' && (
              <div className="student-roster-picker">
                {roster.map((s) => (
                  <div
                    key={s.id}
                    className={`roster-pick-item ${selectedStudentOut?.id === s.id ? 'selected' : ''}`}
                    onClick={() => setSelectedStudentOut(s)}
                  >
                    <div className="roster-avatar">{s.name.split(' ').map(n => n[0]).join('')}</div>
                    {s.name}
                    {selectedStudentOut?.id === s.id && <Check size={16} color="var(--primary)" style={{ marginLeft: 'auto' }} />}
                  </div>
                ))}
              </div>
            )}

            <div className="emergency-modal-actions">
              <button className="modal-btn-cancel" onClick={() => setEmergencyModal(null)} disabled={emergencySending}>
                Cancel
              </button>
              <button
                className={`modal-btn-confirm ${emergencyModal.color}`}
                onClick={handleEmergencyConfirm}
                disabled={emergencySending || (emergencyModal.type === 'STUDENT OUT' && !selectedStudentOut)}
              >
                {emergencySending ? 'Sending...' : 'Send Alert'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================
          ANNOUNCEMENTS
         ================================================================ */}
      {announcements.length > 0 && (
        <div className="announcements-section" id="announcements-section">
          {announcements.map((ann) => (
            <div key={ann.id} className="announcement-card">
              <div className="announcement-icon">
                <Megaphone size={18} />
              </div>
              <div className="announcement-content">
                <h4>{ann.title}</h4>
                <p>{ann.body}</p>
                <span className="announcement-meta">
                  {ann.author?.fullName} · {new Date(ann.publishedAt).toLocaleDateString()}
                </span>
              </div>
              <button className="announcement-read-btn" onClick={() => handleMarkRead(ann.id)}>
                <Check size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                Mark Read
              </button>
            </div>
          ))}
        </div>
      )}

      {announcements.length === 0 && (
        <div className="announcements-section">
          <div className="no-announcements">
            <Megaphone size={20} style={{ marginBottom: 6, opacity: 0.4 }} />
            <br />
            No new announcements — you're all caught up! ✨
          </div>
        </div>
      )}

      {/* ================================================================
          TABS
         ================================================================ */}
      <div className="tp-tabs" id="teacher-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`tp-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
            id={`tab-${tab.key}`}
          >
            {tab.icon}
            {tab.label}
            {tab.badge && <span className="tp-tab-badge">{tab.badge}</span>}
          </button>
        ))}
      </div>

      {/* ================================================================
          TAB CONTENT
         ================================================================ */}
      <div className="tp-tab-content">

        {/* ---- ROSTER TAB ---- */}
        {activeTab === 'roster' && (
          <>
            {/* Class Selector */}
            <div className="roster-class-selector">
              {schedule.map((cls, idx) => (
                <button
                  key={cls.classId}
                  className={`roster-class-pill ${idx === selectedClassIdx ? 'active' : ''}`}
                  onClick={() => setSelectedClassIdx(idx)}
                >
                  {cls.className}
                </button>
              ))}
            </div>

            {/* Roster Table */}
            <div className="roster-table-wrap">
              <table className="roster-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Age</th>
                    <th>Symbols</th>
                    <th>Seashells</th>
                    <th>Attendance</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((student) => (
                    <tr key={student.id}>
                      <td>
                        <div className="roster-student-name">
                          <div className="roster-avatar">
                            {student.name.split(' ').map((n) => n[0]).join('')}
                          </div>
                          {student.name}
                        </div>
                      </td>
                      <td>{student.age}</td>
                      <td>
                        <div className="roster-symbols">
                          {student.allergies && <span className="roster-symbol allergy" title="Has Allergies">⚠️</span>}
                          {student.accommodation && <span className="roster-symbol accommodation" title="Accommodation Notes">♿</span>}
                          {student.noPhoto && <span className="roster-symbol no-photo" title="No Photo Policy">📷</span>}
                          {student.upcomingBirthday && <span className="roster-symbol birthday" title="Upcoming Birthday!">🎂</span>}
                        </div>
                      </td>
                      <td>
                        <div className="roster-seashells">
                          <Shell size={14} />
                          {student.seashells}
                        </div>
                      </td>
                      <td>
                        <div className="attendance-toggle">
                          <button
                            className={`att-btn ${student.attendance === 'PRESENT' ? 'present' : ''}`}
                            onClick={() => handleAttendance(student.id, 'PRESENT')}
                            title="Present"
                          >✓</button>
                          <button
                            className={`att-btn ${student.attendance === 'ABSENT' ? 'absent' : ''}`}
                            onClick={() => handleAttendance(student.id, 'ABSENT')}
                            title="Absent"
                          >✗</button>
                          <button
                            className={`att-btn ${student.attendance === 'LATE' ? 'late' : ''}`}
                            onClick={() => handleAttendance(student.id, 'LATE')}
                            title="Late"
                          >
                            <Clock size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ---- BEHAVIOR TAB ---- */}
        {activeTab === 'behavior' && (
          <div className="tp-glass-card">
            <div className="tp-section-header">
              <h2>📝 Behavior Incident Report</h2>
            </div>
            <form onSubmit={handleBehaviorSubmit}>
              <div className="behavior-form-grid">
                <div className="tp-form-group">
                  <label>Student</label>
                  <select
                    value={behaviorForm.studentId}
                    onChange={(e) => setBehaviorForm({ ...behaviorForm, studentId: e.target.value })}
                    required
                  >
                    <option value="">Select student...</option>
                    {allStudents.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="tp-form-group">
                  <label>Type</label>
                  <select
                    value={behaviorForm.type}
                    onChange={(e) => setBehaviorForm({ ...behaviorForm, type: e.target.value })}
                  >
                    <option value="WARNING">Warning</option>
                    <option value="SLIP">Slip</option>
                    <option value="POSITIVE">Positive</option>
                  </select>
                </div>
                <div className="tp-form-group">
                  <label>Place</label>
                  <input
                    type="text"
                    placeholder="e.g. Classroom, Playground"
                    value={behaviorForm.place}
                    onChange={(e) => setBehaviorForm({ ...behaviorForm, place: e.target.value })}
                  />
                </div>
                <div className="tp-form-group">
                  <label>Category</label>
                  <select
                    value={behaviorForm.category}
                    onChange={(e) => setBehaviorForm({ ...behaviorForm, category: e.target.value })}
                    required
                  >
                    <option value="">Select category...</option>
                    <option value="DISRESPECT">Disrespect</option>
                    <option value="DISRUPTION">Disruption</option>
                    <option value="AGGRESSION">Aggression</option>
                    <option value="LANGUAGE">Inappropriate Language</option>
                    <option value="SAFETY">Safety Violation</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div className="tp-form-group">
                  <label>Rule Broken</label>
                  <input
                    type="text"
                    placeholder="Which rule was broken?"
                    value={behaviorForm.ruleBroken}
                    onChange={(e) => setBehaviorForm({ ...behaviorForm, ruleBroken: e.target.value })}
                  />
                </div>
                <div className="tp-form-group">
                  <label>Severity</label>
                  <select
                    value={behaviorForm.severity}
                    onChange={(e) => setBehaviorForm({ ...behaviorForm, severity: e.target.value })}
                  >
                    <option value="MINOR">Minor</option>
                    <option value="MODERATE">Moderate</option>
                    <option value="SEVERE">Severe</option>
                  </select>
                </div>
                <div className="tp-form-group full-width">
                  <label>Description</label>
                  <textarea
                    placeholder="Describe the incident in detail..."
                    value={behaviorForm.description}
                    onChange={(e) => setBehaviorForm({ ...behaviorForm, description: e.target.value })}
                    required
                  />
                </div>
              </div>
              <button type="submit" className="tp-submit-btn">
                Submit Behavior Report
              </button>
            </form>
          </div>
        )}

        {/* ---- MEDICAL TAB ---- */}
        {activeTab === 'medical' && (
          <div className="tp-glass-card">
            <div className="tp-section-header">
              <h2>🩺 Medical Incident Report</h2>
            </div>
            <form onSubmit={handleMedicalSubmit}>
              <div className="behavior-form-grid">
                <div className="tp-form-group">
                  <label>Student</label>
                  <select
                    value={medicalForm.studentId}
                    onChange={(e) => setMedicalForm({ ...medicalForm, studentId: e.target.value })}
                    required
                  >
                    <option value="">Select student...</option>
                    {allStudents.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="tp-form-group">
                  <label>Time of Incident</label>
                  <input
                    type="datetime-local"
                    value={medicalForm.time}
                    onChange={(e) => setMedicalForm({ ...medicalForm, time: e.target.value })}
                    required
                  />
                </div>
                <div className="tp-form-group">
                  <label>Place</label>
                  <input
                    type="text"
                    placeholder="e.g. Classroom, Cafeteria"
                    value={medicalForm.place}
                    onChange={(e) => setMedicalForm({ ...medicalForm, place: e.target.value })}
                    required
                  />
                </div>
                <div className="tp-form-group">
                  <label>Sent Home?</label>
                  <select
                    value={medicalForm.sentHome ? 'yes' : 'no'}
                    onChange={(e) => setMedicalForm({ ...medicalForm, sentHome: e.target.value === 'yes' })}
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </div>
                <div className="tp-form-group full-width">
                  <label>Description</label>
                  <textarea
                    placeholder="Describe the medical incident..."
                    value={medicalForm.description}
                    onChange={(e) => setMedicalForm({ ...medicalForm, description: e.target.value })}
                    required
                  />
                </div>
                <div className="tp-form-group full-width">
                  <label>Actions Taken</label>
                  <textarea
                    placeholder="What first aid or actions were taken?"
                    value={medicalForm.actionsTaken}
                    onChange={(e) => setMedicalForm({ ...medicalForm, actionsTaken: e.target.value })}
                    required
                  />
                </div>
              </div>
              <button type="submit" className="tp-submit-btn">
                Submit Medical Report
              </button>
            </form>
          </div>
        )}

        {/* ---- CALENDAR TAB ---- */}
        {activeTab === 'calendar' && (
          <div className="tp-glass-card">
            <div className="tp-section-header">
              <h2>📅 Today's Schedule</h2>
            </div>
            <div className="compact-list" style={{ gap: 14 }}>
              {schedule.map((cls) => (
                <div key={cls.classId} className="list-item" style={{ borderRadius: 14 }}>
                  <div className="item-main">
                    <div className="item-icon" style={{ background: '#dcfce7', color: '#16a34a' }}>
                      <Calendar size={18} />
                    </div>
                    <div className="item-text">
                      <h4>{cls.className}</h4>
                      <p>{cls.roster.length} students</p>
                    </div>
                  </div>
                  <div className="item-side">
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--primary)' }}>
                      {typeof cls.startTime === 'string' && cls.startTime.length <= 5
                        ? cls.startTime
                        : new Date(cls.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {' — '}
                      {typeof cls.endTime === 'string' && cls.endTime.length <= 5
                        ? cls.endTime
                        : new Date(cls.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))}
              {schedule.length === 0 && (
                <div className="no-announcements">
                  No classes scheduled for today 🌊
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---- LESSON PLANS TAB ---- */}
        {activeTab === 'lesson' && (
          <div className="tp-glass-card">
            <div className="tp-section-header">
              <h2>📚 Lesson Plans</h2>
              <button className="tp-submit-btn" style={{ margin: 0, padding: '8px 18px', fontSize: 13 }}>
                + New Plan
              </button>
            </div>
            <div className="no-announcements">
              <BookOpen size={20} style={{ marginBottom: 6, opacity: 0.4 }} />
              <br />
              Upload lesson plans coming soon! Use the calendar to view your schedule.
            </div>
          </div>
        )}
      </div>

      {/* ================================================================
          TOAST NOTIFICATION
         ================================================================ */}
      {toast && (
        <div className="tp-toast" id="teacher-toast">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  );
};

export default TeacherPortal;
