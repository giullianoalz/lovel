import React, { useState, useEffect } from 'react';
import { Bell, Save } from 'lucide-react';
import api from '../../lib/api';
import './NotificationSettings.css';

const AUDIENCE_LABELS = {
  PARENTS: 'Parents / families',
  ADMINS: 'Admins / front desk',
};

const NotificationSettings = () => {
  const [events, setEvents] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/settings/notifications');
      setEvents(res.data.events);
    } catch {
      setError('Could not load notification settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const patchEvent = (key, updater) => {
    setEvents((prev) => prev.map((e) => (e.key === key ? updater(e) : e)));
  };

  const toggleEnabled = (key, value) => patchEvent(key, (e) => ({ ...e, enabled: value }));

  const toggleAudience = (key, audience) => patchEvent(key, (e) => {
    const has = e.audience.includes(audience);
    return { ...e, audience: has ? e.audience.filter((a) => a !== audience) : [...e.audience, audience] };
  });

  const setParam = (key, paramKey, value) => patchEvent(key, (e) => ({
    ...e,
    params: { ...e.params, [paramKey]: value },
  }));

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const payload = {
        events: events.map((e) => ({
          key: e.key,
          enabled: e.enabled,
          audience: e.audience,
          // Coerce param inputs to numbers; empty string falls back to schema default.
          params: Object.fromEntries(
            e.paramSchema.map((p) => {
              const raw = e.params[p.key];
              const num = Number(raw);
              return [p.key, Number.isFinite(num) && raw !== '' ? num : p.default];
            }),
          ),
        })),
      };
      const res = await api.put('/settings/notifications', payload);
      setEvents(res.data.events);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="ns-page"><div className="app-loader"><div className="app-spinner" /><span className="app-loader-text">Loading settings…</span></div></div>;
  if (!events) return <div className="ns-page">{error || 'Settings unavailable.'}</div>;

  return (
    <div className="ns-page">
      <div className="ns-header">
        <Bell size={22} />
        <div>
          <h1>Notification Settings</h1>
          <p className="text-muted">Turn each automated notification on or off, choose who receives it, and tune when it fires.</p>
        </div>
      </div>

      {events.map((evt) => (
        <div className="ns-card" key={evt.key}>
          <div className="ns-row">
            <div>
              <h3>{evt.label}</h3>
              <p>{evt.description}</p>
            </div>
            <label className="ns-switch">
              <input
                type="checkbox"
                checked={evt.enabled}
                onChange={(e) => toggleEnabled(evt.key, e.target.checked)}
              />
              <span className="ns-slider" />
            </label>
          </div>

          {evt.enabled && (
            <div className="ns-details">
              <div className="ns-detail-block">
                <span className="ns-detail-label">Send to</span>
                <div className="ns-audience">
                  {evt.allowedAudience.map((aud) => (
                    <label key={aud} className={`ns-chip ${evt.audience.includes(aud) ? 'ns-chip-on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={evt.audience.includes(aud)}
                        onChange={() => toggleAudience(evt.key, aud)}
                      />
                      {AUDIENCE_LABELS[aud] || aud}
                    </label>
                  ))}
                </div>
                {evt.audience.length === 0 && (
                  <span className="ns-warn">No recipients selected — this notification won't be sent.</span>
                )}
              </div>

              {evt.paramSchema.length > 0 && (
                <div className="ns-detail-block">
                  {evt.paramSchema.map((p) => (
                    <div className="ns-param" key={p.key}>
                      <label htmlFor={`${evt.key}-${p.key}`}>{p.label}</label>
                      <input
                        id={`${evt.key}-${p.key}`}
                        type="number"
                        min={p.min}
                        max={p.max}
                        value={evt.params[p.key] ?? ''}
                        onChange={(e) => setParam(evt.key, p.key, e.target.value)}
                        className="ns-num-input"
                      />
                      <span>{p.unit}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {error && <div className="ns-error">{error}</div>}

      <button className="ns-save-btn" onClick={handleSave} disabled={saving}>
        <Save size={16} />
        {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Changes'}
      </button>
    </div>
  );
};

export default NotificationSettings;
