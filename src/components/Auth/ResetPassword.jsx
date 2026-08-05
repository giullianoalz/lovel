import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { verifyPasswordResetCode, confirmPasswordReset } from 'firebase/auth';
import { ShieldCheck, KeyRound, AlertCircle, Loader } from 'lucide-react';
import { auth } from '../../lib/firebase';
import './Login.css';

/**
 * "Set your password" — the page an invitation link lands on.
 *
 * This exists because Firebase's own hosted page does not: the project has no
 * Firebase Hosting site, so llexplorers2026.firebaseapp.com/__/auth/action
 * answers "Site Not Found" and the reset form there can never load its config.
 * Every invite and every "Forgot your password?" email pointed at that dead end.
 *
 * The code is redeemed straight from the browser with the web SDK, so the
 * password still goes only to Firebase and never touches our server — the same
 * property the Firebase-hosted page would have given us.
 */
const MIN_PASSWORD_LENGTH = 8;

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const oobCode = searchParams.get('oobCode');

  // 'checking' until Firebase confirms the code is real — no point showing a
  // password form to someone whose link already expired.
  const [status, setStatus] = useState('checking');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!oobCode) {
      setStatus('bad-code');
      return undefined;
    }

    verifyPasswordResetCode(auth, oobCode)
      .then((verifiedEmail) => {
        if (cancelled) return;
        setEmail(verifiedEmail);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('bad-code');
      });

    return () => { cancelled = true; };
  }, [oobCode]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Your password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setError('');
    setSaving(true);
    try {
      await confirmPasswordReset(auth, oobCode, password);
      navigate('/login?reset=done', { replace: true });
    } catch (err) {
      // Codes are single-use and short-lived, and the most likely failure by
      // far is that this one is spent — say so instead of showing a raw code.
      const message = err?.code === 'auth/weak-password'
        ? 'That password is too weak. Try a longer one.'
        : 'That link is no longer valid. Please open the most recent invitation email, or use "Forgot your password?" on the sign-in page.';
      setError(message);
      setSaving(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <ShieldCheck size={40} className="login-logo" />
          <h1>Love Learning Explorers</h1>
          <p>{status === 'ready' ? `Set the password for ${email}` : 'Set your password'}</p>
        </div>

        {status === 'checking' && (
          <div className="login-notice-banner">
            <Loader size={18} />
            <span>Checking your link…</span>
          </div>
        )}

        {status === 'bad-code' && (
          <>
            <div className="login-error-banner">
              <AlertCircle size={18} />
              <span>
                This link has expired or has already been used. Open the most recent
                invitation email, or use &quot;Forgot your password?&quot; on the sign-in page
                to get a new one.
              </span>
            </div>
            <button type="button" className="login-btn" onClick={() => navigate('/login')}>
              Go to sign in
            </button>
          </>
        )}

        {status === 'ready' && (
          <>
            {error && (
              <div className="login-error-banner">
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="login-form">
              <div className="input-group">
                <label htmlFor="new-password">New password</label>
                <div className="input-wrapper">
                  <KeyRound size={18} className="input-icon" />
                  <input
                    id="new-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                    autoComplete="new-password"
                autoFocus
                  />
                </div>
              </div>

              <div className="input-group">
                <label htmlFor="confirm-password">Confirm password</label>
                <div className="input-wrapper">
                  <KeyRound size={18} className="input-icon" />
                  <input
                    id="confirm-password"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Type it again"
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <button type="submit" className="login-btn" disabled={saving}>
                {saving ? 'Saving…' : 'Set password and continue'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
