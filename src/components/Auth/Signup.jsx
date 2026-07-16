import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { User, Mail, Lock, Phone, Plus, Trash2, Baby, AlertCircle, ArrowLeft } from 'lucide-react';
import api from '../../lib/api';
import './Login.css';

const emptyChild = () => ({ fullName: '', age: '', allergies: '' });

const Signup = () => {
  const { signupParent } = useAuth();
  const navigate = useNavigate();

  const [parent, setParent] = useState({ fullName: '', email: '', password: '', phone: '' });
  const [children, setChildren] = useState([emptyChild()]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const updateParent = (field, value) => setParent(p => ({ ...p, [field]: value }));
  const updateChild = (i, field, value) =>
    setChildren(cs => cs.map((c, idx) => (idx === i ? { ...c, [field]: value } : c)));
  const addChild = () => setChildren(cs => [...cs, emptyChild()]);
  const removeChild = (i) => setChildren(cs => cs.filter((_, idx) => idx !== i));

  const friendlyFirebaseError = (code) => {
    if (code === 'auth/email-already-in-use') return 'That email already has an account. Try signing in instead.';
    if (code === 'auth/invalid-email') return 'That email address looks invalid.';
    if (code === 'auth/weak-password') return 'Password must be at least 6 characters.';
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!parent.fullName.trim() || !parent.email.trim() || !parent.password) {
      setError('Please fill in your name, email and password.');
      return;
    }
    const validChildren = children.filter(c => c.fullName.trim());
    if (validChildren.length === 0) {
      setError('Add at least one child.');
      return;
    }

    setLoading(true);
    try {
      // 1) Create the parent's account (Firebase) + PARENT user row.
      await signupParent({
        email: parent.email.trim(),
        password: parent.password,
        fullName: parent.fullName.trim(),
        phone: parent.phone.trim(),
      });
      // 2) Create their family + children.
      await api.post('/portal/parent/register-family', {
        children: validChildren.map(c => ({
          fullName: c.fullName.trim(),
          age: c.age,
          allergies: c.allergies.trim(),
        })),
      });
      navigate('/portal/parent');
    } catch (err) {
      const fb = friendlyFirebaseError(err?.code);
      setError(fb || err?.response?.data?.message || err?.userMessage || 'Could not create your account. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-background-decor">
        <div className="blob blob-1"></div>
        <div className="blob blob-2"></div>
      </div>

      <div className="login-card glass">
        <div className="login-header">
          <img src="/logo.png" alt="Love Learning Explorers Logo" className="login-logo" />
          <h2>Create your family account</h2>
          <p>Register yourself and your children</p>
        </div>

        {error && (
          <div className="login-error-banner">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          {/* Parent */}
          <div className="input-group">
            <label>Your Full Name</label>
            <div className="input-field">
              <User size={18} className="input-icon" />
              <input type="text" placeholder="e.g. Elena Garcia" value={parent.fullName}
                onChange={e => updateParent('fullName', e.target.value)} disabled={loading} required />
            </div>
          </div>

          <div className="input-group">
            <label>Email</label>
            <div className="input-field">
              <Mail size={18} className="input-icon" />
              <input type="email" placeholder="you@email.com" value={parent.email}
                onChange={e => updateParent('email', e.target.value)} disabled={loading} required />
            </div>
          </div>

          <div className="input-group">
            <label>Password</label>
            <div className="input-field">
              <Lock size={18} className="input-icon" />
              <input type="password" placeholder="At least 6 characters" value={parent.password}
                onChange={e => updateParent('password', e.target.value)} disabled={loading} required />
            </div>
          </div>

          <div className="input-group">
            <label>Phone <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span></label>
            <div className="input-field">
              <Phone size={18} className="input-icon" />
              <input type="tel" placeholder="(555) 123-4567" value={parent.phone}
                onChange={e => updateParent('phone', e.target.value)} disabled={loading} />
            </div>
          </div>

          {/* Children */}
          <div className="signup-children">
            <div className="signup-children-head">
              <span><Baby size={16} /> Your Children</span>
            </div>
            {children.map((child, i) => (
              <div key={i} className="signup-child-card">
                <div className="input-field">
                  <User size={16} className="input-icon" />
                  <input type="text" placeholder="Child's full name" value={child.fullName}
                    onChange={e => updateChild(i, 'fullName', e.target.value)} disabled={loading} />
                </div>
                <div className="signup-child-row">
                  <input type="number" min="1" max="21" placeholder="Age" value={child.age}
                    onChange={e => updateChild(i, 'age', e.target.value)} disabled={loading} />
                  <input type="text" placeholder="Allergies (or none)" value={child.allergies}
                    onChange={e => updateChild(i, 'allergies', e.target.value)} disabled={loading} />
                  {children.length > 1 && (
                    <button type="button" className="signup-remove-child" onClick={() => removeChild(i)} disabled={loading} aria-label="Remove child">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            <button type="button" className="signup-add-child" onClick={addChild} disabled={loading}>
              <Plus size={15} /> Add another child
            </button>
          </div>

          <button type="submit" className="login-submit-btn" disabled={loading}>
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <div className="login-divider"><span>ALREADY HAVE AN ACCOUNT?</span></div>
        <Link to="/login" className="signup-back-link">
          <ArrowLeft size={15} /> Back to sign in
        </Link>
      </div>
    </div>
  );
};

export default Signup;
