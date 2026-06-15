import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Heart, Users, MessageSquare, QrCode, Plus, X, Trash2, ShieldCheck,
  Shell, AlertTriangle, ThumbsUp, Clock, Calendar, Gift, BookOpen,
  CreditCard, Receipt, CheckCircle, AlertCircle, ExternalLink, Download,
  ChevronDown, ChevronUp, Bell, Award, GraduationCap, Smartphone, Landmark, Copy,
  ClipboardList, Lock, Star, Hourglass,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import ErrorBanner from '../Layout/ErrorBanner';
import './ParentPortal.css';

const RELATIONSHIPS = ['Parent', 'Guardian', 'Grandparent', 'Aunt/Uncle', 'Sibling', 'Family Friend', 'Other'];

/* Payment methods accepted by Love Camp — edit handles here as they change. */
const PAYMENT_METHODS = [
  {
    id: 'ema',
    name: 'EMA · Step Up for Students',
    icon: <GraduationCap size={18} />,
    badge: 'Beca',
    accent: '#047857',
    detail: 'Solicita el pago desde tu portal de Step Up usando el número de factura (ej. LC-4391). Nosotros aprobamos el cargo y el pago se procesa con tu beca.',
    copy: null,
  },
  {
    id: 'zelle',
    name: 'Zelle',
    icon: <Landmark size={18} />,
    badge: 'Sin cargo',
    accent: '#7c3aed',
    detail: 'Envía a:',
    copy: 'lovelearningfl@gmail.com',
  },
  {
    id: 'venmo',
    name: 'Venmo',
    icon: <Smartphone size={18} />,
    badge: 'Sin cargo',
    accent: '#0369a1',
    detail: 'Usuario:',
    copy: '@LoveLearningFL',
  },
  {
    id: 'paypal',
    name: 'PayPal',
    icon: <Smartphone size={18} />,
    badge: 'Sin cargo',
    accent: '#1d4ed8',
    detail: 'Envía a:',
    copy: 'lovelearningfl@gmail.com',
  },
  {
    id: 'card',
    name: 'Tarjeta de crédito',
    icon: <CreditCard size={18} />,
    badge: '+4% cargo',
    accent: '#b45309',
    detail: 'Usa el botón "Pagar" en cada factura para pagar con tarjeta de forma segura. Se aplica un cargo de procesamiento del 4%.',
    copy: null,
  },
];

const TABS = [
  { id: 'children',  label: 'Mis Hijos',      icon: <Users size={16} /> },
  { id: 'register',  label: 'Inscripción',    icon: <ClipboardList size={16} /> },
  { id: 'billing',   label: 'Cuenta & Pagos',  icon: <CreditCard size={16} /> },
  { id: 'announcements', label: 'Anuncios',    icon: <Bell size={16} /> },
];

const fmt = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtShort = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

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
  enrolled_first: { label: 'Inscrito en tu primera opción', cls: 'ok', icon: <CheckCircle size={15} /> },
  enrolled: { label: 'Inscrito', cls: 'ok', icon: <CheckCircle size={15} /> },
  waitlisted_first_enrolled_second: { label: 'En lista de espera (1ª) · Inscrito en 2ª opción', cls: 'partial', icon: <Hourglass size={15} /> },
  waitlisted_both: { label: 'En lista de espera', cls: 'wait', icon: <Hourglass size={15} /> },
  pending: { label: 'Solicitud en proceso', cls: 'wait', icon: <Hourglass size={15} /> },
};

/* ────────── Registration: per-child card ────────── */
const RegistrationChildCard = ({ child, classes, onClaim, onSubmit, submitting }) => {
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const busy = submitting === child.id;

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
          <span>Tu ventana de inscripción aún no abre.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="reg-child-card">
      <div className="reg-child-head">
        <div className="reg-child-avatar">{child.name?.[0]}</div>
        <div><h4>{child.name}</h4></div>
        {child.hasPriority && <span className="reg-priority-tag"><Star size={12} /> Cupo garantizado</span>}
      </div>

      {/* Guaranteed-spot one-click claim */}
      {child.hasPriority && child.priorityClassId && (
        <div className="reg-guaranteed">
          <div className="reg-guaranteed-text">
            <Star size={16} />
            <div>
              <strong>{child.priorityClassName}</strong>
              <span>Tu lugar está reservado. Recláma­lo con un clic.</span>
            </div>
          </div>
          <button className="reg-claim-btn" disabled={busy} onClick={() => onClaim(child.id, child.priorityClassId)}>
            {busy ? 'Procesando…' : 'Reclamar mi cupo'}
          </button>
        </div>
      )}

      {/* First / second choice selection */}
      <div className="reg-choices">
        <div className="reg-field">
          <label>Primera opción</label>
          <select value={first} onChange={e => setFirst(e.target.value)}>
            <option value="">Elige un pod…</option>
            {classes.map(c => (
              <option key={c.id} value={c.id} disabled={c.available <= 0}>
                {c.name} — {c.available > 0 ? `${c.available} cupos` : 'Lleno (lista de espera)'}
              </option>
            ))}
          </select>
        </div>
        <div className="reg-field">
          <label>Segunda opción <span className="reg-optional">(opcional)</span></label>
          <select value={second} onChange={e => setSecond(e.target.value)}>
            <option value="">Sin segunda opción</option>
            {classes.filter(c => c.id !== first).map(c => (
              <option key={c.id} value={c.id} disabled={c.available <= 0}>
                {c.name} — {c.available > 0 ? `${c.available} cupos` : 'Lleno (lista de espera)'}
              </option>
            ))}
          </select>
        </div>
        <button
          className="reg-submit-btn"
          disabled={!first || busy}
          onClick={() => onSubmit(child.id, first, second || null)}
        >
          {busy ? 'Procesando…' : 'Enviar inscripción'}
        </button>
      </div>
    </div>
  );
};

/* ────────── Pickup Modal ────────── */
const PickupModal = ({ children, onClose, onCreated }) => {
  const [form, setForm] = useState({ pickupPerson: '', relationship: 'Parent', validDate: '', studentId: '' });
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState(null);
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
        studentName: children.find(c => c.id === form.studentId)?.fullName || '',
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
              <div><h2>Autorizar Recogida</h2><p>Genera un QR para una persona de confianza.</p></div>
            </div>
            <form onSubmit={handleSubmit} className="pickup-form">
              {children.length > 1 && (
                <div className="form-group">
                  <label>Estudiante</label>
                  <select value={form.studentId} onChange={e => setForm(f => ({ ...f, studentId: e.target.value }))}>
                    <option value="">Todos los hijos</option>
                    {children.map(c => <option key={c.id} value={c.id}>{c.fullName}</option>)}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label>Nombre de la persona *</label>
                <input type="text" placeholder="Nombre completo" value={form.pickupPerson}
                  onChange={e => setForm(f => ({ ...f, pickupPerson: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label>Relación</label>
                <select value={form.relationship} onChange={e => setForm(f => ({ ...f, relationship: e.target.value }))}>
                  {RELATIONSHIPS.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Válido hasta *</label>
                <input type="date" min={today} value={form.validDate}
                  onChange={e => setForm(f => ({ ...f, validDate: e.target.value }))} required />
              </div>
              <button type="submit" className="pp-primary-btn" disabled={submitting}>
                {submitting ? 'Generando…' : <><QrCode size={16} /> Generar QR</>}
              </button>
            </form>
          </>
        ) : (
          <div className="qr-result">
            <div className="qr-success-badge"><ShieldCheck size={20} /> Autorización creada</div>
            <h3>{created.pickupPerson}</h3>
            <p className="qr-valid-date">Válido hasta: <strong>{fmt(created.validDate)}</strong></p>
            <div className="qr-wrapper">
              <QRCodeSVG value={qrPayload} size={200} bgColor="#ffffff" fgColor="#1e293b" level="M" includeMargin />
            </div>
            <p className="qr-instructions">Muestra este QR en recepción para verificar la autorización.</p>
            <div className="qr-actions">
              <button className="qr-new-btn" onClick={() => setCreated(null)}>Crear otro</button>
              <button className="qr-done-btn" onClick={onClose}>Listo</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* ────────── Invoice Row ────────── */
const STATUS_META = {
  DRAFT:    { label: 'Borrador',  cls: 'draft'    },
  SENT:     { label: 'Pendiente', cls: 'sent'     },
  PAID:     { label: 'Pagado',    cls: 'paid'     },
  OVERDUE:  { label: 'Vencido',   cls: 'overdue'  },
  VOID:     { label: 'Anulado',   cls: 'void'     },
};

const InvoiceRow = ({ inv, onPay, paying }) => {
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[inv.status] || { label: inv.status, cls: 'draft' };
  const canPay = ['SENT', 'OVERDUE'].includes(inv.status) && inv.amountDue > 0;

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
              <span className="pp-inv-due">Saldo: ${inv.amountDue.toFixed(2)}</span>
            )}
          </div>
          {canPay && (
            <button
              className="pp-pay-btn"
              onClick={e => { e.stopPropagation(); onPay(inv.id); }}
              disabled={paying === inv.id}
            >
              {paying === inv.id ? 'Procesando…' : <><CreditCard size={14} /> Pagar</>}
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
            <span>Fecha: {fmt(inv.date)}</span>
            {inv.dueDate && <span>Vence: {fmt(inv.dueDate)}</span>}
            {inv.amountPaid > 0 && <span>Pagado: ${inv.amountPaid.toFixed(2)}</span>}
          </div>
          {inv.lines.length > 0 && (
            <table className="pp-inv-lines">
              <thead>
                <tr><th>Descripción</th><th>Cant.</th><th>Monto</th></tr>
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
  const [activeChild, setActiveChild] = useState(0);
  const [pickupAuths, setPickupAuths] = useState([]);
  const [showPickupModal, setShowPickupModal] = useState(false);
  const [paying, setPaying]         = useState(null);
  const [payError, setPayError]     = useState(null);
  const [showHowToPay, setShowHowToPay] = useState(false);
  const [copiedId, setCopiedId]     = useState(null);
  const [registration, setRegistration] = useState(null);
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError]     = useState(null);
  const [regSubmitting, setRegSubmitting] = useState(null);
  const navigate = useNavigate();

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
    } catch (err) {
      setError(err.userMessage || 'No se pudo cargar el portal familiar.');
    } finally {
      setLoading(false);
    }
  };

  const loadBilling = async () => {
    if (billing) return;
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

  const loadRegistration = async () => {
    setRegLoading(true); setRegError(null);
    try {
      const res = await api.get('/registration/parent');
      setRegistration(res.data);
    } catch (err) {
      setRegError(err.userMessage || 'No se pudo cargar la inscripción.');
    } finally {
      setRegLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'billing') loadBilling();
    if (tab === 'register') loadRegistration();
  }, [tab]);

  const handleRegSubmit = async (studentId, firstChoiceClassId, secondChoiceClassId) => {
    if (!registration?.term) return;
    setRegSubmitting(studentId); setRegError(null);
    try {
      await api.post('/registration/request', {
        termId: registration.term.id,
        studentId,
        firstChoiceClassId,
        secondChoiceClassId,
      });
      await loadRegistration();
    } catch (err) {
      setRegError(err.response?.data?.message || 'No se pudo procesar la inscripción.');
    } finally {
      setRegSubmitting(null);
    }
  };

  const handleRegClaim = (studentId, priorityClassId) =>
    handleRegSubmit(studentId, priorityClassId, null);

  const handlePickupCreated = (auth) => setPickupAuths(prev => [auth, ...prev]);

  const handleDeleteAuth = async (id) => {
    try {
      await api.delete(`/portal/parent/pickup/${id}`);
      setPickupAuths(prev => prev.filter(a => a.id !== id));
    } catch (err) { console.error(err); }
  };

  const handlePay = async (invoiceId) => {
    setPaying(invoiceId); setPayError(null);
    try {
      const res = await api.post(`/portal/parent/billing/pay/${invoiceId}`);
      window.open(res.data.url, '_blank');
    } catch (err) {
      setPayError(err.response?.data?.error || 'No se pudo procesar el pago. Contacta a la academia.');
    } finally {
      setPaying(null);
    }
  };

  if (loading) return <div className="pp-loading"><span className="pp-spinner" />Cargando portal familiar…</div>;
  if (error)   return <div className="pp-loading"><ErrorBanner message={error} onRetry={load} /></div>;
  if (!data)   return null;

  const { children, announcements } = data;
  const child = children[activeChild] || null;
  const activeAuths = pickupAuths.filter(a => new Date(a.validDate) >= new Date(new Date().setHours(0,0,0,0)));

  return (
    <div className="pp-root">
      {/* ── Hero ── */}
      <div className="pp-hero">
        <div className="pp-hero-bg" />
        <div className="pp-hero-content">
          <div className="pp-hero-icon"><Heart size={28} /></div>
          <div className="pp-hero-text">
            <h1>Portal Familiar</h1>
            <p>Sigue el progreso de tus hijos y gestiona tu cuenta</p>
          </div>
        </div>
        <div className="pp-hero-actions">
          <button className="pp-hero-btn" onClick={() => setShowPickupModal(true)}>
            <QrCode size={15} /> Autorizar Recogida
            {activeAuths.length > 0 && <span className="pp-auth-badge">{activeAuths.length}</span>}
          </button>
          <button className="pp-hero-btn" onClick={() => navigate('/chat')}>
            <MessageSquare size={15} /> Chat con Maestros
          </button>
        </div>
      </div>

      {/* Active pickup strip */}
      {activeAuths.length > 0 && (
        <div className="pp-pickup-strip">
          <ShieldCheck size={14} />
          <span>Autorizaciones activas:</span>
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
            {/* Child selector */}
            {children.length > 1 && (
              <div className="pp-child-tabs">
                {children.map((c, i) => (
                  <button key={c.id} className={`pp-child-tab ${activeChild === i ? 'active' : ''}`}
                    onClick={() => setActiveChild(i)}>
                    <div className="pp-child-avatar">{c.fullName?.[0]}</div>
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
                    <div className="pp-child-avatar-lg">{child.fullName?.[0]}</div>
                    <div className="pp-child-info">
                      <h2>{child.fullName}</h2>
                      {child.age && <span className="pp-child-age">Age {child.age}</span>}
                      <span className={`status-tag ${child.status?.toLowerCase()}`}>{child.status}</span>
                    </div>
                  </div>
                  <div className="pp-child-stats">
                    <div className="pp-cstat shells">
                      <Shell size={20} />
                      <span className="pp-cstat-num">{child.seashells || 0}</span>
                      <span className="pp-cstat-lbl">Seashells</span>
                    </div>
                    <div className="pp-cstat snack">
                      <span style={{ fontSize: 20 }}>🍪</span>
                      <span className="pp-cstat-num">{child.snackPunches || 0}</span>
                      <span className="pp-cstat-lbl">Punches</span>
                    </div>
                    <div className="pp-cstat pos">
                      <ThumbsUp size={20} />
                      <span className="pp-cstat-num">{child.behaviorSummary?.positives || 0}</span>
                      <span className="pp-cstat-lbl">Positivos</span>
                    </div>
                    {(child.behaviorSummary?.warnings || 0) > 0 && (
                      <div className="pp-cstat warn">
                        <AlertTriangle size={20} />
                        <span className="pp-cstat-num">{child.behaviorSummary.warnings}</span>
                        <span className="pp-cstat-lbl">Avisos</span>
                      </div>
                    )}
                  </div>
                </div>

                {(child.allergies || child.medicalNotes) && (
                  <div className="pp-health-banner">
                    <AlertTriangle size={15} />
                    {child.allergies && <span><strong>Alergias:</strong> {child.allergies}</span>}
                    {child.medicalNotes && <span><strong>Médico:</strong> {child.medicalNotes}</span>}
                  </div>
                )}

                <div className="pp-child-grid">
                  {/* Classes */}
                  <div className="pp-child-section">
                    <h3><Calendar size={17} /> Clases & Horario</h3>
                    {!child.enrollments?.length ? <p className="pp-empty">Sin clases activas.</p> : (
                      <div className="pp-child-classes">
                        {child.enrollments.map((e, i) => (
                          <div key={i} className="pp-class-item">
                            <div>
                              <h4>{e.className}</h4>
                              <span>con {e.teacherName}</span>
                            </div>
                            {e.upcomingSessions?.[0] && (
                              <div className="pp-next-badge">
                                <Clock size={11} />
                                {fmtShort(e.upcomingSessions[0].date)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Rewards */}
                  <div className="pp-child-section">
                    <h3><Gift size={17} /> Premios Recientes</h3>
                    {!child.seashellHistory?.length ? <p className="pp-empty">Sin premios aún.</p> : (
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
                    <h3><BookOpen size={17} /> Materiales</h3>
                    {!child.materials?.length ? <p className="pp-empty">Sin materiales.</p> : (
                      <div className="pp-materials">
                        {child.materials.slice(0, 5).map((m, i) => (
                          <a key={i} href={m.fileUrl} target="_blank" rel="noopener noreferrer" className="pp-material-link">
                            📄 {m.name}<span className="pp-mat-sub">{m.subject}</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Pickup Authorizations */}
                  <div className="pp-child-section">
                    <h3><QrCode size={17} /> Autorizaciones de Recogida</h3>
                    {pickupAuths.length === 0 ? (
                      <div className="pp-pickup-empty">
                        <p className="pp-empty">Sin autorizaciones.</p>
                        <button className="pp-secondary-btn" onClick={() => setShowPickupModal(true)}>
                          <Plus size={13} /> Autorizar
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
                                  {isPast ? 'Expirado' : 'Activo'}
                                </span>
                                {!isPast && (
                                  <button className="pp-revoke-btn" onClick={() => handleDeleteAuth(auth.id)}>
                                    <Trash2 size={13} />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        <button className="pp-secondary-btn pp-mt" onClick={() => setShowPickupModal(true)}>
                          <Plus size={13} /> Nueva Autorización
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="pp-no-children">
                <Users size={40} />
                <h3>Sin estudiantes</h3>
                <p>Tu cuenta no tiene estudiantes vinculados.</p>
              </div>
            )}
          </>
        )}

        {/* ══════════ REGISTRATION TAB ══════════ */}
        {tab === 'register' && (
          <div className="reg-tab">
            {regLoading ? (
              <div className="pp-loading-inner"><span className="pp-spinner" />Cargando inscripción…</div>
            ) : regError && !registration ? (
              <div className="pp-billing-error">
                <AlertCircle size={32} />
                <p>{regError}</p>
                <button className="pp-secondary-btn" onClick={loadRegistration}>Reintentar</button>
              </div>
            ) : !registration?.term ? (
              <div className="pp-billing-empty">
                <ClipboardList size={32} />
                <p>No hay inscripción abierta en este momento.</p>
                <span style={{ fontSize: 13, color: '#94a3b8' }}>Te avisaremos cuando abra el próximo término.</span>
              </div>
            ) : (
              <>
                {(() => {
                  const t = registration.term;
                  const nowRef = t.now;
                  let phase;
                  if (new Date(nowRef) < new Date(t.window1OpensAt)) {
                    phase = { label: 'Abre en', value: countdown(t.window1OpensAt, nowRef), cls: 'soon' };
                  } else if (new Date(nowRef) <= new Date(t.registrationCloses)) {
                    phase = { label: 'Cierra en', value: countdown(t.registrationCloses, nowRef), cls: 'open' };
                  } else {
                    phase = { label: 'Cerrada', value: null, cls: 'closed' };
                  }
                  return (
                    <div className={`reg-term-header ${phase.cls}`}>
                      <div>
                        <span className="reg-term-eyebrow">Inscripción</span>
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
                    <p>No hay estudiantes vinculados a tu cuenta.</p>
                  </div>
                ) : (
                  <div className="reg-children-grid">
                    {registration.students.map(child => (
                      <RegistrationChildCard
                        key={child.id}
                        child={child}
                        classes={registration.classes}
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
              <div className="pp-loading-inner"><span className="pp-spinner" />Cargando cuenta…</div>
            ) : !billing ? (
              <div className="pp-billing-error">
                <AlertCircle size={32} />
                <p>No se pudo cargar la información de cuenta.</p>
                <button className="pp-secondary-btn" onClick={loadBilling}>Reintentar</button>
              </div>
            ) : (
              <>
                {/* Balance summary */}
                <div className={`pp-balance-card ${billing.balance > 0 ? 'owing' : 'clear'}`}>
                  <div className="pp-balance-left">
                    <span className="pp-balance-label">Saldo de Cuenta</span>
                    <span className="pp-balance-amount">
                      {billing.balance > 0 ? `$${billing.balance.toFixed(2)}` : 'Al corriente ✓'}
                    </span>
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
                    <span><CreditCard size={16} /> Cómo Pagar</span>
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
                  <h3><Receipt size={18} /> Facturas</h3>
                  {billing.invoices.length === 0 ? (
                    <div className="pp-billing-empty">
                      <CheckCircle size={32} />
                      <p>No hay facturas en tu cuenta.</p>
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
                  <h3><CreditCard size={18} /> Historial de Movimientos</h3>
                  {billing.transactions.length === 0 ? (
                    <p className="pp-empty">Sin movimientos registrados.</p>
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

        {/* ══════════ ANNOUNCEMENTS TAB ══════════ */}
        {tab === 'announcements' && (
          <div className="pp-announcements">
            {announcements.length === 0 ? (
              <div className="pp-billing-empty">
                <Bell size={32} />
                <p>No hay anuncios en este momento.</p>
              </div>
            ) : (
              <div className="pp-ann-cards">
                {announcements.map((a, i) => (
                  <div key={i} className="pp-ann-card">
                    {a.isPinned && <span className="pp-pinned">📌 Fijado</span>}
                    <h4>{a.title}</h4>
                    <p>{a.body.substring(0, 200)}{a.body.length > 200 ? '…' : ''}</p>
                    <span className="pp-ann-date">
                      {fmt(a.publishedAt)}{a.author && ` — ${a.author.fullName}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showPickupModal && (
        <PickupModal
          children={children}
          onClose={() => setShowPickupModal(false)}
          onCreated={handlePickupCreated}
        />
      )}
    </div>
  );
};

export default ParentPortal;
