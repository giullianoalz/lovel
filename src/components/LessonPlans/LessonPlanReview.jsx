import React, { useState, useEffect } from 'react';
import { BookOpen, ShoppingCart, CheckCircle, XCircle, Clock, X, Package, DollarSign } from 'lucide-react';
import api from '../../lib/api';
import { useToast } from '../Layout/ToastProvider';
import './LessonPlanReview.css';

const STATUS_LABEL = {
  SUBMITTED: 'Pending Review',
  NEEDS_REVISION: 'Needs Revision',
  APPROVED: 'Approved',
};

const LessonPlanReview = () => {
  const toast = useToast();
  const [tab, setTab] = useState('plans');
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [reviewPlan, setReviewPlan] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  const [supplyItems, setSupplyItems] = useState([]);
  const [supplyLoading, setSupplyLoading] = useState(true);
  const [purchasingId, setPurchasingId] = useState(null);

  const loadPlans = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterStatus) params.status = filterStatus;
      const res = await api.get('/lesson-plans', { params });
      setPlans(res.data.lessonPlans || []);
    } catch {
      toast.error('Could not load lesson plans.');
    }
    setLoading(false);
  };

  const loadSupplyList = async () => {
    setSupplyLoading(true);
    try {
      const res = await api.get('/lesson-plans/supply-list');
      setSupplyItems(res.data.supplyItems || []);
    } catch {
      toast.error('Could not load shopping list.');
    }
    setSupplyLoading(false);
  };

  useEffect(() => { loadPlans(); }, [filterStatus]);
  useEffect(() => { if (tab === 'supplies') loadSupplyList(); }, [tab]);

  const openReview = (plan) => {
    setReviewPlan(plan);
    setFeedback(plan.managerFeedback || '');
  };

  const handleReview = async (status) => {
    if (!reviewPlan) return;
    setReviewSubmitting(true);
    try {
      await api.patch(`/lesson-plans/${reviewPlan.id}/review`, { status, managerFeedback: feedback });
      toast.success(status === 'APPROVED' ? 'Lesson plan approved.' : 'Sent back for revision.');
      setReviewPlan(null);
      await loadPlans();
    } catch {
      toast.error('Could not update the lesson plan.');
    }
    setReviewSubmitting(false);
  };

  const handleMarkPurchased = async (item) => {
    setPurchasingId(item.id);
    try {
      const cost = window.prompt(`Cost for "${item.itemName}" (optional):`, '');
      await api.patch(`/lesson-plans/supply-list/${item.id}/purchased`, { cost: cost ? parseFloat(cost) : null });
      toast.success('Marked as purchased.');
      await loadSupplyList();
    } catch {
      toast.error('Could not update the item.');
    }
    setPurchasingId(null);
  };

  const pendingCount = plans.filter(p => p.status === 'SUBMITTED').length;
  const pendingSupplies = supplyItems.filter(i => i.status === 'PENDING');
  const purchasedSupplies = supplyItems.filter(i => i.status === 'PURCHASED');

  return (
    <div className="lpr-page">
      <div className="lpr-header">
        <div>
          <h1 className="lpr-title">Lesson Plans</h1>
          <p className="lpr-subtitle">Review submitted lesson plans and manage the supply shopping list.</p>
        </div>
        {pendingCount > 0 && tab === 'plans' && (
          <div className="lpr-pending-badge">
            <Clock size={16} /> {pendingCount} pending review
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="lpr-tabs">
        <button
          onClick={() => setTab('plans')}
          className={`lpr-tab ${tab === 'plans' ? 'active' : ''}`}
        >
          <BookOpen size={14} /> Lesson Plans
        </button>
        <button
          onClick={() => setTab('supplies')}
          className={`lpr-tab ${tab === 'supplies' ? 'active' : ''}`}
        >
          <ShoppingCart size={14} /> Shopping List
        </button>
      </div>

      {tab === 'plans' ? (
        <>
          <div className="lpr-filter">
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All Statuses</option>
              <option value="SUBMITTED">Pending Review</option>
              <option value="NEEDS_REVISION">Needs Revision</option>
              <option value="APPROVED">Approved</option>
            </select>
          </div>

          <div className="lpr-card">
            {loading ? (
              <div className="lpr-empty"><span className="app-inline-loader"><span className="app-spinner-sm" />Loading lesson plans…</span></div>
            ) : plans.length === 0 ? (
              <div className="lpr-empty">
                <BookOpen size={32} />
                <p>No lesson plans found.</p>
              </div>
            ) : (
              <table className="lpr-table">
                <thead>
                  <tr>
                    {['Week Of', 'Type', 'Class', 'Teacher', 'Main Activity', 'Status'].map(h => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {plans.map(plan => (
                    <tr key={plan.id} onClick={() => openReview(plan)}>
                      <td>
                        {new Date(plan.weekOf).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                      </td>
                      <td>{plan.type === 'DISCOVERY_COVE' ? 'Discovery Cove' : 'Elective'}</td>
                      <td>{plan.class?.name || '—'}</td>
                      <td>{plan.teacher?.fullName}</td>
                      <td className="lpr-td-activity">{plan.mainActivity}</td>
                      <td>
                        <span className={`lpr-status-pill ${(plan.status || 'SUBMITTED').toLowerCase()}`}>
                          {STATUS_LABEL[plan.status] || STATUS_LABEL.SUBMITTED}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <>
          {supplyLoading ? (
            <div className="lpr-empty"><span className="app-inline-loader"><span className="app-spinner-sm" />Loading shopping list…</span></div>
          ) : supplyItems.length === 0 ? (
            <div className="lpr-card lpr-empty">
              <ShoppingCart size={32} />
              <p>No supply items yet. They'll appear here once a teacher's lesson plan with a supply list is approved.</p>
            </div>
          ) : (
            <div className="lpr-supply-grid">
              {pendingSupplies.length > 0 && (
                <div className="lpr-supply-group">
                  <div className="lpr-supply-group-header pending">
                    <Package size={16} /> To Buy ({pendingSupplies.length})
                  </div>
                  {pendingSupplies.map(item => (
                    <div key={item.id} className="lpr-supply-row">
                      <div>
                        <div className="lpr-supply-name">{item.itemName} <span>× {item.quantity}</span></div>
                        <div className="lpr-supply-meta">
                          {item.lessonPlan?.class?.name || 'General'} · {item.teacher?.fullName} {item.dayNeeded && `· Needed ${item.dayNeeded}`}
                        </div>
                      </div>
                      <button
                        onClick={() => handleMarkPurchased(item)}
                        disabled={purchasingId === item.id}
                        className="lpr-buy-btn"
                      >
                        <CheckCircle size={13} /> {purchasingId === item.id ? 'Saving...' : 'Mark Purchased'}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {purchasedSupplies.length > 0 && (
                <div className="lpr-supply-group">
                  <div className="lpr-supply-group-header purchased">
                    <CheckCircle size={16} /> Purchased ({purchasedSupplies.length})
                  </div>
                  {purchasedSupplies.map(item => (
                    <div key={item.id} className="lpr-supply-row">
                      <div>
                        <div className="lpr-supply-name purchased">{item.itemName} × {item.quantity}</div>
                        <div className="lpr-supply-meta">{item.lessonPlan?.class?.name || 'General'} · {item.teacher?.fullName}</div>
                      </div>
                      {item.cost != null && (
                        <span className="lpr-cost">
                          <DollarSign size={13} /> {Number(item.cost).toFixed(2)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Review Modal */}
      {reviewPlan && (
        <div className="lpr-modal-overlay" onClick={() => setReviewPlan(null)}>
          <div className="lpr-modal" onClick={e => e.stopPropagation()}>
            <div className="lpr-modal-header">
              <h3><BookOpen size={18} /> Review Lesson Plan</h3>
              <button onClick={() => setReviewPlan(null)} className="lpr-modal-close">
                <X size={20} />
              </button>
            </div>

            <div className="lpr-modal-body">
              <div className="lpr-plan-summary">
                <div className="lpr-plan-summary-title">
                  {reviewPlan.class?.name || 'General'} — Week of {new Date(reviewPlan.weekOf).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                </div>
                <div className="lpr-plan-summary-meta">
                  {reviewPlan.type === 'DISCOVERY_COVE' ? 'Discovery Cove' : 'Elective'} · Submitted by {reviewPlan.teacher?.fullName}
                </div>
                <p><strong>Main Activity:</strong> {reviewPlan.mainActivity}</p>
                {reviewPlan.materials && <p><strong>Materials:</strong> {reviewPlan.materials}</p>}
                {reviewPlan.safetyNotes && <p><strong>Safety Notes:</strong> {reviewPlan.safetyNotes}</p>}
                {reviewPlan.skillConnection && <p><strong>Skill Connection:</strong> {reviewPlan.skillConnection}</p>}
                {reviewPlan.differentiation && <p><strong>Differentiation:</strong> {reviewPlan.differentiation}</p>}
              </div>

              {reviewPlan.supplyItems?.length > 0 && (
                <div className="lpr-field">
                  <label className="lpr-field-label">Supply List</label>
                  <div className="lpr-supply-tags">
                    {reviewPlan.supplyItems.map(item => (
                      <span key={item.id} className="lpr-supply-tag">
                        {item.itemName} × {item.quantity}{item.dayNeeded ? ` (${item.dayNeeded})` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="lpr-field">
                <label className="lpr-field-label">Manager Feedback</label>
                <textarea
                  rows={3}
                  placeholder="Add feedback for the teacher..."
                  value={feedback}
                  onChange={e => setFeedback(e.target.value)}
                  className="lpr-feedback-input"
                />
              </div>
            </div>

            <div className="lpr-modal-footer">
              <button onClick={() => handleReview('NEEDS_REVISION')} disabled={reviewSubmitting} className="lpr-btn-revision">
                <XCircle size={16} /> Needs Revision
              </button>
              <button onClick={() => handleReview('APPROVED')} disabled={reviewSubmitting} className="lpr-btn-approve">
                <CheckCircle size={16} /> {reviewSubmitting ? 'Saving...' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LessonPlanReview;
