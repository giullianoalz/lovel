import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Heart, Users, MessageSquare, QrCode, Plus, X, Trash2, ShieldCheck,
  Shell, AlertTriangle, ThumbsUp, Clock, Calendar, Gift, BookOpen,
  CreditCard, Receipt, CheckCircle, AlertCircle, ExternalLink, Download,
  ChevronDown, ChevronUp, Bell, Award, GraduationCap, Smartphone, Landmark, Copy,
  ClipboardList, Lock, Star, Hourglass, FileSignature, DoorOpen, Pencil, HeartPulse,
  Camera, Zap,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { useAuth } from '../../context/AuthContext';
import ErrorBanner from '../Layout/ErrorBanner';
import ProtectedImage from '../Layout/ProtectedImage';
import StatHistoryModal from './StatHistoryModal';
import FamilyCodeModal from './FamilyCodeModal';
import LessonNotesModal from './LessonNotesModal';
import WaiverForm from '../Waiver/WaiverForm';
import { GRADE_LEVELS } from '../../constants/gradeLevels';
import Linkified from '../../lib/linkify';
import './ParentPortal.css';

const RELATIONSHIPS = ['Parent', 'Guardian', 'Grandparent', 'Aunt/Uncle', 'Sibling', 'Family Friend', 'Other'];

/* Payment methods accepted by Love Camp — edit handles here as they change. */
const PAYMENT_METHODS = [
  {
    id: 'ema',
    name: 'EMA · Step Up for Students',
    icon: <GraduationCap size={18} />,
    badge: 'Scholarship',
    accent: '#047857',
    detail: 'Direct Pay on EMA Marketplace/Providers/Love Camp using the invoice number (e.g. LC-4391). We approve the charge and payment is processed with your scholarship.',
    copy: null,
  },
  {
    id: 'zelle',
    name: 'Zelle',
    icon: <Landmark size={18} />,
    badge: 'No fee',
    accent: '#7c3aed',
    detail: 'Send to:',
    copy: 'lovelearningfl@gmail.com',
  },
  {
    id: 'venmo',
    name: 'Venmo',
    icon: <Smartphone size={18} />,
    badge: 'No fee',
    accent: '#0369a1',
    detail: 'Username:',
    copy: '@LoveLearningFL',
  },
  {
    id: 'paypal',
    name: 'PayPal',
    icon: <Smartphone size={18} />,
    badge: 'No fee',
    accent: '#1d4ed8',
    detail: 'Send to:',
    copy: 'lovelearningfl@gmail.com',
  },
  {
    id: 'card',
    name: 'Credit Card',
    icon: <CreditCard size={18} />,
    badge: 'No extra fee',
    accent: '#b45309',
    detail: 'Use the "Pay" button on each invoice to pay securely by card. You are charged the exact invoice amount.',
    copy: null,
  },
];

/* What each kind of submission looks like to a family. Same colours the
   Marketing Hub uses in its review queue, so staff and parents recognise the
   same card. "Weekly Photos" loses its label here — to a parent the pictures
   are the point, and a badge reading "Weekly Photos" over a photo grid is
   noise. */
const HIGHLIGHT_TYPES = {
  PHOTOS:           { label: null,                  icon: Camera, color: '#3b82f6', bg: '#dbeafe' },
  STUDENT_OF_WEEK:  { label: 'Student of the Week', icon: Star,   color: '#f59e0b', bg: '#fef3c7' },
  ACTIVITY_OF_WEEK: { label: 'Activity of the Week', icon: Zap,   color: '#8b5cf6', bg: '#ede9fe' },
};

const TABS = [
  { id: 'children',  label: 'My Children',      icon: <Users size={16} /> },
  { id: 'register',  label: 'Registration',    icon: <ClipboardList size={16} /> },
  { id: 'billing',   label: 'Account & Payments',  icon: <CreditCard size={16} /> },
  { id: 'highlights', label: 'Highlights',      icon: <Camera size={16} /> },
  { id: 'announcements', label: 'Announcements',    icon: <Bell size={16} /> },
];

// mm/dd/yy — US school, dates are always numeric US format.
//
// Read with the UTC getters, because everything these two format is a
// date-only column (Session.date, Invoice.date/dueDate, Transaction.date,
// TempPickupAuth.validDate), and Postgres hands those back stamped at UTC
// midnight. The local getters turned 2026-08-25T00:00:00Z into the evening of
// the 24th for every family in Florida, so a Tuesday class was advertised to
// parents as meeting on Monday. For a real timestamp use fmtInstant below.
const fmt = (iso) => {
  const d = new Date(iso);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCFullYear()).slice(-2)}`;
};
const fmtShort = (iso) => {
  const d = new Date(iso);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
};

/**
 * The same mm/dd/yy for values that are a genuine point in time — a waiver
 * signature, an announcement's publication. Those carry a real zone, so they
 * belong on the reader's own clock and must NOT go through fmt().
 */
const fmtInstant = (iso) => {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
};

/* Human-readable countdown between now and a target date. */
const countdown = (target, from = new Date()) => {
  const ms = new Date(target) - new Date(from);
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const REQUEST_STATUS_META = {
  enrolled_first: { label: 'Enrolled in your first choice', cls: 'ok', icon: <CheckCircle size={15} /> },
  enrolled: { label: 'Enrolled', cls: 'ok', icon: <CheckCircle size={15} /> },
  waitlisted_first_enrolled_second: { label: 'Waitlisted (1st) · Enrolled in 2nd choice', cls: 'partial', icon: <Hourglass size={15} /> },
  waitlisted_both: { label: 'Waitlisted', cls: 'wait', icon: <Hourglass size={15} /> },
  enrolled_all: { label: 'Enrolled in all requested classes', cls: 'ok', icon: <CheckCircle size={15} /> },
  enrolled_partial: { label: 'Enrolled in some classes, waitlisted for others', cls: 'partial', icon: <Hourglass size={15} /> },
  waitlisted_all: { label: 'Waitlisted for every requested class', cls: 'wait', icon: <Hourglass size={15} /> },
  pending: { label: 'Request in progress', cls: 'wait', icon: <Hourglass size={15} /> },
};

/* ────────── Registration: per-child card ────────── */
const IXL_OPTIONS = [
  { value: 'NONE', label: 'None' },
  { value: 'CORE', label: 'IXL Core ($5)' },
  { value: 'CORE_SPANISH', label: 'IXL Core + Spanish ($10)' },
];

const RegistrationChildCard = ({ child, classes, electives, onClaim, onSubmit, submitting }) => {
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [electiveIds, setElectiveIds] = useState([]);
  const [ixlPlan, setIxlPlan] = useState('NONE');
  const busy = submitting === child.id;

  const toggleElective = (id) =>
    setElectiveIds(prev => prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]);

  const electivesPicker = electives.length > 0 && (
    <div className="reg-field">
      <label>Electives <span className="reg-optional">(optional, $130 each)</span></label>
      <div className="reg-elective-list">
        {electives.map(e => (
          <label key={e.id} className="reg-elective-option">
            <input type="checkbox" checked={electiveIds.includes(e.id)} onChange={() => toggleElective(e.id)} />
            {e.name} — ${e.price}
          </label>
        ))}
      </div>
    </div>
  );

  const ixlPicker = (
    <div className="reg-field">
      <label>IXL Plan</label>
      <select value={ixlPlan} onChange={e => setIxlPlan(e.target.value)}>
        {IXL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );

  // Already has a processed request → show outcome (read-only).
  if (child.isRegistered) {
    const meta = REQUEST_STATUS_META[child.requestStatus] || REQUEST_STATUS_META.pending;
    return (
      <div className="reg-child-card">
        <div className="reg-child-head">
          <div className="reg-child-avatar">{child.name?.[0]}</div>
          <div><h4>{child.name}</h4></div>
        </div>
        <div className={`reg-status-banner ${meta.cls}`}>{meta.icon}<span>{meta.label}</span></div>
        {child.enrollments.length > 0 && (
          <ul className="reg-enrolled-list">
            {child.enrollments.map(e => (
              <li key={e.classId}><CheckCircle size={13} /> {e.className}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // Window not open for this child yet.
  if (!child.windowOpen) {
    return (
      <div className="reg-child-card locked">
        <div className="reg-child-head">
          <div className="reg-child-avatar">{child.name?.[0]}</div>
          <div><h4>{child.name}</h4></div>
        </div>
        <div className="reg-status-banner locked">
          <Lock size={15} />
          <span>Your registration window is not open yet.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="reg-child-card">
      <div className="reg-child-head">
        <div className="reg-child-avatar">{child.name?.[0]}</div>
        <div><h4>{child.name}</h4></div>
        {child.hasPriority && <span className="reg-priority-tag"><Star size={12} /> Guaranteed spot</span>}
      </div>

      {/* Guaranteed-spot one-click claim */}
      {child.hasPriority && child.priorityClassId && (
        <div className="reg-guaranteed">
          <div className="reg-guaranteed-text">
            <Star size={16} />
            <div>
              <strong>{child.priorityClassName}</strong>
              <span>Your spot is reserved. Choose your extras below, then claim it.</span>
            </div>
          </div>
          {electivesPicker}
          {ixlPicker}
          <button className="reg-claim-btn" disabled={busy} onClick={() => onClaim(child.id, child.priorityClassId, electiveIds, ixlPlan)}>
            {busy ? 'Processing...' : 'Claim my spot'}
          </button>
        </div>
      )}

      {/* First / second choice selection */}
      <div className="reg-choices">
        <div className="reg-field">
          <label>First choice</label>
          <select value={first} onChange={e => setFirst(e.target.value)}>
            <option value="">Choose a cove...</option>
            {classes.map(c => (
              <option key={c.id} value={c.id} disabled={c.available <= 0}>
                {c.name} — {c.available > 0 ? `${c.available} spots` : 'Full (waitlist)'}
              </option>
            ))}
          </select>
        </div>
        <div className="reg-field">
          <label>Second choice <span className="reg-optional">(optional)</span></label>
          <select value={second} onChange={e => setSecond(e.target.value)}>
            <option value="">No second choice</option>
            {classes.filter(c => c.id !== first).map(c => (
              <option key={c.id} value={c.id} disabled={c.available <= 0}>
                {c.name} — {c.available > 0 ? `${c.available} spots` : 'Full (waitlist)'}
              </option>
            ))}
          </select>
        </div>
        {electivesPicker}
        {ixlPicker}
        <button
          className="reg-submit-btn"
          disabled={!first || busy}
          onClick={() => onSubmit(child.id, first, second || null, electiveIds, ixlPlan)}
        >
          {busy ? 'Processing...' : 'Submit registration'}
        </button>
      </div>
    </div>
  );
};

/* ────────── Pickup Modal ────────── */
const PickupModal = ({ children, onClose, onCreated, initialAuth = null }) => {
  const [form, setForm] = useState({ pickupPerson: '', relationship: 'Parent', validDate: '', studentId: '' });
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState(initialAuth);
  const today = new Date().toISOString().split('T')[0];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.pickupPerson || !form.validDate) return;
    setSubmitting(true);
    try {
      const res = await api.post('/portal/parent/pickup', {
        pickupPerson: form.pickupPerson,
        relationship: form.relationship,
        validDate: form.validDate,
        // The id, not the name: this is what ties the code to a child, and the
        // desk resolves it on scan. Empty keeps meaning "all my children".
        studentId: form.studentId,
      });
      setCreated(res.data);
      onCreated(res.data);
    } catch (err) { console.error(err); }
    setSubmitting(false);
  };

  const qrPayload = created
    ? JSON.stringify({ token: created.qrCodeHash, person: created.pickupPerson, valid: created.validDate })
    : null;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pickup-modal">
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        {!created ? (
          <>
            <div className="modal-header">
              <div className="modal-icon"><QrCode size={22} /></div>
              <div><h2>Authorize Pickup</h2><p>Generate a QR code for a trusted person.</p></div>
            </div>
            <form onSubmit={handleSubmit} className="pickup-form">
              {children.length > 1 && (
                <div className="form-group">
                  <label>Student</label>
                  <select value={form.studentId} onChange={e => setForm(f => ({ ...f, studentId: e.target.value }))}>
                    <option value="">All children</option>
                    {children.map(c => <option key={c.id} value={c.id}>{c.fullName}</option>)}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label>Person's name *</label>
                <input type="text" placeholder="Full name" value={form.pickupPerson}
                  onChange={e => setForm(f => ({ ...f, pickupPerson: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label>Relationship</label>
                <select value={form.relationship} onChange={e => setForm(f => ({ ...f, relationship: e.target.value }))}>
                  {RELATIONSHIPS.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Valid until *</label>
                <input type="date" min={today} value={form.validDate}
                  onChange={e => setForm(f => ({ ...f, validDate: e.target.value }))} required />
              </div>
              <button type="submit" className="pp-primary-btn" disabled={submitting}>
                {submitting ? 'Generating...' : <><QrCode size={16} /> Generate QR</>}
              </button>
            </form>
          </>
        ) : (
          <div className="qr-result">
            <div className="qr-success-badge"><ShieldCheck size={20} /> Authorization created</div>
            <h3>{created.pickupPerson}</h3>
            <p className="qr-valid-date">
              Picking up: <strong>{created.student?.fullName || 'All children'}</strong>
            </p>
            <p className="qr-valid-date">Valid until: <strong>{fmt(created.validDate)}</strong></p>
            <div className="qr-wrapper">
              <QRCodeSVG value={qrPayload} size={200} bgColor="#ffffff" fgColor="#1e293b" level="M" includeMargin />
            </div>
            <p className="qr-instructions">
              <strong>Please take a screenshot of this QR code</strong> and send it to the person collecting your child. They must show it at the front desk.
            </p>
            <div className="qr-actions">
              {!initialAuth && <button className="qr-new-btn" onClick={() => setCreated(null)}>Create another</button>}
              <button className="qr-done-btn" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* ────────── Child Profile Modal ────────── */
/* What a parent can maintain about their own child. Deliberately just the
   health and school details the family is the authority on — name, email and
   status stay with staff, since the roster and every invoice key off those. */
const ChildProfileModal = ({ child, onClose, onSaved }) => {
  const [form, setForm] = useState({
    allergies: child.allergies || '',
    medicalNotes: child.medicalNotes || '',
    accommodationNotes: child.accommodationNotes || '',
    gradeLevel: child.gradeLevel || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(child.avatarUrl);
  const fileInputRef = useRef(null);

  const update = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.put(`/portal/parent/children/${child.id}`, form);
      // Ensure we preserve the avatarUrl from local state in case it just updated
      const updatedStudent = { ...res.data.student, avatarUrl };
      onSaved(updatedStudent);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || err.userMessage || 'Could not save those details.');
      setSaving(false);
    }
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAvatarUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('avatar', file);

    try {
      const res = await api.post(`/portal/parent/children/${child.id}/avatar`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setAvatarUrl(res.data.student.avatarUrl);
      onSaved(res.data.student);
    } catch (err) {
      setError(err.response?.data?.message || err.userMessage || 'Could not upload profile picture.');
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pickup-modal">
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="modal-header">
          <div className="modal-icon"><HeartPulse size={22} /></div>
          <div>
            <h2>{child.fullName?.split(' ')[0]}'s details</h2>
            <p>Keep us up to date — teachers and the front desk see this.</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="pickup-form">
          {error && <ErrorBanner message={error} />}
          
          <div className="pp-avatar-upload">
            <div className="pp-avatar-upload-preview">
              {avatarUrl ? (
                <img src={`${import.meta.env.VITE_API_URL || ''}${avatarUrl}`} alt="" />
              ) : (
                <>{child.fullName?.[0]}</>
              )}
            </div>
            <div className="pp-avatar-upload-actions">
              <input type="file" ref={fileInputRef} onChange={handleAvatarChange} style={{ display: 'none' }} accept="image/*" />
              <button type="button" className="pp-avatar-upload-btn" onClick={() => fileInputRef.current?.click()} disabled={avatarUploading}>
                {avatarUploading ? 'Uploading...' : 'Upload new photo'}
              </button>
              <p className="pp-avatar-upload-info">JPG or PNG, max 5MB</p>
            </div>
          </div>
          <div className="form-group">
            <label>Grade level</label>
            <select value={form.gradeLevel} onChange={e => update('gradeLevel', e.target.value)}>
              <option value="">Not set</option>
              {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Allergies</label>
            <textarea rows={2} maxLength={1000} placeholder="e.g. Peanuts, shellfish — or leave blank if none"
              value={form.allergies} onChange={e => update('allergies', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Medical conditions</label>
            <textarea rows={3} maxLength={1000}
              placeholder="Asthma, epilepsy, medication taken during the day, anything staff should know in an emergency"
              value={form.medicalNotes} onChange={e => update('medicalNotes', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Accommodations</label>
            <textarea rows={3} maxLength={1000}
              placeholder="How your child learns best — extra time, seating, reading support, an IEP or 504 plan"
              value={form.accommodationNotes} onChange={e => update('accommodationNotes', e.target.value)} />
          </div>
          <button type="submit" className="pp-primary-btn" disabled={saving}>
            {saving ? 'Saving...' : <><CheckCircle size={16} /> Save details</>}
          </button>
        </form>
      </div>
    </div>
  );
};

/* ────────── Invoice Row ────────── */
const STATUS_META = {
  DRAFT:    { label: 'Draft',    cls: 'draft'    },
  SENT:     { label: 'Pending',  cls: 'sent'     },
  PARTIAL:  { label: 'Partial',  cls: 'partial'  },
  PAID:     { label: 'Paid',     cls: 'paid'     },
  OVERDUE:  { label: 'Overdue',  cls: 'overdue'  },
  VOID:     { label: 'Voided',   cls: 'void'     },
};

const InvoiceRow = ({ inv, onPay, paying }) => {
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[inv.status] || { label: inv.status, cls: 'draft' };
  // A PARTIAL invoice (e.g. a deposit charge that absorbed existing account
  // credit) still owes a balance and must stay payable, same as SENT/OVERDUE —
  // only PAID/VOID/DRAFT are not.
  const canPay = ['SENT', 'PARTIAL', 'OVERDUE'].includes(inv.status) && inv.amountDue > 0;

  return (
    <div className={`pp-invoice ${meta.cls}`}>
      <div className="pp-invoice-main" onClick={() => setOpen(o => !o)}>
        <div className="pp-invoice-left">
          <span className={`pp-inv-status ${meta.cls}`}>{meta.label}</span>
          <div>
            <span className="pp-inv-number">{inv.invoiceNumber}</span>
            {inv.dateRange && <span className="pp-inv-range">{inv.dateRange}</span>}
          </div>
        </div>
        <div className="pp-invoice-right">
          <div className="pp-inv-amounts">
            <span className="pp-inv-total">${inv.total.toFixed(2)}</span>
            {inv.amountDue > 0 && (
              <span className="pp-inv-due">Balance: ${inv.amountDue.toFixed(2)}</span>
            )}
          </div>
          {canPay && (
            <button
              className="pp-pay-btn"
              onClick={e => { e.stopPropagation(); onPay(inv.id); }}
              disabled={paying === inv.id}
            >
              {paying === inv.id ? 'Processing...' : <><CreditCard size={14} /> Pay</>}
            </button>
          )}
          <button className="pp-inv-toggle">
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="pp-invoice-detail">
          <div className="pp-inv-detail-meta">
            <span>Date: {fmt(inv.date)}</span>
            {inv.dueDate && <span>Due: {fmt(inv.dueDate)}</span>}
            {inv.amountPaid > 0 && <span>Paid: ${inv.amountPaid.toFixed(2)}</span>}
          </div>
          {inv.lines.length > 0 && (
            <table className="pp-inv-lines">
              <thead>
                <tr><th>Description</th><th>Qty.</th><th>Amount</th></tr>
              </thead>
              <tbody>
                {inv.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.description}</td>
                    <td>{l.quantity}</td>
                    <td>${Number(l.amount).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={2}><strong>Total</strong></td><td><strong>${inv.total.toFixed(2)}</strong></td></tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

/* ────────── Parent Portal ────────── */
const ParentPortal = () => {
  const [data, setData]             = useState(null);
  const [billing, setBilling]       = useState(null);
  const [loading, setLoading]       = useState(true);
  const [billingLoading, setBillingLoading] = useState(false);
  const [error, setError]           = useState(null);
  const [tab, setTab]               = useState('children');
  const [highlights, setHighlights]   = useState([]);
  const [hlLoading, setHlLoading]     = useState(false);
  const [hlError, setHlError]         = useState(null);
  const [lightbox, setLightbox]       = useState(null); // { photoId, alt }

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e) => { if (e.key === 'Escape') setLightbox(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);
  const [activeChild, setActiveChild] = useState(0);
  const [statModal, setStatModal] = useState(null); // 'seashells' | 'punches' | 'positive' | 'warnings'
  const [pickupAuths, setPickupAuths] = useState([]);
  const [showPickupModal, setShowPickupModal] = useState(false);
  const [viewAuth, setViewAuth] = useState(null);
  const [showFamilyCode, setShowFamilyCode] = useState(false);
  const [paying, setPaying]         = useState(null);
  const [payError, setPayError]     = useState(null);
  const [showHowToPay, setShowHowToPay] = useState(false);
  const [copiedId, setCopiedId]     = useState(null);
  const [registration, setRegistration] = useState(null);
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError]     = useState(null);
  const [regSubmitting, setRegSubmitting] = useState(null);
  const [reloadSubmitting, setReloadSubmitting] = useState(null);
  const [waiverChild, setWaiverChild] = useState(null);
  // The child whose health / school details are open for editing.
  const [profileChild, setProfileChild] = useState(null);
  const [waiverDownloading, setWaiverDownloading] = useState(null);
  // The class whose full note history is open — { studentId, classId, className }.
  const [notesFor, setNotesFor] = useState(null);
  const [notesDownloading, setNotesDownloading] = useState(null); // classId being exported
  const [notesError, setNotesError] = useState(null);
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleCopy = (id, value) => {
    navigator.clipboard?.writeText(value);
    setCopiedId(id);
    setTimeout(() => setCopiedId(c => (c === id ? null : c)), 1500);
  };

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [portalRes, pickupRes] = await Promise.all([
        api.get('/portal/parent'),
        api.get('/portal/parent/pickup'),
      ]);
      setData(portalRes.data);
      setPickupAuths(pickupRes.data);
      
      // Fetch billing in the background so the dashboard can show debt
      loadBilling();
    } catch (err) {
      setError(err.userMessage || 'Could not load the family portal.');
    } finally {
      setLoading(false);
    }
  };

  const loadBilling = async (force = false) => {
    if (billing && !force) return;
    setBillingLoading(true);
    try {
      const res = await api.get('/portal/parent/billing');
      setBilling(res.data);
    } catch (err) {
      console.error('Billing load error', err);
    } finally {
      setBillingLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Live push: a Stripe card payment settles via webhook while the parent may
  // be sitting on this very screen (or never left it, e.g. paid on their
  // phone). Without this the paid invoice only shows up on a manual reload.
  useEffect(() => {
    if (!user?.id) return;
    const socket = getSocket();
    socket.emit('join_user', user.id);
    const onBillingUpdated = () => loadBilling(true);
    socket.on('billing_updated', onBillingUpdated);
    return () => socket.off('billing_updated', onBillingUpdated);
  }, [user?.id]);

  // Coming back from a Stripe Checkout redirect — jump to Billing and pull the
  // freshly-webhooked invoice status instead of showing stale/cached data.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    if (!payment) return;
    setTab('billing');
    loadBilling(true);
    if (payment === 'success') setPayError(null);
    if (payment === 'cancelled') setPayError('Payment was cancelled.');
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  // The family-facing slice of the Marketing Hub: only what an admin has
  // already approved, never the review queue.
  const loadHighlights = async () => {
    setHlLoading(true); setHlError(null);
    try {
      const res = await api.get('/marketing/feed');
      setHighlights(res.data.submissions);
    } catch (err) {
      setHlError(err.userMessage || 'Could not load highlights.');
    } finally {
      setHlLoading(false);
    }
  };

  const loadRegistration = async () => {
    setRegLoading(true); setRegError(null);
    try {
      const res = await api.get('/registration/parent');
      setRegistration(res.data);
    } catch (err) {
      setRegError(err.userMessage || 'Could not load registration.');
    } finally {
      setRegLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'billing') loadBilling();
    if (tab === 'register') loadRegistration();
    if (tab === 'highlights') loadHighlights();
    // Mark all announcements as read when the user opens this tab, clearing
    // the sidebar badge count.
    if (tab === 'announcements' && data?.announcements?.length) {
      data.announcements.forEach(a => {
        if (!a.isRead) api.post(`/announcements/${a.id}/read`).catch(() => {});
      });
    }
  }, [tab]);

  const handleRegSubmit = async (studentId, firstChoiceClassId, secondChoiceClassId, electiveIds = [], ixlPlan = 'NONE') => {
    if (!registration?.term) return;
    setRegSubmitting(studentId); setRegError(null);
    try {
      await api.post('/registration/request', {
        termId: registration.term.id,
        studentId,
        firstChoiceClassId,
        secondChoiceClassId,
        electiveIds,
        ixlPlan,
      });
      await loadRegistration();
    } catch (err) {
      setRegError(err.response?.data?.message || 'Could not process the registration.');
    } finally {
      setRegSubmitting(null);
    }
  };

  const handleRegClaim = (studentId, priorityClassId, electiveIds = [], ixlPlan = 'NONE') =>
    handleRegSubmit(studentId, priorityClassId, null, electiveIds, ixlPlan);

  const handlePickupCreated = (auth) => setPickupAuths(prev => [auth, ...prev]);

  // Patch the one child locally instead of refetching the whole portal — the
  // banner has to disappear the moment the signature lands, and a round-trip
  // here reads as the button not having worked.
  const handleWaiverSigned = (studentId, waiver) => {
    setData(d => ({
      ...d,
      children: d.children.map(c =>
        c.id === studentId ? { ...c, waiver: { id: waiver.id, signedAt: waiver.signedAt } } : c
      ),
    }));
    setWaiverChild(null);
  };

  // Same idea for the profile edit: the server hands back the saved columns, so
  // merge those onto the child rather than refetching the portal.
  const handleProfileSaved = (student) => {
    setData(d => ({
      ...d,
      children: d.children.map(c => (c.id === student.id ? { ...c, ...student } : c)),
    }));
  };

  // The PDF sits behind the same auth as everything else, so it has to be
  // fetched with the token rather than opened as a plain link.
  const handleDownloadWaiver = async (waiverId, childName) => {
    setWaiverDownloading(waiverId);
    try {
      const res = await api.get(`/waivers/${waiverId}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `waiver-${(childName || 'signed').replace(/[^a-zA-Z0-9]+/g, '-')}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    } finally {
      setWaiverDownloading(null);
    }
  };

  // Same pattern as the waiver download — the PDF sits behind auth, so it has
  // to be fetched with the token rather than opened as a plain link.
  const handleDownloadClassNotes = async (studentId, classId, className) => {
    setNotesDownloading(classId);
    setNotesError(null);
    try {
      const res = await api.get(`/portal/parent/children/${studentId}/classes/${classId}/notes/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `lesson-notes-${(className || 'class').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setNotesError(err.userMessage || 'Could not download those lesson notes.');
    } finally {
      setNotesDownloading(null);
    }
  };

  const handleDeleteAuth = async (id) => {
    try {
      await api.delete(`/portal/parent/pickup/${id}`);
      setPickupAuths(prev => prev.filter(a => a.id !== id));
    } catch (err) { console.error(err); }
  };

  const handleReloadDecision = async (childId, requestId, decision) => {
    setReloadSubmitting(requestId);
    try {
      await api.patch(`/portal/parent/snack-reloads/${requestId}`, { decision });
      // Clear the banner locally so the child card updates immediately.
      setData(prev => prev && {
        ...prev,
        children: prev.children.map(c =>
          c.id === childId ? { ...c, pendingReload: null } : c
        ),
      });
    } catch (err) {
      setError(err.userMessage || err.response?.data?.message || 'Could not submit your decision.');
    } finally {
      setReloadSubmitting(null);
    }
  };

  const handlePay = async (invoiceId) => {
    setPaying(invoiceId); setPayError(null);
    try {
      const res = await api.post(`/portal/parent/billing/pay/${invoiceId}`);
      window.open(res.data.url, '_blank');
    } catch (err) {
      setPayError(err.response?.data?.error || 'Could not process the payment. Contact the academy.');
    } finally {
      setPaying(null);
    }
  };

  if (loading) return <div className="pp-loading"><span className="pp-spinner" />Loading family portal...</div>;
  if (error)   return <div className="pp-loading"><ErrorBanner message={error} onRetry={load} /></div>;
  if (!data)   return null;

  const { children, announcements } = data;
  const child = children[activeChild] || null;
  const activeAuths = pickupAuths.filter(a => new Date(a.validDate) >= new Date(new Date().setHours(0,0,0,0)));
  // Pickup + snack cards are an on-site concept — hide them entirely for
  // families whose children are 100% online.
  const inPersonChildren = children.filter(c => c.isInPerson);

  return (
    <div className="pp-root">
      {/* ── Hero ── */}
      <div className="pp-hero">
        <div className="pp-hero-bg" />
        <div className="pp-hero-content">
          <div className="pp-hero-icon"><Heart size={28} /></div>
          <div className="pp-hero-text">
            <h1>Family Portal</h1>
            <p>Follow your children's progress and manage your account</p>
          </div>
        </div>
        <div className="pp-hero-actions">
          {inPersonChildren.length > 0 && (
            <>
              {/* The everyday code comes first — authorising someone else is
                  the exception, and it reads as one sitting next to this. */}
              <button className="pp-hero-btn" onClick={() => setShowFamilyCode(true)}>
                <DoorOpen size={15} /> Check-In QR
              </button>
              <button className="pp-hero-btn" onClick={() => setShowPickupModal(true)}>
                <QrCode size={15} /> Authorize Pickup
                {activeAuths.length > 0 && <span className="pp-auth-badge">{activeAuths.length}</span>}
              </button>
            </>
          )}
          <button className="pp-hero-btn" onClick={() => navigate('/chat')}>
            <MessageSquare size={15} /> Chat with Teachers
          </button>
        </div>
      </div>

      {/* Active pickup strip */}
      {activeAuths.length > 0 && (
        <div className="pp-pickup-strip">
          <ShieldCheck size={14} />
          <span>Active authorizations:</span>
          {activeAuths.map(auth => (
            <div key={auth.id} className="pp-pickup-chip">
              <QrCode size={12} />
              <span>{auth.pickupPerson}</span>
              <span className="pp-chip-date">{fmtShort(auth.validDate)}</span>
              <button onClick={() => handleDeleteAuth(auth.id)}><Trash2 size={11} /></button>
            </div>
          ))}
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="pp-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`pp-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.icon}<span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="pp-body">

        {/* ══════════ CHILDREN TAB ══════════ */}
        {tab === 'children' && (
          <>
            {/* Outstanding Balance Banner */}
            {billing && billing.balance > 0 && (
              <div className="pp-dashboard-alert" style={{ background: '#fef2f2', border: '1px solid #fca5a5', padding: '16px', borderRadius: '8px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h4 style={{ color: '#991b1b', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}><AlertCircle size={18} /> Account Balance</h4>
                  <p style={{ margin: '4px 0 0 0', color: '#7f1d1d' }}>You have an outstanding balance of <strong>${billing.balance.toFixed(2)}</strong>.</p>
                </div>
                <button className="pp-primary-btn" style={{ background: '#dc2626', borderColor: '#dc2626' }} onClick={() => setTab('billing')}>Pay Now</button>
              </div>
            )}

            {/* Child selector */}
            {children.length > 1 && (
              <div className="pp-child-tabs">
                {children.map((c, i) => (
                  <button key={c.id} className={`pp-child-tab ${activeChild === i ? 'active' : ''}`}
                    onClick={() => setActiveChild(i)}>
                    {c.avatarUrl ? (
                      <img src={`${import.meta.env.VITE_API_URL || ''}${c.avatarUrl}`} alt="" className="pp-child-avatar-img" />
                    ) : (
                      <div className="pp-child-avatar">{c.fullName?.[0]}</div>
                    )}
                    <span>{c.fullName?.split(' ')[0]}</span>
                  </button>
                ))}
              </div>
            )}

            {child ? (
              <>
                {/* Child profile + stats */}
                <div className="pp-child-overview">
                  <div className="pp-child-card">
                    {child.avatarUrl ? (
                      <img src={`${import.meta.env.VITE_API_URL || ''}${child.avatarUrl}`} alt="" className="pp-child-avatar-lg-img" />
                    ) : (
                      <div className="pp-child-avatar-lg">{child.fullName?.[0]}</div>
                    )}
                    <div className="pp-child-info">
                      <h2>{child.fullName}</h2>
                      {child.age && <span className="pp-child-age">Age {child.age}</span>}
                      {child.gradeLevel && <span className="pp-child-age">{child.gradeLevel} grade</span>}
                      {/* A self-registered child sits INACTIVE until staff place
                          them. "INACTIVE" reads like something is wrong with
                          their account; it only means we haven't placed them yet. */}
                      <span className={`status-tag ${child.status?.toLowerCase()}`}>
                        {child.status === 'INACTIVE' ? 'Pending placement' : child.status}
                      </span>
                    </div>
                  </div>
                  {/* Tap any stat to see its full history and the reason behind each entry */}
                  <div className="pp-child-stats">
                    <button type="button" className="pp-cstat shells" onClick={() => setStatModal('seashells')}>
                      <Shell size={20} />
                      <span className="pp-cstat-num">{child.seashells || 0}</span>
                      <span className="pp-cstat-lbl">Seashells</span>
                    </button>
                    {child.isInPerson && (
                      <button type="button" className="pp-cstat snack" onClick={() => setStatModal('punches')}>
                        <span style={{ fontSize: 20 }}>🍪</span>
                        <span className="pp-cstat-num">{child.snackPunches || 0}</span>
                        <span className="pp-cstat-lbl">Punches</span>
                      </button>
                    )}
                    <button type="button" className="pp-cstat pos" onClick={() => setStatModal('positive')}>
                      <ThumbsUp size={20} />
                      <span className="pp-cstat-num">{child.behaviorSummary?.positives || 0}</span>
                      <span className="pp-cstat-lbl">Positive</span>
                    </button>
                    {(child.behaviorSummary?.warnings || 0) > 0 && (
                      <button type="button" className="pp-cstat warn" onClick={() => setStatModal('warnings')}>
                        <AlertTriangle size={20} />
                        <span className="pp-cstat-num">{child.behaviorSummary.warnings}</span>
                        <span className="pp-cstat-lbl">Warnings</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Health and school details, kept by the family rather than
                    guessed at by staff. Stays red-and-loud when there is
                    something to flag, and turns into a plain invitation when
                    there isn't — an empty allergy field is not an alert, but a
                    parent who never noticed they could fill it in is a problem. */}
                {(child.allergies || child.medicalNotes || child.accommodationNotes) ? (
                  <div className="pp-health-banner">
                    <AlertTriangle size={15} />
                    {child.allergies && <span><strong>Allergies:</strong> {child.allergies}</span>}
                    {child.medicalNotes && <span><strong>Medical:</strong> {child.medicalNotes}</span>}
                    {child.accommodationNotes && <span><strong>Accommodations:</strong> {child.accommodationNotes}</span>}
                    <button type="button" className="pp-health-edit" onClick={() => setProfileChild(child)}>
                      <Pencil size={13} /> Edit
                    </button>
                  </div>
                ) : (
                  <div className="pp-health-banner empty">
                    <HeartPulse size={15} />
                    <span>
                      No allergies, medical conditions or accommodations on file for
                      {' '}{child.fullName?.split(' ')[0]}.
                    </span>
                    <button type="button" className="pp-health-edit" onClick={() => setProfileChild(child)}>
                      <Plus size={13} /> Add details
                    </button>
                  </div>
                )}

                {/* The liability waiver is required before a child takes part.
                    Shown here rather than in the signup wizard because it also
                    has to reach families who registered before it existed. */}
                {!child.waiver ? (
                  <div className="pp-waiver-banner">
                    <div className="pp-waiver-copy">
                      <FileSignature size={18} />
                      <div>
                        <h4>Liability waiver required</h4>
                        <p>
                          We need a signed waiver for {child.fullName?.split(' ')[0]} before
                          they can take part in activities.
                        </p>
                      </div>
                    </div>
                    <button className="pp-waiver-sign" onClick={() => setWaiverChild(child)}>
                      <FileSignature size={15} /> Read &amp; sign
                    </button>
                  </div>
                ) : (
                  <div className="pp-waiver-banner signed">
                    <div className="pp-waiver-copy">
                      <ShieldCheck size={18} />
                      <div>
                        <h4>Liability waiver signed</h4>
                        <p>Signed on {fmtInstant(child.waiver.signedAt)}.</p>
                      </div>
                    </div>
                    <button
                      className="pp-waiver-download"
                      disabled={waiverDownloading === child.waiver.id}
                      onClick={() => handleDownloadWaiver(child.waiver.id, child.fullName)}
                    >
                      <Download size={15} />
                      {waiverDownloading === child.waiver.id ? 'Preparing...' : 'Download PDF'}
                    </button>
                  </div>
                )}

                {/* Snack card reached 0 — parent must approve a paid reload */}
                {child.pendingReload && (
                  <div className="pp-reload-banner">
                    <div className="pp-reload-head">
                      <span className="pp-reload-emoji">🍪</span>
                      <div>
                        <h4>{child.fullName?.split(' ')[0]} ran out of snack punches</h4>
                        <p>
                          Approve reloading <strong>{child.pendingReload.punchCount} punches</strong> for{' '}
                          <strong>${child.pendingReload.price.toFixed(2)}</strong>? This will be charged to your account.
                        </p>
                      </div>
                    </div>
                    <div className="pp-reload-actions">
                      <button
                        className="pp-reload-reject"
                        disabled={reloadSubmitting === child.pendingReload.id}
                        onClick={() => handleReloadDecision(child.id, child.pendingReload.id, 'REJECTED')}
                      >
                        <X size={15} /> Not now
                      </button>
                      <button
                        className="pp-reload-approve"
                        disabled={reloadSubmitting === child.pendingReload.id}
                        onClick={() => handleReloadDecision(child.id, child.pendingReload.id, 'APPROVED')}
                      >
                        {reloadSubmitting === child.pendingReload.id
                          ? 'Submitting...'
                          : <><CheckCircle size={15} /> Approve reload</>}
                      </button>
                    </div>
                  </div>
                )}

                <div className="pp-child-grid">
                  {/* Classes */}
                  <div className="pp-child-section">
                    <h3><Calendar size={17} /> Classes & Schedule</h3>
                    {!child.enrollments?.length ? <p className="pp-empty">No active classes.</p> : (
                      <div className="pp-child-classes">
                        {child.enrollments.map((e, i) => (
                          <div key={i} className="pp-class-item-wrap">
                            <div className="pp-class-item">
                              <div>
                                <h4>{e.className}</h4>
                                <span>with {e.teacherName}</span>
                              </div>
                              {e.upcomingSessions?.[0] && (
                                <div className="pp-next-badge">
                                  <Clock size={11} />
                                  {fmtShort(e.upcomingSessions[0].date)}
                                </div>
                              )}
                            </div>
                            {e.upcomingSessions?.[0]?.lessonPreview && (
                              <p className="pp-lesson-preview">
                                <BookOpen size={12} /> {e.upcomingSessions[0].lessonPreview}
                              </p>
                            )}
                            {/* The badge above is only the next meeting — this opens every
                                note a manager has published for the class. */}
                            <button
                              type="button"
                              className="pp-notes-btn"
                              onClick={() => setNotesFor({ studentId: child.id, classId: e.classId, className: e.className })}
                            >
                              <BookOpen size={12} /> All lesson notes
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Classes that already wrapped, or one the child was
                        dropped from — kept separate so the schedule above
                        stays only what's actually running, while the notes
                        archive for a finished class stays reachable. */}
                    {child.pastEnrollments?.length > 0 && (
                      <div className="pp-past-classes">
                        <p className="pp-past-classes-title">Past classes</p>
                        {child.pastEnrollments.map((e, i) => (
                          <div key={i} className="pp-class-item-wrap pp-past">
                            <div className="pp-class-item">
                              <div>
                                <h4>{e.className}</h4>
                                <span>with {e.teacherName}</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              className="pp-notes-btn"
                              onClick={() => setNotesFor({ studentId: child.id, classId: e.classId, className: e.className })}
                            >
                              <BookOpen size={12} /> All lesson notes
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Rewards */}
                  <div className="pp-child-section">
                    <h3><Gift size={17} /> Recent Rewards</h3>
                    {!child.seashellHistory?.length ? <p className="pp-empty">No rewards yet.</p> : (
                      <div className="pp-reward-list">
                        {child.seashellHistory.slice(0, 6).map((p, i) => (
                          <div key={i} className="pp-reward-item">
                            <span className="pp-reward-reason">{p.reason}</span>
                            <span className={`pp-reward-pts ${p.type === 'EARNED' ? 'pos' : 'neg'}`}>
                              {p.type === 'EARNED' ? '+' : '−'}{p.points}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Materials */}
                  <div className="pp-child-section">
                    <h3><BookOpen size={17} /> Materials</h3>
                    {!child.materials?.length ? <p className="pp-empty">No materials yet.</p> : (
                      <div className="pp-materials">
                        {child.materials.slice(0, 5).map((m, i) => (
                          <a key={i} href={m.fileUrl} target="_blank" rel="noopener noreferrer" className="pp-material-link">
                            📄 {m.name}<span className="pp-mat-sub">{m.subject}</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Lesson notes — the full published history per class, kept
                      separate from Materials since it comes from a different
                      source (approved lesson plans, not uploads). */}
                  {child.enrollments?.length > 0 && (
                    <div className="pp-child-section">
                      <h3><Download size={17} /> Lesson Notes</h3>
                      {notesError && <ErrorBanner message={notesError} />}
                      <div className="pp-materials">
                        {child.enrollments.map((e) => (
                          <button
                            key={e.classId}
                            type="button"
                            className="pp-material-link pp-notes-download"
                            disabled={notesDownloading === e.classId}
                            onClick={() => handleDownloadClassNotes(child.id, e.classId, e.className)}
                          >
                            📄 {e.className}
                            <span className="pp-mat-sub">
                              {notesDownloading === e.classId ? 'Preparing…' : 'Download PDF'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Pickup Authorizations — only relevant for students who are physically picked up */}
                  {child.isInPerson && (
                    <div className="pp-child-section">
                      <h3><QrCode size={17} /> Pickup Authorizations</h3>
                      {pickupAuths.length === 0 ? (
                        <div className="pp-pickup-empty">
                          <p className="pp-empty">No authorizations.</p>
                          <button className="pp-secondary-btn" onClick={() => setShowPickupModal(true)}>
                            <Plus size={13} /> Authorize
                          </button>
                        </div>
                      ) : (
                        <div className="pp-pickup-list">
                          {pickupAuths.slice(0, 5).map(auth => {
                            const isPast = new Date(auth.validDate) < new Date(new Date().setHours(0,0,0,0));
                            return (
                              <div key={auth.id} className={`pp-pickup-item ${isPast ? 'expired' : 'valid'}`}>
                                <div>
                                  <span className="pp-pickup-person">{auth.pickupPerson}</span>
                                  <span className="pp-pickup-date">{fmt(auth.validDate)}</span>
                                </div>
                                <div className="pp-pickup-actions">
                                  <span className={`pp-pickup-badge ${isPast ? 'expired' : 'valid'}`}>
                                    {isPast ? 'Expired' : 'Active'}
                                  </span>
                                  {!isPast && (
                                    <>
                                      <button className="pp-revoke-btn" style={{marginRight: '8px', color: 'var(--primary)'}} onClick={() => setViewAuth(auth)} title="View QR">
                                        <QrCode size={13} />
                                      </button>
                                      <button className="pp-revoke-btn" onClick={() => handleDeleteAuth(auth.id)} title="Revoke">
                                        <Trash2 size={13} />
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          <button className="pp-secondary-btn pp-mt" onClick={() => setShowPickupModal(true)}>
                            <Plus size={13} /> New Authorization
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="pp-no-children">
                <Users size={40} />
                <h3>No students</h3>
                <p>Your account has no linked students.</p>
              </div>
            )}
          </>
        )}

        {/* ══════════ REGISTRATION TAB ══════════ */}
        {tab === 'register' && (
          <div className="reg-tab">
            {regLoading ? (
              <div className="pp-loading-inner"><span className="pp-spinner" />Loading registration...</div>
            ) : regError && !registration ? (
              <div className="pp-billing-error">
                <AlertCircle size={32} />
                <p>{regError}</p>
                <button className="pp-secondary-btn" onClick={loadRegistration}>Retry</button>
              </div>
            ) : !registration?.term ? (
              <div className="pp-billing-empty">
                <ClipboardList size={32} />
                <p>No open registration at this time.</p>
                <span style={{ fontSize: 13, color: '#94a3b8' }}>We will notify you when the next term opens.</span>
              </div>
            ) : (
              <>
                {(() => {
                  const t = registration.term;
                  const nowRef = t.now;
                  let phase;
                  if (new Date(nowRef) < new Date(t.window1OpensAt)) {
                    phase = { label: 'Opens in', value: countdown(t.window1OpensAt, nowRef), cls: 'soon' };
                  } else if (new Date(nowRef) <= new Date(t.registrationCloses)) {
                    phase = { label: 'Closes in', value: countdown(t.registrationCloses, nowRef), cls: 'open' };
                  } else {
                    phase = { label: 'Closed', value: null, cls: 'closed' };
                  }
                  return (
                    <div className={`reg-term-header ${phase.cls}`}>
                      <div>
                        <span className="reg-term-eyebrow">Registration</span>
                        <h2>{t.name}</h2>
                      </div>
                      {phase.value && (
                        <div className="reg-countdown">
                          <Clock size={15} />
                          <span>{phase.label} <strong>{phase.value}</strong></span>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {regError && (
                  <div className="pp-pay-error">
                    <AlertCircle size={16} /> {regError}
                    <button onClick={() => setRegError(null)}><X size={14} /></button>
                  </div>
                )}

                {registration.students.length === 0 ? (
                  <div className="pp-billing-empty">
                    <Users size={32} />
                    <p>No students linked to your account.</p>
                  </div>
                ) : (
                  <div className="reg-children-grid">
                    {registration.students.map(child => (
                      <RegistrationChildCard
                        key={child.id}
                        child={child}
                        classes={registration.classes}
                        electives={registration.electives || []}
                        onClaim={handleRegClaim}
                        onSubmit={handleRegSubmit}
                        submitting={regSubmitting}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ══════════ BILLING TAB ══════════ */}
        {tab === 'billing' && (
          <div className="pp-billing">
            {billingLoading ? (
              <div className="pp-loading-inner"><span className="pp-spinner" />Loading account...</div>
            ) : !billing ? (
              <div className="pp-billing-error">
                <AlertCircle size={32} />
                <p>Could not load account information.</p>
                <button className="pp-secondary-btn" onClick={loadBilling}>Retry</button>
              </div>
            ) : (
              <>
                {/* Balance summary */}
                <div className={`pp-balance-card ${billing.balance > 0 ? 'owing' : 'clear'}`}>
                  <div className="pp-balance-left">
                    <span className="pp-balance-label">{billing.balance < 0 ? 'Credit on Account' : 'Account Balance'}</span>
                    <span className="pp-balance-amount">
                      {billing.balance > 0
                        ? `$${billing.balance.toFixed(2)}`
                        : billing.balance < 0
                          ? `$${Math.abs(billing.balance).toFixed(2)}`
                          : 'Paid up ✓'}
                    </span>
                    {billing.balance < 0 && (
                      <span className="pp-family-name">Will be applied automatically to your next invoice</span>
                    )}
                    {billing.pendingScholarship > 0 && (
                      <span className="pp-pending-scholarship">
                        <Clock size={13} />
                        Includes <strong>${billing.pendingScholarship.toFixed(2)}</strong> from your Step Up scholarship,
                        already approved and awaiting payment — nothing for you to do.
                      </span>
                    )}
                    {billing.familyName && <span className="pp-family-name">{billing.familyName}</span>}
                  </div>
                  {billing.balance > 0 && (
                    <div className="pp-balance-right">
                      <Receipt size={40} style={{ opacity: 0.2 }} />
                    </div>
                  )}
                </div>

                {payError && (
                  <div className="pp-pay-error">
                    <AlertCircle size={16} /> {payError}
                    <button onClick={() => setPayError(null)}><X size={14} /></button>
                  </div>
                )}

                {/* How to pay */}
                <section className="pp-howto-pay">
                  <button className="pp-howto-toggle" onClick={() => setShowHowToPay(o => !o)}>
                    <span><CreditCard size={16} /> How to Pay</span>
                    {showHowToPay ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                  {showHowToPay && (
                    <div className="pp-howto-grid">
                      {PAYMENT_METHODS.map(m => (
                        <div key={m.id} className="pp-paymethod" style={{ '--accent': m.accent }}>
                          <div className="pp-paymethod-head">
                            <span className="pp-paymethod-icon">{m.icon}</span>
                            <span className="pp-paymethod-name">{m.name}</span>
                            {m.badge && <span className="pp-paymethod-badge">{m.badge}</span>}
                          </div>
                          <p className="pp-paymethod-detail">{m.detail}</p>
                          {m.copy && (
                            <button className="pp-paymethod-copy" onClick={() => handleCopy(m.id, m.copy)}>
                              <code>{m.copy}</code>
                              {copiedId === m.id ? <CheckCircle size={13} /> : <Copy size={13} />}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Invoices */}
                <section className="pp-billing-section">
                  <h3><Receipt size={18} /> Invoices</h3>
                  {billing.invoices.length === 0 ? (
                    <div className="pp-billing-empty">
                      <CheckCircle size={32} />
                      <p>No invoices on your account.</p>
                    </div>
                  ) : (
                    <div className="pp-invoices-list">
                      {billing.invoices.map(inv => (
                        <InvoiceRow key={inv.id} inv={inv} onPay={handlePay} paying={paying} />
                      ))}
                    </div>
                  )}
                </section>

                {/* Transaction History */}
                <section className="pp-billing-section">
                  <h3><CreditCard size={18} /> Transaction History</h3>
                  {billing.transactions.length === 0 ? (
                    <p className="pp-empty">No transactions recorded yet.</p>
                  ) : (
                    <div className="pp-tx-list">
                      {billing.transactions.map(t => {
                        const isCharge = t.type === 'CHARGE';
                        const isPayment = t.type === 'PAYMENT';
                        return (
                          <div key={t.id} className={`pp-tx-item ${t.type.toLowerCase()}`}>
                            <div className={`pp-tx-icon ${t.type.toLowerCase()}`}>
                              {isPayment ? <CheckCircle size={16} /> : isCharge ? <Receipt size={16} /> : <CreditCard size={16} />}
                            </div>
                            <div className="pp-tx-info">
                              <span className="pp-tx-desc">{t.description || t.type}</span>
                              {t.studentName && <span className="pp-tx-student">{t.studentName}</span>}
                              <span className="pp-tx-date">{fmtShort(t.date)}</span>
                            </div>
                            <span className={`pp-tx-amount ${isPayment ? 'credit' : 'debit'}`}>
                              {isPayment ? '−' : '+'} ${Number(t.amount).toFixed(2)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        )}

        {/* ══════════ HIGHLIGHTS TAB ══════════ */}
        {tab === 'highlights' && (
          <div className="pp-highlights">
            <p className="pp-hl-intro">
              Photos and weekly highlights your children's teachers have shared.
            </p>

            {hlError && <ErrorBanner message={hlError} onRetry={loadHighlights} />}

            {hlLoading ? (
              <div className="pp-billing-empty">
                <span className="app-inline-loader"><span className="app-spinner-sm" />Loading highlights…</span>
              </div>
            ) : highlights.length === 0 ? (
              <div className="pp-billing-empty">
                <Camera size={32} />
                <p>Nothing shared yet. Teachers post here every week — check back soon.</p>
              </div>
            ) : (
              <div className="pp-hl-cards">
                {highlights.map(h => {
                  const tc = HIGHLIGHT_TYPES[h.type] || HIGHLIGHT_TYPES.PHOTOS;
                  const Icon = tc.icon;
                  return (
                    <article key={h.id} className="pp-hl-card">
                      {tc.label && (
                        <span className="pp-hl-badge" style={{ background: tc.bg, color: tc.color }}>
                          <Icon size={13} /> {tc.label}
                        </span>
                      )}
                      {h.title && <h4 className="pp-hl-title">{h.title}</h4>}
                      {h.description && <p className="pp-hl-desc"><Linkified text={h.description} /></p>}

                      {h.photos.length > 0 && (
                        <div className="pp-hl-photos" data-count={h.photos.length}>
                          {h.photos.map(photo => (
                            <button
                              key={photo.id}
                              type="button"
                              className="pp-hl-photo"
                              onClick={() => setLightbox({ photoId: photo.id, alt: h.title || photo.fileName })}
                            >
                              <ProtectedImage
                                apiPath={`/marketing/photos/${photo.id}/file`}
                                alt={photo.fileName}
                                className="pp-hl-photo-img"
                              />
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="pp-hl-foot">
                        <span>{h.teacher?.fullName}</span>
                        <span>{fmtInstant(h.createdAt)}</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══════════ ANNOUNCEMENTS TAB ══════════ */}
        {tab === 'announcements' && (
          <div className="pp-announcements">
            {announcements.length === 0 ? (
              <div className="pp-billing-empty">
                <Bell size={32} />
                <p>No announcements right now.</p>
              </div>
            ) : (
              <div className="pp-ann-cards">
                {announcements.map((a, i) => (
                  <div key={i} className="pp-ann-card">
                    {a.isPinned && <span className="pp-pinned">📌 Pinned</span>}
                    <h4>{a.title}</h4>
                    {/* Truncate first, then linkify — cutting at 200 characters
                        afterwards would leave half an anchor behind. */}
                    <p><Linkified text={a.body.substring(0, 200)} />{a.body.length > 200 ? '…' : ''}</p>
                    <span className="pp-ann-date">
                      {fmtInstant(a.publishedAt)}{a.author && ` — ${a.author.fullName}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {(showPickupModal || viewAuth) && (
        <PickupModal
          children={inPersonChildren}
          onClose={() => { setShowPickupModal(false); setViewAuth(null); }}
          onCreated={(auth) => { handlePickupCreated(); setViewAuth(auth); }}
          initialAuth={viewAuth}
        />
      )}

      {lightbox && (
        <div className="pp-hl-lightbox" onClick={() => setLightbox(null)} role="dialog" aria-modal="true">
          <button className="pp-hl-lightbox-close" aria-label="Close"><X size={22} /></button>
          <ProtectedImage
            apiPath={`/marketing/photos/${lightbox.photoId}/file`}
            alt={lightbox.alt}
            className="pp-hl-lightbox-img"
          />
        </div>
      )}

      {showFamilyCode && (
        <FamilyCodeModal canRotate onClose={() => setShowFamilyCode(false)} />
      )}

      {notesFor && (
        <LessonNotesModal
          studentId={notesFor.studentId}
          classId={notesFor.classId}
          className={notesFor.className}
          onClose={() => setNotesFor(null)}
        />
      )}

      {waiverChild && (
        <WaiverForm
          child={waiverChild}
          parentName={user?.fullName || ''}
          onClose={() => setWaiverChild(null)}
          onSigned={(waiver) => handleWaiverSigned(waiverChild.id, waiver)}
        />
      )}

      {profileChild && (
        <ChildProfileModal
          child={profileChild}
          onClose={() => setProfileChild(null)}
          onSaved={handleProfileSaved}
        />
      )}

      {child && (
        <StatHistoryModal
          kind={statModal}
          studentName={child.fullName?.split(' ')[0]}
          data={{
            prizeHistory: child.prizeHistory || [],
            punchHistory: child.punchHistory || [],
            behaviorHistory: child.behaviorHistory || [],
          }}
          onClose={() => setStatModal(null)}
        />
      )}
    </div>
  );
};

export default ParentPortal;
