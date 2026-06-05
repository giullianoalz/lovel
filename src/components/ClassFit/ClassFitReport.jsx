import React, { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, Clock, ChevronDown, X, Users, MessageSquare } from 'lucide-react';
import api from '../../lib/api';
import './ClassFitReport.css';

const ClassFitReport = () => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [reviewModal, setReviewModal] = useState(null);
  const [reviewNotes, setReviewNotes] = useState('');

  const [form, setForm] = useState({
    studentId: '',
    classId: '',
    reason: '',
    suggestion: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const loadReports = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterStatus) params.status = filterStatus;
      const response = await api.get('/class-fit', { params });
      setReports(response.data.reports);
    } catch (error) {
      console.error('Error loading class-fit reports:', error);
    }
    setLoading(false);
  };

  const loadData = async () => {
    try {
      const [studRes, classRes] = await Promise.all([
        api.get('/students'),
        api.get('/classes'),
      ]);
      setStudents(studRes.data.students || []);
      setClasses(classRes.data.classes || []);
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  useEffect(() => {
    loadReports();
    loadData();
  }, [filterStatus]);

  const handleSubmit = async () => {
    if (!form.studentId || !form.classId || !form.reason) return;
    setSubmitting(true);
    try {
      await api.post('/class-fit', form);
      setShowModal(false);
      setForm({ studentId: '', classId: '', reason: '', suggestion: '' });
      await loadReports();
    } catch (error) {
      console.error('Error creating report:', error);
    }
    setSubmitting(false);
  };

  const handleReview = async (id, status) => {
    try {
      await api.patch(`/class-fit/${id}`, { status, reviewNotes });
      setReviewModal(null);
      setReviewNotes('');
      await loadReports();
    } catch (error) {
      console.error('Error reviewing report:', error);
    }
  };

  const statusConfig = {
    pending: { label: 'Pending Review', color: '#f59e0b', bg: '#fef3c7' },
    reviewed: { label: 'Reviewed', color: '#3b82f6', bg: '#dbeafe' },
    resolved: { label: 'Resolved', color: '#10b981', bg: '#d1fae5' },
  };

  return (
    <div className="classfit-container">
      <header className="classfit-header">
        <div>
          <h1>Class-Fit Reports</h1>
          <p className="text-muted">End-of-day tool to flag students who may need a class change.</p>
        </div>
        <button className="classfit-add-btn" onClick={() => setShowModal(true)}>
          <AlertTriangle size={16} />
          Flag Student
        </button>
      </header>

      {/* Status Tabs */}
      <div className="status-tabs">
        <button className={`tab ${!filterStatus ? 'active' : ''}`} onClick={() => setFilterStatus('')}>
          All ({reports.length})
        </button>
        <button className={`tab ${filterStatus === 'pending' ? 'active' : ''}`} onClick={() => setFilterStatus('pending')}>
          Pending
        </button>
        <button className={`tab ${filterStatus === 'reviewed' ? 'active' : ''}`} onClick={() => setFilterStatus('reviewed')}>
          Reviewed
        </button>
        <button className={`tab ${filterStatus === 'resolved' ? 'active' : ''}`} onClick={() => setFilterStatus('resolved')}>
          Resolved
        </button>
      </div>

      {/* Reports Grid */}
      <div className="reports-grid">
        {loading ? (
          <div className="classfit-loading">Loading reports...</div>
        ) : reports.length === 0 ? (
          <div className="classfit-empty">
            <CheckCircle size={40} />
            <h3>All Clear</h3>
            <p>No class-fit reports to review.</p>
          </div>
        ) : (
          reports.map(report => {
            const sc = statusConfig[report.status] || statusConfig.pending;
            const date = new Date(report.createdAt);
            return (
              <div key={report.id} className="report-card">
                <div className="report-card-header">
                  <div className="report-student">
                    <div className="report-avatar">{report.student?.fullName?.[0] || '?'}</div>
                    <div>
                      <h4>{report.student?.fullName}</h4>
                      <span className="report-class">{report.class?.name}</span>
                    </div>
                  </div>
                  <span className="status-pill" style={{ background: sc.bg, color: sc.color }}>
                    {sc.label}
                  </span>
                </div>

                <div className="report-body">
                  <div className="report-field">
                    <label>Reason</label>
                    <p>{report.reason}</p>
                  </div>
                  {report.suggestion && (
                    <div className="report-field">
                      <label>Teacher's Suggestion</label>
                      <p>{report.suggestion}</p>
                    </div>
                  )}
                  {report.reviewNotes && (
                    <div className="report-field review-notes">
                      <label>Admin Review Notes</label>
                      <p>{report.reviewNotes}</p>
                    </div>
                  )}
                </div>

                <div className="report-footer">
                  <div className="report-meta">
                    <span><Clock size={12} /> {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    <span><Users size={12} /> {report.teacher?.fullName}</span>
                  </div>
                  {report.status === 'pending' && (
                    <button className="review-btn" onClick={() => { setReviewModal(report); setReviewNotes(''); }}>
                      Review
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Create Report Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="classfit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Flag Student — Class Fit</h3>
              <button onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>

            <div className="modal-form">
              <div className="form-group">
                <label>Student</label>
                <select className="form-control" value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })}>
                  <option value="">Select student...</option>
                  {students.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Class</label>
                <select className="form-control" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
                  <option value="">Select class...</option>
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Reason</label>
                <textarea className="form-control" rows="3" placeholder="Why isn't this student a good fit for this class?" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Suggestion (optional)</label>
                <input type="text" className="form-control" placeholder="e.g. Move to Group B, needs 1-on-1" value={form.suggestion} onChange={(e) => setForm({ ...form, suggestion: e.target.value })} />
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn-send" onClick={handleSubmit} disabled={submitting || !form.studentId || !form.classId || !form.reason}>
                {submitting ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Modal */}
      {reviewModal && (
        <div className="modal-overlay" onClick={() => setReviewModal(null)}>
          <div className="classfit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Review: {reviewModal.student?.fullName}</h3>
              <button onClick={() => setReviewModal(null)}><X size={20} /></button>
            </div>
            <div className="modal-form">
              <div className="review-summary">
                <p><strong>Class:</strong> {reviewModal.class?.name}</p>
                <p><strong>Teacher:</strong> {reviewModal.teacher?.fullName}</p>
                <p><strong>Reason:</strong> {reviewModal.reason}</p>
                {reviewModal.suggestion && <p><strong>Suggestion:</strong> {reviewModal.suggestion}</p>}
              </div>
              <div className="form-group">
                <label>Admin Notes</label>
                <textarea className="form-control" rows="3" placeholder="Your review notes..." value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => handleReview(reviewModal.id, 'reviewed')}>
                Mark as Reviewed
              </button>
              <button className="btn-send" onClick={() => handleReview(reviewModal.id, 'resolved')}>
                Resolve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClassFitReport;
