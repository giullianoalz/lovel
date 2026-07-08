import React, { useState, useEffect } from 'react';
import { 
  DollarSign, AlertCircle, Coffee, Filter, Download, Send, X, CheckCircle, 
  CreditCard, History, ChevronLeft, Plus, MoreVertical, Calendar as CalendarIcon, Search,
  UploadCloud, FileText, Check, User
} from 'lucide-react';
import { database } from '../../lib/database';
import { useToast } from '../Layout/ToastProvider';
import ErrorBanner from '../Layout/ErrorBanner';
import './BillingPanel.css';

const formatDateUS = (dateStr) => {
  if (!dateStr) return '';
  if (dateStr.includes('/') && dateStr.split('/').pop().length === 2) return dateStr; 
  const [y, m, d] = dateStr.split('T')[0].split('-');
  if (!y || !m || !d) return dateStr;
  return `${m}/${d}/${y.slice(-2)}`;
};

const BillingPanel = () => {
  const toast = useToast();
  const [families, setFamilies] = useState([]);
  const [students, setStudents] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedFamily, setSelectedFamily] = useState(null);
  const [activeTab, setActiveTab] = useState('Account'); // 'Account' | 'Invoices'

  // Modal States
  const [isAddTxModalOpen, setIsAddTxModalOpen] = useState(false);
  const [isEmaModalOpen, setIsEmaModalOpen] = useState(false);
  const [emaSyncState, setEmaSyncState] = useState({ step: 1, matched: 0, newInvoices: [] });
  const [isReconcileOpen, setIsReconcileOpen] = useState(false);
  const [reconcile, setReconcile] = useState({ step: 1, text: '', lines: [], report: null });
  const [newTxForm, setNewTxForm] = useState({ type: 'Payment', amount: '', date: new Date().toISOString().split('T')[0], description: '', studentId: '', paymentMethod: '', invoiceId: '' });
  const [refundModal, setRefundModal] = useState(null); // { invoice, payment, amount, reason }

  const loadBilling = async () => {
    setLoading(true);
    setError(null);
    try {
      const fams = await database.fetchFamilies();
      const studs = await database.fetchStudents();
      const txs = await database.fetchAllTransactions();
      const invs = await database.fetchAllInvoices();
      setFamilies(fams);
      setStudents(studs);
      setTransactions(txs);
      setInvoices(invs);
    } catch (err) {
      setError(err.userMessage || 'Could not load billing data. Real financial figures could not be verified, so nothing is shown — please retry.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBilling();
  }, []);

  const calculateFamilyBalance = (familyId) => {
    const famTxs = transactions.filter(t => t.familyId === familyId);
    // Charges/Refunds increase balance owing, Payments/Discounts/Credits decrease it
    return famTxs.reduce((acc, t) => {
      const type = t.type.toLowerCase();
      if (type === 'charge' || type === 'refund') return acc + Math.abs(t.amount);
      if (type === 'payment' || type === 'discount' || type === 'credit') return acc - Math.abs(t.amount);
      return acc;
    }, 0);
  };

  const handleAddTransaction = async () => {
    if (!newTxForm.amount || isNaN(newTxForm.amount)) return;
    setLoading(true);

    try {
      // 1. Create the charge
      const newTx = await database.addTransaction({
        familyId: selectedFamily.id,
        studentId: newTxForm.studentId || null,
        amount: parseFloat(newTxForm.amount),
        type: newTxForm.type,
        description: newTxForm.description || `Manual ${newTxForm.type}`,
        date: newTxForm.date,
        paymentMethod: newTxForm.type === 'Payment' ? (newTxForm.paymentMethod || null) : null,
        invoiceId: newTxForm.type === 'Payment' ? (newTxForm.invoiceId || null) : null,
      });

      // 2. Auto-Generate Invoice if it's a Charge
      if (newTx.type.toLowerCase() === 'charge') {
        const newInv = await database.generateInvoice(selectedFamily.id, [newTx.id]);
        toast.success(`Charge added. Invoice ${newInv.id} generated and sent to parent automatically.`);
      }

      setIsAddTxModalOpen(false);
      await loadBilling();
    } catch (err) {
      setLoading(false);
      toast.error(err.userMessage || 'Could not save the transaction. Please try again.');
    }
  };

  const handleRefund = async () => {
    if (!refundModal?.payment) return;
    const amount = parseFloat(refundModal.amount);
    if (!amount || isNaN(amount) || amount <= 0) return;
    setLoading(true);
    try {
      await database.refundPayment(refundModal.payment.id, { amount, reason: refundModal.reason });
      toast.success('Refund processed.');
      setRefundModal(null);
      await loadBilling();
    } catch (err) {
      setLoading(false);
      toast.error(err.userMessage || 'Could not process the refund. Please try again.');
    }
  };

  const handleGenerateInvoice = async () => {
    const uninvoicedCharges = transactions.filter(t => t.familyId === selectedFamily.id && t.type === 'Charge' && !t.invoiceId);
    if (uninvoicedCharges.length === 0) {
      toast.info('No pending charges to invoice.');
      return;
    }
    setLoading(true);
    try {
      await database.generateInvoice(selectedFamily.id, uninvoicedCharges.map(t => t.id));
      setActiveTab('Invoices');
      await loadBilling();
    } catch (err) {
      setLoading(false);
      toast.error(err.userMessage || 'Could not generate the invoice. Please try again.');
    }
  };

  // EMA CSV column indices (0-based) for the Step Up "DO NOT EDIT" export.
  const EMA_COL = { PO_NUM: 0, PURCHASE_DATE: 1, STUDENT_NAME: 3, STUDENT_ID: 4, PROVIDER_ID: 6, START_DATE: 7, END_DATE: 8, AMOUNT: 9, INVOICE_NUM: 10 };
  const PROVIDER_ID = '20000720';

  const handleEmaFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setEmaSyncState({ ...emaSyncState, step: 2 });

    const reader = new FileReader();
    reader.onload = async (event) => {
      const csvText = event.target.result;
      const lines = csvText.split('\n');

      if (lines.length < 3) {
        toast.error('Invalid CSV format — expected the "DO NOT EDIT" Step Up export with two header rows.');
        setEmaSyncState({ step: 1, matched: 0, newInvoices: [] });
        return;
      }

      // Parse data rows (everything after the two header rows), grouping by student.
      const parsedRows = []; // { cols, studentName, studentId, amount }
      const groupMap = new Map(); // key -> { key, studentName, studentId, total, rowIndexes }

      for (let i = 2; i < lines.length; i++) {
        if (!lines[i].trim()) { parsedRows.push(null); continue; }
        const cols = lines[i].split(',');
        const poNumber = (cols[EMA_COL.PO_NUM] || '').trim();
        const studentName = (cols[EMA_COL.STUDENT_NAME] || '').trim();
        const studentId = (cols[EMA_COL.STUDENT_ID] || '').trim();
        const amount = parseFloat(cols[EMA_COL.AMOUNT]) || 0;

        if (!studentName) { parsedRows.push({ cols, skip: true }); continue; }

        const key = studentId || studentName.toLowerCase();
        if (!groupMap.has(key)) {
          groupMap.set(key, { key, studentName, studentId, total: 0, rowIndexes: [], poNumbers: [] });
        }
        const g = groupMap.get(key);
        g.total += amount;
        g.rowIndexes.push(parsedRows.length);
        if (poNumber) g.poNumbers.push(poNumber);
        parsedRows.push({ cols, studentName, studentId, amount, key });
      }

      const groups = Array.from(groupMap.values());
      if (groups.length === 0) {
        toast.error('No student rows found in the CSV.');
        setEmaSyncState({ step: 1, matched: 0, newInvoices: [] });
        return;
      }

      // Assign sequential LC-#### invoice numbers (one per student) and record invoices.
      try {
        const enriched = await database.processEmaBatch(groups);
        const invoiceByKey = new Map(enriched.map(g => [g.key, g]));

        // Rebuild the CSV with the three columns filled in.
        const updatedLines = [lines[0], lines[1]];
        for (const row of parsedRows) {
          if (!row) { updatedLines.push(''); continue; }
          const cols = row.cols;
          if (!row.skip && row.key && invoiceByKey.has(row.key)) {
            cols[EMA_COL.PROVIDER_ID] = PROVIDER_ID;
            cols[EMA_COL.START_DATE] = cols[EMA_COL.PURCHASE_DATE];
            cols[EMA_COL.END_DATE] = cols[EMA_COL.PURCHASE_DATE];
            cols[EMA_COL.INVOICE_NUM] = invoiceByKey.get(row.key).invoiceNumber;
          }
          updatedLines.push(cols.join(','));
        }

        const blob = new Blob([updatedLines.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);

        setEmaSyncState({
          step: 3,
          matched: enriched.length,
          rowCount: parsedRows.filter(r => r && !r.skip).length,
          groups: enriched,
          downloadUrl: url,
        });
        await loadBilling();
      } catch (err) {
        toast.error(err.userMessage || 'Could not generate EMA invoices. No invoices were created — please try again.');
        setEmaSyncState({ step: 1, matched: 0, newInvoices: [] });
      }
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

  // --- EMA Step Up remittance reconciliation ---
  // Parse pasted/uploaded remittance text. Each line carries a Step Up PO #
  // (e.g. 25670936-1) and a net amount; the student name is best-effort.
  const parseRemittance = (raw) => {
    const out = [];
    for (const rawLine of raw.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const poMatch = line.match(/\d{5,}-\d+/);
      const amounts = line.match(/[\d,]+\.\d{2}/g);
      if (!poMatch || !amounts) continue;
      const poNumber = poMatch[0];
      const amount = parseFloat(amounts[amounts.length - 1].replace(/,/g, ''));
      // Student name = what's left after stripping PO #, amounts and date-like tokens.
      const studentName = line
        .replace(poNumber, '')
        .replace(/[\d,]+\.\d{2}/g, '')
        .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/^[\s,;|]+|[\s,;|]+$/g, '')
        .trim();
      out.push({ poNumber, amount, studentName });
    }
    return out;
  };

  const handleParseRemittance = (text) => {
    const lines = parseRemittance(text);
    if (lines.length === 0) {
      toast.error('No rows found with "PO # + amount". Paste the Step Up remittance lines (e.g. "25670936-1   6/5/2026   Liam Killian   250.00").');
      return;
    }
    // Annotate each line with the invoice it would match (preview only).
    const annotated = lines.map(l => {
      const inv = invoices.find(i =>
        (i.poNumbers || []).includes(l.poNumber) ||
        i.id === l.poNumber ||
        (l.studentName && i.status !== 'Paid' && i.studentName?.toLowerCase().trim() === l.studentName.toLowerCase().trim())
      );
      return { ...l, invoiceNumber: inv?.id || null, matched: !!inv };
    });
    setReconcile({ step: 2, text, lines: annotated, report: null });
  };

  const handleRemittanceFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => handleParseRemittance(ev.target.result);
    reader.readAsText(file);
  };

  const handleConfirmReconcile = async () => {
    try {
      const report = await database.reconcileEmaRemittance(reconcile.lines);
      setReconcile(r => ({ ...r, step: 3, report }));
      await loadBilling();
    } catch (err) {
      toast.error(err.userMessage || 'Could not reconcile the payment. No invoices were marked paid — please try again.');
    }
  };

  const resetReconcile = () => {
    setIsReconcileOpen(false);
    setTimeout(() => setReconcile({ step: 1, text: '', lines: [], report: null }), 300);
  };

  if (error) return <div className="billing-container"><ErrorBanner message={error} onRetry={loadBilling} /></div>;

  if (loading && families.length === 0) return (
    <div className="billing-container" style={{ textAlign: 'center', padding: '80px 20px' }}>
      <div className="spinner" style={{ marginBottom: '16px' }}></div>
      <p style={{ color: 'var(--text-muted)' }}>Loading financial data...</p>
    </div>
  );

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
              <button className="btn-export" style={{background: '#0369a1', color: 'white', borderColor: '#0369a1'}} onClick={() => setIsReconcileOpen(true)}>
                <CheckCircle size={16} /> Reconcile Payment
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
              <div style={{padding: '20px'}}>
                <div style={{textAlign: 'center', marginBottom: '20px'}}>
                  <CheckCircle size={48} color="#10b981" style={{marginBottom: '12px'}} />
                  <h2 style={{color: 'var(--text-main)', marginBottom: '4px'}}>Invoices Generated</h2>
                  <p style={{color: 'var(--text-muted)', fontSize: '14px'}}>
                    <strong>{emaSyncState.matched}</strong> invoice{emaSyncState.matched !== 1 ? 's' : ''} across <strong>{emaSyncState.rowCount}</strong> session row{emaSyncState.rowCount !== 1 ? 's' : ''}.
                  </p>
                </div>

                <div style={{maxHeight: '260px', overflowY: 'auto', border: '1px solid var(--border-light)', borderRadius: '10px', marginBottom: '20px'}}>
                  <table className="ledger-table" style={{margin: 0}}>
                    <thead>
                      <tr>
                        <th>Student</th>
                        <th>Invoice #</th>
                        <th style={{textAlign: 'center'}}>Sessions</th>
                        <th style={{textAlign: 'right'}}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(emaSyncState.groups || []).map(g => (
                        <tr key={g.invoiceNumber}>
                          <td>
                            {g.studentName}
                            {!g.matched && (
                              <span title="No matching student in system — invoice still generated" style={{marginLeft: '6px', fontSize: '11px', color: '#b45309', background: '#fef3c7', padding: '1px 6px', borderRadius: '6px'}}>unmatched</span>
                            )}
                          </td>
                          <td style={{fontWeight: 600, color: 'var(--primary)'}}>{g.invoiceNumber}</td>
                          <td style={{textAlign: 'center'}}>{g.rowIndexes.length}</td>
                          <td style={{textAlign: 'right', fontWeight: 700}}>${g.total.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{background: '#dcfce7', color: '#166534', padding: '12px', borderRadius: '8px', fontSize: '13px', marginBottom: '20px', display: 'flex', gap: '8px', alignItems: 'center', textAlign: 'left'}}>
                  <Check size={16} style={{flexShrink: 0}} />
                  <span>Filled <strong>Provider ID</strong>, <strong>Start/End dates</strong>, and a sequential <strong>Business Invoice #</strong> for each student. Upload the file to Step Up.</span>
                </div>

                <div className="modal-actions" style={{justifyContent: 'center'}}>
                  <a
                    href={emaSyncState.downloadUrl}
                    download="EMA_Completed.csv"
                    className="btn-send"
                    style={{display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none'}}
                  >
                    <Download size={16} /> Download Completed CSV
                  </a>
                </div>
              </div>
              )}
            </div>
          </div>
        )}

        {/* EMA Remittance Reconciliation Modal */}
        {isReconcileOpen && (
          <div className="modal-overlay" onClick={resetReconcile}>
            <div className="tx-modal" onClick={e => e.stopPropagation()} style={{maxWidth: '640px'}}>
              <div className="modal-head">
                <h3>Reconcile EMA Payment</h3>
                <button onClick={resetReconcile}><X size={20}/></button>
              </div>

              {reconcile.step === 1 && (
                <div style={{padding: '8px 4px'}}>
                  <p style={{color: 'var(--text-muted)', fontSize: '13px', marginBottom: '16px'}}>
                    Paste the lines from the Step Up <strong>Remittance Advice</strong> (each line has a PO #, student, and net amount), or upload it as a CSV. The system matches each PO # back to its invoice and marks it paid.
                  </p>
                  <textarea
                    className="form-control"
                    rows={8}
                    placeholder={'25670936-1   6/5/2026   Liam Killian   250.00\n25670944-1   6/5/2026   Emma Killian   250.00\n25677573-1   6/5/2026   jasper theis   60.00'}
                    value={reconcile.text}
                    onChange={e => setReconcile(r => ({ ...r, text: e.target.value }))}
                    style={{width: '100%', fontFamily: 'monospace', fontSize: '13px', resize: 'vertical', boxSizing: 'border-box'}}
                  />
                  <div className="modal-actions" style={{marginTop: '16px', justifyContent: 'space-between'}}>
                    <label className="btn-cancel" style={{cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px'}}>
                      <FileText size={16} /> Upload CSV
                      <input type="file" accept=".csv,.txt" style={{display: 'none'}} onChange={handleRemittanceFileUpload} />
                    </label>
                    <button className="btn-send" onClick={() => handleParseRemittance(reconcile.text)} disabled={!reconcile.text.trim()}>
                      Parse & Preview
                    </button>
                  </div>
                </div>
              )}

              {reconcile.step === 2 && (
                <div style={{padding: '8px 4px'}}>
                  <p style={{color: 'var(--text-muted)', fontSize: '13px', marginBottom: '12px'}}>
                    Found <strong>{reconcile.lines.length}</strong> payment line{reconcile.lines.length !== 1 ? 's' : ''}. Review the matches, then confirm to mark invoices paid.
                  </p>
                  <div style={{maxHeight: '300px', overflowY: 'auto', border: '1px solid var(--border-light)', borderRadius: '10px', marginBottom: '16px'}}>
                    <table className="ledger-table" style={{margin: 0}}>
                      <thead>
                        <tr>
                          <th>PO #</th>
                          <th>Student</th>
                          <th>Invoice</th>
                          <th style={{textAlign: 'right'}}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reconcile.lines.map((l, idx) => (
                          <tr key={idx}>
                            <td style={{fontFamily: 'monospace', fontSize: '12px'}}>{l.poNumber}</td>
                            <td>{l.studentName || '—'}</td>
                            <td>
                              {l.matched
                                ? <span style={{fontWeight: 600, color: 'var(--primary)'}}>{l.invoiceNumber}</span>
                                : <span title="No invoice covers this PO #" style={{fontSize: '11px', color: '#b45309', background: '#fef3c7', padding: '1px 6px', borderRadius: '6px'}}>no match</span>}
                            </td>
                            <td style={{textAlign: 'right', fontWeight: 700}}>${l.amount.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="modal-actions" style={{justifyContent: 'space-between'}}>
                    <button className="btn-cancel" onClick={() => setReconcile(r => ({ ...r, step: 1 }))}>Back</button>
                    <button className="btn-send" onClick={handleConfirmReconcile}>
                      Confirm & Apply {reconcile.lines.filter(l => l.matched).length} payment{reconcile.lines.filter(l => l.matched).length !== 1 ? 's' : ''}
                    </button>
                  </div>
                </div>
              )}

              {reconcile.step === 3 && reconcile.report && (
                <div style={{textAlign: 'center', padding: '20px'}}>
                  <CheckCircle size={48} color="#10b981" style={{marginBottom: '12px'}} />
                  <h2 style={{color: 'var(--text-main)', marginBottom: '8px'}}>Payment Reconciled</h2>
                  <p style={{color: 'var(--text-muted)', marginBottom: '20px'}}>
                    Applied <strong>${reconcile.report.totalMatched.toFixed(2)}</strong> across <strong>{reconcile.report.matched.length}</strong> line{reconcile.report.matched.length !== 1 ? 's' : ''}.
                    {' '}<strong>{reconcile.report.invoicesPaid.length}</strong> invoice{reconcile.report.invoicesPaid.length !== 1 ? 's' : ''} marked paid.
                  </p>
                  {reconcile.report.unmatched.length > 0 && (
                    <div style={{background: '#fef3c7', color: '#92400e', padding: '12px', borderRadius: '8px', fontSize: '13px', marginBottom: '20px', textAlign: 'left'}}>
                      <strong>{reconcile.report.unmatched.length}</strong> line{reconcile.report.unmatched.length !== 1 ? 's' : ''} could not be matched to an invoice (PO #: {reconcile.report.unmatched.map(u => u.poNumber).join(', ')}). Review these manually.
                    </div>
                  )}
                  <div className="modal-actions" style={{justifyContent: 'center'}}>
                    <button className="btn-send" onClick={resetReconcile}>Done</button>
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
  
  // Calculate running balance. Convention: positive = family owes money, negative = family has a credit.
  // Matches calculateFamilyBalance() above so the family list and this detail view never disagree.
  let runningBal = 0;
  const ledgerTxs = familyTxs.map(tx => {
    const type = tx.type.toLowerCase();
    if (type === 'charge') runningBal += tx.amount;
    if (type === 'payment' || type === 'discount') runningBal -= Math.abs(tx.amount);
    if (type === 'refund') runningBal += Math.abs(tx.amount);
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
                {currentBalance > 0 ? (
                  <h2>Balance Owing: <span style={{color: '#dc2626'}}>${currentBalance.toFixed(2)}</span></h2>
                ) : currentBalance < 0 ? (
                  <h2>Credit on Account: <span style={{color: '#166534'}}>${Math.abs(currentBalance).toFixed(2)}</span></h2>
                ) : (
                  <h2>Balance: <span style={{color: '#166534'}}>Paid in Full</span></h2>
                )}
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
                        <td style={{fontWeight: 700, color: tx.runningBalance > 0 ? '#dc2626' : '#166534'}}>
                          {tx.runningBalance < 0 ? `($${Math.abs(tx.runningBalance).toFixed(2)} credit)` : `$${tx.runningBalance.toFixed(2)}`}
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
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {familyInvoices.map(inv => (
                    <tr key={inv.id}>
                      <td style={{color: 'var(--primary)', fontWeight: 600}}>{formatDateUS(inv.date)}</td>
                      <td>{inv.dateRange}</td>
                      <td style={{fontWeight: 700}}>${inv.amount.toFixed(2)}</td>
                      <td><span className={`status-badge ${inv.status.toLowerCase()}`}>{inv.status}</span></td>
                      <td>
                        {inv.payments?.filter(p => p.status !== 'REFUNDED').length > 0 && (
                          <button
                            className="action-btn"
                            style={{ padding: '4px 10px', fontSize: '12px' }}
                            onClick={() => {
                              const payment = inv.payments.find(p => p.status !== 'REFUNDED');
                              setRefundModal({ invoice: inv, payment, amount: payment.amount.toFixed(2), reason: '' });
                            }}
                          >
                            Refund
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {familyInvoices.length === 0 && <tr><td colSpan="5" className="text-center text-muted">No invoices generated yet.</td></tr>}
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
                <label htmlFor="tx-student-select">Student</label>
                <select
                  id="tx-student-select"
                  className="form-control"
                  value={newTxForm.studentId}
                  onChange={(e) => setNewTxForm({ ...newTxForm, studentId: e.target.value })}
                >
                  <option value="">— General (entire family) —</option>
                  {students
                    .filter(s => s.familyId === selectedFamily.id)
                    .map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                </select>
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
                <>
                  <div className="form-group">
                    <label>Payment Method</label>
                    <select
                      className="form-control"
                      value={newTxForm.paymentMethod}
                      onChange={(e) => setNewTxForm({ ...newTxForm, paymentMethod: e.target.value })}
                    >
                      <option value="">— Not specified —</option>
                      <option value="ZELLE">Zelle</option>
                      <option value="VENMO">Venmo</option>
                      <option value="PAYPAL">PayPal</option>
                      <option value="CASH">Cash</option>
                      <option value="CHECK">Check</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Apply to Invoice (optional)</label>
                    <select
                      className="form-control"
                      value={newTxForm.invoiceId}
                      onChange={(e) => setNewTxForm({ ...newTxForm, invoiceId: e.target.value })}
                    >
                      <option value="">— General family balance —</option>
                      {familyInvoices
                        .filter(inv => inv.amountPaid < inv.amount)
                        .map(inv => (
                          <option key={inv.dbId} value={inv.dbId}>
                            {inv.id} — ${(inv.amount - inv.amountPaid).toFixed(2)} due
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="payment-allocation-mock">
                    <p className="text-muted" style={{fontSize: '13px', marginTop: '16px'}}>
                      <AlertCircle size={14} style={{display:'inline', marginRight:'4px'}}/>
                      Payments automatically reduce the Account Balance Owing. Any amount over what's due becomes credit for the next invoice.
                    </p>
                  </div>
                </>
              )}
            </div>

            <div className="modal-actions" style={{marginTop: '24px'}}>
              <button className="btn-cancel" onClick={() => setIsAddTxModalOpen(false)}>Cancel</button>
              <button className="btn-send" onClick={handleAddTransaction}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Refund Modal */}
      {refundModal && (
        <div className="modal-overlay" onClick={() => setRefundModal(null)}>
          <div className="tx-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Refund {refundModal.invoice.id}</h3>
              <button onClick={() => setRefundModal(null)}><X size={20}/></button>
            </div>
            <div className="tx-form">
              <div className="form-group">
                <label>Original Payment Method</label>
                <p style={{ fontWeight: 600 }}>{refundModal.payment.method}</p>
              </div>
              <div className="form-group">
                <label>Refund Amount</label>
                <input
                  type="number"
                  className="form-control"
                  value={refundModal.amount}
                  max={refundModal.payment.amount}
                  onChange={e => setRefundModal({ ...refundModal, amount: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Reason (optional)</label>
                <input
                  type="text"
                  className="form-control"
                  value={refundModal.reason}
                  onChange={e => setRefundModal({ ...refundModal, reason: e.target.value })}
                />
              </div>
              {refundModal.payment.method === 'STRIPE_CARD' ? (
                <p className="text-muted" style={{fontSize: '13px'}}>
                  <AlertCircle size={14} style={{display:'inline', marginRight:'4px'}}/>
                  This will reverse the charge on Stripe — the card will actually be refunded.
                </p>
              ) : (
                <p className="text-muted" style={{fontSize: '13px'}}>
                  <AlertCircle size={14} style={{display:'inline', marginRight:'4px'}}/>
                  This only records the refund in the ledger — return the money to the family outside the app first.
                </p>
              )}
            </div>
            <div className="modal-actions" style={{marginTop: '24px'}}>
              <button className="btn-cancel" onClick={() => setRefundModal(null)}>Cancel</button>
              <button className="btn-send" onClick={handleRefund}>Confirm Refund</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default BillingPanel;
