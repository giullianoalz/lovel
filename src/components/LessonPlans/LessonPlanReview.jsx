import React, { useState, useEffect } from 'react';
import { BookOpen, ShoppingCart, CheckCircle, XCircle, Clock, X, Package, DollarSign } from 'lucide-react';
import api from '../../lib/api';
import { useToast } from '../Layout/ToastProvider';

const STATUS_STYLE = {
  SUBMITTED: { bg: '#fef3c7', color: '#92400e', label: 'Pending Review' },
  NEEDS_REVISION: { bg: '#fee2e2', color: '#991b1b', label: 'Needs Revision' },
  APPROVED: { bg: '#dcfce7', color: '#166534', label: 'Approved' },
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
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-main)', margin: '0 0 4px' }}>Lesson Plans</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>Review submitted lesson plans and manage the supply shopping list.</p>
        </div>
        {pendingCount > 0 && tab === 'plans' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 10, color: '#92400e', fontSize: 13, fontWeight: 600 }}>
            <Clock size={16} /> {pendingCount} pending review
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', padding: 4, borderRadius: 10, marginBottom: 20, width: 'fit-content' }}>
        <button
          onClick={() => setTab('plans')}
          style={{ padding: '8px 18px', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: tab === 'plans' ? 'white' : 'transparent', color: tab === 'plans' ? 'var(--text-main)' : '#64748b', boxShadow: tab === 'plans' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <BookOpen size={14} /> Lesson Plans
        </button>
        <button
          onClick={() => setTab('supplies')}
          style={{ padding: '8px 18px', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: tab === 'supplies' ? 'white' : 'transparent', color: tab === 'supplies' ? 'var(--text-main)' : '#64748b', boxShadow: tab === 'supplies' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <ShoppingCart size={14} /> Shopping List
        </button>
      </div>

      {tab === 'plans' ? (
        <>
          <div style={{ marginBottom: 16 }}>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              style={{ padding: '8px 14px', border: '1px solid var(--border-light)', borderRadius: 10, background: 'white', fontSize: 13, color: 'var(--text-main)', outline: 'none' }}
            >
              <option value="">All Statuses</option>
              <option value="SUBMITTED">Pending Review</option>
              <option value="NEEDS_REVISION">Needs Revision</option>
              <option value="APPROVED">Approved</option>
            </select>
          </div>

          <div style={{ background: 'white', borderRadius: 14, border: '1px solid var(--border-light)', overflowX: 'auto', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            {loading ? (
              <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading lesson plans...</div>
            ) : plans.length === 0 ? (
              <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <BookOpen size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
                <p>No lesson plans found.</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Week Of', 'Type', 'Class', 'Teacher', 'Main Activity', 'Status'].map(h => (
                      <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', background: '#f8fafc', borderBottom: '1px solid var(--border-light)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {plans.map(plan => {
                    const sty = STATUS_STYLE[plan.status] || STATUS_STYLE.SUBMITTED;
                    return (
                      <tr
                        key={plan.id}
                        onClick={() => openReview(plan)}
                        style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#fafbff'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}
                      >
                        <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600 }}>
                          {new Date(plan.weekOf).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 13 }}>{plan.type === 'DISCOVERY_COVE' ? 'Discovery Cove' : 'Elective'}</td>
                        <td style={{ padding: '12px 16px', fontSize: 13 }}>{plan.class?.name || '—'}</td>
                        <td style={{ padding: '12px 16px', fontSize: 13 }}>{plan.teacher?.fullName}</td>
                        <td style={{ padding: '12px 16px', fontSize: 13, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{plan.mainActivity}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', background: sty.bg, color: sty.color }}>
                            {sty.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <>
          {supplyLoading ? (
            <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading shopping list...</div>
          ) : supplyItems.length === 0 ? (
            <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)', background: 'white', borderRadius: 14, border: '1px solid var(--border-light)' }}>
              <ShoppingCart size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
              <p>No supply items yet. They'll appear here once a teacher's lesson plan with a supply list is approved.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              {pendingSupplies.length > 0 && (
                <div style={{ background: 'white', borderRadius: 14, border: '1px solid var(--border-light)', overflow: 'hidden' }}>
                  <div style={{ padding: '14px 20px', background: '#fffbeb', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: '#92400e' }}>
                    <Package size={16} /> To Buy ({pendingSupplies.length})
                  </div>
                  {pendingSupplies.map(item => (
                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid #f1f5f9' }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{item.itemName} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>× {item.quantity}</span></div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {item.lessonPlan?.class?.name || 'General'} · {item.teacher?.fullName} {item.dayNeeded && `· Needed ${item.dayNeeded}`}
                        </div>
                      </div>
                      <button
                        onClick={() => handleMarkPurchased(item)}
                        disabled={purchasingId === item.id}
                        style={{ padding: '6px 14px', background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                      >
                        <CheckCircle size={13} /> {purchasingId === item.id ? 'Saving...' : 'Mark Purchased'}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {purchasedSupplies.length > 0 && (
                <div style={{ background: 'white', borderRadius: 14, border: '1px solid var(--border-light)', overflow: 'hidden' }}>
                  <div style={{ padding: '14px 20px', background: '#f0fdf4', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: '#166534' }}>
                    <CheckCircle size={16} /> Purchased ({purchasedSupplies.length})
                  </div>
                  {purchasedSupplies.map(item => (
                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid #f1f5f9' }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)', textDecoration: 'line-through' }}>{item.itemName} × {item.quantity}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.lessonPlan?.class?.name || 'General'} · {item.teacher?.fullName}</div>
                      </div>
                      {item.cost != null && (
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#166534', display: 'flex', alignItems: 'center', gap: 4 }}>
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setReviewPlan(null)}>
          <div style={{ background: 'white', borderRadius: 16, width: '95%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid var(--border-light)' }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <BookOpen size={18} /> Review Lesson Plan
              </h3>
              <button onClick={() => setReviewPlan(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 8, color: 'var(--text-muted)' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '16px 24px' }}>
              <div style={{ padding: 14, background: '#f8fafc', borderRadius: 10, marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
                  {reviewPlan.class?.name || 'General'} — Week of {new Date(reviewPlan.weekOf).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                  {reviewPlan.type === 'DISCOVERY_COVE' ? 'Discovery Cove' : 'Elective'} · Submitted by {reviewPlan.teacher?.fullName}
                </div>
                <p style={{ margin: '0 0 6px', fontSize: 13 }}><strong>Main Activity:</strong> {reviewPlan.mainActivity}</p>
                {reviewPlan.materials && <p style={{ margin: '0 0 6px', fontSize: 13 }}><strong>Materials:</strong> {reviewPlan.materials}</p>}
                {reviewPlan.safetyNotes && <p style={{ margin: '0 0 6px', fontSize: 13 }}><strong>Safety Notes:</strong> {reviewPlan.safetyNotes}</p>}
                {reviewPlan.skillConnection && <p style={{ margin: '0 0 6px', fontSize: 13 }}><strong>Skill Connection:</strong> {reviewPlan.skillConnection}</p>}
                {reviewPlan.differentiation && <p style={{ margin: 0, fontSize: 13 }}><strong>Differentiation:</strong> {reviewPlan.differentiation}</p>}
              </div>

              {reviewPlan.supplyItems?.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: 6, color: 'var(--text-main)' }}>Supply List</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {reviewPlan.supplyItems.map(item => (
                      <span key={item.id} style={{ padding: '4px 10px', background: '#eef2ff', borderRadius: 10, fontSize: 12, color: '#4338ca' }}>
                        {item.itemName} × {item.quantity}{item.dayNeeded ? ` (${item.dayNeeded})` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: 6, color: 'var(--text-main)' }}>Manager Feedback</label>
                <textarea
                  rows={3}
                  placeholder="Add feedback for the teacher..."
                  value={feedback}
                  onChange={e => setFeedback(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-light)', borderRadius: 10, fontSize: 14, color: 'var(--text-main)', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: '1px solid var(--border-light)' }}>
              <button onClick={() => handleReview('NEEDS_REVISION')} disabled={reviewSubmitting} style={{ padding: '10px 20px', border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                <XCircle size={16} /> Needs Revision
              </button>
              <button onClick={() => handleReview('APPROVED')} disabled={reviewSubmitting} style={{ padding: '10px 20px', background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
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
