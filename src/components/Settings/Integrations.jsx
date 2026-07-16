import React, { useState, useEffect, useCallback } from 'react';
import { Plug, CheckCircle2, AlertTriangle, RefreshCw, Link2, Unlink, Save } from 'lucide-react';
import api from '../../lib/api';
import './Integrations.css';

// First / last day of the current month, as YYYY-MM-DD, for the default range.
const monthBounds = () => {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { from: fmt(first), to: fmt(last) };
};

const Integrations = () => {
  const [data, setData] = useState(null);      // { configured, status, accounts }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [banner, setBanner] = useState(null);   // post-OAuth redirect feedback

  const [anchorId, setAnchorId] = useState('');
  const [incomeId, setIncomeId] = useState('');
  const [savingAccounts, setSavingAccounts] = useState(false);

  const [range, setRange] = useState(monthBounds());
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/integrations/wave');
      setData(res.data);
      setAnchorId(res.data.status?.anchorAccountId || '');
      setIncomeId(res.data.status?.incomeAccountId || '');
      setError(null);
    } catch {
      setError('Could not load integration settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Read the ?wave=connected|error feedback Wave's callback redirected back with.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wave = params.get('wave');
    if (!wave) return;
    if (wave === 'connected') setBanner({ ok: true, text: 'Wave connected successfully.' });
    else setBanner({ ok: false, text: `Wave connection failed: ${params.get('reason') || 'unknown error'}` });
    // Clean the query string so a refresh doesn't re-show the banner.
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  const handleConnect = async () => {
    try {
      const res = await api.get('/integrations/wave/connect');
      window.location.href = res.data.url;
    } catch (err) {
      setError(err.response?.data?.message || 'Could not start the Wave connection.');
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Wave? Income will no longer sync until you reconnect.')) return;
    try {
      await api.post('/integrations/wave/disconnect');
      setPreview(null); setSyncResult(null);
      await load();
    } catch {
      setError('Could not disconnect Wave.');
    }
  };

  const handleSaveAccounts = async () => {
    setSavingAccounts(true);
    setError(null);
    try {
      await api.put('/integrations/wave/accounts', { anchorAccountId: anchorId, incomeAccountId: incomeId });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save account mapping.');
    } finally {
      setSavingAccounts(false);
    }
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setSyncResult(null);
    setError(null);
    try {
      const res = await api.post('/integrations/wave/sync/preview', range);
      setPreview(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not build the sync preview.');
    } finally {
      setPreviewing(false);
    }
  };

  const handleSync = async () => {
    if (!window.confirm(`Push ${preview?.count || 0} payment(s) totaling $${preview?.total || '0.00'} to Wave?`)) return;
    setSyncing(true);
    setError(null);
    try {
      const res = await api.post('/integrations/wave/sync', range);
      setSyncResult(res.data);
      setPreview(null);
    } catch (err) {
      setError(err.response?.data?.message || 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return <div className="int-page">Loading…</div>;

  const status = data?.status || {};
  const accounts = data?.accounts || null;

  return (
    <div className="int-page">
      <div className="int-header">
        <Plug size={22} />
        <div>
          <h1>Integrations</h1>
          <p className="text-muted">Connect external services. Wave keeps your income accounting in sync.</p>
        </div>
      </div>

      {banner && (
        <div className={`int-banner ${banner.ok ? 'int-banner-ok' : 'int-banner-err'}`}>
          {banner.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {banner.text}
        </div>
      )}
      {error && <div className="int-banner int-banner-err"><AlertTriangle size={16} /> {error}</div>}

      <div className="int-card">
        <div className="int-card-head">
          <div className="int-card-title">
            <h2>Wave Accounting</h2>
            {status.connected
              ? <span className="int-pill int-pill-on"><CheckCircle2 size={13} /> Connected</span>
              : <span className="int-pill int-pill-off">Not connected</span>}
          </div>
        </div>

        {!data?.configured && (
          <div className="int-note">
            <AlertTriangle size={15} />
            <span>
              Wave OAuth isn't configured on the server yet. An admin must register an app at
              developer.waveapps.com and set <code>WAVE_CLIENT_ID</code>, <code>WAVE_CLIENT_SECRET</code> and
              <code> WAVE_REDIRECT_URI</code> in the backend environment.
            </span>
          </div>
        )}

        {data?.configured && !status.connected && (
          <>
            <p className="int-desc">Authorize Love Learning to post income to your Wave business.</p>
            <button className="int-btn int-btn-primary" onClick={handleConnect}>
              <Link2 size={16} /> Connect with Wave
            </button>
          </>
        )}

        {status.connected && (
          <>
            <div className="int-meta">
              <span>Business</span><strong>{status.businessName || status.businessId}</strong>
            </div>

            {accounts?.error ? (
              <div className="int-note"><AlertTriangle size={15} /><span>Couldn't load Wave accounts: {accounts.error}. Try reconnecting.</span></div>
            ) : (
              <div className="int-accounts">
                <label>
                  <span>Deposit account <small>(where money lands — asset)</small></span>
                  <select value={anchorId} onChange={(e) => setAnchorId(e.target.value)}>
                    <option value="">Select an account…</option>
                    {(accounts?.deposit || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>Income account <small>(revenue category)</small></span>
                  <select value={incomeId} onChange={(e) => setIncomeId(e.target.value)}>
                    <option value="">Select an account…</option>
                    {(accounts?.income || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </label>
                <button className="int-btn int-btn-primary" onClick={handleSaveAccounts} disabled={savingAccounts || !anchorId || !incomeId}>
                  <Save size={15} /> {savingAccounts ? 'Saving…' : 'Save mapping'}
                </button>
              </div>
            )}

            {/* Income sync — only once both accounts are mapped */}
            {status.readyToSync && (
              <div className="int-sync">
                <h3>Sync income to Wave</h3>
                <p className="int-desc">Pushes completed payments in the range as income transactions. Already-synced payments are skipped.</p>
                <div className="int-range">
                  <label>From <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></label>
                  <label>To <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></label>
                  <button className="int-btn" onClick={handlePreview} disabled={previewing}>
                    <RefreshCw size={15} /> {previewing ? 'Checking…' : 'Preview'}
                  </button>
                </div>

                {preview && (
                  <div className="int-preview">
                    <p><strong>{preview.count}</strong> payment(s) · total <strong>${preview.total}</strong> to push.</p>
                    {preview.count > 0 && (
                      <>
                        <ul className="int-preview-list">
                          {preview.items.slice(0, 8).map((it) => (
                            <li key={it.id}>
                              <span>{new Date(it.date).toLocaleDateString()}</span>
                              <span>{it.description}</span>
                              <span>${it.amount}</span>
                            </li>
                          ))}
                          {preview.items.length > 8 && <li className="int-more">+ {preview.items.length - 8} more…</li>}
                        </ul>
                        <button className="int-btn int-btn-primary" onClick={handleSync} disabled={syncing}>
                          {syncing ? 'Syncing…' : `Sync ${preview.count} to Wave`}
                        </button>
                      </>
                    )}
                  </div>
                )}

                {syncResult && (
                  <div className="int-result">
                    <CheckCircle2 size={16} /> Synced {syncResult.synced} of {syncResult.attempted}.
                    {syncResult.failed > 0 && <span className="int-fail"> {syncResult.failed} failed.</span>}
                    {(syncResult.errors || []).length > 0 && (
                      <ul className="int-preview-list">
                        {syncResult.errors.map((e, i) => <li key={i}>{e.paymentId.slice(0, 8)}: {e.message}</li>)}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}

            <button className="int-btn int-btn-ghost int-disconnect" onClick={handleDisconnect}>
              <Unlink size={15} /> Disconnect Wave
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default Integrations;
