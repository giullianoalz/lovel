import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, UserPlus, AlertCircle, Cookie, Mail, MessageSquare, ShoppingBag, GraduationCap, DollarSign, Briefcase, UploadCloud, Download, Users, Send, CheckCircle2, Clock, Copy } from 'lucide-react';
import { database } from '../../lib/database';
import api from '../../lib/api';
import { useToast } from '../Layout/ToastProvider';
import { useAuth } from '../../context/AuthContext';
import StudentProfileModal from './StudentProfileModal';
import TeacherProfileModal from './TeacherProfileModal';
import SnackCabinetModal from './SnackCabinetModal';
import AddStudentModal from './AddStudentModal';
import ImportStudentsModal from './ImportStudentsModal';
import ErrorBanner from '../Layout/ErrorBanner';
import './StudentsList.css';

const StudentsList = () => {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const [activeTab, setActiveTab] = useState('students');
  const [students, setStudents] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [selectedTeacher, setSelectedTeacher] = useState(null);
  const [isSnackManagerOpen, setIsSnackManagerOpen] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState('All');
  const [families, setFamilies] = useState([]);
  const [parents, setParents] = useState([]);
  const [invitingId, setInvitingId] = useState(null);
  // Only set when an invite was created but the email couldn't go out, so the
  // admin can still hand the link over.
  const [manualInvite, setManualInvite] = useState(null);

  const loadData = async () => {
    setLoadError(null);
    try {
      const data = await database.fetchStudents();
      setStudents(data);
      if (selectedStudent) {
        const updatedStudent = data.find(s => s.id === selectedStudent.id);
        if (updatedStudent) setSelectedStudent(updatedStudent);
      }
    } catch (error) {
      setLoadError(error.userMessage || 'Could not load the student list.');
    } finally {
      setLoading(false);
    }
  };

  const loadTeachers = async () => {
    try {
      const data = await database.fetchTeachers();
      setTeachers(data);
    } catch (error) {
      console.error("Error loading teachers:", error);
    }
  };

  // Parents are the invite queue: the row exists (imported or added by staff)
  // before the person can sign in, so admins need to see who still has no access.
  const loadParents = async () => {
    try {
      const res = await api.get('/users', { params: { role: 'PARENT', limit: 200 } });
      setParents(res.data.users || []);
    } catch (error) {
      console.error('Error loading parents:', error);
    }
  };

  useEffect(() => {
    loadData();
    loadTeachers();
    if (hasRole('ADMIN')) loadParents();
    const loadFamilies = async () => {
      try {
        const fams = await database.fetchFamilies();
        setFamilies(fams);
      } catch (err) {
        console.error('Error loading families:', err);
      }
    };
    loadFamilies();
  }, []);

  const filteredStudents = students.filter(student => {
    const matchesSearch = student.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'All' || student.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const filteredTeachers = teachers.filter(t =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
    (statusFilter === 'All' || t.status === statusFilter)
  );

  const filteredParents = parents.filter(p =>
    (p.fullName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.email || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleInvite = async (parent) => {
    setInvitingId(parent.id);
    setManualInvite(null);
    try {
      const res = await api.post(`/users/${parent.id}/invite`);
      setParents(ps => ps.map(p => (p.id === parent.id ? { ...p, ...res.data.user } : p)));
      if (res.data.emailed) {
        toast.success(res.data.message);
      } else {
        // Email is down or unconfigured — the account is still ready, so give
        // the admin the link rather than leaving the family stuck.
        toast.error(res.data.message);
        setManualInvite({ name: parent.fullName, link: res.data.link });
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not send the invite.');
    } finally {
      setInvitingId(null);
    }
  };

  const handleExportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await api.get('/students/export', { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `students-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err.userMessage || 'Could not export students.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="students-container">
      <header className="students-header">
        <div>
          <p className="text-muted">
            {activeTab === 'students'
              ? `Total Enrolled: ${students.length}`
              : activeTab === 'teachers'
                ? `Total Teachers: ${teachers.length}`
                : `${parents.filter(p => p.canSignIn).length} of ${parents.length} parents can sign in`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          {activeTab === 'students' && (
            <>
              <button 
                className="action-btn outline" 
                style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'white', border: '1px solid #e2e8f0', color: '#475569', fontWeight: 600 }}
                onClick={() => setIsSnackManagerOpen(true)}
              >
                <ShoppingBag size={18} />
                <span className="desk-only">Snack Cabinet</span>
              </button>
              {hasRole('ADMIN') && (
                <>
                  <button
                    className="action-btn outline"
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'white', border: '1px solid #e2e8f0', color: '#475569', fontWeight: 600 }}
                    onClick={handleExportCsv}
                    disabled={exporting}
                  >
                    <Download size={18} />
                    <span className="desk-only">{exporting ? 'Exporting…' : 'Export CSV'}</span>
                  </button>
                  <button
                    className="action-btn outline"
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'white', border: '1px solid #e2e8f0', color: '#475569', fontWeight: 600 }}
                    onClick={() => setShowImportModal(true)}
                  >
                    <UploadCloud size={18} />
                    <span className="desk-only">Import CSV</span>
                  </button>
                  <button
                    className="action-btn primary"
                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                    onClick={() => setShowAddModal(true)}
                  >
                    <UserPlus size={18} />
                    <span className="desk-only">Add New Student</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </header>

      {/* Tabs */}
      <div className="directory-tabs">
        <button 
          className={`dir-tab ${activeTab === 'students' ? 'active' : ''}`}
          onClick={() => { setActiveTab('students'); setSearchQuery(''); setStatusFilter('All'); }}
        >
          <GraduationCap size={18} />
          <span>Students</span>
          <span className="tab-count">{students.length}</span>
        </button>
        {hasRole('ADMIN') && (
          <>
            <button
              className={`dir-tab ${activeTab === 'teachers' ? 'active' : ''}`}
              onClick={() => { setActiveTab('teachers'); setSearchQuery(''); setStatusFilter('All'); }}
            >
              <Briefcase size={18} />
              <span>Teachers & Payroll</span>
              <span className="tab-count">{teachers.length}</span>
            </button>
            <button
              className={`dir-tab ${activeTab === 'parents' ? 'active' : ''}`}
              onClick={() => { setActiveTab('parents'); setSearchQuery(''); setStatusFilter('All'); }}
            >
              <Users size={18} />
              <span>Parents & Access</span>
              <span className="tab-count">{parents.length}</span>
            </button>
          </>
        )}
      </div>

      <div className="search-filter-row">
        <div className="search-input-wrapper">
          <Search size={18} className="search-icon" />
          <input 
            type="text" 
            placeholder={
              activeTab === 'students' ? "Search by name..."
                : activeTab === 'teachers' ? "Search teachers..."
                  : "Search parents by name or email..."
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="filter-chips">
          {activeTab !== 'parents' && ['All', 'Active', 'Inactive'].map(status => (
            <button
              key={status}
              className={`filter-chip ${statusFilter === status ? 'active' : ''}`}
              onClick={() => setStatusFilter(status)}
            >
              {status === 'All' ? `All ${activeTab === 'students' ? 'Students' : 'Teachers'}` : status}
            </button>
          ))}
        </div>
      </div>

      {/* Students Tab */}
      {activeTab === 'students' && (
        <>
          {loadError && <ErrorBanner message={loadError} onRetry={loadData} />}
          {loading ? (
            <div className="loading-state"><span className="app-inline-loader"><span className="app-spinner-sm" />Loading academy records…</span></div>
          ) : filteredStudents.length === 0 ? (
            <div className="empty-state">
              <Search size={32} />
              <p>No students match your search or filters.</p>
            </div>
          ) : (
            <div className="students-grid">
              {filteredStudents.map(student => (
                <div key={student.id} className="premium-card student-card">
                  <div className="card-top">
                    <div className="student-main-info">
                      <div className="student-avatar">{student.name[0]}</div>
                      <div>
                        <h3 className="student-name">{student.name}</h3>
                        <span className={`status-tag ${student.status.replace(' ', '').toLowerCase()}`}>
                          {student.status}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="card-details">
                    <div className="detail-item">
                      <span className="detail-label">Allergies:</span>
                      <span className={student.allergies !== 'None' ? 'allergy-alert' : ''}>
                        {student.allergies === 'None' ? (
                          'No reported allergies'
                        ) : (
                          <>
                            <AlertCircle size={14} />
                            {student.allergies}
                          </>
                        )}
                      </span>
                    </div>

                    <div className="detail-item">
                      <span className="detail-label">Billing:</span>
                      {student.snackAuthorized ? (
                        <div className="snack-badge">
                          <Cookie size={14} />
                          <span>Snacks Authorized</span>
                        </div>
                      ) : (
                        <span className="text-muted" style={{ fontSize: '12px' }}>Standard Plan (No snacks)</span>
                      )}
                    </div>
                  </div>

                  <div className="card-actions">
                    {student.parentEmail && student.parentEmail !== 'N/A' && (
                      <a
                        className="icon-btn"
                        href={`mailto:${student.parentEmail}`}
                        title={`Email ${student.parentName || 'parent'}`}
                        aria-label={`Send email to ${student.parentName || 'parent'}`}
                      >
                        <Mail size={18} />
                      </a>
                    )}
                    <button
                      className="icon-btn"
                      title="Internal Chat"
                      aria-label={`Open chat about ${student.name}`}
                      onClick={() => navigate('/chat')}
                    >
                      <MessageSquare size={18} />
                    </button>
                    <button className="action-btn" onClick={() => setSelectedStudent({ ...student })}>View Profile</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Teachers Tab */}
      {activeTab === 'teachers' && (
        <div className="students-grid">
          {filteredTeachers.map(teacher => (
            <div key={teacher.id} className="premium-card student-card teacher-card">
              <div className="card-top">
                <div className="student-main-info">
                  <div className="student-avatar teacher-avatar">{teacher.name[0]}</div>
                  <div>
                    <h3 className="student-name">{teacher.name}</h3>
                    <span className={`status-tag ${teacher.status?.replace(' ', '').toLowerCase()}`}>
                      {teacher.status}
                    </span>
                  </div>
                </div>
              </div>

              <div className="card-details">
                <div className="detail-item">
                  <span className="detail-label">Email:</span>
                  <span style={{ fontSize: '13px' }}>{teacher.email}</span>
                </div>
                {/* Pay is management information: the API only sends it to
                    admins, so a teacher would otherwise read "$0.00 /mo" for
                    every colleague. */}
                {hasRole('ADMIN') && (
                  <>
                    <div className="detail-item">
                      <span className="detail-label">Salary:</span>
                      <span className="salary-badge">
                        <DollarSign size={14} />
                        ${teacher.baseSalary?.toLocaleString('en-US', { minimumFractionDigits: 2 }) || '0.00'} /mo
                      </span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Per Session:</span>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#0369a1' }}>
                        ${teacher.perSessionRate?.toFixed(2) || '0.00'}
                      </span>
                    </div>
                  </>
                )}
              </div>

              <div className="card-actions">
                {teacher.email && (
                  <a
                    className="icon-btn"
                    href={`mailto:${teacher.email}`}
                    title={`Email ${teacher.name}`}
                    aria-label={`Send email to ${teacher.name}`}
                  >
                    <Mail size={18} />
                  </a>
                )}
                <button className="action-btn" onClick={() => setSelectedTeacher(teacher)}>
                  <DollarSign size={14} /> View Payroll
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Parents Tab — who can actually sign in, and the invite queue */}
      {activeTab === 'parents' && (
        <>
          {manualInvite && (
            <div className="invite-manual-banner">
              <div>
                <strong>{manualInvite.name}'s account is ready, but the email didn't go out.</strong>
                <p>Send them this link yourself — it lets them set a password, so treat it like one.</p>
                <code>{manualInvite.link}</code>
              </div>
              <div className="invite-manual-actions">
                <button
                  className="action-btn"
                  onClick={() => {
                    navigator.clipboard?.writeText(manualInvite.link);
                    toast.success('Link copied.');
                  }}
                >
                  <Copy size={14} /> Copy link
                </button>
                <button className="action-btn outline" onClick={() => setManualInvite(null)}>Dismiss</button>
              </div>
            </div>
          )}

          {filteredParents.length === 0 ? (
            <div className="empty-state">
              <Users size={32} />
              <p>No parents match your search.</p>
            </div>
          ) : (
            <div className="students-grid">
              {filteredParents.map(parent => {
                const familyName = parent.familyMembers?.[0]?.family?.name;
                return (
                  <div key={parent.id} className="premium-card student-card">
                    <div className="card-top">
                      <div className="student-main-info">
                        <div className="student-avatar parent-avatar">{parent.fullName[0]}</div>
                        <div>
                          <h3 className="student-name">{parent.fullName}</h3>
                          {parent.canSignIn ? (
                            <span className="access-tag active"><CheckCircle2 size={13} /> Can sign in</span>
                          ) : parent.invitedAt ? (
                            <span className="access-tag invited">
                              <Clock size={13} /> Invited {new Date(parent.invitedAt).toLocaleDateString('en-US')}
                            </span>
                          ) : (
                            <span className="access-tag none">No portal access</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="card-details">
                      <div className="detail-item">
                        <span className="detail-label">Email:</span>
                        <span style={{ fontSize: '13px' }}>
                          {parent.emailUsable ? parent.email : <em>No real email on file</em>}
                        </span>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">Family:</span>
                        <span style={{ fontSize: '13px' }}>{familyName || '—'}</span>
                      </div>
                    </div>

                    <div className="card-actions">
                      {parent.emailUsable ? (
                        <button
                          className="action-btn primary"
                          onClick={() => handleInvite(parent)}
                          disabled={invitingId === parent.id}
                        >
                          <Send size={14} />
                          {invitingId === parent.id
                            ? 'Sending…'
                            : parent.invitedAt ? 'Resend invite' : 'Send invite'}
                        </button>
                      ) : (
                        <span className="invite-blocked-hint">
                          <AlertCircle size={14} /> Add their email first
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {selectedStudent && (
        <StudentProfileModal
          student={selectedStudent} 
          onClose={() => setSelectedStudent(null)} 
          onUpdate={loadData}
        />
      )}

      {selectedTeacher && (
        <TeacherProfileModal
          teacher={selectedTeacher}
          onClose={() => setSelectedTeacher(null)}
        />
      )}

      {isSnackManagerOpen && (
        <SnackCabinetModal 
          mode="manage"
          onClose={() => setIsSnackManagerOpen(false)}
        />
      )}

      {showAddModal && (
        <AddStudentModal
          onClose={() => setShowAddModal(false)}
          onSaved={loadData}
          families={families}
        />
      )}

      {showImportModal && (
        <ImportStudentsModal
          onClose={() => setShowImportModal(false)}
          onImported={loadData}
        />
      )}
    </div>
  );
};

export default StudentsList;
