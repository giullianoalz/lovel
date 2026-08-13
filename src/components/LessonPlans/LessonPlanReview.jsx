import React, { useState, useEffect } from 'react';
import { BookOpen, ShoppingCart, CheckCircle, XCircle, Clock, X, Package, DollarSign, Info, Archive, ArchiveRestore } from 'lucide-react';
import { startOfWeek } from 'date-fns';
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
  const [showArchived, setShowArchived] = useState(false);
  const [reviewPlan, setReviewPlan] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [archivingKey, setArchivingKey] = useState(null);

  const [supplyItems, setSupplyItems] = useState([]);
  const [supplyLoading, setSupplyLoading] = useState(true);
  const [purchasingId, setPurchasingId] = useState(null);
  const [activityModal, setActivityModal] = useState(null);

  const loadPlans = async () => {
    setLoading(true);
    try {
      const params = { archived: showArchived };
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

  useEffect(() => { loadPlans(); }, [filterStatus, showArchived]);
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
      if (item.status === 'PURCHASED') {
        await api.patch(`/lesson-plans/supply-list/${item.id}/purchased`, { status: 'PENDING' });
        toast.success('Marked as pending.');
      } else {
        const cost = window.prompt(`Cost for "${item.itemName}" (optional):`, '');
        await api.patch(`/lesson-plans/supply-list/${item.id}/purchased`, { status: 'PURCHASED', cost: cost ? parseFloat(cost) : null });
        toast.success('Marked as purchased.');
      }
      await loadSupplyList();
    } catch {
      toast.error('Could not update the item.');
    }
    setPurchasingId(null);
  };

  const handleArchivePlan = async (plan, e) => {
    e.stopPropagation();
    setArchivingKey(plan.id);
    try {
      await api.patch(`/lesson-plans/${plan.id}/archive`, { archived: !showArchived });
      toast.success(showArchived ? 'Lesson plan restored.' : 'Lesson plan archived.');
      await loadPlans();
    } catch {
      toast.error('Could not update the lesson plan.');
    }
    setArchivingKey(null);
  };

  const handleArchiveWeek = async (weekOf, e) => {
    e.stopPropagation();
    if (!window.confirm(`Archive all lesson plans for the week of ${new Date(weekOf).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}?`)) return;
    setArchivingKey(weekOf);
    try {
      const res = await api.patch('/lesson-plans/archive-week', { weekOf });
      toast.success(`Archived ${res.data.archivedCount} lesson plan${res.data.archivedCount === 1 ? '' : 's'}.`);
      await loadPlans();
    } catch {
      toast.error('Could not archive that week.');
    }
    setArchivingKey(null);
  };

  const pendingCount = plans.filter(p => p.status === 'SUBMITTED').length;

  const plansByWeek = plans.reduce((acc, plan) => {
    const key = new Date(plan.weekOf).toISOString();
    if (!acc[key]) acc[key] = [];
    acc[key].push(plan);
    return acc;
  }, {});
  const sortedPlanWeeks = Object.keys(plansByWeek).sort((a, b) => new Date(b) - new Date(a));

  const supplyItemsByWeek = supplyItems.reduce((acc, item) => {
    let weekLabel = 'General / Unscheduled';
    let weekKey = 0;

    if (item.lessonPlan?.weekOf) {
      // Snap any date to the Monday of that week
      const date = new Date(item.lessonPlan.weekOf);
      // We pass the raw UTC date and get the local Monday, but wait
      // `weekOf` is typically stored as a date string. Let's ensure it's a Monday:
      const monday = startOfWeek(date, { weekStartsOn: 1 });
      weekLabel = `Week of ${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`;
      weekKey = monday.getTime();
    }

    if (!acc[weekKey]) {
      acc[weekKey] = { label: weekLabel, pending: [], purchased: [] };
    }
    if (item.status === 'PENDING') {
      acc[weekKey].pending.push(item);
    } else {
      acc[weekKey].purchased.push(item);
    }
    return acc;
  }, {});

  const sortedWeeks = Object.keys(supplyItemsByWeek)
    .sort((a, b) => Number(a) - Number(b))
    .map(key => supplyItemsByWeek[key]);

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
            <label className="lpr-archived-toggle">
              <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
              Show archived
            </label>
          </div>

          {loading ? (
            <div className="lpr-card lpr-empty"><span className="app-inline-loader"><span className="app-spinner-sm" />Loading lesson plans…</span></div>
          ) : plans.length === 0 ? (
            <div className="lpr-card lpr-empty">
              <BookOpen size={32} />
              <p>{showArchived ? 'No archived lesson plans.' : 'No lesson plans found.'}</p>
            </div>
          ) : (
            sortedPlanWeeks.map(weekKey => (
              <div key={weekKey} className="lpr-card" style={{ marginBottom: 16 }}>
                <div className="lpr-week-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Week of {new Date(weekKey).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</span>
                  {!showArchived && (
                    <button
                      className="lpr-archive-week-btn"
                      onClick={(e) => handleArchiveWeek(weekKey, e)}
                      disabled={archivingKey === weekKey}
                    >
                      <Archive size={14} /> Archive Week
                    </button>
                  )}
                </div>
                <table className="lpr-table">
                  <thead>
                    <tr>
                      {['Type', 'Class', 'Teacher', 'Main Activity', 'Status', ''].map(h => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plansByWeek[weekKey].map(plan => (
                      <tr key={plan.id} onClick={() => openReview(plan)}>
                        <td>{plan.type === 'DISCOVERY_COVE' ? 'Discovery Cove' : 'Elective'}</td>
                        <td>{plan.class?.name || '—'}</td>
                        <td>{plan.teacher?.fullName}</td>
                        <td className="lpr-td-activity">{plan.mainActivity}</td>
                        <td>
                          <span className={`lpr-status-pill ${(plan.status || 'SUBMITTED').toLowerCase()}`}>
                            {STATUS_LABEL[plan.status] || STATUS_LABEL.SUBMITTED}
                          </span>
                        </td>
                        <td>
                          <button
                            className="lpr-archive-btn"
                            onClick={(e) => handleArchivePlan(plan, e)}
                            disabled={archivingKey === plan.id}
                            title={showArchived ? 'Restore' : 'Archive'}
                          >
                            {showArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
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
              {sortedWeeks.map(weekGroup => (
                <div key={weekGroup.label} className="lpr-week-section">
                  <h3 className="lpr-week-header">{weekGroup.label}</h3>

                  {weekGroup.pending.length > 0 && (
                    <div className="lpr-supply-group">
                      <div className="lpr-supply-group-header pending">
                        <Package size={16} /> To Buy ({weekGroup.pending.length})
                      </div>
                      {weekGroup.pending.map(item => (
                        <div key={item.id} className="lpr-supply-row">
                          <label className="lpr-supply-checkbox">
                            <input 
                              type="checkbox" 
                              onChange={() => handleMarkPurchased(item)}
                              disabled={purchasingId === item.id}
                            />
                            <span className="lpr-custom-check"></span>
                          </label>

                          <div className="lpr-supply-info">
                            <div className="lpr-supply-name">{item.itemName} <span>× {item.quantity}</span></div>
                            <div className="lpr-supply-meta">
                              {item.lessonPlan?.class?.name || 'General'} · {item.teacher?.fullName} {item.dayNeeded && `· Needed ${item.dayNeeded}`}
                            </div>
                          </div>
                          
                          <div className="lpr-supply-actions">
                            {item.lessonPlan?.mainActivity && (
                              <button
                                className="lpr-activity-btn"
                                onClick={() => setActivityModal(item.lessonPlan.mainActivity)}
                                title="View activity"
                              >
                                <Info size={14} /> Activity
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {weekGroup.purchased.length > 0 && (
                    <div className="lpr-supply-group" style={{ marginTop: weekGroup.pending.length > 0 ? '16px' : '0' }}>
                      <div className="lpr-supply-group-header purchased">
                        <CheckCircle size={16} /> Purchased ({weekGroup.purchased.length})
                      </div>
                      {weekGroup.purchased.map(item => (
                        <div key={item.id} className="lpr-supply-row purchased">
                          <label className="lpr-supply-checkbox">
                            <input 
                              type="checkbox" 
                              checked 
                              onChange={() => handleMarkPurchased(item)}
                              disabled={purchasingId === item.id}
                            />
                            <span className="lpr-custom-check checked"><CheckCircle size={12} /></span>
                          </label>

                          <div className="lpr-supply-info">
                            <div className="lpr-supply-name purchased">{item.itemName} × {item.quantity}</div>
                            <div className="lpr-supply-meta">{item.lessonPlan?.class?.name || 'General'} · {item.teacher?.fullName}</div>
                          </div>

                          <div className="lpr-supply-actions">
                            {item.lessonPlan?.mainActivity && (
                              <button
                                className="lpr-activity-btn"
                                onClick={() => setActivityModal(item.lessonPlan.mainActivity)}
                                title="View activity"
                              >
                                <Info size={14} /> Activity
                              </button>
                            )}
                            {item.cost != null && (
                              <span className="lpr-cost">
                                <DollarSign size={13} /> {Number(item.cost).toFixed(2)}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
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
      {/* Activity Context Modal */}
      {activityModal && (
        <div className="lpr-modal-overlay" onClick={() => setActivityModal(null)}>
          <div className="lpr-modal activity-modal" onClick={e => e.stopPropagation()}>
            <div className="lpr-modal-header">
              <h3><Info size={18} /> Lesson Plan Activity</h3>
              <button onClick={() => setActivityModal(null)} className="lpr-modal-close">
                <X size={20} />
              </button>
            </div>
            <div className="lpr-modal-body">
              <p style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>{activityModal}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LessonPlanReview;
