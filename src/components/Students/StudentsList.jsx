import React, { useState, useEffect } from 'react';
import { Search, UserPlus, Filter, AlertCircle, Cookie, MoreHorizontal, Mail, MessageSquare } from 'lucide-react';
import { database } from '../../lib/database';
import './StudentsList.css';

const StudentsList = () => {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await database.fetchStudents();
        setStudents(data);
      } catch (error) {
        console.error("Error loading students:", error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const filteredStudents = students.filter(student => 
    student.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="students-container">
      <header className="students-header">
        <div>
          <h1>Student Directory</h1>
          <p className="text-muted">Total Enrolled: {students.length}</p>
        </div>
        <button className="action-btn primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <UserPlus size={18} />
          <span>Add New Student</span>
        </button>
      </header>

      <div className="search-filter-row">
        <div className="search-input-wrapper">
          <Search size={18} className="search-icon" />
          <input 
            type="text" 
            placeholder="Search by name..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <button className="action-btn">
          <Filter size={18} />
        </button>
      </div>

      {loading ? (
        <div className="loading-state">Loading academy records...</div>
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
                <button className="icon-btn"><MoreHorizontal size={20} /></button>
              </div>

              <div className="card-details">
                <div className="detail-item">
                  <span className="detail-label">Allergies:</span>
                  <span className={student.allergies !== 'None' ? 'allergy-alert' : ''}>
                    {student.allergies === 'None' ? (
                      'No reported allergies'
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <AlertCircle size={14} />
                        {student.allergies}
                      </div>
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
                <button className="icon-btn" title="Send Email"><Mail size={18} /></button>
                <button className="icon-btn" title="Internal Chat"><MessageSquare size={18} /></button>
                <button className="action-btn">View Profile</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default StudentsList;
