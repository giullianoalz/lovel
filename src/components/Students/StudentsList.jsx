import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, UserPlus, AlertCircle, Cookie, Mail, MessageSquare, ShoppingBag, GraduationCap, DollarSign, Briefcase, UploadCloud } from 'lucide-react';
import { database } from '../../lib/database';
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
  const { role } = useAuth();
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

  useEffect(() => {
    loadData();
    loadTeachers();
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

  const handleAddStudent = (newStudent) => {
    setStudents(prev => [...prev, newStudent]);
    setShowAddModal(false);
  };

  return (
    <div className="students-container">
      <header className="students-header">
        <div>
          <h1>Directory</h1>
          <p className="text-muted">
            {activeTab === 'students' 
              ? `Total Enrolled: ${students.length}` 
              : `Total Teachers: ${teachers.length}`}
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
              {role === 'ADMIN' && (
                <>
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
        {role === 'ADMIN' && (
          <button
            className={`dir-tab ${activeTab === 'teachers' ? 'active' : ''}`}
            onClick={() => { setActiveTab('teachers'); setSearchQuery(''); setStatusFilter('All'); }}
          >
            <Briefcase size={18} />
            <span>Teachers & Payroll</span>
            <span className="tab-count">{teachers.length}</span>
          </button>
        )}
      </div>

      <div className="search-filter-row">
        <div className="search-input-wrapper">
          <Search size={18} className="search-icon" />
          <input 
            type="text" 
            placeholder={activeTab === 'students' ? "Search by name..." : "Search teachers..."} 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="filter-chips">
          {['All', 'Active', 'Inactive'].map(status => (
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
            <div className="loading-state">Loading academy records...</div>
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
                    {role !== 'TEACHER' && student.parentEmail && student.parentEmail !== 'N/A' && (
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
          onSave={handleAddStudent}
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
