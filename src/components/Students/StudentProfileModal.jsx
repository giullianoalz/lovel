import React, { useState, useEffect, useRef } from 'react';
import { X, Cookie, AlertCircle, ShoppingBag, History, FileText, Download, Eye, Search, Star, Gift, Check, TrendingDown, CreditCard } from 'lucide-react';
import { database } from '../../lib/database';
import SnackCabinetModal from './SnackCabinetModal';
import './StudentProfileModal.css';

const StudentProfileModal = ({ student, onClose, onUpdate }) => {
  const [snackCabinet, setSnackCabinet] = useState([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [showCabinet, setShowCabinet] = useState(false);
  const [materialSearch, setMaterialSearch] = useState('');
  
  // Redeem state
  const [showRedeem, setShowRedeem] = useState(false);
  const [redeemItem, setRedeemItem] = useState('');
  const [redeemCost, setRedeemCost] = useState('');
  const [redeeming, setRedeeming] = useState(false);

  const isLowBalance = student.snackPunches < 7;
  const isNegative = student.snackPunches < 0;

  const filteredMaterials = (student.materials || []).filter(m => 
    m.name.toLowerCase().includes(materialSearch.toLowerCase()) ||
    m.subject.toLowerCase().includes(materialSearch.toLowerCase())
  );

  const handleRedeem = async () => {
    if (!redeemItem || !redeemCost || redeeming) return;
    setRedeeming(true);
    const result = await database.redeemPrizePoints(student.id, redeemItem, redeemCost);
    if(result && result.success) {
      onUpdate(); // Trigger parent refresh to get updated student data
      setShowRedeem(false);
      setRedeemItem('');
      setRedeemCost('');
    } else {
      alert("Error redeeming: " + (result?.error || 'Unknown error'));
    }
    setRedeeming(false);
  };

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
              <p style={{ marginBottom: '8px' }}><strong>Allergies:</strong> {student.allergies || 'None'}</p>

              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-light)' }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: 'var(--text-main)' }}>Parent / Guardian</h4>
                <p style={{ marginBottom: '4px' }}><strong>Name:</strong> {student.parentName || 'N/A'}</p>
                <p style={{ marginBottom: '4px' }}><strong>Phone:</strong> {student.parentPhone || 'N/A'}</p>
                <p style={{ marginBottom: '0' }}><strong>Email:</strong> {student.parentEmail || 'N/A'}</p>
              </div>
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

            <div className="info-card history-card" style={{marginTop: '20px'}}>
              <h3 style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                <Star size={18} fill="currentColor" color="#fbbf24" /> Prize History
              </h3>
              {student.prizeHistory && student.prizeHistory.length > 0 ? (
                <ul className="snack-history-list">
                  {student.prizeHistory.map(record => {
                    const dateObj = new Date(record.date);
                    const isEarned = record.type === 'earned';
                    return (
                      <li key={record.id} className="history-item">
                        <div>
                          <strong>{record.reason}</strong>
                          <div className="text-muted" style={{fontSize: '12px'}}>
                            {dateObj.toLocaleDateString()} at {dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                          </div>
                        </div>
                        <span className={`punch-cost ${isEarned ? 'earned' : 'redeemed'}`}>
                          {isEarned ? '+' : ''}{record.points} pts
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-muted">No prize points earned yet.</p>
              )}
            </div>
          </div>

          {/* Right Column: Snack Card & Academic Materials */}
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

              <button 
                className="action-btn primary shop-btn" 
                onClick={() => setShowCabinet(true)}
                style={{marginTop: '20px', width: '100%', background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)', backdropFilter: 'blur(10px)'}}
              >
                <ShoppingBag size={18} />
                <span>Shop Snacks</span>
              </button>
            </div>

            <div className="snack-card-container prize-card">
              <div className="snack-balance-header">
                <h3><Star size={20} fill="currentColor" /> Prize Points</h3>
                <div className="punch-balance">
                  <span className="punch-number">{student.prizePoints || 0}</span>
                  <span className="punch-label">Total Points</span>
                </div>
              </div>
              
              {!showRedeem ? (
                <button 
                  className="action-btn primary shop-btn prize-btn" 
                  onClick={() => setShowRedeem(true)}
                  style={{marginTop: '20px', width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(0,0,0,0.1)'}}
                >
                  <Gift size={18} />
                  <span>Redeem Prize</span>
                </button>
              ) : (
                <div className="redeem-form">
                  <input 
                    type="text" 
                    placeholder="Physical Prize (e.g. Teddy Bear)" 
                    value={redeemItem}
                    onChange={e => setRedeemItem(e.target.value)}
                    className="prize-input"
                  />
                  <div style={{display: 'flex', gap: '10px', alignItems: 'center'}}>
                    <input 
                      type="number" 
                      placeholder="Points" 
                      value={redeemCost}
                      onChange={e => setRedeemCost(e.target.value)}
                      className="prize-input points"
                    />
                    <button className="action-btn primary" onClick={handleRedeem} disabled={redeeming || !redeemItem || !redeemCost}>
                      <Check size={16} /> Confirm
                    </button>
                    <button className="icon-btn" onClick={() => setShowRedeem(false)} style={{background: 'rgba(255,255,255,0.2)', color: 'white'}}>
                      <X size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Notes panel — right side */}
            {(student.medicalNotes || student.accommodationNotes) && (
              <div className="info-card notes-panel-card">
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>📋 Notes</h3>
                {student.medicalNotes && (
                  <div className="note-block medical-note">
                    <span className="note-block-label">Medical</span>
                    <p>{student.medicalNotes}</p>
                  </div>
                )}
                {student.accommodationNotes && (
                  <div className="note-block accommodation-note">
                    <span className="note-block-label">Accommodation</span>
                    <p>{student.accommodationNotes}</p>
                  </div>
                )}
              </div>
            )}

            {/* Payment summary */}
            <div className="info-card payment-card">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CreditCard size={18} /> Account Balance
              </h3>
              {student.familyId ? (
                <div className="payment-summary">
                  <div className="payment-row">
                    <span>Balance owing</span>
                    <span className={`payment-amount ${(student.balanceOwing || 0) > 0 ? 'owing' : 'clear'}`}>
                      {(student.balanceOwing || 0) > 0 ? `$${student.balanceOwing.toFixed(2)}` : 'Paid up ✓'}
                    </span>
                  </div>
                  {student.nextInvoiceDate && (
                    <div className="payment-row">
                      <span>Next invoice</span>
                      <span className="payment-date">{new Date(student.nextInvoiceDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    </div>
                  )}
                  <button
                    className="view-billing-btn"
                    onClick={() => window.location.href = `/billing?family=${student.familyId}`}
                  >
                    <CreditCard size={14} /> View Full Account
                  </button>
                </div>
              ) : (
                <p className="text-muted" style={{ fontSize: '13px' }}>No family account linked.</p>
              )}
            </div>

            <div className="info-card materials-card">
              <header className="section-header-row">
                <h3 style={{display: 'flex', alignItems: 'center', gap: '8px', margin: 0}}>
                  <FileText size={18} /> Academic Materials
                </h3>
                <div className="mini-search">
                  <Search size={14} />
                  <input 
                    type="text" 
                    placeholder="Filter by subject or name..." 
                    value={materialSearch}
                    onChange={(e) => setMaterialSearch(e.target.value)}
                  />
                </div>
              </header>

              <div className="materials-list">
                {filteredMaterials.length > 0 ? (
                  filteredMaterials.map(item => (
                    <div key={item.id} className="material-item">
                      <div className="material-info">
                        <span className="material-name">{item.name}</span>
                        <div className="material-meta">
                          <span className="subject-tag">{item.subject}</span>
                          <span className="divider">•</span>
                          <span>{item.date}</span>
                        </div>
                      </div>
                      <div className="material-actions">
                        <button 
                          className="icon-btn tiny" 
                          title="Preview" 
                          onClick={() => window.open(item.fileUrl, '_blank')}
                        >
                          <Eye size={16} />
                        </button>
                        <a 
                          href={item.fileUrl} 
                          download 
                          className="icon-btn tiny" 
                          title="Download"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Download size={16} />
                        </a>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-muted" style={{padding: '20px 0', textAlign: 'center'}}>
                    No materials found matching your search.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Snack Cabinet Pop-up Overlay */}
        {showCabinet && (
          <SnackCabinetModal 
            mode="purchase"
            student={student}
            onClose={() => setShowCabinet(false)}
            onUpdate={onUpdate}
          />
        )}
      </div>
    </div>
  );
};

export default StudentProfileModal;
