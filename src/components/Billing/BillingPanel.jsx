import React, { useState, useEffect } from 'react';
import { 
  DollarSign, 
  AlertCircle, 
  Coffee, 
  Filter, 
  Download, 
  Send,
  X,
  CheckCircle
} from 'lucide-react';
import { database } from '../../lib/database';
import './BillingPanel.css';

const BillingPanel = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Modal State
  const [activeModalInvoice, setActiveModalInvoice] = useState(null);
  const [reminderText, setReminderText] = useState("");
  const [isSentVisible, setIsSentVisible] = useState(false);

  useEffect(() => {
    const loadBilling = async () => {
      setLoading(true);
      const res = await database.fetchAdminBillingData();
      setData(res);
      setLoading(false);
    };
    loadBilling();
  }, []);

  const openReminderModal = (invoice) => {
    setActiveModalInvoice(invoice);
    setReminderText(
      `Dear ${invoice.parent},\n\nThis is a friendly reminder from Lovelearning Academy that invoice ${invoice.id} for the amount of ${invoice.total} is currently ${invoice.status.toLowerCase()}.\n\nThank you!`
    );
  };

  const handleSendReminder = () => {
    // Simulate sending email
    setIsSentVisible(true);
    setTimeout(() => {
      setIsSentVisible(false);
      setActiveModalInvoice(null);
    }, 2000);
  };

  if (loading || !data) return <div className="billing-container"><p>Loading financial data...</p></div>;

  return (
    <div className="billing-container">
      <header className="billing-header">
        <div>
          <h1>Unified Billing</h1>
          <p>Automated invoice tracking and payment administration.</p>
        </div>
      </header>

      <div className="billing-metrics">
        <div className="metric-card">
          <div className="metric-icon"><DollarSign size={24} /></div>
          <div className="metric-info">
            <h3>Expected Revenue</h3>
            <p>{data.metrics.expected}</p>
          </div>
        </div>
        
        <div className="metric-card warning">
          <div className="metric-icon"><AlertCircle size={24} /></div>
          <div className="metric-info">
            <h3>Overdue Payments</h3>
            <p>{data.metrics.overdue}</p>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon" style={{background:'#fef3c7', color:'#d97706'}}><Coffee size={24} /></div>
          <div className="metric-info">
            <h3>Unbilled Snacks</h3>
            <p>{data.metrics.snacks}</p>
          </div>
        </div>
      </div>

      <div className="table-container">
        <div className="table-header">
          <h2>Recent Invoices</h2>
          <div className="table-actions">
            <button className="btn-filter"><Filter size={16} /> Filter</button>
            <button className="btn-export"><Download size={16} /> Export</button>
          </div>
        </div>
        
        <div className="table-scroll">
          <table className="billing-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Student / Parent</th>
                <th>Due Date</th>
                <th>Base Tuition</th>
                <th>Extras (Snacks)</th>
                <th>Total</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((inv) => (
                <tr key={inv.id}>
                  <td style={{fontWeight: 600}}>{inv.id}</td>
                  <td className="student-column">
                    <span className="student-name">{inv.student}</span>
                    <span className="parent-name">{inv.parent}</span>
                  </td>
                  <td>{inv.dueDate}</td>
                  <td>{inv.tuition}</td>
                  <td style={{color: '#d97706', fontWeight: 600}}>{inv.snacks}</td>
                  <td style={{fontWeight: 700}}>{inv.total}</td>
                  <td>
                    <span className={`status-badge ${inv.status.toLowerCase()}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="action-buttons">
                    {inv.status !== 'Paid' && (
                      <button className="btn-remind" onClick={() => openReminderModal(inv)}>
                        <Send size={14} style={{display:'inline', marginRight: '4px'}} />
                        Remind
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Custom Reminder Modal */}
      {activeModalInvoice && (
        <div className="modal-overlay" onClick={() => setActiveModalInvoice(null)}>
          <div className="reminder-modal" onClick={e => e.stopPropagation()}>
            {isSentVisible ? (
              <div style={{textAlign: 'center', padding: '40px 20px'}}>
                <CheckCircle size={48} color="#10b981" style={{marginBottom: '16px'}} />
                <h2 style={{color: 'var(--text-main)'}}>Reminder Sent!</h2>
                <p style={{color: 'var(--text-muted)'}}>The parent has been notified.</p>
              </div>
            ) : (
              <>
                <div className="modal-head">
                  <h3>Send Payment Reminder</h3>
                  <button onClick={() => setActiveModalInvoice(null)}><X size={20}/></button>
                </div>
                
                <div>
                  <p style={{fontSize: '14px', color: 'var(--text-muted)'}}>
                    Review and customize the automated message below before sending it to {activeModalInvoice.parent}:
                  </p>
                  <textarea 
                    className="reminder-textarea"
                    value={reminderText}
                    onChange={(e) => setReminderText(e.target.value)}
                  />
                </div>

                <div className="modal-actions">
                  <button className="btn-cancel" onClick={() => setActiveModalInvoice(null)}>Cancel</button>
                  <button className="btn-send" onClick={handleSendReminder}>
                    <Send size={16} style={{display:'inline', marginRight:'8px'}}/>
                    Send Email
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
};

export default BillingPanel;
