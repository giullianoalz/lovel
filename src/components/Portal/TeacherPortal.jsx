import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ShieldAlert, Siren, HeartPulse, DoorOpen, HandHelping, Megaphone,
  Check, Users, FileText, Calendar, Shell, AlertTriangle, Stethoscope,
  BookOpen, CheckCircle2, X, Clock, Star, Gift, History, Eye, EyeOff,
  ShieldCheck, ChevronDown, Download, Bold, Italic, Underline, List,
  Link2, Image, Paperclip, Video, LogOut, LifeBuoy, AlertCircle, FileWarning,
} from 'lucide-react';
import mammoth from 'mammoth';
import * as xlsx from 'xlsx';
import { useAuth } from '../../context/AuthContext';
import { database } from '../../lib/database';
import api from '../../lib/api';
import './TeacherPortal.css';

/* ── Demo fallbacks ─────────────────────────────────────────── */
const getDemoSchedule = () => [
  {
    sessionId: 'demo-1', classId: 'cls-1',
    className: 'Ocean Explorers — Morning', startTime: '09:00', endTime: '11:30',
    roster: [
      { id: 's1', name: 'Luna García',    age: 7, allergies: true,  accommodation: false, noPhoto: false, upcomingBirthday: true,  seashells: 42, prizePoints: 120, attendance: 'PENDING' },
      { id: 's2', name: 'Max Johnson',    age: 8, allergies: false, accommodation: true,  noPhoto: false, upcomingBirthday: false, seashells: 35, prizePoints: 85,  attendance: 'PENDING' },
      { id: 's3', name: 'Sofia Rodriguez',age: 6, allergies: true,  accommodation: false, noPhoto: true,  upcomingBirthday: false, seashells: 58, prizePoints: 200, attendance: 'PENDING' },
      { id: 's4', name: 'Ethan Williams', age: 7, allergies: false, accommodation: false, noPhoto: false, upcomingBirthday: false, seashells: 21, prizePoints: 40,  attendance: 'PENDING' },
      { id: 's5', name: 'Isabella Chen',  age: 8, allergies: false, accommodation: true,  noPhoto: false, upcomingBirthday: true,  seashells: 64, prizePoints: 310, attendance: 'PENDING' },
    ],
  },
  {
    sessionId: 'demo-2', classId: 'cls-2',
    className: 'Wave Riders — Afternoon', startTime: '13:00', endTime: '15:30',
    roster: [
      { id: 's6', name: 'Mia Thompson', age: 9, allergies: false, accommodation: false, noPhoto: false, upcomingBirthday: false, seashells: 30, prizePoints: 75,  attendance: 'PENDING' },
      { id: 's7', name: 'Noah Davis',   age: 8, allergies: true,  accommodation: false, noPhoto: false, upcomingBirthday: false, seashells: 47, prizePoints: 140, attendance: 'PENDING' },
      { id: 's8', name: 'Ava Martinez', age: 7, allergies: false, accommodation: true,  noPhoto: true,  upcomingBirthday: false, seashells: 55, prizePoints: 90,  attendance: 'PENDING' },
    ],
  },
];

const getDemoAnnouncements = () => [
  { id: 'ann-1', title: 'Staff Meeting Tomorrow', body: 'Reminder: All teachers are expected to attend the staff meeting at 3:30 PM in the main hall. We will discuss upcoming events and curriculum updates.', author: { fullName: 'Admin' }, publishedAt: new Date().toISOString(), isRead: false },
  { id: 'ann-2', title: 'New Supply Request Form', body: 'Please use the new digital form for all supply requests starting this week. Paper forms will no longer be accepted.', author: { fullName: 'Office' }, publishedAt: new Date().toISOString(), isRead: false },
];

/* ── Helpers ────────────────────────────────────────────────── */
const fmtTime = (t) =>
  typeof t === 'string' && t.length <= 5
    ? t
    : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/* ============================================================ */
const TeacherPortal = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('session');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  /* ── Portal data ── */
  const [schedule, setSchedule] = useState([]);
  const [selectedClassIdx, setSelectedClassIdx] = useState(0);
  const [announcements, setAnnouncements] = useState([]);

  /* ── Emergency ── */
  const [emergencyModal, setEmergencyModal] = useState(null);
  const [emergencySending, setEmergencySending] = useState(false);
  const [selectedStudentOut, setSelectedStudentOut] = useState(null);

  /* ── Per-student alert modal ── */
  const [alertModal, setAlertModal] = useState(null); // student obj

  /* ── Prize bar ── */
  const [selectedForPrize, setSelectedForPrize] = useState({});
  const [prizePoints, setPrizePoints] = useState('');
  const [prizeReason, setPrizeReason] = useState('');
  const [awarding, setAwarding] = useState(false);

  /* ── Session notes & materials ── */
  const [classNotes, setClassNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [recordingUrl, setRecordingUrl] = useState('');
  const [noteVisibility, setNoteVisibility] = useState(['students_parents', 'me']);
  const [completeLoading, setCompleteLoading] = useState(false);

  /* ── History ── */
  const [sessionHistory, setSessionHistory] = useState([]);
  const [historyFilter, setHistoryFilter] = useState('30days');
  const [expandedNotes, setExpandedNotes] = useState({});
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  /* ── Rich text toolbar ── */
  const [activeFormats, setActiveFormats] = useState({ bold: false, italic: false, underline: false, fontSize: '3' });
  const [isSizeDropdownOpen, setIsSizeDropdownOpen] = useState(false);
  const [isLinkInputOpen, setIsLinkInputOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [savedRange, setSavedRange] = useState(null);

  /* ── File preview ── */
  const [previewFile, setPreviewFile] = useState(null);
  const [officePreviewHtml, setOfficePreviewHtml] = useState('');
  const [officeProcessing, setOfficeProcessing] = useState(false);

  /* ── Allergy popover ── */
  const [visibleAllergy, setVisibleAllergy] = useState(null);

  /* ── Forms ── */
  const [behaviorForm, setBehaviorForm] = useState({ studentId: '', place: '', ruleBroken: '', type: 'WARNING', category: '', description: '', severity: 'MINOR' });
  const [medicalForm, setMedicalForm] = useState({ studentId: '', time: '', place: '', description: '', actionsTaken: '', sentHome: false });

  /* ── Refs ── */
  const editorRef       = useRef(null);
  const fileInputRef    = useRef(null);
  const videoInputRef   = useRef(null);
  const filterRef       = useRef(null);
  const sizeDropdownRef = useRef(null);
  const linkDropdownRef = useRef(null);

  /* ═══════════════════════════════════════════════════════════
     LOAD DATA
  ═══════════════════════════════════════════════════════════ */
  const loadPortalData = useCallback(async () => {
    setLoading(true);
    try {
      const [portalRes, annRes] = await Promise.all([
        api.get('/portal/teacher'),
        api.get('/announcements'),
      ]);
      const sc = portalRes.data.schedule || [];
      const ann = (annRes.data.announcements || []).filter((a) => !a.isRead);
      setSchedule(sc.length > 0 ? sc : getDemoSchedule());
      setAnnouncements(ann.length > 0 ? ann : getDemoAnnouncements());
    } catch {
      setSchedule(getDemoSchedule());
      setAnnouncements(getDemoAnnouncements());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPortalData(); }, [loadPortalData]);

  /* Load history whenever selected class changes */
  useEffect(() => {
    const cls = schedule[selectedClassIdx];
    if (!cls) return;
    setLoadingHistory(true);
    database.fetchSessionHistory(cls.sessionId)
      .then((h) => setSessionHistory(h || []))
      .catch(() => setSessionHistory([]))
      .finally(() => setLoadingHistory(false));
  }, [selectedClassIdx, schedule]);

  /* Close dropdowns on outside click */
  useEffect(() => {
    const h = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) setIsFilterOpen(false);
      if (sizeDropdownRef.current && !sizeDropdownRef.current.contains(e.target)) setIsSizeDropdownOpen(false);
      if (linkDropdownRef.current && !linkDropdownRef.current.contains(e.target)) setIsLinkInputOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  /* Track rich-text active formats */
  useEffect(() => {
    const check = () => {
      if (editorRef.current) {
        setActiveFormats({
          bold: document.queryCommandState('bold'),
          italic: document.queryCommandState('italic'),
          underline: document.queryCommandState('underline'),
          fontSize: document.queryCommandValue('fontSize') || '3',
        });
      }
    };
    document.addEventListener('selectionchange', check);
    return () => document.removeEventListener('selectionchange', check);
  }, []);

  /* Process local office files for preview */
  useEffect(() => {
    if (!previewFile) { setOfficePreviewHtml(''); return; }
    const isLocal = previewFile.url?.startsWith('blob:');
    if (!isLocal) return;
    const ext = previewFile.name.toLowerCase().split('.').pop();
    if (ext !== 'docx' && ext !== 'xlsx') return;
    setOfficeProcessing(true);
    fetch(previewFile.url)
      .then((r) => r.arrayBuffer())
      .then(async (buf) => {
        if (ext === 'docx') {
          const r = await mammoth.convertToHtml({ arrayBuffer: buf });
          setOfficePreviewHtml(r.value || '<p style="padding:20px;text-align:center">Empty document.</p>');
        } else {
          const wb = xlsx.read(new Uint8Array(buf), { type: 'array' });
          if (wb.SheetNames.length > 0) {
            setOfficePreviewHtml(`<div class="xlsx-preview-table-container">${xlsx.utils.sheet_to_html(wb.Sheets[wb.SheetNames[0]])}</div>`);
          } else {
            setOfficePreviewHtml('<p style="padding:20px;text-align:center">No sheets found.</p>');
          }
        }
      })
      .catch(() => setOfficePreviewHtml('<div style="color:#ef4444;padding:40px;text-align:center"><strong>Error rendering document</strong></div>'))
      .finally(() => setOfficeProcessing(false));
  }, [previewFile]);

  /* ═══════════════════════════════════════════════════════════
     HELPERS
  ═══════════════════════════════════════════════════════════ */
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3500); };

  const currentClass = schedule[selectedClassIdx];
  const roster = currentClass?.roster || [];
  const allStudents = schedule.flatMap((c) => c.roster);
  const selectedCount = Object.values(selectedForPrize).filter(Boolean).length;

  /* ── Attendance ── */
  const handleAttendance = (studentId, status) => {
    setSchedule((prev) =>
      prev.map((cls, idx) =>
        idx === selectedClassIdx
          ? { ...cls, roster: cls.roster.map((s) => s.id === studentId ? { ...s, attendance: status } : s) }
          : cls
      )
    );
  };

  /* ── Prize ── */
  const handleAwardPoints = async () => {
    const ids = Object.keys(selectedForPrize).filter((id) => selectedForPrize[id]);
    if (!ids.length || !prizePoints || !prizeReason) return;
    setAwarding(true);
    const ok = await database.awardPrizePoints(ids, prizeReason, prizePoints);
    if (ok) { setPrizePoints(''); setPrizeReason(''); setSelectedForPrize({}); showToast('⭐ Points awarded!'); }
    setAwarding(false);
  };

  /* ── Complete session ── */
  const handleCompleteSession = async () => {
    if (!currentClass) return;
    const attendanceMap = {};
    roster.forEach((s) => { attendanceMap[s.id] = s.attendance || 'PENDING'; });
    setCompleteLoading(true);
    try {
      await database.saveAttendance(currentClass.sessionId, attendanceMap);
      if (classNotes || attachedFiles.length > 0) {
        await database.saveClassNotes(currentClass.sessionId, classNotes, attachedFiles, noteVisibility.join(','), recordingUrl);
      }
      showToast('✅ Session completed and saved!');
      setClassNotes('');
      if (editorRef.current) editorRef.current.innerHTML = '';
      setAttachedFiles([]);
      setRecordingUrl('');
      setSelectedForPrize({});
    } catch {
      showToast('⚠️ Saved locally (offline mode)');
    } finally {
      setCompleteLoading(false);
    }
  };

  /* ── Save notes ── */
  const handleSaveNotes = async () => {
    if (!classNotes && attachedFiles.length === 0) return;
    setSavingNotes(true);
    await database.saveClassNotes(currentClass?.sessionId || 'session', classNotes, attachedFiles, noteVisibility.join(','), recordingUrl);
    const updated = await database.fetchSessionHistory(currentClass?.sessionId || 'session');
    setSessionHistory(updated || []);
    setSavingNotes(false);
    showToast('✅ Materials published!');
    setClassNotes('');
    if (editorRef.current) editorRef.current.innerHTML = '';
    setAttachedFiles([]);
    setRecordingUrl('');
  };

  /* ── File handling ── */
  const handleFileChange = (e) => {
    const files = Array.from(e.target.files).map((f) => ({
      name: f.name, type: f.type, size: f.size, url: URL.createObjectURL(f),
    }));
    setAttachedFiles((prev) => [...prev, ...files]);
  };

  const toggleVisibility = (role) => {
    setNoteVisibility((prev) => {
      const next = prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role];
      return next.length === 0 ? ['me'] : next;
    });
  };

  /* ── Emergency ── */
  const emergencyButtons = [
    { type: 'LOCK DOWN',    label: 'Lock Down',    icon: <Siren size={16} />,       color: 'red',    cssClass: 'lockdown' },
    { type: 'MEDIC',        label: 'Medic',        icon: <HeartPulse size={16} />,  color: 'orange', cssClass: 'medic' },
    { type: 'STUDENT OUT',  label: 'Student Out',  icon: <DoorOpen size={16} />,    color: 'yellow', cssClass: 'student-out' },
    { type: 'CLASS SUPPORT',label: 'Class Support',icon: <HandHelping size={16} />, color: 'purple', cssClass: 'class-support' },
  ];

  const handleEmergencyConfirm = async () => {
    if (!emergencyModal) return;
    setEmergencySending(true);
    try {
      await api.post('/alerts', {
        alertType: emergencyModal.type,
        reason: emergencyModal.type === 'STUDENT OUT' && selectedStudentOut ? `Student: ${selectedStudentOut.name}` : undefined,
        studentId: emergencyModal.type === 'STUDENT OUT' && selectedStudentOut ? selectedStudentOut.id : undefined,
      });
      showToast(`✅ ${emergencyModal.label} alert sent!`);
    } catch {
      showToast('⚠️ Alert sent (offline mode)');
    } finally {
      setEmergencySending(false);
      setEmergencyModal(null);
    }
  };

  /* ── Per-student alert ── */
  const handleAlertTrigger = async (student, type) => {
    try {
      await api.post('/alerts', { studentId: student.id, alertType: type, reason: `${type} — from Teacher Portal` });
      showToast(`✅ ${type} alert sent for ${student.name}`);
    } catch {
      showToast('⚠️ Alert sent (offline mode)');
    }
    setAlertModal(null);
  };

  /* ── Announcements ── */
  const handleMarkRead = async (id) => {
    try { await api.post(`/announcements/${id}/read`); } catch { /* noop */ }
    setAnnouncements((prev) => prev.filter((a) => a.id !== id));
  };

  /* ── Behavior / Medical ── */
  const handleBehaviorSubmit = async (e) => {
    e.preventDefault();
    try { await api.post('/behavior', behaviorForm); showToast('✅ Behavior report submitted'); }
    catch { showToast('⚠️ Report saved locally'); }
    setBehaviorForm({ studentId: '', place: '', ruleBroken: '', type: 'WARNING', category: '', description: '', severity: 'MINOR' });
  };

  const handleMedicalSubmit = async (e) => {
    e.preventDefault();
    try { await api.post('/medical', medicalForm); showToast('✅ Medical report submitted'); }
    catch { showToast('⚠️ Report saved locally'); }
    setMedicalForm({ studentId: '', time: '', place: '', description: '', actionsTaken: '', sentHome: false });
  };

  /* ── History filter ── */
  const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const filteredHistory = sessionHistory.filter((h) =>
    historyFilter === 'all' || new Date(h.date) >= thirtyDaysAgo
  );

  /* ═══════════════════════════════════════════════════════════
     LOADING
  ═══════════════════════════════════════════════════════════ */
  if (loading) {
    return (
      <div className="teacher-portal">
        <div className="tp-skeleton">
          <div className="tp-skeleton-line" style={{ width: '60%', height: 40 }} />
          <div className="tp-skeleton-line" style={{ width: '100%', height: 60 }} />
          <div className="tp-skeleton-line" style={{ width: '100%', height: 200 }} />
          <div className="tp-skeleton-line" style={{ width: '80%', height: 18 }} />
        </div>
      </div>
    );
  }

  const tabs = [
    { key: 'session',  label: 'Session',      icon: <Users size={16} />,        badge: roster.length },
    { key: 'behavior', label: 'Behavior',      icon: <AlertTriangle size={16} /> },
    { key: 'medical',  label: 'Medical',       icon: <Stethoscope size={16} /> },
    { key: 'calendar', label: 'Calendar',      icon: <Calendar size={16} /> },
    { key: 'lesson',   label: 'Lesson Plans',  icon: <BookOpen size={16} /> },
  ];

  /* ═══════════════════════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════════════════════ */
  return (
    <div className="teacher-portal">

      {/* ── EMERGENCY STRIP ─────────────────────────────────── */}
      <div className="emergency-strip">
        <span className="emergency-strip-label"><ShieldAlert size={14} /> EMERGENCY</span>
        {emergencyButtons.map((btn) => (
          <button key={btn.type} className={`emergency-btn ${btn.cssClass}`}
            onClick={() => { setEmergencyModal(btn); setSelectedStudentOut(null); }}>
            {btn.icon} {btn.label}
          </button>
        ))}
      </div>

      {/* ── EMERGENCY MODAL ──────────────────────────────────── */}
      {emergencyModal && (
        <div className="emergency-modal-overlay" onClick={() => !emergencySending && setEmergencyModal(null)}>
          <div className="emergency-modal" onClick={(e) => e.stopPropagation()}>
            <div className="emergency-modal-icon" style={{
              background: emergencyModal.color === 'red' ? '#fee2e2' : emergencyModal.color === 'orange' ? '#ffedd5' : emergencyModal.color === 'yellow' ? '#fef9c3' : '#ede9fe',
            }}>
              {emergencyModal.type === 'LOCK DOWN'     && <Siren      size={28} color="#dc2626" />}
              {emergencyModal.type === 'MEDIC'         && <HeartPulse size={28} color="#ea580c" />}
              {emergencyModal.type === 'STUDENT OUT'   && <DoorOpen   size={28} color="#ca8a04" />}
              {emergencyModal.type === 'CLASS SUPPORT' && <HandHelping size={28} color="#7c3aed" />}
            </div>
            <h3>Confirm: {emergencyModal.label}</h3>
            <p>
              {emergencyModal.type === 'LOCK DOWN'     && 'This will send a silent alert (🐰) to ALL staff members immediately.'}
              {emergencyModal.type === 'MEDIC'         && 'This will notify the manager and front desk of a medical emergency.'}
              {emergencyModal.type === 'STUDENT OUT'   && 'Select the student who left the room.'}
              {emergencyModal.type === 'CLASS SUPPORT' && 'This will notify management that you need support in your classroom.'}
            </p>
            {emergencyModal.type === 'STUDENT OUT' && (
              <div className="student-roster-picker">
                {roster.map((s) => (
                  <div key={s.id} className={`roster-pick-item ${selectedStudentOut?.id === s.id ? 'selected' : ''}`}
                    onClick={() => setSelectedStudentOut(s)}>
                    <div className="roster-avatar">{s.name.split(' ').map((n) => n[0]).join('')}</div>
                    {s.name}
                    {selectedStudentOut?.id === s.id && <Check size={16} color="var(--primary)" style={{ marginLeft: 'auto' }} />}
                  </div>
                ))}
              </div>
            )}
            <div className="emergency-modal-actions">
              <button className="modal-btn-cancel" onClick={() => setEmergencyModal(null)} disabled={emergencySending}>Cancel</button>
              <button className={`modal-btn-confirm ${emergencyModal.color}`} onClick={handleEmergencyConfirm}
                disabled={emergencySending || (emergencyModal.type === 'STUDENT OUT' && !selectedStudentOut)}>
                {emergencySending ? 'Sending...' : 'Send Alert'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ANNOUNCEMENTS ────────────────────────────────────── */}
      <div className="announcements-section">
        {announcements.length > 0 ? (
          announcements.map((ann) => (
            <div key={ann.id} className="announcement-card">
              <div className="announcement-icon"><Megaphone size={18} /></div>
              <div className="announcement-content">
                <h4>{ann.title}</h4>
                <p>{ann.body}</p>
                <span className="announcement-meta">{ann.author?.fullName} · {new Date(ann.publishedAt).toLocaleDateString()}</span>
              </div>
              <button className="announcement-read-btn" onClick={() => handleMarkRead(ann.id)}>
                <Check size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} /> Mark Read
              </button>
            </div>
          ))
        ) : (
          <div className="no-announcements">
            <Megaphone size={20} style={{ marginBottom: 6, opacity: 0.4 }} /><br />
            No new announcements — you're all caught up! ✨
          </div>
        )}
      </div>

      {/* ── TABS ─────────────────────────────────────────────── */}
      <div className="tp-tabs">
        {tabs.map((tab) => (
          <button key={tab.key} className={`tp-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}>
            {tab.icon} {tab.label}
            {tab.badge && <span className="tp-tab-badge">{tab.badge}</span>}
          </button>
        ))}
      </div>

      {/* ── TAB CONTENT ──────────────────────────────────────── */}
      <div className="tp-tab-content">

        {/* ════════════════════════════════════════════
            SESSION TAB
        ════════════════════════════════════════════ */}
        {activeTab === 'session' && (
          <>
            {/* Class selector + Complete Session */}
            <div className="session-header-bar">
              <div className="roster-class-selector">
                {schedule.map((cls, idx) => (
                  <button key={cls.classId} className={`roster-class-pill ${idx === selectedClassIdx ? 'active' : ''}`}
                    onClick={() => { setSelectedClassIdx(idx); setSelectedForPrize({}); }}>
                    {cls.className}
                  </button>
                ))}
              </div>
              {currentClass && (
                <div className="session-header-right">
                  <span className="session-time-tag">
                    <Clock size={13} /> {fmtTime(currentClass.startTime)} — {fmtTime(currentClass.endTime)}
                  </span>
                  <button className="complete-session-btn" onClick={handleCompleteSession} disabled={completeLoading}>
                    {completeLoading ? 'Saving...' : '✓ Complete Session'}
                  </button>
                </div>
              )}
            </div>

            {/* Prize bar */}
            <div className="prize-quick-bar">
              <div className="prize-bar-content">
                <div className="prize-indicator">
                  <Star fill="#fbbf24" size={18} color="#fbbf24" />
                  <span>Award Points ({selectedCount} selected)</span>
                </div>
                <div className="prize-bar-inputs">
                  <input type="text" placeholder="Reason..." value={prizeReason}
                    onChange={(e) => setPrizeReason(e.target.value)} className="prize-input-mini" />
                  <input type="number" placeholder="Pts" value={prizePoints}
                    onChange={(e) => setPrizePoints(e.target.value)} className="prize-input-mini points-mini" />
                  <button className="prize-award-btn" onClick={handleAwardPoints}
                    disabled={awarding || selectedCount === 0 || !prizePoints || !prizeReason}>
                    Apply
                  </button>
                </div>
              </div>
            </div>

            {/* Roster table */}
            <div className="roster-table-wrap">
              <table className="roster-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Symbols</th>
                    <th>Seashells</th>
                    <th>Points</th>
                    <th>Attendance</th>
                    <th style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <span style={{ fontSize: 9, textTransform: 'uppercase', color: '#64748b' }}>Prize</span>
                        <input type="checkbox" className="custom-checkbox"
                          checked={roster.length > 0 && roster.every((s) => selectedForPrize[s.id])}
                          onChange={(e) => {
                            const sel = {};
                            roster.forEach((s) => { sel[s.id] = e.target.checked; });
                            setSelectedForPrize(sel);
                          }} />
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((student) => (
                    <tr key={student.id} className={`attendance-row ${selectedForPrize[student.id] ? 'selected-row' : ''}`}>
                      <td>
                        <div className="roster-student-name">
                          <div className="roster-avatar">{student.name.split(' ').map((n) => n[0]).join('')}</div>
                          <div>
                            <div>{student.name}</div>
                            {/* Quick action icons */}
                            <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                              <button title="Send Alert" onClick={() => setAlertModal(student)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#eab308', padding: 2, display: 'flex', alignItems: 'center' }}>
                                <AlertTriangle size={13} />
                              </button>
                              {student.allergies && (
                                <div style={{ position: 'relative' }}>
                                  <button title="View Allergies" onClick={() => setVisibleAllergy(visibleAllergy === student.id ? null : student.id)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 2, display: 'flex', alignItems: 'center' }}>
                                    <HeartPulse size={13} />
                                  </button>
                                  {visibleAllergy === student.id && (
                                    <div className="allergy-popover">
                                      <strong>Allergies:</strong> {typeof student.allergies === 'string' ? student.allergies : 'Has allergy — see profile'}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="roster-symbols">
                          {student.allergies      && <span className="roster-symbol allergy"       title="Has Allergies">⚠️</span>}
                          {student.accommodation  && <span className="roster-symbol accommodation" title="Accommodation Notes">♿</span>}
                          {student.noPhoto        && <span className="roster-symbol no-photo"      title="No Photo Policy">📷</span>}
                          {student.upcomingBirthday && <span className="roster-symbol birthday"    title="Upcoming Birthday!">🎂</span>}
                        </div>
                      </td>
                      <td>
                        <div className="roster-seashells"><Shell size={13} /> {student.seashells}</div>
                      </td>
                      <td>
                        <div className="points-badge"><Star size={13} fill="#fbbf24" color="#fbbf24" /> {student.prizePoints || 0}</div>
                      </td>
                      <td>
                        <div className="attendance-toggle">
                          <button className={`att-btn ${student.attendance === 'PRESENT' ? 'present' : ''}`}
                            onClick={() => handleAttendance(student.id, 'PRESENT')} title="Present">✓</button>
                          <button className={`att-btn ${student.attendance === 'ABSENT' ? 'absent' : ''}`}
                            onClick={() => handleAttendance(student.id, 'ABSENT')} title="Absent">✗</button>
                          <button className={`att-btn ${student.attendance === 'LATE' ? 'late' : ''}`}
                            onClick={() => handleAttendance(student.id, 'LATE')} title="Late">
                            <Clock size={13} />
                          </button>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input type="checkbox" className="custom-checkbox"
                          checked={!!selectedForPrize[student.id]}
                          onChange={() => setSelectedForPrize((prev) => ({ ...prev, [student.id]: !prev[student.id] }))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Class Continuity History ── */}
            <div className="session-history-panel">
              <div className="history-header">
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 15 }}>
                  <History size={18} color="#64748b" /> Class Continuity
                </h3>
                <div className="custom-filter-wrapper" ref={filterRef}>
                  <button className="history-filter-btn" onClick={() => setIsFilterOpen(!isFilterOpen)}>
                    {historyFilter === '30days' ? 'Last 30 Days' : 'All Time'} <ChevronDown size={14} />
                  </button>
                  {isFilterOpen && (
                    <div className="custom-filter-menu">
                      <div className={`filter-option ${historyFilter === '30days' ? 'active' : ''}`}
                        onClick={() => { setHistoryFilter('30days'); setIsFilterOpen(false); }}>Last 30 Days</div>
                      <div className={`filter-option ${historyFilter === 'all' ? 'active' : ''}`}
                        onClick={() => { setHistoryFilter('all'); setIsFilterOpen(false); }}>All Time</div>
                    </div>
                  )}
                </div>
              </div>
              <div className="history-body">
                {loadingHistory ? (
                  <div className="history-loading">Loading past notes...</div>
                ) : filteredHistory.length > 0 ? (
                  <div className="history-timeline">
                    {filteredHistory.map((hist) => (
                      <div key={hist.sessionId} className="history-item">
                        <div className="history-date">
                          <strong>{new Date(hist.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</strong>
                          <div className="visibility-badge">
                            {(hist.visibility === 'teacher' || hist.visibility === 'me') && <EyeOff size={12} />}
                            {hist.visibility?.includes('students_parents') && <Users size={12} />}
                            {hist.visibility === 'all' && <Eye size={12} />}
                          </div>
                        </div>
                        <div className="history-content">
                          <div className="history-formatted-notes">
                            {hist.notes?.length > 200 && !expandedNotes[hist.sessionId]
                              ? <div dangerouslySetInnerHTML={{ __html: `${hist.notes.substring(0, 200)}...` }} />
                              : <div dangerouslySetInnerHTML={{ __html: hist.notes }} />}
                          </div>
                          {hist.notes?.length > 200 && (
                            <button className="read-more-btn"
                              onClick={() => setExpandedNotes((p) => ({ ...p, [hist.sessionId]: !p[hist.sessionId] }))}>
                              {expandedNotes[hist.sessionId] ? 'Show less' : 'Read more'}
                            </button>
                          )}
                          {hist.materials?.length > 0 && (
                            <div className="history-materials">
                              {hist.materials.map((m, i) => (
                                <button key={i} className="hist-mat-chip previewable" onClick={() => setPreviewFile(m)} title="Preview">
                                  <Paperclip size={10} /> {m.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="history-empty">No previous session notes found for this class.</div>
                )}
              </div>
            </div>

            {/* ── Session Notes & Materials ── */}
            <div className="session-resources-panel">
              <div className="resources-header">
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={20} color="#3b82f6" /> Session Notes & Materials
                </h3>
                <span className="text-muted" style={{ fontSize: 12 }}>Publish notes and files for this class</span>
              </div>
              <div className="resources-body">
                {/* Recording link */}
                <div style={{ marginBottom: 16 }}>
                  <div className="recording-input-wrapper" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, background: '#f0f9ff', padding: '10px 14px', borderRadius: 10, border: '1px dashed #7dd3fc' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 200px' }}>
                      <Video size={18} color="#0284c7" />
                      <input type="url" placeholder="Paste recording link (Zoom, Drive…)"
                        style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 13, color: '#0369a1', minWidth: 0 }}
                        value={recordingUrl} onChange={(e) => setRecordingUrl(e.target.value)} />
                    </div>
                    <div style={{ width: 1, height: 20, background: '#bae6fd' }} />
                    <input type="file" ref={videoInputRef} style={{ display: 'none' }} onChange={handleFileChange} accept=".mp4,.mov,.webm" />
                    <button type="button" className="upload-recording-btn" onClick={() => videoInputRef.current.click()}>
                      <Paperclip size={14} /> Upload Video
                    </button>
                  </div>
                </div>

                {/* Rich text editor */}
                <div className="notes-editor-container">
                  <div className="rich-toolbar">
                    <button type="button" className={`toolbar-btn ${activeFormats.bold ? 'active' : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); document.execCommand('bold'); }}>
                      <Bold size={16} />
                    </button>
                    <button type="button" className={`toolbar-btn ${activeFormats.italic ? 'active' : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); document.execCommand('italic'); }}>
                      <Italic size={16} />
                    </button>
                    <button type="button" className={`toolbar-btn ${activeFormats.underline ? 'active' : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); document.execCommand('underline'); }}>
                      <Underline size={16} />
                    </button>
                    <div className="toolbar-divider" />
                    <div className="custom-filter-wrapper" ref={sizeDropdownRef}>
                      <button type="button" className="toolbar-btn text-dropdown"
                        onClick={() => setIsSizeDropdownOpen(!isSizeDropdownOpen)}
                        style={{ width: 'auto', padding: '0 8px', gap: 4 }}>
                        Size <ChevronDown size={14} />
                      </button>
                      {isSizeDropdownOpen && (
                        <div className="custom-filter-menu" style={{ width: 120, left: 0, right: 'auto', top: 'calc(100% + 4px)', zIndex: 10 }}>
                          {[['2','Small'],['3','Normal'],['5','Large']].map(([val, label]) => (
                            <div key={val} className={`filter-option ${activeFormats.fontSize === val ? 'active' : ''}`}
                              onMouseDown={(e) => { e.preventDefault(); document.execCommand('fontSize', false, val); setIsSizeDropdownOpen(false); }}>
                              {label}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="toolbar-divider" />
                    <button type="button" className="toolbar-btn"
                      onMouseDown={(e) => { e.preventDefault(); document.execCommand('insertUnorderedList'); }}>
                      <List size={16} />
                    </button>
                    <div className="custom-filter-wrapper" ref={linkDropdownRef}>
                      <button type="button" className={`toolbar-btn ${isLinkInputOpen ? 'active' : ''}`}
                        onClick={() => {
                          if (!isLinkInputOpen) {
                            const sel = window.getSelection();
                            if (sel?.rangeCount > 0) setSavedRange(sel.getRangeAt(0));
                            setIsLinkInputOpen(true); setLinkUrl('');
                          } else setIsLinkInputOpen(false);
                        }}>
                        <Link2 size={16} />
                      </button>
                      {isLinkInputOpen && (
                        <div className="custom-filter-menu" style={{ width: 280, left: 'auto', right: 0, top: 'calc(100% + 4px)', zIndex: 10, padding: 12, display: 'flex', gap: 8 }}
                          onClick={(e) => e.stopPropagation()}>
                          <input type="url" placeholder="https://…" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} autoFocus
                            style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13, outline: 'none' }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                if (savedRange) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRange); }
                                if (linkUrl) document.execCommand('createLink', false, linkUrl);
                                setIsLinkInputOpen(false);
                              }
                            }} />
                          <button type="button" className="action-btn primary" style={{ padding: '6px 12px', fontSize: 12 }}
                            onClick={() => {
                              if (savedRange) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRange); }
                              if (linkUrl) document.execCommand('createLink', false, linkUrl);
                              setIsLinkInputOpen(false);
                            }}>
                            Add
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div ref={editorRef} className="rich-editor-area" contentEditable
                    onInput={(e) => setClassNotes(e.currentTarget.innerHTML)}
                    data-placeholder="Write key concepts, homework, or important links…" />
                </div>

                {/* Attachments */}
                {attachedFiles.length > 0 && (
                  <div className="attachments-list">
                    {attachedFiles.map((file, idx) => (
                      <div key={idx} className="attachment-chip">
                        {file.type.includes('image') ? <Image size={14} /> : <Paperclip size={14} />}
                        <span className="file-name">{file.name}</span>
                        <button className="remove-file-btn" onClick={() => setAttachedFiles((p) => p.filter((_, i) => i !== idx))}>
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="resources-footer">
                  <div className="upload-buttons">
                    <input type="file" ref={fileInputRef} style={{ display: 'none' }} multiple onChange={handleFileChange}
                      accept="image/*,.pdf,.doc,.docx,.xlsx,.mp4,.mov,.webm" />
                    <button type="button" className="upload-recording-btn" style={{ background: '#f8fafc', color: '#64748b', borderColor: '#e2e8f0' }}
                      onClick={() => fileInputRef.current.click()}>
                      <Image size={16} /> Images
                    </button>
                    <button type="button" className="upload-recording-btn" style={{ background: '#f8fafc', color: '#64748b', borderColor: '#e2e8f0' }}
                      onClick={() => fileInputRef.current.click()}>
                      <Paperclip size={16} /> Files
                    </button>
                  </div>

                  <div className="visibility-toggles-container">
                    <span className="vis-label"><ShieldCheck size={14} /> Visible to:</span>
                    <div className="vis-toggles">
                      <button className={`vis-toggle-btn ${noteVisibility.includes('students_parents') ? 'active' : ''}`}
                        onClick={() => toggleVisibility('students_parents')}>Students & Parents</button>
                      <button className={`vis-toggle-btn ${noteVisibility.includes('me') ? 'active' : ''}`}
                        onClick={() => toggleVisibility('me')}>Me only</button>
                    </div>
                  </div>

                  <button className="action-btn primary" onClick={handleSaveNotes}
                    disabled={savingNotes || (!classNotes && attachedFiles.length === 0)}>
                    <Check size={16} /> {savingNotes ? 'Publishing…' : 'Publish Materials'}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ════════════════════════════════════════════
            BEHAVIOR TAB
        ════════════════════════════════════════════ */}
        {activeTab === 'behavior' && (
          <div className="tp-glass-card">
            <div className="tp-section-header"><h2>📝 Behavior Incident Report</h2></div>
            <form onSubmit={handleBehaviorSubmit}>
              <div className="behavior-form-grid">
                <div className="tp-form-group">
                  <label>Student</label>
                  <select value={behaviorForm.studentId} onChange={(e) => setBehaviorForm({ ...behaviorForm, studentId: e.target.value })} required>
                    <option value="">Select student…</option>
                    {allStudents.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="tp-form-group">
                  <label>Type</label>
                  <select value={behaviorForm.type} onChange={(e) => setBehaviorForm({ ...behaviorForm, type: e.target.value })}>
                    <option value="WARNING">Warning</option>
                    <option value="SLIP">Slip</option>
                    <option value="POSITIVE">Positive</option>
                  </select>
                </div>
                <div className="tp-form-group">
                  <label>Place</label>
                  <input type="text" placeholder="e.g. Classroom, Playground" value={behaviorForm.place}
                    onChange={(e) => setBehaviorForm({ ...behaviorForm, place: e.target.value })} />
                </div>
                <div className="tp-form-group">
                  <label>Category</label>
                  <select value={behaviorForm.category} onChange={(e) => setBehaviorForm({ ...behaviorForm, category: e.target.value })} required>
                    <option value="">Select category…</option>
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
                  <input type="text" placeholder="Which rule was broken?" value={behaviorForm.ruleBroken}
                    onChange={(e) => setBehaviorForm({ ...behaviorForm, ruleBroken: e.target.value })} />
                </div>
                <div className="tp-form-group">
                  <label>Severity</label>
                  <select value={behaviorForm.severity} onChange={(e) => setBehaviorForm({ ...behaviorForm, severity: e.target.value })}>
                    <option value="MINOR">Minor</option>
                    <option value="MODERATE">Moderate</option>
                    <option value="SEVERE">Severe</option>
                  </select>
                </div>
                <div className="tp-form-group full-width">
                  <label>Description</label>
                  <textarea placeholder="Describe the incident in detail…" value={behaviorForm.description}
                    onChange={(e) => setBehaviorForm({ ...behaviorForm, description: e.target.value })} required />
                </div>
              </div>
              <button type="submit" className="tp-submit-btn">Submit Behavior Report</button>
            </form>
          </div>
        )}

        {/* ════════════════════════════════════════════
            MEDICAL TAB
        ════════════════════════════════════════════ */}
        {activeTab === 'medical' && (
          <div className="tp-glass-card">
            <div className="tp-section-header"><h2>🩺 Medical Incident Report</h2></div>
            <form onSubmit={handleMedicalSubmit}>
              <div className="behavior-form-grid">
                <div className="tp-form-group">
                  <label>Student</label>
                  <select value={medicalForm.studentId} onChange={(e) => setMedicalForm({ ...medicalForm, studentId: e.target.value })} required>
                    <option value="">Select student…</option>
                    {allStudents.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="tp-form-group">
                  <label>Time of Incident</label>
                  <input type="datetime-local" value={medicalForm.time}
                    onChange={(e) => setMedicalForm({ ...medicalForm, time: e.target.value })} required />
                </div>
                <div className="tp-form-group">
                  <label>Place</label>
                  <input type="text" placeholder="e.g. Classroom, Cafeteria" value={medicalForm.place}
                    onChange={(e) => setMedicalForm({ ...medicalForm, place: e.target.value })} required />
                </div>
                <div className="tp-form-group">
                  <label>Sent Home?</label>
                  <select value={medicalForm.sentHome ? 'yes' : 'no'}
                    onChange={(e) => setMedicalForm({ ...medicalForm, sentHome: e.target.value === 'yes' })}>
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </div>
                <div className="tp-form-group full-width">
                  <label>Description</label>
                  <textarea placeholder="Describe the medical incident…" value={medicalForm.description}
                    onChange={(e) => setMedicalForm({ ...medicalForm, description: e.target.value })} required />
                </div>
                <div className="tp-form-group full-width">
                  <label>Actions Taken</label>
                  <textarea placeholder="What first aid or actions were taken?" value={medicalForm.actionsTaken}
                    onChange={(e) => setMedicalForm({ ...medicalForm, actionsTaken: e.target.value })} required />
                </div>
              </div>
              <button type="submit" className="tp-submit-btn">Submit Medical Report</button>
            </form>
          </div>
        )}

        {/* ════════════════════════════════════════════
            CALENDAR TAB
        ════════════════════════════════════════════ */}
        {activeTab === 'calendar' && (
          <div className="tp-glass-card">
            <div className="tp-section-header"><h2>📅 Today's Schedule</h2></div>
            <div className="compact-list" style={{ gap: 14 }}>
              {schedule.map((cls) => (
                <div key={cls.classId} className="list-item" style={{ borderRadius: 14 }}>
                  <div className="item-main">
                    <div className="item-icon" style={{ background: '#dcfce7', color: '#16a34a' }}><Calendar size={18} /></div>
                    <div className="item-text">
                      <h4>{cls.className}</h4>
                      <p>{cls.roster.length} students</p>
                    </div>
                  </div>
                  <div className="item-side">
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--primary)' }}>
                      {fmtTime(cls.startTime)} — {fmtTime(cls.endTime)}
                    </div>
                  </div>
                </div>
              ))}
              {schedule.length === 0 && <div className="no-announcements">No classes scheduled for today 🌊</div>}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════
            LESSON PLANS TAB
        ════════════════════════════════════════════ */}
        {activeTab === 'lesson' && (
          <div className="tp-glass-card">
            <div className="tp-section-header">
              <h2>📚 Lesson Plans</h2>
              <button className="tp-submit-btn" style={{ margin: 0, padding: '8px 18px', fontSize: 13 }}>+ New Plan</button>
            </div>
            <div className="no-announcements">
              <BookOpen size={20} style={{ marginBottom: 6, opacity: 0.4 }} /><br />
              Upload lesson plans coming soon!
            </div>
          </div>
        )}

      </div>{/* end tp-tab-content */}

      {/* ── PER-STUDENT ALERT MODAL ──────────────────────────── */}
      {alertModal && (
        <div className="emergency-modal-overlay" onClick={() => setAlertModal(null)}>
          <div className="emergency-modal" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center' }}>
            <div className="emergency-modal-icon" style={{ background: '#fef9c3' }}>
              <AlertTriangle size={28} color="#ca8a04" />
            </div>
            <h3>Send Alert for {alertModal.name}</h3>
            <p>Select the type of front-desk alert to send immediately.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
              <button style={{ background: '#fef08a', color: '#ca8a04', border: '2px solid #fde047', padding: '14px', borderRadius: 12, fontSize: 16, fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer', width: '100%' }}
                onClick={() => handleAlertTrigger(alertModal, 'Student out')}>
                <LogOut size={22} /> Student Out
              </button>
              <button style={{ background: '#ffedd5', color: '#c2410c', border: '2px solid #fdba74', padding: '14px', borderRadius: 12, fontSize: 16, fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer', width: '100%' }}
                onClick={() => handleAlertTrigger(alertModal, 'Class support')}>
                <LifeBuoy size={22} /> Class Support
              </button>
              <button style={{ background: '#fee2e2', color: '#b91c1c', border: '2px solid #fca5a5', padding: '14px', borderRadius: 12, fontSize: 16, fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer', width: '100%' }}
                onClick={() => handleAlertTrigger(alertModal, 'Medic')}>
                <AlertCircle size={22} /> Medical
              </button>
            </div>
            <button style={{ marginTop: 24, background: 'none', border: 'none', color: '#64748b', fontSize: 15, cursor: 'pointer', fontWeight: 600 }}
              onClick={() => setAlertModal(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── FILE PREVIEW MODAL ───────────────────────────────── */}
      {previewFile && (
        <div className="preview-modal-overlay" onClick={() => setPreviewFile(null)}>
          <div className="preview-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="preview-header">
              <div className="preview-title">
                {previewFile.type?.includes('image') ? <Image size={18} /> :
                 previewFile.type?.includes('video') ? <Video size={18} /> : <FileText size={18} />}
                <span>{previewFile.name}</span>
              </div>
              <div className="preview-actions">
                {previewFile.url && (
                  <a href={previewFile.url} download={previewFile.name} className="preview-btn-action download" title="Download">
                    <Download size={18} />
                  </a>
                )}
                <button className="preview-btn-action close" onClick={() => setPreviewFile(null)}><X size={20} /></button>
              </div>
            </div>
            <div className="preview-body">
              {(() => {
                const isImage = previewFile.type?.includes('image');
                const isVideo = previewFile.type?.includes('video') || ['.mp4','.mov','.webm'].some((e) => previewFile.name.toLowerCase().endsWith(e));
                const isPdf   = previewFile.type === 'application/pdf' || previewFile.name.toLowerCase().endsWith('.pdf');
                const isLocal = previewFile.url?.startsWith('blob:');
                if (isImage) return <img src={previewFile.url} alt="Preview" className="preview-image" />;
                if (isVideo) return (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a' }}>
                    <video src={previewFile.url} controls autoPlay style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8 }} />
                  </div>
                );
                if (isPdf || !isLocal) {
                  const src = isLocal ? previewFile.url : `https://docs.google.com/viewer?url=${encodeURIComponent(previewFile.url)}&embedded=true`;
                  return <iframe src={src} title="Document Preview" className="preview-iframe" width="100%" height="100%" />;
                }
                const ext = previewFile.name.split('.').pop().toUpperCase();
                return (
                  <div style={{ width: '100%', height: '100%', padding: 40, overflowY: 'auto', background: 'white' }}>
                    {officeProcessing ? (
                      <div className="document-preview-placeholder">
                        <FileText size={64} color="#e2e8f0" /><p>Processing {ext} Document…</p>
                        <div className="mock-text-skeleton">
                          <div className="skel-line" /><div className="skel-line" /><div className="skel-line half" />
                        </div>
                      </div>
                    ) : officePreviewHtml ? (
                      <div className="office-html-canvas" dangerouslySetInnerHTML={{ __html: officePreviewHtml }}
                        style={{ fontSize: 14, color: '#334155', lineHeight: 1.6 }} />
                    ) : (
                      <div className="document-preview-placeholder"><FileText size={64} color="#e2e8f0" /><p>Preview unsupported</p></div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── TOAST ────────────────────────────────────────────── */}
      {toast && (
        <div className="tp-toast"><CheckCircle2 size={18} /> {toast}</div>
      )}

    </div>
  );
};

export default TeacherPortal;
