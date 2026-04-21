import React, { useState, useEffect } from 'react';
import { X, Cookie, AlertCircle, ShoppingBag, History, CreditCard } from 'lucide-react';
import { database } from '../../lib/database';
import './StudentProfileModal.css';

const StudentProfileModal = ({ student, onClose, onUpdate }) => {
  const [snackCabinet, setSnackCabinet] = useState([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);

  useEffect(() => {
    const loadCabinet = async () => {
      const snacks = await database.getSnackCabinet();
      setSnackCabinet(snacks);
      setLoading(false);
    };
    loadCabinet();
  }, []);

  const handlePurchase = async (snack) => {
    if(purchasing) return;
    setPurchasing(true);
    
    const result = await database.purchaseSnack(student.id, snack.id);
    if(result && result.success) {
      onUpdate(); // Trigger parent refresh to get updated student data
    }
    setPurchasing(false);
  };

  const isLowBalance = student.snackPunches < 7;
  const isNegative = student.snackPunches < 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content profile-modal" onClick={e => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}><X size={24} /></button>
        
        <header className="profile-header">
          <div className="student-main-info">
            <div className="student-avatar large">{student.name[0]}</div>
            <div>
              <h2 className="student-name" style={{fontSize: '24px', margin: '0 0 4px 0'}}>{student.name}</h2>
              <span className={`status-tag ${student.status.replace(' ', '').toLowerCase()}`}>
                {student.status}
              </span>
            </div>
          </div>
        </header>

        <div className="profile-body">
          {/* Left Column: Details & History */}
          <div className="profile-col">
            <div className="info-card">
              <h3>Health & Details</h3>
              <p><strong>Allergies:</strong> {student.allergies}</p>
            </div>

            <div className="info-card history-card">
              <h3 style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                <History size={18} /> Snack History
              </h3>
              {student.snackHistory && student.snackHistory.length > 0 ? (
                <ul className="snack-history-list">
                  {student.snackHistory.map(record => {
                    const dateObj = new Date(record.date);
                    return (
                      <li key={record.id} className="history-item">
                        <div>
                          <strong>{record.snackName}</strong>
                          <div className="text-muted" style={{fontSize: '12px'}}>
                            {dateObj.toLocaleDateString()} at {dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                          </div>
                        </div>
                        <span className="punch-cost">-{record.cost} Punches</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-muted">No snacks consumed yet.</p>
              )}
            </div>
          </div>

          {/* Right Column: Snack Card & Cabinet */}
          <div className="profile-col">
            <div className={`snack-card-container ${isNegative ? 'negative' : (isLowBalance ? 'warning' : 'healthy')}`}>
              <div className="snack-balance-header">
                <h3><Cookie size={20} /> Snack Card</h3>
                <div className="punch-balance">
                  <span className="punch-number">{student.snackPunches}</span>
                  <span className="punch-label">Punches</span>
                </div>
              </div>
              
              {isNegative && (
                <div className="snack-alert error">
                  <AlertCircle size={16} /> Balance is negative. Charges will be added to the next invoice.
                </div>
              )}
              {(!isNegative && isLowBalance) && (
                <div className="snack-alert warning">
                  <AlertCircle size={16} /> Low balance! Parent will be prompted to reload on the next cycle.
                </div>
              )}
            </div>

            <div className="snack-cabinet">
              <h3 style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px'}}>
                <ShoppingBag size={18} /> Snack Cabinet
              </h3>
              
              {loading ? (
                <p>Loading cabinet...</p>
              ) : (
                <div className="cabinet-grid">
                  {snackCabinet.map(snack => (
                    <div key={snack.id} className="snack-item" onClick={() => handlePurchase(snack)}>
                      <img src={snack.image} alt={snack.name} className="snack-img" />
                      <div className="snack-info">
                        <span className="snack-name">{snack.name}</span>
                        <span className="snack-cost">{snack.costPunches} Punches</span>
                      </div>
                      <button className="action-btn primary small outline" disabled={purchasing}>
                        Select
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StudentProfileModal;
