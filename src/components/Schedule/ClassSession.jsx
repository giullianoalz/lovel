import React, { useState, useEffect } from 'react';
import { database } from '../../lib/database';
import { Check, X, Cookie, AlertTriangle, Clock, Users, Star, Gift } from 'lucide-react';
import './ClassSession.css';

const ClassSession = () => {
  const [students, setStudents] = useState([]);
  const [attendance, setAttendance] = useState({});
  const [snackLogged, setSnackLogged] = useState({});
  const [selectedForPrize, setSelectedForPrize] = useState({});
  const [prizePoints, setPrizePoints] = useState('');
  const [prizeReason, setPrizeReason] = useState('');
  const [awarding, setAwarding] = useState(false);

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

  const selectedCount = Object.values(selectedForPrize).filter(Boolean).length;

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

      {/* Prize Points Award Panel */}
      <div className="prize-award-panel">
        <div className="prize-panel-header">
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Star fill="currentColor" size={20} color="#fbbf24" />
            Award Prize Points
          </h3>
          <button className="action-btn outline small" onClick={selectAllPresent}>
            Select All Present
          </button>
        </div>
        <div className="prize-panel-body">
          <div className="prize-inputs">
            <input 
              type="text" 
              placeholder="Reason (e.g. Good Participation)" 
              value={prizeReason}
              onChange={(e) => setPrizeReason(e.target.value)}
              className="prize-input"
            />
            <input 
              type="number" 
              placeholder="Points" 
              value={prizePoints}
              onChange={(e) => setPrizePoints(e.target.value)}
              className="prize-input points"
              min="1"
            />
          </div>
          <button 
            className="action-btn primary" 
            onClick={handleAwardPoints}
            disabled={awarding || selectedCount === 0 || !prizePoints || !prizeReason}
          >
            <Gift size={16} style={{marginRight: '8px'}} />
            Award to {selectedCount} Students
          </button>
        </div>
      </div>

      <div className="table-responsive">
        <table className="attendance-table">
          <thead>
            <tr>
              <th width="40px" align="center"></th>
              <th align="left">Student</th>
              <th align="center">Attendance</th>
              <th align="right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {students.map(student => (
              <tr key={student.id} className={`attendance-row ${selectedForPrize[student.id] ? 'selected-row' : ''}`}>
                <td align="center">
                  <input 
                    type="checkbox" 
                    checked={!!selectedForPrize[student.id]}
                    onChange={() => togglePrizeSelection(student.id)}
                    className="custom-checkbox"
                  />
                </td>
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
