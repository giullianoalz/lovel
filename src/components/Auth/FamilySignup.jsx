import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Mail, Lock, User, Phone, Plus, Trash2, AlertCircle, ArrowLeft, ArrowRight,
  CheckCircle, GraduationCap, Heart, Cake, Stethoscope,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
// What families can ask for. Free text on the server, so adding one there is the
// only change needed — no migration, no enum. Shared with the admin review queue
// so both screens call the same modality by the same name.
import { INTERESTS } from '../../lib/enrollmentInterests';
// The form reuses the sign-in card's fields, blobs and buttons, so it depends on
// Login.css directly rather than on Login happening to be loaded first.
import './Login.css';
import './FamilySignup.css';

const IXL_OPTIONS = [
  { value: 'NONE',         label: 'No IXL' },
  { value: 'CORE',         label: 'IXL Core ($5/mo)' },
  { value: 'CORE_SPANISH', label: 'IXL Core + Spanish ($10/mo)' },
];

const emptyChild = () => ({
  key: crypto.randomUUID(),
  fullName: '',
  age: '',
  allergies: '',
  medicalNotes: '',
  interests: [],
  ixlPlan: 'NONE',
});

/* Firebase's raw codes are unreadable to a parent; everything unmapped falls
   back to a generic line rather than leaking an internal message. */
const firebaseMessage = (code) => ({
  'auth/email-already-in-use': 'That email already has an account. Try signing in instead.',
  'auth/invalid-email': 'That email address does not look right.',
  'auth/weak-password': 'Please choose a password with at least 6 characters.',
  'auth/network-request-failed': 'Could not reach the server. Check your connection and try again.',
}[code] || null);

const FamilySignup = () => {
  const { signUpFamily } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [account, setAccount] = useState({
    fullName: '', email: '', phone: '', password: '', confirm: '',
  });
  const [children, setChildren] = useState([emptyChild()]);
  const [scholarship, setScholarship] = useState(false);
  const [notes, setNotes] = useState('');

  const setField = (field, value) => setAccount(a => ({ ...a, [field]: value }));

  const updateChild = (key, field, value) =>
    setChildren(list => list.map(c => (c.key === key ? { ...c, [field]: value } : c)));

  const toggleInterest = (key, interest) =>
    setChildren(list => list.map(c => {
      if (c.key !== key) return c;
      const has = c.interests.includes(interest);
      return { ...c, interests: has ? c.interests.filter(i => i !== interest) : [...c.interests, interest] };
    }));

  const addChild = () => setChildren(list => [...list, emptyChild()]);
  const removeChild = (key) => setChildren(list => list.filter(c => c.key !== key));

  const validateAccount = () => {
    if (account.fullName.trim().length < 2) return 'Please enter your full name.';
    if (!account.email.includes('@')) return 'Please enter a valid email address.';
    if (account.password.length < 8) return 'Your password needs at least 8 characters.';
    if (account.password !== account.confirm) return 'The two passwords do not match.';
    return null;
  };

  const validateChildren = () => {
    if (children.length === 0) return 'Add at least one child.';
    if (children.some(c => c.fullName.trim().length < 2)) return "Every child needs a full name.";
    const badAge = children.find(c => c.age !== '' && (Number(c.age) < 1 || Number(c.age) > 25));
    if (badAge) return `Check ${badAge.fullName || 'your child'}'s age.`;
    return null;
  };

  const goNext = () => {
    const problem = step === 1 ? validateAccount() : validateChildren();
    if (problem) { setError(problem); return; }
    setError('');
    setStep(s => s + 1);
  };

  const goBack = () => { setError(''); setStep(s => s - 1); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Send them back to the step that actually holds the mistake.
    const accountProblem = validateAccount();
    const problem = accountProblem || validateChildren();
    if (problem) { setError(problem); setStep(accountProblem ? 1 : 2); return; }

    setError('');
    setSubmitting(true);
    try {
      await signUpFamily({
        email: account.email.trim(),
        password: account.password,
        parent: {
          fullName: account.fullName.trim(),
          phone: account.phone.trim() || undefined,
        },
        children: children.map(c => ({
          fullName: c.fullName.trim(),
          age: c.age === '' ? undefined : Number(c.age),
          allergies: c.allergies.trim() || undefined,
          medicalNotes: c.medicalNotes.trim() || undefined,
          interests: c.interests,
          ixlPlan: c.ixlPlan,
        })),
        scholarship,
        notes: notes.trim() || undefined,
      });
      navigate('/portal/parent');
    } catch (err) {
      console.error(err);
      setError(
        firebaseMessage(err?.code) ||
        err?.response?.data?.message ||
        err?.userMessage ||
        'Could not complete your registration. Please try again.'
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="signup-page">
      <div className="login-background-decor">
        <div className="blob blob-1" />
        <div className="blob blob-2" />
      </div>

      <div className="signup-card glass">
        <div className="signup-header">
          <img src="/logo.png" alt="Love Learning Explorers" className="signup-logo" />
          <h2>Register your family</h2>
          <p>A few minutes now, and everything about your children lives in one place.</p>
        </div>

        <ol className="signup-steps" aria-label="Progress">
          {['Your account', 'Your children', 'Review'].map((label, i) => {
            const n = i + 1;
            return (
              <li key={label} className={`signup-step ${step === n ? 'active' : ''} ${step > n ? 'done' : ''}`}>
                <span className="signup-step-dot">{step > n ? <CheckCircle size={14} /> : n}</span>
                <span className="signup-step-label">{label}</span>
              </li>
            );
          })}
        </ol>

        {error && (
          <div className="login-error-banner">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="signup-form">
          {/* ── Step 1 · the parent's own account ── */}
          {step === 1 && (
            <>
              <div className="input-group">
                <label htmlFor="su-name">Your full name *</label>
                <div className="input-field">
                  <User size={18} className="input-icon" />
                  <input id="su-name" type="text" autoComplete="name" placeholder="Maria Rivas"
                    value={account.fullName} onChange={e => setField('fullName', e.target.value)} />
                </div>
              </div>

              <div className="input-group">
                <label htmlFor="su-email">Email *</label>
                <div className="input-field">
                  <Mail size={18} className="input-icon" />
                  <input id="su-email" type="email" autoComplete="email" placeholder="you@example.com"
                    value={account.email} onChange={e => setField('email', e.target.value)} />
                </div>
                <span className="signup-hint">This is how you will sign in, and where invoices go.</span>
              </div>

              <div className="input-group">
                <label htmlFor="su-phone">Mobile phone</label>
                <div className="input-field">
                  <Phone size={18} className="input-icon" />
                  <input id="su-phone" type="tel" autoComplete="tel" placeholder="(555) 123-4567"
                    value={account.phone} onChange={e => setField('phone', e.target.value)} />
                </div>
              </div>

              <div className="signup-row">
                <div className="input-group">
                  <label htmlFor="su-pass">Password *</label>
                  <div className="input-field">
                    <Lock size={18} className="input-icon" />
                    <input id="su-pass" type="password" autoComplete="new-password" placeholder="At least 8 characters"
                      value={account.password} onChange={e => setField('password', e.target.value)} />
                  </div>
                </div>
                <div className="input-group">
                  <label htmlFor="su-confirm">Confirm password *</label>
                  <div className="input-field">
                    <Lock size={18} className="input-icon" />
                    <input id="su-confirm" type="password" autoComplete="new-password" placeholder="Type it again"
                      value={account.confirm} onChange={e => setField('confirm', e.target.value)} />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── Step 2 · one card per child ── */}
          {step === 2 && (
            <>
              {children.map((child, index) => (
                <div key={child.key} className="signup-child-card">
                  <div className="signup-child-head">
                    <h3><Heart size={15} /> Child {index + 1}</h3>
                    {children.length > 1 && (
                      <button type="button" className="signup-remove-btn" onClick={() => removeChild(child.key)}
                        aria-label={`Remove child ${index + 1}`}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>

                  <div className="signup-row">
                    <div className="input-group grow">
                      <label>Full name *</label>
                      <div className="input-field">
                        <User size={18} className="input-icon" />
                        <input type="text" placeholder="Sofia Rivas" value={child.fullName}
                          onChange={e => updateChild(child.key, 'fullName', e.target.value)} />
                      </div>
                    </div>
                    <div className="input-group narrow">
                      <label>Age</label>
                      <div className="input-field">
                        <Cake size={18} className="input-icon" />
                        <input type="number" min="1" max="25" placeholder="8" value={child.age}
                          onChange={e => updateChild(child.key, 'age', e.target.value)} />
                      </div>
                    </div>
                  </div>

                  <div className="input-group">
                    <label>Allergies</label>
                    <div className="input-field">
                      <Stethoscope size={18} className="input-icon" />
                      <input type="text" placeholder="Peanuts, dairy… (leave blank if none)" value={child.allergies}
                        onChange={e => updateChild(child.key, 'allergies', e.target.value)} />
                    </div>
                  </div>

                  <div className="input-group">
                    <label>Anything the teachers should know</label>
                    <textarea rows={2} placeholder="Medication, accommodations, what helps them focus…"
                      value={child.medicalNotes}
                      onChange={e => updateChild(child.key, 'medicalNotes', e.target.value)} />
                  </div>

                  <div className="input-group">
                    <label>What are you interested in?</label>
                    <div className="signup-interests">
                      {INTERESTS.map(opt => (
                        <label key={opt.id}
                          className={`signup-chip ${child.interests.includes(opt.id) ? 'on' : ''}`}>
                          <input type="checkbox" checked={child.interests.includes(opt.id)}
                            onChange={() => toggleInterest(child.key, opt.id)} />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="input-group">
                    <label>IXL plan</label>
                    <select value={child.ixlPlan} onChange={e => updateChild(child.key, 'ixlPlan', e.target.value)}>
                      {IXL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>
              ))}

              <button type="button" className="signup-add-btn" onClick={addChild}>
                <Plus size={16} /> Add another child
              </button>
            </>
          )}

          {/* ── Step 3 · confirm what we are about to send ── */}
          {step === 3 && (
            <>
              <div className="signup-review">
                <h3>{account.fullName}</h3>
                <p className="signup-review-sub">{account.email}{account.phone && ` · ${account.phone}`}</p>
                <ul className="signup-review-list">
                  {children.map(c => (
                    <li key={c.key}>
                      <span className="signup-review-name">
                        <strong>{c.fullName}</strong>{c.age && ` · age ${c.age}`}
                      </span>
                      <span className="signup-review-meta">
                        {c.interests.length > 0
                          ? c.interests.map(i => INTERESTS.find(o => o.id === i)?.label).join(', ')
                          : 'No preference given'}
                        {c.ixlPlan !== 'NONE' && ` · ${IXL_OPTIONS.find(o => o.value === c.ixlPlan)?.label}`}
                      </span>
                      {c.allergies && <span className="signup-review-allergy">Allergies: {c.allergies}</span>}
                    </li>
                  ))}
                </ul>
              </div>

              <label className="signup-check">
                <input type="checkbox" checked={scholarship} onChange={e => setScholarship(e.target.checked)} />
                <span>
                  <GraduationCap size={15} /> We use a Step Up for Students scholarship (FES / EMA)
                </span>
              </label>

              <div className="input-group">
                <label htmlFor="su-notes">Anything else you want us to know?</label>
                <textarea id="su-notes" rows={3} value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Preferred days or times, a sibling already with us, how you heard about us…" />
              </div>

              <p className="signup-fineprint">
                Creating your account gets you into the app right away. Someone from the academy
                reviews what each child needs and places them in a class — you will see it here and
                get a notification as soon as that happens.
              </p>
            </>
          )}

          <div className="signup-actions">
            {step > 1 && (
              <button type="button" className="signup-back-btn" onClick={goBack} disabled={submitting}>
                <ArrowLeft size={16} /> Back
              </button>
            )}
            {step < 3 ? (
              <button type="button" className="login-submit-btn grow" onClick={goNext}>
                Continue <ArrowRight size={16} />
              </button>
            ) : (
              <button type="submit" className="login-submit-btn grow" disabled={submitting}>
                {submitting ? 'Creating your account…' : 'Create my account'}
              </button>
            )}
          </div>
        </form>

        <p className="signup-signin-cta">
          Already with us? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
};

export default FamilySignup;
