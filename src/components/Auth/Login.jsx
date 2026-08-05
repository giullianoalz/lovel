import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import {
  ShieldCheck,
  Lock,
  Mail,
  KeyRound,
  AlertCircle
} from 'lucide-react';
import './Login.css';

const Login = () => {
  const { loginWithEmail, loginAsSeededUser, requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Where GET /api/auth/activate/:token sends someone whose invite link didn't
  // work. Without this they'd land on a plain login form with no idea why, and
  // no account to sign in with — every message here has to end in a way out.
  const inviteProblem = {
    expired: 'That invitation link has expired. Enter your email below and use "Forgot your password?" to get a new one.',
    invalid: 'That invitation link is not valid. It may have been replaced by a newer one — check for a more recent email, or ask the academy to send another.',
    blocked: 'That invitation cannot be used. Please contact the academy so they can sort out your account.',
    error: 'Something went wrong opening that invitation. Please try again, or contact the academy.',
  }[searchParams.get('invite')];

  // Set by /reset-password on success. Landing on a bare sign-in form after
  // choosing a password leaves people wondering whether it took.
  const passwordJustSet = searchParams.get('reset') === 'done';

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setError('');
    setNotice('');
    setLoading(true);
    try {
      await loginWithEmail(email, password);
      navigate('/'); // SmartRoot routes each role to its portal
    } catch (err) {
      console.error(err);
      // Firebase accepted the password but we have no profile for them: the
      // academy hasn't set this person up. Telling them to retry their password
      // would send them in circles.
      if (err?.response?.status === 401) {
        setError('This account is not set up yet. Please contact the academy to receive your invitation.');
      } else {
        setError('Invalid credentials. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Enter your email above first, then tap "Forgot your password?".');
      return;
    }
    setError('');
    setLoading(true);
    await requestPasswordReset(email);
    setLoading(false);
    // Deliberately the same message whether or not the account exists.
    setNotice(`If ${email} has an account, a link to set a new password is on its way. Check your spam folder too.`);
  };

  const handleDevBypass = async (seededEmail) => {
    setError('');
    setLoading(true);
    try {
      await loginAsSeededUser(seededEmail);
      navigate('/'); // SmartRoot routes each role to its portal
    } catch (err) {
      console.error(err);
      setError('The server is waking up — please wait a moment and try again.');
    } finally {
      setLoading(false);
    }
  };

  // Hardcoded, so every entry here has to be an account that actually exists —
  // a button for a deleted user just throws "not set up yet" at whoever clicks
  // it. The demo teachers/parents/students were dropped in the data reset, so
  // the real admin is all that is left. Re-add rows here if a demo set is
  // seeded again.
  const seededUsers = [
    {
      name: 'Admin',
      role: 'ADMIN',
      email: 'lovelearningfl@gmail.com',
      icon: <ShieldCheck size={20} />,
      color: '#dc2626',
      bg: '#fef2f2'
    }
  ];

  return (
    <div className="login-page">
      <div className="login-background-decor">
        <div className="blob blob-1"></div>
        <div className="blob blob-2"></div>
      </div>
      
      <div className="login-card glass">
        <div className="login-header">
          <img
            src="/logo.png"
            alt="Love Learning Explorers Logo"
            className="login-logo"
          />
          <h2>Love Learning Explorers</h2>
          <p>Sign in to your learning portal</p>
        </div>

        {error && (
          <div className="login-error-banner">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {notice && (
          <div className="login-notice-banner">
            <KeyRound size={18} />
            <span>{notice}</span>
          </div>
        )}

        {passwordJustSet && !error && !notice && (
          <div className="login-notice-banner">
            <KeyRound size={18} />
            <span>Your password is set. Sign in with it below.</span>
          </div>
        )}

        {/* Hidden once the user acts, so a stale ?invite= in the URL doesn't
            keep shouting over the message their action just produced. */}
        {inviteProblem && !error && !notice && (
          <div className="login-error-banner">
            <AlertCircle size={18} />
            <span>{inviteProblem}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="login-form">
          <div className="input-group">
            <label htmlFor="email">Email</label>
            <div className="input-field">
              <Mail size={18} className="input-icon" />
              <input 
                id="email"
                type="email" 
                placeholder="example@lovelearning.com" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                required
              />
            </div>
          </div>

          <div className="input-group">
            <label htmlFor="password">Password</label>
            <div className="input-field">
              <Lock size={18} className="input-icon" />
              <input 
                id="password"
                type="password" 
                placeholder="••••••••" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
              />
            </div>
          </div>

          <button type="submit" className="login-submit-btn" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="login-help-row">
          <button type="button" className="login-link-btn" onClick={handleForgotPassword} disabled={loading}>
            Forgot your password?
          </button>
          <p className="login-signup-cta">
            New family? <Link to="/signup" className="login-signup-link">Register your family</Link>
          </p>
        </div>

        {/* Dev builds only. This used to also honor VITE_ENABLE_TEST_LOGIN so a
            staging deploy could show demo profiles — until the flag ended up set
            on production and put an "Admin" button on the public login page.
            The backend rejected those clicks (its own bypass flag was off), but
            advertising an admin bypass on a page families use is not acceptable
            even non-functional. import.meta.env.DEV is statically false in any
            `vite build`, so Vite strips this whole block from production bundles
            — no env var can turn it back on. */}
        {import.meta.env.DEV && (
          <>
            <div className="login-divider">
              <span>OR SIGN IN AS A TEST USER</span>
            </div>

            <div className="dev-bypass-section">
              <p className="dev-bypass-subtitle">Select one of the demo profiles to explore:</p>
              <div className="dev-bypass-grid">
                {seededUsers.map((u, i) => (
                  <button
                    key={i}
                    type="button"
                    className="dev-bypass-btn"
                    style={{ '--accent-color': u.color, '--bg-color': u.bg }}
                    onClick={() => handleDevBypass(u.email)}
                    disabled={loading}
                  >
                    <div className="dev-bypass-icon" style={{ color: u.color, backgroundColor: u.bg }}>
                      {u.icon}
                    </div>
                    <div className="dev-bypass-text">
                      <span className="dev-bypass-name">{u.name}</span>
                      <span className="dev-bypass-role">{u.role}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Login;
