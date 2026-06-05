import React, { useState, useEffect, useRef } from 'react';
import { database } from '../../lib/database';
import { Check, X, AlertTriangle, FileWarning, Clock, Users, Star, Gift, TrendingUp, FileText, Image, Paperclip, Video, History, Eye, EyeOff, ShieldCheck, ChevronDown, Download, Bold, Italic, Underline, List, Link2, Type, Activity, Wind, LogOut, LifeBuoy, AlertCircle } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import mammoth from 'mammoth';
import * as xlsx from 'xlsx';
import api from '../../lib/api';
import './ClassSession.css';

const ClassSession = () => {
  const [dailySessions, setDailySessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);

  const [students, setStudents] = useState([]);
  const [attendance, setAttendance] = useState({});
  const [selectedForPrize, setSelectedForPrize] = useState({});
  const [prizePoints, setPrizePoints] = useState('');
  const [prizeReason, setPrizeReason] = useState('');
  const [awarding, setAwarding] = useState(false);
  const [classNotes, setClassNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [recordingUrl, setRecordingUrl] = useState('');
  const [noteVisibility, setNoteVisibility] = useState(['students_parents', 'me']);
  const [sessionHistory, setSessionHistory] = useState([]);
  const [historyFilter, setHistoryFilter] = useState('30days');
  const [expandedNotes, setExpandedNotes] = useState({});
  const [previewFile, setPreviewFile] = useState(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterRef = useRef(null);
  const [isSizeDropdownOpen, setIsSizeDropdownOpen] = useState(false);
  const sizeDropdownRef = useRef(null);
  const [isLinkInputOpen, setIsLinkInputOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [savedRange, setSavedRange] = useState(null);
  const linkDropdownRef = useRef(null);
  
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [completeLoading, setCompleteLoading] = useState(false);
  const [visibleAllergy, setVisibleAllergy] = useState(null);
  const [selectedAlertStudent, setSelectedAlertStudent] = useState(null);
  
  // Rich Text Active States
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
    fontSize: '3'
  });
  
  // Office Preview State
  const [officePreviewHtml, setOfficePreviewHtml] = useState('');
  const [officeProcessing, setOfficeProcessing] = useState(false);
  const fileInputRef = React.useRef(null);
  const videoInputRef = useRef(null);
  const editorRef = useRef(null);
  const navigate = useNavigate();

  // Close filter dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (filterRef.current && !filterRef.current.contains(event.target)) {
        setIsFilterOpen(false);
      }
      if (sizeDropdownRef.current && !sizeDropdownRef.current.contains(event.target)) {
        setIsSizeDropdownOpen(false);
      }
      if (linkDropdownRef.current && !linkDropdownRef.current.contains(event.target)) {
        setIsLinkInputOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Track Rich Text Active Formats
  const checkActiveFormats = () => {
    if (editorRef.current) {
      setActiveFormats({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        fontSize: document.queryCommandValue('fontSize') || '3'
      });
    }
  };

  useEffect(() => {
    document.addEventListener('selectionchange', checkActiveFormats);
    return () => document.removeEventListener('selectionchange', checkActiveFormats);
  }, []);

  // Process Local Office Files for Preview
  useEffect(() => {
    if (!previewFile) {
        setOfficePreviewHtml('');
        return;
    }
    const processLocalOfficeFiles = async () => {
      const isLocal = previewFile.url && previewFile.url.startsWith('blob:');
      if (!isLocal) return;

      const ext = previewFile.name.toLowerCase().split('.').pop();
      if (ext === 'docx' || ext === 'xlsx') {
         setOfficeProcessing(true);
         try {
           const response = await fetch(previewFile.url);
           const arrayBuffer = await response.arrayBuffer();

           if (ext === 'docx') {
             // Mammoth works well with arrayBuffer
             const result = await mammoth.convertToHtml({ arrayBuffer });
             setOfficePreviewHtml(result.value || '<p style="text-align:center; padding:20px;">The document is empty.</p>');
           } else if (ext === 'xlsx') {
             // XLSX (SheetJS)
             const data = new Uint8Array(arrayBuffer);
             const workbook = xlsx.read(data, { type: 'array' });
             if (workbook.SheetNames.length > 0) {
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                let html = xlsx.utils.sheet_to_html(firstSheet);
                // Enhanced table styling
                html = `<div class="xlsx-preview-table-container">${html}</div>`;
                setOfficePreviewHtml(html);
             } else {
                setOfficePreviewHtml('<p style="text-align:center; padding:20px;">The spreadsheet has no visible sheets.</p>');
             }
           }
         } catch (e) {
           console.error("Office Preview Error:", e);
           setOfficePreviewHtml('<div style="color:#ef4444; padding:40px; text-align:center;"><p><strong>Error rendering document</strong></p><p style="font-size:12px; opacity:0.7;">The file might be protected or in an unsupported format.</p></div>');
         }
         setOfficeProcessing(false);
      }
    };
    
    processLocalOfficeFiles();
  }, [previewFile]);

  // Fetch session history when a session is activated
  useEffect(() => {
    if (activeSessionId) {
      const loadHistory = async () => {
        setLoadingHistory(true);
        // Assuming session.id maps to groupId for this mock
        const history = await database.fetchSessionHistory(activeSessionId);
        setSessionHistory(history);
        setLoadingHistory(false);
      };
      loadHistory();
    } else {
      setSessionHistory([]);
    }
  }, [activeSessionId]);

  useEffect(() => {
    const loadStudentsAndSessions = async () => {
      // Load Students
      const data = await database.fetchStudents();
      setStudents(data);
      // Initialize states
      const initialAttendance = {};
      data.forEach(s => initialAttendance[s.id] = 'present');
      setAttendance(initialAttendance);

      // Load Sessions
      const sessions = await database.fetchDailySessions();
      if (sessions && sessions.length > 0) {
        setDailySessions(sessions);
      } else {
        // Fallback mock if no sessions today
        setDailySessions([
          { id: '1', title: 'Math Foundations - Group A (Mock)', time: '4:00 PM - 5:30 PM', studentsCount: 3, status: 'pending', link: 'https://zoom.us/j/123' }
        ]);
      }
    };
    loadStudentsAndSessions();
  }, []);

  const togglePresence = (id, status) => {
    setAttendance(prev => ({ ...prev, [id]: status }));
  };

  const togglePrizeSelection = (id) => {
    setSelectedForPrize(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const selectAllPresent = () => {
    const newSelection = {};
    students.forEach(s => {
      if (attendance[s.id] === 'present') {
        newSelection[s.id] = true;
      }
    });
    setSelectedForPrize(newSelection);
  };

  const handleAwardPoints = async () => {
    const idsToAward = Object.keys(selectedForPrize).filter(id => selectedForPrize[id]);
    if (idsToAward.length === 0 || !prizePoints || !prizeReason) return;
    
    setAwarding(true);
    const success = await database.awardPrizePoints(idsToAward, prizeReason, prizePoints);
    if (success) {
      // Reset after success
      setPrizePoints('');
      setPrizeReason('');
      setSelectedForPrize({});
      // Optionally show a success toast here
    }
    setAwarding(false);
  };

  const handleSaveNotes = async () => {
    if (!classNotes && attachedFiles.length === 0) return;
    setSavingNotes(true);
    await database.saveClassNotes(activeSessionId || 'math-group-a', classNotes, attachedFiles, noteVisibility.join(','), recordingUrl);
    
    // Refresh history dynamically
    const updatedHistory = await database.fetchSessionHistory(activeSessionId || 'math-group-a');
    setSessionHistory(updatedHistory);
    
    setSavingNotes(false);
    alert(`Session materials and notes published successfully!`);
    setClassNotes('');
    if (editorRef.current) editorRef.current.innerHTML = '';
    setAttachedFiles([]);
    setRecordingUrl('');
    setNoteVisibility(['students_parents', 'me']);
  };

  const toggleVisibility = (role) => {
    setNoteVisibility(prev => {
      let next;
      if (prev.includes(role)) {
        // If turning OFF a role
        next = prev.filter(r => r !== role);
      } else {
        // If turning ON a role
        next = [...prev, role];
      }
      return next.length === 0 ? ['me'] : next; // Prevent unselecting everything, fallback to private
    });
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      const newFiles = files.map(f => ({
        name: f.name,
        type: f.type,
        size: f.size,
        url: URL.createObjectURL(f) // Create local URL for previewing
      }));
      setAttachedFiles(prev => [...prev, ...newFiles]);
    }
  };

  const removeFile = (index) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleAlertTrigger = async (student, type) => {
    try {
      await api.post('/alerts', { studentId: student.id, alertType: type, reason: `${type} requested from Class Session` });
      alert(`${type} alert sent to Front Desk for ${student.name}.`);
    } catch (error) {
      console.error('Error triggering alert:', error);
      alert('Failed to trigger alert. Make sure the backend is running.');
    }
  };

  const handleCompleteSession = async (sessionId) => {
    const markedCount = Object.keys(attendance).length;
    if (markedCount < students.length) {
      const confirm = window.confirm('Some students haven\'t been marked. Do you want to complete the session anyway?');
      if (!confirm) return;
    }

    setCompleteLoading(true);
    try {
      await database.saveAttendance(sessionId, attendance);
      await database.saveClassNotes(sessionId, classNotes, attachedFiles);
      
      setDailySessions(prev => 
        prev.map(s => s.id === sessionId ? { ...s, status: 'completed' } : s)
      );
      
      setActiveSessionId(null);
      // Reset form states for the next class
      setAttendance({});
      setSelectedForPrize({});
      setClassNotes('');
      setAttachedFiles([]);
      setNoteVisibility(['students_parents', 'me']);
      
      const askFit = window.confirm('Session completed and saved successfully!\n\nDo you need to submit a Class-Fit Report to flag any student who might need to change groups?');
      if (askFit) {
        navigate('/class-fit');
      }
    } catch (error) {
      console.error('Error completing session:', error);
      alert('There was an error saving the session. Please try again.');
    } finally {
      setCompleteLoading(false);
    }
  };

  const selectedCount = Object.values(selectedForPrize).filter(Boolean).length;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const filteredHistory = sessionHistory.filter(hist => {
    if (historyFilter === 'all') return true;
    return new Date(hist.date) >= thirtyDaysAgo;
  });

  return (
    <div className="daily-sessions-wrapper">
      <div className="daily-header">
        <h1>Today's Classes</h1>
        <p className="text-muted">Manage your schedule and student attendance.</p>
      </div>

      <div className="daily-sessions-list">
        {dailySessions.map(session => (
          <div key={session.id} className={`daily-session-card ${session.status === 'completed' ? 'completed' : ''}`}>
            {/* Collapsed Warning or Summary */}
            <div className="session-summary">
              <div className="summary-info">
                <h3>{session.title}</h3>
                <div className="summary-meta">
                  <span className="meta-time"><Clock size={14} /> {session.time}</span>
                  <span className="meta-students"><Users size={14} /> {session.studentsCount} Students</span>
                  {session.status === 'completed' && <span className="status-badge completed">Completed</span>}
                </div>
              </div>
              
              <div className="summary-actions">
                {activeSessionId !== session.id ? (
                  <button 
                    className={`action-btn ${session.status === 'completed' ? 'secondary' : 'primary'}`}
                    onClick={() => setActiveSessionId(session.id)}
                  >
                    {session.status === 'completed' ? 'Review Session' : 'Start Class'}
                  </button>
                ) : (
                  <button className="action-btn secondary" onClick={() => setActiveSessionId(null)}>
                    Minimize
                  </button>
                )}
              </div>
            </div>

            {/* Expanded Active Session View */}
            {activeSessionId === session.id && (
              <div className="session-expanded-content">
                <div className="expanded-actions-bar">
                  <a href={session.link} target="_blank" rel="noopener noreferrer" className="session-link-btn">
                    <Video size={14} />
                    <span>Join Virtual Session</span>
                  </a>
                  <button 
                    className="action-btn primary"
                    onClick={() => handleCompleteSession(session.id)}
                    disabled={completeLoading}
                  >
                    {completeLoading ? 'Processing...' : 'Complete Session'}
                  </button>
                </div>

      {/* Integrated Prize Bar */}
      <div className="prize-quick-bar">
        <div className="prize-bar-content">
          <div className="prize-indicator">
            <Star fill="#fbbf24" size={20} color="#fbbf24" />
            <span>Award Points ({selectedCount} selected)</span>
          </div>
          <div className="prize-bar-inputs">
            <input 
              type="text" 
              placeholder="Reason..." 
              value={prizeReason}
              onChange={(e) => setPrizeReason(e.target.value)}
              className="prize-input-mini"
            />
            <input 
              type="number" 
              placeholder="Pts" 
              value={prizePoints}
              onChange={(e) => setPrizePoints(e.target.value)}
              className="prize-input-mini points-mini"
            />
            <button 
              className="prize-award-btn"
              onClick={handleAwardPoints}
              disabled={awarding || selectedCount === 0 || !prizePoints || !prizeReason}
            >
              Apply
            </button>
          </div>
        </div>
      </div>

      <div className="table-responsive">
        <table className="attendance-table">
          <thead>
            <tr>
              <th align="left">Student</th>
              <th align="center" width="180px">Attendance</th>
              <th align="right" width="140px">Points</th>
              <th width="80px" align="center">
                <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px'}}>
                  <span style={{fontSize: '9px', textTransform: 'uppercase', color: '#64748b'}}>Select</span>
                  <input 
                    type="checkbox" 
                    onChange={(e) => {
                      const checked = e.target.checked;
                      const newSelection = {};
                      students.forEach(s => newSelection[s.id] = checked);
                      setSelectedForPrize(newSelection);
                    }}
                    className="custom-checkbox"
                    checked={students.length > 0 && students.every(s => selectedForPrize[s.id])}
                  />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {students.map(student => (
              <tr key={student.id} className={`attendance-row ${selectedForPrize[student.id] ? 'selected-row' : ''}`}>
                <td>
                  <div className="student-info-cell">
                    <div className="student-name">{student.name}</div>
                    <div className="student-quick-actions" style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                      <button 
                        className="quick-action-btn behavior" 
                        title="Log Behavior"
                        onClick={() => navigate('/behavior')}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: '2px', display: 'flex', alignItems: 'center' }}
                      >
                        <FileWarning size={14} />
                      </button>
                      <button 
                        className="quick-action-btn alert-trigger" 
                        title="Send Alert"
                        onClick={() => setSelectedAlertStudent(student)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#eab308', padding: '2px', display: 'flex', alignItems: 'center' }}
                      >
                        <AlertTriangle size={14} />
                      </button>
                    </div>
                    {student.allergies !== 'None' && (
                      <div className="allergy-indicator-wrapper">
                        <button 
                          className="allergy-mini-btn"
                          onClick={() => setVisibleAllergy(visibleAllergy === student.id ? null : student.id)}
                          title="View Allergies"
                        >
                          <AlertTriangle size={14} />
                        </button>
                        {visibleAllergy === student.id && (
                          <div className="allergy-popover">
                            <strong>Allergies:</strong> {student.allergies}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </td>
                <td align="center">
                  <div className="presence-toggle">
                    <button 
                      className={`presence-btn ${attendance[student.id] === 'present' ? 'active present' : ''}`}
                      onClick={() => togglePresence(student.id, 'present')}
                    >
                      Present
                    </button>
                    <button 
                      className={`presence-btn ${attendance[student.id] === 'absent' ? 'active absent' : ''}`}
                      onClick={() => togglePresence(student.id, 'absent')}
                    >
                      Absent
                    </button>
                  </div>
                </td>
                <td align="right">
                  <div className="points-badge">
                    <Star size={14} fill="#fbbf24" color="#fbbf24" />
                    <span>{student.prizePoints || 0}</span>
                  </div>
                </td>
                <td align="center">
                  <input 
                    type="checkbox" 
                    checked={!!selectedForPrize[student.id]}
                    onChange={() => togglePrizeSelection(student.id)}
                    className="custom-checkbox"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Class Continuity History */}
      <div className="session-history-panel">
        <div className="history-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
           <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px' }}>
              <History size={18} color="#64748b" />
              Class Continuity (Previous Sessions)
           </h3>
           <div className="custom-filter-wrapper" ref={filterRef}>
             <button 
               className="history-filter-btn" 
               onClick={() => setIsFilterOpen(!isFilterOpen)}
             >
               {historyFilter === '30days' ? 'Last 30 Days' : 'View All Time'}
               <ChevronDown size={14} />
             </button>
             {isFilterOpen && (
               <div className="custom-filter-menu">
                 <div 
                   className={`filter-option ${historyFilter === '30days' ? 'active' : ''}`}
                   onClick={() => { setHistoryFilter('30days'); setIsFilterOpen(false); }}
                 >
                   Last 30 Days
                 </div>
                 <div 
                   className={`filter-option ${historyFilter === 'all' ? 'active' : ''}`}
                   onClick={() => { setHistoryFilter('all'); setIsFilterOpen(false); }}
                 >
                   View All Time
                 </div>
               </div>
             )}
           </div>
        </div>
        <div className="history-body">
           {loadingHistory ? (
             <div className="history-loading">Loading past notes...</div>
           ) : filteredHistory.length > 0 ? (
             <div className="history-timeline">
               {filteredHistory.map(hist => (
                 <div key={hist.sessionId} className="history-item">
                   <div className="history-date">
                     <strong>{new Date(hist.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric'})}</strong>
                     <div className="visibility-badge" title={`Visible to: ${hist.visibility}`}>
                        {(hist.visibility === 'teacher' || hist.visibility === 'me') && <EyeOff size={12} />}
                        {(hist.visibility === 'students' || hist.visibility.includes('students_parents')) && <Users size={12} />}
                        {hist.visibility === 'all' && <Eye size={12} />}
                     </div>
                   </div>
                   <div className="history-content">
                     <div className="history-formatted-notes">
                       {hist.notes.length > 200 && !expandedNotes[hist.sessionId] 
                         ? <div dangerouslySetInnerHTML={{ __html: `${hist.notes.substring(0, 200)}...` }} />
                         : <div dangerouslySetInnerHTML={{ __html: hist.notes }} />
                       }
                     </div>
                     
                     {hist.notes.length > 200 && (
                       <button 
                         className="read-more-btn"
                         onClick={() => setExpandedNotes(prev => ({ ...prev, [hist.sessionId]: !prev[hist.sessionId] }))}
                       >
                         {expandedNotes[hist.sessionId] ? 'Show less' : 'Read more'}
                       </button>
                     )}

                     {hist.materials && hist.materials.length > 0 && (
                       <div className="history-materials">
                         {hist.materials.map((m, i) => (
                           <button 
                             key={i} 
                             className="hist-mat-chip previewable"
                             onClick={() => setPreviewFile(m)}
                             title="Click to preview"
                           >
                             <Paperclip size={10} /> {m.name}
                           </button>
                         ))}
                       </div>
                     )}
                   </div>
                 </div>
               ))}
             </div>
           ) : sessionHistory.length > 0 ? (
             <div className="history-empty">No notes found for the last 30 days. Select "View All Time" to see older records.</div>
           ) : (
             <div className="history-empty">No previous session notes found for this group.</div>
           )}
        </div>
      </div>

      <div className="session-resources-panel">
        <div className="resources-header">
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={20} color="#3b82f6" />
            Session Materials & Notes
          </h3>
          <span className="text-muted" style={{fontSize: '12px'}}>Visible to all students in this group</span>
        </div>
        <div className="resources-body">
          <div className="recording-link-section" style={{ marginBottom: '16px' }}>
            <div className="recording-input-wrapper" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', background: '#f0f9ff', padding: '10px 14px', borderRadius: '10px', border: '1px dashed #7dd3fc' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '1 1 200px' }}>
                <Video size={18} color="#0284c7" />
                <input 
                  type="url" 
                  placeholder="Paste class recording link (Zoom, Drive, etc.)..."
                  style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: '13px', color: '#0369a1', minWidth: '0' }}
                  value={recordingUrl}
                  onChange={e => setRecordingUrl(e.target.value)}
                />
              </div>
              <div className="recording-divider" style={{ width: '1px', height: '20px', background: '#bae6fd' }}></div>
              <input 
                type="file" 
                ref={videoInputRef} 
                style={{ display: 'none' }} 
                onChange={handleFileChange}
                accept=".mp4,.mov,.webm"
              />
              <button 
                type="button"
                className="upload-recording-btn" 
                onClick={() => videoInputRef.current.click()}
              >
                <Paperclip size={14} /> Upload Video File
              </button>
            </div>
          </div>

          <div className="notes-editor-container">
            <div className="rich-toolbar">
              <button type="button" className={`toolbar-btn ${activeFormats.bold ? 'active' : ''}`} title="Bold" onMouseDown={e => { e.preventDefault(); document.execCommand('bold'); checkActiveFormats(); }}>
                <Bold size={16} />
              </button>
              <button type="button" className={`toolbar-btn ${activeFormats.italic ? 'active' : ''}`} title="Italic" onMouseDown={e => { e.preventDefault(); document.execCommand('italic'); checkActiveFormats(); }}>
                <Italic size={16} />
              </button>
              <button type="button" className={`toolbar-btn ${activeFormats.underline ? 'active' : ''}`} title="Underline" onMouseDown={e => { e.preventDefault(); document.execCommand('underline'); checkActiveFormats(); }}>
                <Underline size={16} />
              </button>
              
              <div className="toolbar-divider"></div>
              
              <div className="custom-filter-wrapper" ref={sizeDropdownRef}>
                <button 
                  type="button"
                  className="toolbar-btn text-dropdown" 
                  onClick={() => setIsSizeDropdownOpen(!isSizeDropdownOpen)}
                  style={{ width: 'auto', padding: '0 8px', gap: '4px' }}
                >
                  Size <ChevronDown size={14} />
                </button>
                {isSizeDropdownOpen && (
                  <div className="custom-filter-menu" style={{ width: '120px', left: 0, right: 'auto', top: 'calc(100% + 4px)', zIndex: 10 }}>
                    <div className={`filter-option ${activeFormats.fontSize === '2' ? 'active' : ''}`} onMouseDown={e => { e.preventDefault(); document.execCommand('fontSize', false, '2'); checkActiveFormats(); setIsSizeDropdownOpen(false); }}>Small</div>
                    <div className={`filter-option ${activeFormats.fontSize === '3' ? 'active' : ''}`} onMouseDown={e => { e.preventDefault(); document.execCommand('fontSize', false, '3'); checkActiveFormats(); setIsSizeDropdownOpen(false); }}>Normal</div>
                    <div className={`filter-option ${String(activeFormats.fontSize) === '5' ? 'active' : ''}`} onMouseDown={e => { e.preventDefault(); document.execCommand('fontSize', false, '5'); checkActiveFormats(); setIsSizeDropdownOpen(false); }}>Large</div>
                  </div>
                )}
              </div>

              <div className="toolbar-divider"></div>
              <button type="button" className="toolbar-btn" title="Bullet List" onMouseDown={e => { e.preventDefault(); document.execCommand('insertUnorderedList'); }}>
                <List size={16} />
              </button>
              
              <div className="custom-filter-wrapper" ref={linkDropdownRef}>
                <button 
                  type="button" 
                  className={`toolbar-btn ${isLinkInputOpen ? 'active' : ''}`} 
                  title="Insert Link" 
                  onClick={() => {
                    if (!isLinkInputOpen) {
                      const selection = window.getSelection();
                      if (selection.rangeCount > 0) {
                        setSavedRange(selection.getRangeAt(0));
                      }
                      setIsLinkInputOpen(true);
                      setLinkUrl('');
                    } else {
                      setIsLinkInputOpen(false);
                    }
                  }}
                >
                  <Link2 size={16} />
                </button>
                {isLinkInputOpen && (
                  <div className="custom-filter-menu" style={{ width: '280px', left: 'auto', right: 0, top: 'calc(100% + 4px)', zIndex: 10, padding: '12px', display: 'flex', gap: '8px', cursor: 'default', boxSizing: 'border-box' }} onClick={e => e.stopPropagation()}>
                    <input 
                      type="url" 
                      placeholder="https://..." 
                      value={linkUrl}
                      onChange={e => setLinkUrl(e.target.value)}
                      style={{ flex: 1, padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', outline: 'none' }}
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (savedRange) {
                            const selection = window.getSelection();
                            selection.removeAllRanges();
                            selection.addRange(savedRange);
                          }
                          if (linkUrl) document.execCommand('createLink', false, linkUrl);
                          checkActiveFormats();
                          setIsLinkInputOpen(false);
                        }
                      }}
                    />
                    <button 
                      type="button" 
                      className="action-btn primary"
                      style={{ padding: '6px 12px', fontSize: '12px' }}
                      onClick={() => {
                        if (savedRange) {
                          const selection = window.getSelection();
                          selection.removeAllRanges();
                          selection.addRange(savedRange);
                        }
                        if (linkUrl) document.execCommand('createLink', false, linkUrl);
                        checkActiveFormats();
                        setIsLinkInputOpen(false);
                      }}
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div 
              ref={editorRef}
              className="rich-editor-area"
              contentEditable
              onInput={(e) => setClassNotes(e.currentTarget.innerHTML)}
              data-placeholder="Write key concepts, homework instructions, or important links here..."
            ></div>
          </div>
          {attachedFiles.length > 0 && (
            <div className="attachments-list">
              {attachedFiles.map((file, idx) => (
                <div key={idx} className="attachment-chip">
                  {file.type.includes('image') ? <Image size={14} /> : <Paperclip size={14} />}
                  <span className="file-name">{file.name}</span>
                  <button className="remove-file-btn" onClick={() => removeFile(idx)}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="resources-footer">
            <div className="upload-buttons">
              <input 
                type="file" 
                ref={fileInputRef} 
                style={{ display: 'none' }} 
                multiple 
                onChange={handleFileChange}
                accept="image/*,.pdf,.doc,.docx,.xlsx,.mp4,.mov,.webm"
              />
              <button type="button" className="upload-recording-btn" style={{ background: '#f8fafc', color: '#64748b', borderColor: '#e2e8f0' }} title="Add Images" onClick={() => fileInputRef.current.click()}>
                <Image size={16} /> Images
              </button>
              <button type="button" className="upload-recording-btn" style={{ background: '#f8fafc', color: '#64748b', borderColor: '#e2e8f0' }} title="Attach Files" onClick={() => fileInputRef.current.click()}>
                <Paperclip size={16} /> Files
              </button>
            </div>
            
            {/* Visibility Selector */}
            <div className="visibility-toggles-container">
              <span className="vis-label"><ShieldCheck size={14} /> Visible to:</span>
              <div className="vis-toggles">
                <button 
                  className={`vis-toggle-btn ${noteVisibility.includes('students_parents') ? 'active' : ''}`}
                  onClick={() => toggleVisibility('students_parents')}
                >
                  Students & Parents
                </button>
                <button 
                  className={`vis-toggle-btn ${noteVisibility.includes('me') ? 'active' : ''}`}
                  onClick={() => toggleVisibility('me')}
                >
                  Me
                </button>
              </div>
            </div>

            <button 
              className="action-btn primary" 
              onClick={handleSaveNotes}
              disabled={savingNotes || (!classNotes && attachedFiles.length === 0)}
            >
              <Check size={16} />
              {savingNotes ? 'Publishing...' : 'Publish Materials'}
            </button>
          </div>
        </div>
      </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Alert Modal */}
      {selectedAlertStudent && (
        <div className="alert-modal-overlay" onClick={() => setSelectedAlertStudent(null)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div className="alert-modal-content" onClick={e => e.stopPropagation()} style={{ background: '#fff', padding: '30px', borderRadius: '16px', width: '90%', maxWidth: '400px', textAlign: 'center', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
              <AlertTriangle size={48} color="#eab308" />
            </div>
            <h2 style={{ marginTop: 0, marginBottom: '8px', color: '#0f172a' }}>Send Alert</h2>
            <p style={{ color: '#64748b', marginBottom: '32px', fontSize: '15px' }}>Trigger an immediate alert to Front Desk for <strong>{selectedAlertStudent.name}</strong></p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <button 
                onClick={() => { handleAlertTrigger(selectedAlertStudent, 'Student out'); setSelectedAlertStudent(null); }}
                style={{ background: '#fef08a', color: '#ca8a04', border: '2px solid #fde047', padding: '16px', borderRadius: '12px', fontSize: '18px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', cursor: 'pointer', transition: 'all 0.2s', width: '100%' }}
              >
                <LogOut size={24} /> Student Out
              </button>
              
              <button 
                onClick={() => { handleAlertTrigger(selectedAlertStudent, 'Class support'); setSelectedAlertStudent(null); }}
                style={{ background: '#ffedd5', color: '#c2410c', border: '2px solid #fdba74', padding: '16px', borderRadius: '12px', fontSize: '18px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', cursor: 'pointer', transition: 'all 0.2s', width: '100%' }}
              >
                <LifeBuoy size={24} /> Class Support
              </button>
              
              <button 
                onClick={() => { handleAlertTrigger(selectedAlertStudent, 'Medic'); setSelectedAlertStudent(null); }}
                style={{ background: '#fee2e2', color: '#b91c1c', border: '2px solid #fca5a5', padding: '16px', borderRadius: '12px', fontSize: '18px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', cursor: 'pointer', transition: 'all 0.2s', width: '100%' }}
              >
                <AlertCircle size={24} /> Medical
              </button>
            </div>
            
            <button 
              onClick={() => setSelectedAlertStudent(null)}
              style={{ marginTop: '32px', background: 'none', border: 'none', color: '#64748b', fontSize: '16px', cursor: 'pointer', fontWeight: '600' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* File Preview Modal */}
      {previewFile && (
        <div className="preview-modal-overlay" onClick={() => setPreviewFile(null)}>
          <div className="preview-modal-content" onClick={e => e.stopPropagation()}>
            <div className="preview-header">
              <div className="preview-title">
                {previewFile.type && previewFile.type.includes('image') ? <Image size={18} /> : 
                 (previewFile.type && previewFile.type.includes('video')) || ['.mp4', '.mov', '.webm'].some(ext => previewFile.name.toLowerCase().endsWith(ext)) ? <Video size={18} /> :
                 <FileText size={18} />}
                <span>{previewFile.name}</span>
              </div>
              <div className="preview-actions">
                {previewFile.url && (
                  <a 
                    href={previewFile.url} 
                    download={previewFile.name} 
                    className="preview-btn-action download"
                    title="Download file"
                  >
                    <Download size={18} />
                  </a>
                )}
                <button className="preview-btn-action close" onClick={() => setPreviewFile(null)}>
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="preview-body">
              {(() => {
                const isImage = previewFile.type && previewFile.type.includes('image');
                const isPdf = previewFile.type === 'application/pdf' || previewFile.name.toLowerCase().endsWith('.pdf');
                const isVideo = (previewFile.type && previewFile.type.includes('video')) || 
                                ['.mp4', '.mov', '.webm'].some(ext => previewFile.name.toLowerCase().endsWith(ext));
                const isLocal = previewFile.url && previewFile.url.startsWith('blob:');
                
                if (isImage) {
                  return <img src={previewFile.url} alt="Preview" className="preview-image" />;
                }

                if (isVideo) {
                  return (
                    <div className="preview-video-container" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a' }}>
                      <video 
                        src={previewFile.url} 
                        controls 
                        autoPlay
                        className="preview-video"
                        style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: '8px' }}
                      >
                        Your browser does not support the video tag.
                      </video>
                    </div>
                  );
                }
                
                if (previewFile.url && (isPdf || !isLocal)) {
                  // For PDFs (local or remote) and remote office files, we can use an iframe
                  const iframeSrc = isLocal ? previewFile.url : `https://docs.google.com/viewer?url=${encodeURIComponent(previewFile.url)}&embedded=true`;
                  return (
                    <iframe 
                      src={iframeSrc} 
                      title="Document Preview" 
                      className="preview-iframe"
                      width="100%" 
                      height="100%"
                    ></iframe>
                  );
                }

                // Render Local Office files using the html state
                const ext = previewFile.name.split('.').pop().toUpperCase();
                return (
                  <div className="local-office-container" style={{ width: '100%', height: '100%', padding: '40px', overflowY: 'auto', background: 'white' }}>
                    {officeProcessing ? (
                      <div className="document-preview-placeholder">
                        <FileText size={64} color="#e2e8f0" />
                        <p>Processing {ext} Document...</p>
                        <span className="text-muted">Extracting contents for fast previewing</span>
                        <div className="mock-text-skeleton" style={{animation: 'pulse 1.5s infinite'}}>
                           <div className="skel-line"></div>
                           <div className="skel-line"></div>
                           <div className="skel-line half"></div>
                        </div>
                      </div>
                    ) : officePreviewHtml ? (
                      <div className="office-html-canvas" dangerouslySetInnerHTML={{ __html: officePreviewHtml }} style={{ fontSize: '14px', color: '#334155', lineHeight: '1.6' }} />
                    ) : (
                      <div className="document-preview-placeholder">
                        <FileText size={64} color="#e2e8f0" />
                        <p>Preview format unsupported</p>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClassSession;
