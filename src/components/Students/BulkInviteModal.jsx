import React, { useState, useEffect, useMemo } from 'react';
import { X, Send, Copy, CheckCircle2, AlertCircle, Link2, Mail, Users } from 'lucide-react';
import api from '../../lib/api';
import { useToast } from '../Layout/ToastProvider';
import ErrorBanner from '../Layout/ErrorBanner';
import './BulkInviteModal.css';

// The server refuses more than this in one call — mailing real families is not
// something to trigger by accident. Mirrored here so the limit is visible
// before the request rather than as a 400 afterwards.
const MAX_PER_BATCH = 100;

const ROLE_LABELS = { ADMIN: 'Admin', TEACHER: 'Teacher', PARENT: 'Parent', STUDENT: 'Student' };

/**
 * Clearing the sign-in backlog in one pass.
 *
 * Most accounts here were created by staff — imported, or added by hand — and
 * have never been invited, so the people they belong to cannot log in at all.
 * Doing that one profile at a time is why the backlog exists.
 *
 * Built to be useful while email delivery is still unconfigured: the server
 * creates the account and the set-password link either way, and hands every
 * link back. So the result of this screen is a list of working links an admin
 * can pass on by hand today, and the same button starts emailing the moment a
 * verified sender exists.
 */
const BulkInviteModal = ({ onClose, onDone }) => {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [people, setPeople] = useState([]);
  const [selected, setSelected] = useState([]);
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get('/users', { params: { limit: 500 } });
        if (!alive) return;
        // Only people who cannot sign in — anyone with a working account is not
        // part of this backlog and would only be noise to scroll past.
        setPeople((res.data.users || []).filter(u => !u.canSignIn));
      } catch (err) {
        if (alive) setError(err.userMessage || 'Could not load the list of accounts.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Why a given row can't be invited yet. Mirrors the server's own refusals, so
  // an admin sees the reason here instead of getting a row back marked failed.
  const blockedReason = (p) => {
    if (!p.emailUsable) return 'No real email on file';
    if (p.status === 'SUSPENDED') return 'Account suspended';
    return null;
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people
      .filter(p => roleFilter === 'ALL' || p.role === roleFilter)
      .filter(p => !q || (p.fullName || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q));
  }, [people, roleFilter, search]);

  const invitable = useMemo(() => visible.filter(p => !blockedReason(p)), [visible]);
  const blocked = useMemo(() => visible.filter(p => blockedReason(p)), [visible]);

  const roleCounts = useMemo(() => {
    const counts = {};
    people.forEach(p => { counts[p.role] = (counts[p.role] || 0) + 1; });
    return counts;
  }, [people]);

  const toggle = (id) => {
    setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const selectAllVisible = () => {
    const ids = invitable.slice(0, MAX_PER_BATCH).map(p => p.id);
    setSelected(ids);
    if (invitable.length > MAX_PER_BATCH) {
      toast.info(`Selected the first ${MAX_PER_BATCH} — invite the rest in a second pass.`);
    }
  };

  const handleSend = async () => {
    if (selected.length === 0) return;
    setSending(true);
    try {
      const res = await api.post('/users/invite-bulk', { userIds: selected });
      setResults(res.data);
      onDone?.();
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not send the invites.');
    } finally {
      setSending(false);
    }
  };

  const copy = (text, label) => {
    navigator.clipboard?.writeText(text);
    toast.success(label);
  };

  // One line per person, so the whole batch can go into a spreadsheet or a
  // message without copying thirty links one at a time.
  const copyAllLinks = () => {
    const lines = (results?.results || [])
      .filter(r => r.ok && r.link)
      .map(r => `${r.fullName}\t${r.email}\t${r.link}`);
    if (lines.length === 0) return;
    copy(lines.join('\n'), `${lines.length} links copied.`);
  };

  const withLinks = (results?.results || []).filter(r => r.ok && r.link);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content bulk-invite-modal" onClick={e => e.stopPropagation()}>
        <div className="bulk-invite-header">
          <div>
            <h2>{results ? 'Invites processed' : 'Invite people to the portal'}</h2>
            <p>
              {results
                ? 'Accounts are ready. Anything below with a link still needs to reach the person.'
                : 'Everyone here has an account but has never been able to sign in.'}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>

        {results ? (
          <>
            <div className="bulk-invite-summary">
              <div className="bulk-stat">
                <Mail size={16} />
                <strong>{results.summary.sent}</strong>
                <span>emailed</span>
              </div>
              <div className="bulk-stat highlight">
                <Link2 size={16} />
                <strong>{results.summary.prepared}</strong>
                <span>links to share by hand</span>
              </div>
              <div className="bulk-stat">
                <AlertCircle size={16} />
                <strong>{results.summary.failed}</strong>
                <span>failed</span>
              </div>
            </div>

            {withLinks.length > 0 && (
              <div className="bulk-links-note">
                <AlertCircle size={15} />
                <span>
                  These links set a password — treat each one like a password, and send it
                  only to the person it belongs to.
                </span>
                <button className="action-btn" onClick={copyAllLinks}>
                  <Copy size={14} /> Copy all {withLinks.length}
                </button>
              </div>
            )}

            <div className="bulk-invite-body">
              {results.results.map(r => (
                <div key={r.id} className={`bulk-result-row ${r.ok ? '' : 'failed'}`}>
                  <div className="bulk-result-main">
                    <strong>{r.fullName || r.id}</strong>
                    <span className="bulk-result-email">{r.email || r.message}</span>
                    {r.ok && r.link && <code className="bulk-result-link">{r.link}</code>}
                  </div>
                  {r.ok && r.emailed && (
                    <span className="bulk-tag emailed"><CheckCircle2 size={13} /> Emailed</span>
                  )}
                  {r.ok && r.link && (
                    <button className="action-btn" onClick={() => copy(r.link, `Link for ${r.fullName} copied.`)}>
                      <Copy size={14} /> Copy
                    </button>
                  )}
                  {!r.ok && <span className="bulk-tag failed"><AlertCircle size={13} /> {r.message}</span>}
                </div>
              ))}
            </div>

            <div className="bulk-invite-footer">
              <span className="text-muted">{results.message}</span>
              <button className="btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : loading ? (
          <div className="bulk-invite-state">
            <div className="app-loader"><div className="app-spinner" /><span className="app-loader-text">Loading accounts…</span></div>
          </div>
        ) : error ? (
          <div className="bulk-invite-state"><ErrorBanner message={error} /></div>
        ) : people.length === 0 ? (
          <div className="bulk-invite-state">
            <CheckCircle2 size={32} />
            <p>Everyone already has portal access.</p>
          </div>
        ) : (
          <>
            <div className="bulk-invite-controls">
              <input
                type="text"
                className="form-control"
                placeholder="Search by name or email…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <div className="bulk-role-tabs">
                <button
                  className={`bulk-role-tab ${roleFilter === 'ALL' ? 'active' : ''}`}
                  onClick={() => setRoleFilter('ALL')}
                >
                  All <span className="bulk-role-count">{people.length}</span>
                </button>
                {Object.entries(roleCounts).map(([role, n]) => (
                  <button
                    key={role}
                    className={`bulk-role-tab ${roleFilter === role ? 'active' : ''}`}
                    onClick={() => setRoleFilter(role)}
                  >
                    {ROLE_LABELS[role] || role} <span className="bulk-role-count">{n}</span>
                  </button>
                ))}
              </div>
              <div className="bulk-select-actions">
                <button className="btn-text" onClick={selectAllVisible} disabled={invitable.length === 0}>
                  Select all ready ({invitable.length})
                </button>
                <button className="btn-text" onClick={() => setSelected([])} disabled={selected.length === 0}>
                  Clear
                </button>
              </div>
            </div>

            <div className="bulk-invite-body">
              {invitable.map(p => (
                <label key={p.id} className={`bulk-person-row ${selected.includes(p.id) ? 'selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selected.includes(p.id)}
                    onChange={() => toggle(p.id)}
                    disabled={!selected.includes(p.id) && selected.length >= MAX_PER_BATCH}
                  />
                  <div className="bulk-person-main">
                    <strong>{p.fullName}</strong>
                    <span className="bulk-person-email">{p.email}</span>
                  </div>
                  <span className="bulk-role-badge">{ROLE_LABELS[p.role] || p.role}</span>
                  {p.invitedAt && (
                    <span className="bulk-tag invited">
                      Invited {new Date(p.invitedAt).toLocaleDateString('en-US')}
                    </span>
                  )}
                </label>
              ))}

              {/* Shown, not hidden: an admin needs to know these people exist and
                  why they're stuck, or they quietly never get access. */}
              {blocked.length > 0 && (
                <div className="bulk-blocked-section">
                  <h4>Can't be invited yet ({blocked.length})</h4>
                  {blocked.map(p => (
                    <div key={p.id} className="bulk-person-row blocked">
                      <div className="bulk-person-main">
                        <strong>{p.fullName}</strong>
                        <span className="bulk-person-email">{p.email}</span>
                      </div>
                      <span className="bulk-role-badge">{ROLE_LABELS[p.role] || p.role}</span>
                      <span className="bulk-tag blocked"><AlertCircle size={13} /> {blockedReason(p)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bulk-invite-footer">
              <span className="text-muted">
                <Users size={14} /> {selected.length} selected
                {selected.length >= MAX_PER_BATCH && ` (max ${MAX_PER_BATCH} per batch)`}
              </span>
              <button
                className="btn-primary"
                onClick={handleSend}
                disabled={selected.length === 0 || sending}
              >
                <Send size={15} /> {sending ? 'Working…' : `Invite ${selected.length || ''}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default BulkInviteModal;
