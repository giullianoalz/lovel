import React, { useState, useEffect, useCallback } from 'react';
import {
  BookOpenCheck, Filter, Download, ChevronDown, ChevronRight,
  FileText, Paperclip, Video, Eye, EyeOff, Users, Clock,
  Calendar, Search, User, CheckCircle, XCircle, AlertCircle, Ban,
} from 'lucide-react';
import api from '../../lib/api';
import './SupervisionPanel.css';

const SupervisionPanel = () => {
  const [sessions, setSessions] = useState([]);
  const [classes, setClasses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /* Filters */
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedTeacher, setSelectedTeacher] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchText, setSearchText] = useState('');

  /* UI state */
  const [expandedSessions, setExpandedSessions] = useState({});
  const [generatingPdf, setGeneratingPdf] = useState(null);

  /* Cancellation */
  const [cancelTarget, setCancelTarget] = useState(null); // { sessionId, studentId, studentName, className }
  const [cancelReason, setCancelReason] = useState('');
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedClass) params.set('classId', selectedClass);
      if (selectedTeacher) params.set('teacherId', selectedTeacher);
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
      const res = await api.get(`/sessions/supervision?${params}`);
      setSessions(res.data.sessions || []);
      setClasses(res.data.classes || []);
      setTeachers(res.data.teachers || []);
    } catch (err) {
      setError('Error loading supervision data.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedClass, selectedTeacher, dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleSession = (id) =>
    setExpandedSessions(p => ({ ...p, [id]: !p[id] }));

  /* Group sessions by class */
  const sessionsByClass = {};
  sessions.forEach(s => {
    const key = s.class?.id || 'unknown';
    if (!sessionsByClass[key]) sessionsByClass[key] = { class: s.class, sessions: [] };
    sessionsByClass[key].sessions.push(s);
  });

  /* Filter by search text */
  const filteredGroups = Object.values(sessionsByClass).filter(g => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return g.class?.name?.toLowerCase().includes(q) ||
      g.sessions.some(s =>
        s.notes?.some(n => n.notes?.toLowerCase().includes(q)) ||
        s.materials?.some(m => m.name?.toLowerCase().includes(q))
      );
  });

  const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const attendanceSummary = (att) => {
    const present = att?.filter(a => a.status === 'PRESENT').length || 0;
    const absent = att?.filter(a => a.status === 'ABSENT').length || 0;
    const late = att?.filter(a => a.status === 'LATE').length || 0;
    return { present, absent, late, total: att?.length || 0 };
  };

  // Enrolled students don't get an attendance row until the teacher marks it
  // (or a cancellation excuses them) — merge the class roster with whatever
  // attendance already exists so upcoming sessions still show who to cancel.
  const rosterFor = (session) => {
    const cls = classes.find(c => c.id === session.class?.id);
    const attendanceByStudent = new Map((session.attendance || []).map(a => [a.studentId, a]));
    const enrolled = cls?.enrollments?.map(e => e.student) || [];
    return enrolled.map(s => ({
      id: s.id,
      fullName: s.fullName,
      status: attendanceByStudent.get(s.id)?.status || null,
    }));
  };

  const openCancelModal = (session, student) => {
    setCancelReason('');
    setCancelTarget({
      sessionId: session.id,
      studentId: student.id,
      studentName: student.fullName,
      className: session.class?.name,
    });
  };

  const handleConfirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelSubmitting(true);
    try {
      const { autoResolved } = await api
        .post(`/sessions/${cancelTarget.sessionId}/cancel-student`, {
          studentId: cancelTarget.studentId,
          reason: cancelReason || null,
        })
        .then(r => r.data);
      setActionMessage(
        autoResolved
          ? `${cancelTarget.studentName}'s cancellation was free (48h+ notice) — no charge.`
          : `${cancelTarget.studentName}'s cancellation is under 48h — sent to the admin to decide the charge.`
      );
      setCancelTarget(null);
      await fetchData();
    } catch (err) {
      console.error('Error cancelling session for student:', err);
      setActionMessage('Could not cancel this session — please try again.');
    } finally {
      setCancelSubmitting(false);
      setTimeout(() => setActionMessage(null), 6000);
    }
  };

  const handleDownloadPdf = async (classGroup) => {
    const classId = classGroup.class?.id;
    setGeneratingPdf(classId);
    try {
      const printWindow = window.open('', '_blank');
      const html = buildPdfHtml(classGroup);
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.onload = () => {
        printWindow.print();
      };
    } catch (err) {
      console.error('PDF generation error:', err);
    } finally {
      setGeneratingPdf(null);
    }
  };

  const buildPdfHtml = (classGroup) => {
    const sessionsHtml = classGroup.sessions.map(s => {
      const att = attendanceSummary(s.attendance);
      const notesHtml = s.notes?.map(n => `
        <div style="margin: 8px 0; padding: 10px; background: #f8fafc; border-radius: 6px; border-left: 3px solid #3b82f6;">
          <div style="font-size: 11px; color: #64748b; margin-bottom: 4px;">
            ${n.visibility === 'me' || n.visibility === 'teacher' ? '🔒 Teacher only' : '👁 Visible to all'}
          </div>
          <div>${n.notes || '<em>No notes</em>'}</div>
        </div>
      `).join('') || '<p style="color:#94a3b8;font-style:italic;">No notes recorded.</p>';

      const materialsHtml = s.materials?.length > 0
        ? s.materials.map(m => `<span style="display:inline-block;margin:3px 6px 3px 0;padding:3px 8px;background:#e0f2fe;border-radius:12px;font-size:12px;">📎 ${m.name}</span>`).join('')
        : '';

      const attendanceHtml = s.attendance?.length > 0
        ? `<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px;">
            <tr style="background:#f1f5f9;"><th style="text-align:left;padding:6px;">Student</th><th style="text-align:center;padding:6px;">Status</th></tr>
            ${s.attendance.map(a => `<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:6px;">${a.student?.fullName || 'Unknown'}</td><td style="text-align:center;padding:6px;">${a.status === 'PRESENT' ? '✓' : a.status === 'ABSENT' ? '✗' : '⏰'} ${a.status}</td></tr>`).join('')}
           </table>`
        : '';

      return `
        <div style="page-break-inside:avoid;margin-bottom:20px;padding:16px;border:1px solid #e2e8f0;border-radius:8px;">
          <h3 style="margin:0 0 8px;font-size:15px;color:#1e293b;">
            ${fmtDate(s.date)} &nbsp;·&nbsp; ${fmtTime(s.startTime)} – ${fmtTime(s.endTime)}
            <span style="float:right;font-size:12px;padding:2px 8px;border-radius:12px;background:${s.status === 'COMPLETED' ? '#dcfce7;color:#16a34a' : '#fef3c7;color:#d97706'}">${s.status}</span>
          </h3>
          <div style="display:flex;gap:16px;font-size:12px;color:#64748b;margin-bottom:10px;">
            <span>✓ ${att.present} present</span><span>✗ ${att.absent} absent</span><span>⏰ ${att.late} late</span>
          </div>
          <h4 style="margin:12px 0 6px;font-size:13px;color:#475569;">Session Notes</h4>
          ${notesHtml}
          ${materialsHtml ? `<h4 style="margin:12px 0 6px;font-size:13px;color:#475569;">Materials</h4>${materialsHtml}` : ''}
          ${attendanceHtml ? `<h4 style="margin:12px 0 6px;font-size:13px;color:#475569;">Attendance Detail</h4>${attendanceHtml}` : ''}
        </div>
      `;
    }).join('');

    return `<!DOCTYPE html><html><head><title>${classGroup.class?.name || 'Class'} — Session Report</title>
      <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:40px;color:#1e293b;max-width:800px;margin:0 auto;}
      @media print{body{padding:20px;}}</style></head><body>
      <div style="text-align:center;margin-bottom:30px;">
        <h1 style="margin:0;font-size:22px;color:#166534;">Love Learning Academy</h1>
        <h2 style="margin:6px 0;font-size:18px;color:#334155;">${classGroup.class?.name || 'Class'}</h2>
        <p style="color:#64748b;font-size:13px;">Session History Report — Generated ${new Date().toLocaleDateString()}</p>
      </div>
      ${sessionsHtml}
      <div style="text-align:center;margin-top:30px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;">
        Academy Management System — Confidential
      </div>
    </body></html>`;
  };

  return (
    <div className="supervision-panel">
      <div className="supervision-header">
        <div className="supervision-title">
          <BookOpenCheck size={28} />
          <div>
            <h1>Academic Supervision</h1>
            <p>Review session notes, materials, and attendance across all classes.</p>
          </div>
        </div>
      </div>

      {actionMessage && <div className="supervision-action-message">{actionMessage}</div>}

      {/* Filters */}
      <div className="supervision-filters">
        <div className="filter-group">
          <label><User size={14} /> Teacher</label>
          <select value={selectedTeacher} onChange={e => setSelectedTeacher(e.target.value)}>
            <option value="">All Teachers</option>
            {teachers.map(t => <option key={t.id} value={t.id}>{t.fullName}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label><BookOpenCheck size={14} /> Class</label>
          <select value={selectedClass} onChange={e => setSelectedClass(e.target.value)}>
            <option value="">All Classes</option>
            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label><Calendar size={14} /> From</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div className="filter-group">
          <label><Calendar size={14} /> To</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        <div className="filter-group search-group">
          <label><Search size={14} /> Search</label>
          <input type="text" placeholder="Search notes, materials..." value={searchText} onChange={e => setSearchText(e.target.value)} />
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="supervision-loading">Loading supervision data...</div>
      ) : error ? (
        <div className="supervision-error">{error}</div>
      ) : filteredGroups.length === 0 ? (
        <div className="supervision-empty">
          <BookOpenCheck size={40} strokeWidth={1.2} />
          <h3>No sessions found</h3>
          <p>Adjust the filters or date range to find session records.</p>
        </div>
      ) : (
        <div className="supervision-classes">
          {filteredGroups.map(group => {
            const teacher = classes.find(c => c.id === group.class?.id)?.teacher;
            const totalSessions = group.sessions.length;
            const withNotes = group.sessions.filter(s => s.notes?.length > 0).length;

            return (
              <div key={group.class?.id} className="supervision-class-card">
                <div className="class-card-header">
                  <div className="class-card-info">
                    <h2>{group.class?.name}</h2>
                    <div className="class-card-meta">
                      {teacher && <span><User size={13} /> {teacher.fullName}</span>}
                      <span><FileText size={13} /> {totalSessions} sessions</span>
                      <span><Eye size={13} /> {withNotes} with notes</span>
                    </div>
                  </div>
                  <button
                    className="pdf-download-btn"
                    onClick={() => handleDownloadPdf(group)}
                    disabled={generatingPdf === group.class?.id}
                  >
                    <Download size={15} />
                    {generatingPdf === group.class?.id ? 'Generating...' : 'Download PDF'}
                  </button>
                </div>

                <div className="session-list">
                  {group.sessions.map(session => {
                    const isOpen = expandedSessions[session.id];
                    const att = attendanceSummary(session.attendance);
                    const hasNotes = session.notes?.length > 0;
                    const hasMaterials = session.materials?.length > 0;
                    const roster = rosterFor(session);
                    const canCancel = session.status === 'SCHEDULED';

                    return (
                      <div key={session.id} className={`session-card ${isOpen ? 'open' : ''}`}>
                        <button className="session-card-toggle" onClick={() => toggleSession(session.id)}>
                          <div className="session-card-left">
                            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            <span className="session-date">{fmtDate(session.date)}</span>
                            <span className="session-time">{fmtTime(session.startTime)} – {fmtTime(session.endTime)}</span>
                            <span className={`session-status-badge ${session.status.toLowerCase()}`}>{session.status}</span>
                          </div>
                          <div className="session-card-right">
                            {hasNotes && <span className="session-indicator notes-ind" title="Has notes"><FileText size={13} /></span>}
                            {hasMaterials && <span className="session-indicator materials-ind" title="Has materials"><Paperclip size={13} /></span>}
                            <span className="att-summary">
                              <CheckCircle size={12} className="att-present" /> {att.present}
                              <XCircle size={12} className="att-absent" /> {att.absent}
                              {att.late > 0 && <><AlertCircle size={12} className="att-late" /> {att.late}</>}
                            </span>
                          </div>
                        </button>

                        {isOpen && (
                          <div className="session-card-body">
                            {/* Notes */}
                            <div className="session-detail-section">
                              <h4><FileText size={15} /> Session Notes</h4>
                              {hasNotes ? session.notes.map(note => (
                                <div key={note.id} className="supervision-note">
                                  <div className="note-visibility">
                                    {note.visibility === 'me' || note.visibility === 'teacher'
                                      ? <><EyeOff size={12} /> Teacher only</>
                                      : <><Eye size={12} /> Visible to all</>}
                                  </div>
                                  <div className="note-content" dangerouslySetInnerHTML={{ __html: note.notes }} />
                                </div>
                              )) : (
                                <p className="no-data">No notes recorded for this session.</p>
                              )}
                            </div>

                            {/* Materials */}
                            {hasMaterials && (
                              <div className="session-detail-section">
                                <h4><Paperclip size={15} /> Materials</h4>
                                <div className="materials-list">
                                  {session.materials.map(m => (
                                    <a key={m.id} href={m.fileUrl} target="_blank" rel="noopener noreferrer" className="material-chip">
                                      {m.fileType?.includes('video') ? <Video size={12} /> : <Paperclip size={12} />}
                                      {m.name}
                                    </a>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Roster / Attendance */}
                            {roster.length > 0 && (
                              <div className="session-detail-section">
                                <h4><Users size={15} /> Roster ({roster.length} students){att.total > 0 && ` — ${att.total} marked`}</h4>
                                <div className="attendance-grid">
                                  {roster.map(s => (
                                    <div key={s.id} className={`att-chip ${(s.status || 'scheduled').toLowerCase()}`}>
                                      <span>{s.fullName}</span>
                                      {s.status ? (
                                        <span className="att-status-icon">
                                          {s.status === 'PRESENT' ? '✓' : s.status === 'ABSENT' ? '✗' : s.status === 'EXCUSED' ? '🚫' : '⏰'}
                                        </span>
                                      ) : canCancel ? (
                                        <button
                                          className="att-cancel-btn"
                                          title="Cancel this student's spot"
                                          onClick={() => openCancelModal(session, s)}
                                        >
                                          <Ban size={12} />
                                        </button>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Cancel-student confirmation modal */}
      {cancelTarget && (
        <div className="cancel-modal-overlay" onClick={() => !cancelSubmitting && setCancelTarget(null)}>
          <div className="cancel-modal" onClick={e => e.stopPropagation()}>
            <h3><Ban size={18} /> Cancel {cancelTarget.studentName}'s spot</h3>
            <p>
              {cancelTarget.className} — the system will automatically check the 48-hour policy:
              free if cancelled 48h+ before class, otherwise it's sent to the admin to decide the charge (suggested 50%).
            </p>
            <label className="cancel-modal-label">Reason (optional)</label>
            <textarea
              rows={3}
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              placeholder="Why is this being cancelled?"
            />
            <div className="cancel-modal-actions">
              <button className="cancel-modal-back" disabled={cancelSubmitting} onClick={() => setCancelTarget(null)}>
                Back
              </button>
              <button className="cancel-modal-confirm" disabled={cancelSubmitting} onClick={handleConfirmCancel}>
                {cancelSubmitting ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SupervisionPanel;
