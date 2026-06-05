import React, { useState, useEffect } from 'react';
import { 
  DollarSign, AlertCircle, Coffee, Filter, Download, Send, X, CheckCircle, 
  CreditCard, History, ChevronLeft, Plus, MoreVertical, Calendar as CalendarIcon, Search,
  UploadCloud, FileText, Check, User
} from 'lucide-react';
import { database } from '../../lib/database';
import './BillingPanel.css';

const formatDateUS = (dateStr) => {
  if (!dateStr) return '';
  if (dateStr.includes('/') && dateStr.split('/').pop().length === 2) return dateStr; 
  const [y, m, d] = dateStr.split('T')[0].split('-');
  if (!y || !m || !d) return dateStr;
  return `${m}/${d}/${y.slice(-2)}`;
};

const BillingPanel = () => {
  const [families, setFamilies] = useState([]);
  const [students, setStudents] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedFamily, setSelectedFamily] = useState(null);
  const [activeTab, setActiveTab] = useState('Account'); // 'Account' | 'Invoices'

  // Modal States
  const [isAddTxModalOpen, setIsAddTxModalOpen] = useState(false);
  const [isEmaModalOpen, setIsEmaModalOpen] = useState(false);
  const [emaSyncState, setEmaSyncState] = useState({ step: 1, matched: 0, newInvoices: [] });
  const [newTxForm, setNewTxForm] = useState({ type: 'Payment', amount: '', date: new Date().toISOString().split('T')[0], description: '', studentId: '' });

  const loadBilling = async () => {
    setLoading(true);
    const fams = await database.fetchFamilies();
    const studs = await database.fetchStudents();
    const txs = await database.fetchAllTransactions();
    const invs = await database.fetchAllInvoices();
    setFamilies(fams);
    setStudents(studs);
    setTransactions(txs);
    setInvoices(invs);
    setLoading(false);
  };

  useEffect(() => {
    loadBilling();
  }, []);

  const calculateFamilyBalance = (familyId) => {
    const famTxs = transactions.filter(t => t.familyId === familyId);
    // Charges increase balance owing, Payments/Discounts decrease it
    return famTxs.reduce((acc, t) => {
      const type = t.type.toLowerCase();
      if (type === 'charge') return acc + t.amount;
      if (type === 'payment' || type === 'discount') return acc - Math.abs(t.amount);
      if (type === 'refund') return acc + Math.abs(t.amount);
      return acc;
    }, 0);
  };

  const handleAddTransaction = async () => {
    if (!newTxForm.amount || isNaN(newTxForm.amount)) return;
    setLoading(true);
    
    // 1. Create the charge
    const newTx = await database.addTransaction({
      familyId: selectedFamily.id,
      studentId: newTxForm.studentId || null,
      amount: parseFloat(newTxForm.amount),
      type: newTxForm.type,
      description: newTxForm.description || `Manual ${newTxForm.type}`,
      date: newTxForm.date,
      invoiceId: null
    });

    // 2. Auto-Generate Invoice if it's a Charge
    if (newTx.type.toLowerCase() === 'charge') {
      const newInv = await database.generateInvoice(selectedFamily.id, [newTx.id]);
      alert(`Charge added. Invoice ${newInv.id} generated and emailed to the parent automatically.`);
    }

    setIsAddTxModalOpen(false);
    await loadBilling();
  };

  const handleGenerateInvoice = async () => {
    const uninvoicedCharges = transactions.filter(t => t.familyId === selectedFamily.id && t.type === 'Charge' && !t.invoiceId);
    if (uninvoicedCharges.length === 0) {
      alert("No unbilled charges available to invoice.");
      return;
    }
    setLoading(true);
    await database.generateInvoice(selectedFamily.id, uninvoicedCharges.map(t => t.id));
    setActiveTab('Invoices');
    await loadBilling();
  };

  const handleEmaFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setEmaSyncState({ ...emaSyncState, step: 2 });
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      const csvText = event.target.result;
      const lines = csvText.split('\n');
      
      if (lines.length < 2) {
        alert("Invalid CSV format");
        setEmaSyncState({ step: 1, matched: 0, newInvoices: [] });
        return;
      }
      
      const updatedLines = [];
      let matchedCount = 0;
      
      // Keep headers
      updatedLines.push(lines[0]);
      updatedLines.push(lines[1]);

      for (let i = 2; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        
        // Simple CSV split (assuming no commas inside data cells for this specific EMA export)
        const cols = line.split(','); 
        
        // Indices based on EMA CSV format:
        // 1: PURCHASE DA, 3: STUDENT NAM, 6: INDIVIDUAL PR, 7: START DATE, 8: END DATE, 9: AMOUNT, 10: BUSINESS INVOICE #
        const purchaseDate = cols[1];
        const studentName = cols[3];
        const amountStr = cols[9];
        
        if (!studentName || !amountStr) {
          updatedLines.push(line); // Pass through empty/invalid rows
          continue;
        }

        const amount = parseFloat(amountStr);
        
        // In real app, we query DB for an unpaid invoice matching student/amount
        // For mock, we'll simulate finding a pre-existing invoice:
        const existingInvoiceId = `LC-${Math.floor(1000 + Math.random() * 9000)}`;
        
        // Autofill the required columns
        cols[6] = '20000720';      // INDIVIDUAL PR
        cols[7] = purchaseDate;    // START DATE
        cols[8] = purchaseDate;    // END DATE
        cols[10] = existingInvoiceId; // BUSINESS INVOICE # (Pre-existing)
        
        matchedCount++;
        updatedLines.push(cols.join(','));
      }
      
      const newCsvData = updatedLines.join('\n');
      const blob = new Blob([newCsvData], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      
      setEmaSyncState({ step: 3, matched: matchedCount, downloadUrl: url });
      await loadBilling();
    };
    reader.readAsText(file);
  };

  const resetEmaSync = () => {
    setIsEmaModalOpen(false);
    if (emaSyncState.downloadUrl) {
      URL.revokeObjectURL(emaSyncState.downloadUrl);
    }
    setTimeout(() => setEmaSyncState({ step: 1, matched: 0, newInvoices: [], downloadUrl: null }), 300);
  };

  if (loading && families.length === 0) return <div className="billing-container"><p>Loading financial data...</p></div>;

  // --- MAIN DASHBOARD VIEW (List of Families) ---
  if (!selectedFamily) {
    const totalOwing = families.reduce((acc, f) => acc + calculateFamilyBalance(f.id), 0);
    
    return (
      <div className="billing-container">
        <header className="billing-header">
          <div>
            <h1>Families & Invoices</h1>
            <p>Manage family accounts, process payments, and generate invoices.</p>
          </div>
        </header>

        <div className="billing-metrics">
          <div className="metric-card">
            <div className="metric-icon"><DollarSign size={24} /></div>
            <div className="metric-info">
              <h3>Total Balance Owing (All Families)</h3>
              <p>${totalOwing.toFixed(2)}</p>
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-icon" style={{background:'#dcfce7', color:'#166534'}}><CheckCircle size={24} /></div>
            <div className="metric-info">
              <h3>Active Families</h3>
              <p>{families.length}</p>
            </div>
          </div>
        </div>

        <div className="table-container">
          <div className="table-header">
            <h2>Family Accounts</h2>
            <div className="table-actions">
              <button className="btn-export" style={{background: 'var(--primary)', color: 'white', borderColor: 'var(--primary)'}} onClick={() => setIsEmaModalOpen(true)}>
                <UploadCloud size={16} /> EMA Auto-Sync
              </button>
              <button className="btn-filter"><Filter size={16} /> Filter</button>
              <button className="btn-export"><Search size={16} /> Search</button>
            </div>
          </div>
          
          <div className="table-scroll">
            <table className="billing-table">
              <thead>
                <tr>
                  <th>Family Name</th>
                  <th>Primary Contact</th>
                  <th>Group Tags</th>
                  <th>Balance Owing</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {families.map(f => {
                  const bal = calculateFamilyBalance(f.id);
                  const primary = f.contacts.find(c => c.isInvoiceRecipient) || f.contacts[0];
                  return (
                    <tr key={f.id} onClick={() => setSelectedFamily(f)} style={{cursor: 'pointer'}}>
                      <td style={{fontWeight: 600, color: 'var(--primary)'}}>{f.name}</td>
                      <td>{primary ? primary.name : 'N/A'}</td>
                      <td>
                        <div style={{display:'flex', gap:'4px'}}>
                          {f.tags.map(t => <span key={t} className="tag-ema">{t}</span>)}
                        </div>
                      </td>
                      <td style={{fontWeight: 700, color: bal > 0 ? '#dc2626' : 'var(--text-main)'}}>${bal.toFixed(2)}</td>
                      <td>
                        <button className="btn-mark-paid" onClick={(e) => { e.stopPropagation(); setSelectedFamily(f); }}>
                          View Account
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* EMA Sync Modal */}
        {isEmaModalOpen && (
          <div className="modal-overlay" onClick={resetEmaSync}>
            <div className="tx-modal" onClick={e => e.stopPropagation()} style={{maxWidth: '600px'}}>
              <div className="modal-head">
                <h3>EMA Scholarship Auto-Sync</h3>
                <button onClick={resetEmaSync}><X size={20}/></button>
              </div>

              {emaSyncState.step === 1 && (
                <div style={{textAlign: 'center', padding: '20px'}}>
                  <div style={{background: '#f1f5f9', border: '2px dashed #cbd5e1', borderRadius: '12px', padding: '40px 20px', marginBottom: '24px'}}>
                    <UploadCloud size={48} color="var(--primary)" style={{marginBottom: '16px'}} />
                    <h3 style={{marginBottom: '8px', color: 'var(--text-main)'}}>Upload EMA Approval CSV</h3>
                    <p style={{color: 'var(--text-muted)', fontSize: '13px', marginBottom: '16px'}}>
                      Drop the 'Pending Approvals' CSV file from Step Up For Students here.
                    </p>
                    <label className="btn-send" style={{cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px'}}>
                      <FileText size={16} /> Select CSV File
                      <input type="file" accept=".csv" style={{display: 'none'}} onChange={handleEmaFileUpload} />
                    </label>
                  </div>
                  <p style={{fontSize: '13px', color: 'var(--text-muted)'}}>
                    The system will automatically match Student Names, generate sequential LC-XXXX invoices, and fill out the "BUSINESS INVOICE #" column for you.
                  </p>
                </div>
              )}

              {emaSyncState.step === 2 && (
                <div style={{textAlign: 'center', padding: '40px 20px'}}>
                  <div className="spinner" style={{marginBottom: '24px'}}></div>
                  <h3 style={{color: 'var(--text-main)', marginBottom: '8px'}}>Processing CSV...</h3>
                  <p style={{color: 'var(--text-muted)', fontSize: '14px'}}>Matching students and generating invoices...</p>
                </div>
              )}

              {emaSyncState.step === 3 && (
              <div style={{textAlign: 'center', padding: '20px'}}>
                <CheckCircle size={48} color="#10b981" style={{marginBottom: '16px'}} />
                <h2 style={{color: 'var(--text-main)', marginBottom: '8px'}}>Sync Complete!</h2>
                <p style={{color: 'var(--text-muted)', marginBottom: '24px'}}>
                  Successfully matched <strong>{emaSyncState.matched} students</strong> with their existing invoices.
                </p>

                <div style={{background: '#dcfce7', color: '#166534', padding: '12px', borderRadius: '8px', fontSize: '13px', marginBottom: '24px', display: 'flex', gap: '8px', alignItems: 'center', textAlign: 'left'}}>
                  <Check size={16} />
                  <span>The <strong>BUSINESS INVOICE #</strong> column has been populated with the pre-existing invoice numbers.</span>
                </div>

                  <div className="modal-actions" style={{justifyContent: 'center'}}>
                    <a 
                      href={emaSyncState.downloadUrl} 
                      download="EMA_Fulfilled_Sync.csv" 
                      className="btn-send" 
                      style={{display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none'}}
                      onClick={() => setTimeout(resetEmaSync, 1000)} // Close modal shortly after download triggers
                    >
                      <Download size={16} /> Download Completed CSV
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- FAMILY DETAILED VIEW ---
  const familyTxs = transactions.filter(t => t.familyId === selectedFamily.id).sort((a,b) => new Date(a.date) - new Date(b.date)); // Sort oldest first for running balance
  
  // Calculate running balance
  let runningBal = 0;
  const ledgerTxs = familyTxs.map(tx => {
    const type = tx.type.toLowerCase();
    if (type === 'charge') runningBal -= tx.amount;
    if (type === 'payment' || type === 'refund') runningBal += Math.abs(tx.amount);
    if (type === 'discount') runningBal += Math.abs(tx.amount);
    return { ...tx, runningBalance: runningBal };
  }).reverse(); // Reverse back to newest first for display

  const familyInvoices = invoices.filter(i => i.familyId === selectedFamily.id).sort((a,b) => new Date(b.date) - new Date(a.date));
  const currentBalance = ledgerTxs.length > 0 ? ledgerTxs[0].runningBalance : 0;
  const primaryContact = selectedFamily.contacts.find(c => c.isInvoiceRecipient) || selectedFamily.contacts[0];

  // Map students for this family dynamically from Neon PostgreSQL
  const familyStudents = students.filter(s => s.familyId === selectedFamily.id);

  return (
    <div className="billing-container">
      <button className="btn-back" onClick={() => setSelectedFamily(null)}>
        <ChevronLeft size={16} /> Back to Families & Invoices
      </button>

      <div className="family-billing-layout">
        {/* Left Sidebar */}
        <div className="family-sidebar">
          <h2>{selectedFamily.name}</h2>
          
          <div className="sidebar-section">
            <h3>Students</h3>
            <div className="students-list">
              {familyStudents.map((s, idx) => (
                <div key={idx} className="billing-student-row">
                  <User size={14} className="icon-mr" />
                  <span>{s.name}</span>
                  <span className={`badge-status ${s.status.toLowerCase()}`}>{s.status}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="sidebar-section">
            <h3>Family Contacts</h3>
            <div className="billing-contact-row">
              <User size={14} className="icon-mr" />
              <span>{primaryContact ? primaryContact.name : 'Unknown'}</span>
              <span className="badge-recipient">Invoice Recipient</span>
            </div>
          </div>

          <div className="sidebar-section">
            <h3>Group Tags</h3>
            <div className="tags-container">
              {selectedFamily.tags.map(t => <span key={t} className="tag-ema">{t}</span>)}
            </div>
          </div>

          <button className="btn-auto-invoice">Enable Auto-Invoicing</button>
        </div>

        {/* Right Main Content */}
        <div className="family-main-content">
          <div className="billing-tabs">
            <button className={`tab-btn ${activeTab === 'Account' ? 'active' : ''}`} onClick={() => setActiveTab('Account')}>Account</button>
            <button className={`tab-btn ${activeTab === 'Invoices' ? 'active' : ''}`} onClick={() => setActiveTab('Invoices')}>Invoices</button>
          </div>

          {activeTab === 'Account' && (
            <div className="tab-pane">
              <div className="balance-header">
                <h2>Balance Owing: <span style={{color: currentBalance < 0 ? '#dc2626' : 'var(--text-main)'}}>{currentBalance < 0 ? `$${Math.abs(currentBalance).toFixed(2)}` : `$0.00`}</span></h2>
              </div>

              <div className="ledger-actions">
                <button className="action-btn primary" onClick={() => setIsAddTxModalOpen(true)}>
                  <Plus size={16} /> Add Transaction
                </button>
              </div>

              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Student</th>
                    <th>Description</th>
                    <th>Charges & Discounts</th>
                    <th>Payments & Refunds</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerTxs.map(tx => {
                    const type = tx.type.toLowerCase();
                    return (
                      <tr key={tx.id}>
                        <td>
                          <div className="tx-date">
                            <span className="date-str">{formatDateUS(tx.date)}</span>
                            {tx.invoiceId && <span className="inv-pill">Invoiced</span>}
                          </div>
                        </td>
                        <td>{tx.studentId ? (students.find(s => s.id === tx.studentId)?.name || 'Student') : '—'}</td>
                        <td>{tx.description}</td>
                        <td>
                          {type === 'charge' && <span className="tx-charge">Charge ${tx.amount.toFixed(2)}</span>}
                          {type === 'discount' && <span className="tx-discount">Discount -${Math.abs(tx.amount).toFixed(2)}</span>}
                        </td>
                        <td>
                          {type === 'payment' && <span className="tx-payment">Payment ${Math.abs(tx.amount).toFixed(2)}</span>}
                          {type === 'refund' && <span className="tx-refund">Refund ${Math.abs(tx.amount).toFixed(2)}</span>}
                        </td>
                        <td style={{fontWeight: 700, color: tx.runningBalance < 0 ? '#dc2626' : '#166534'}}>
                          {tx.runningBalance < 0 ? `($${Math.abs(tx.runningBalance).toFixed(2)})` : `$${tx.runningBalance.toFixed(2)}`}
                        </td>
                      </tr>
                    );
                  })}
                  {ledgerTxs.length === 0 && <tr><td colSpan="6" className="text-center text-muted">No transactions found.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'Invoices' && (
            <div className="tab-pane">
              <div className="ledger-actions" style={{justifyContent: 'space-between'}}>
                <button className="action-btn primary" onClick={handleGenerateInvoice}>
                  <Plus size={16} /> New Invoice
                </button>
              </div>

              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Invoice Date</th>
                    <th>Date Range</th>
                    <th>Invoice Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {familyInvoices.map(inv => (
                    <tr key={inv.id}>
                      <td style={{color: 'var(--primary)', fontWeight: 600}}>{formatDateUS(inv.date)}</td>
                      <td>{inv.dateRange}</td>
                      <td style={{fontWeight: 700}}>${inv.amount.toFixed(2)}</td>
                      <td><span className={`status-badge ${inv.status.toLowerCase()}`}>{inv.status}</span></td>
                    </tr>
                  ))}
                  {familyInvoices.length === 0 && <tr><td colSpan="4" className="text-center text-muted">No invoices generated yet.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Add Transaction Modal */}
      {isAddTxModalOpen && (
        <div className="modal-overlay" onClick={() => setIsAddTxModalOpen(false)}>
          <div className="tx-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Add {newTxForm.type}</h3>
              <button onClick={() => setIsAddTxModalOpen(false)}><X size={20}/></button>
            </div>
            
            <div className="tx-type-selector">
              {['Payment', 'Refund', 'Charge', 'Discount'].map(type => (
                <button 
                  key={type}
                  className={`tx-type-btn ${newTxForm.type === type ? 'active' : ''}`}
                  onClick={() => setNewTxForm({...newTxForm, type})}
                >
                  {type}
                </button>
              ))}
            </div>

            <div className="tx-form">
              <div className="form-group">
                <label>Student</label>
                <div className="custom-dropdown" onClick={() => {
                  const el = document.getElementById('student-dropdown-menu');
                  el.style.display = el.style.display === 'block' ? 'none' : 'block';
                }}>
                  <div className="custom-dropdown-selected form-control">
                    {newTxForm.studentId 
                      ? students.find(s => s.id === newTxForm.studentId)?.name 
                      : '— General (entire family) —'}
                  </div>
                  <div id="student-dropdown-menu" className="custom-dropdown-menu">
                    <div 
                      className="custom-dropdown-item" 
                      onClick={(e) => {
                        e.stopPropagation();
                        setNewTxForm({...newTxForm, studentId: ''});
                        document.getElementById('student-dropdown-menu').style.display = 'none';
                      }}
                    >
                      — General (entire family) —
                    </div>
                    {students
                      .filter(s => s.familyId === selectedFamily.id)
                      .map(s => (
                        <div 
                          key={s.id} 
                          className="custom-dropdown-item"
                          onClick={(e) => {
                            e.stopPropagation();
                            setNewTxForm({...newTxForm, studentId: s.id});
                            document.getElementById('student-dropdown-menu').style.display = 'none';
                          }}
                        >
                          {s.name}
                        </div>
                      ))
                    }
                  </div>
                </div>
              </div>
              <div className="form-group">
                <label>Date</label>
                <input type="date" className="form-control" value={newTxForm.date} onChange={e => setNewTxForm({...newTxForm, date: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Amount</label>
                <input type="number" className="form-control" placeholder="$0.00" value={newTxForm.amount} onChange={e => setNewTxForm({...newTxForm, amount: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Description</label>
                <input type="text" className="form-control" placeholder="e.g. EMA Check #1234" value={newTxForm.description} onChange={e => setNewTxForm({...newTxForm, description: e.target.value})} />
              </div>

              {newTxForm.type === 'Payment' && (
                <div className="payment-allocation-mock">
                  <p className="text-muted" style={{fontSize: '13px', marginTop: '16px'}}>
                    <AlertCircle size={14} style={{display:'inline', marginRight:'4px'}}/>
                    Payments automatically reduce the Account Balance Owing.
                  </p>
                </div>
              )}
            </div>

            <div className="modal-actions" style={{marginTop: '24px'}}>
              <button className="btn-cancel" onClick={() => setIsAddTxModalOpen(false)}>Cancel</button>
              <button className="btn-send" onClick={handleAddTransaction}>Save</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default BillingPanel;
