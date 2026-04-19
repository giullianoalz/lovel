import React, { useState, useEffect } from 'react';
import { database } from '../../lib/database';
import { Check, X, Cookie, AlertTriangle, Clock, Users } from 'lucide-react';
import './ClassSession.css';

const ClassSession = () => {
  const [students, setStudents] = useState([]);
  const [attendance, setAttendance] = useState({});
  const [snackLogged, setSnackLogged] = useState({});

  useEffect(() => {
    const loadStudents = async () => {
      const data = await database.fetchStudents();
      setStudents(data);
      // Initialize states
      const initialAttendance = {};
      data.forEach(s => initialAttendance[s.id] = 'present');
      setAttendance(initialAttendance);
    };
    loadStudents();
  }, []);

  const togglePresence = (id, status) => {
    setAttendance(prev => ({ ...prev, [id]: status }));
  };

  const handleSnackLog = async (studentId) => {
    const success = await database.logSnackConsumption(studentId);
    if (success) {
      setSnackLogged(prev => ({ ...prev, [studentId]: true }));
    }
  };

  return (
    <div className="session-container">
      <header className="session-header">
        <div className="class-info">
          <div>
            <h1>Math Foundations - Group A</h1>
            <p className="text-muted" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={16} /> 4:00 PM - 5:30 PM | <Users size={16} /> {students.length} Students
            </p>
          </div>
          <button className="action-btn primary">Complete Session</button>
        </div>
      </header>

      <div className="table-responsive">
        <table className="attendance-table">
          <thead>
            <tr>
              <th align="left">Student</th>
              <th align="center">Attendance</th>
              <th align="right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {students.map(student => (
              <tr key={student.id} className="attendance-row">
                <td>
                  <div>
                    <div className="student-name">{student.name}</div>
                    {student.allergies !== 'None' && (
                      <div style={{ color: '#c53030', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '600' }}>
                        <AlertTriangle size={12} /> ALLERGIES: {student.allergies}
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
                  <div className="attendance-actions">
                    <button 
                      className="snack-btn"
                      disabled={!student.snackAuthorized || snackLogged[student.id]}
                      onClick={() => handleSnackLog(student.id)}
                    >
                      <Cookie size={18} />
                      <span>{snackLogged[student.id] ? 'Snack Logged' : 'Log Snack'}</span>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="allergy-warning">
        <AlertTriangle size={24} />
        <div>
          <h4 style={{ margin: 0 }}>Active Safety Alert</h4>
          <p style={{ margin: '4px 0 0', fontSize: '14px' }}>
            Please review the highlighted medical specifications above before providing any refreshments.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ClassSession;
