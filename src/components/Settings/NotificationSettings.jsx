import React, { useState, useEffect } from 'react';
import { Bell, Save } from 'lucide-react';
import api from '../../lib/api';
import './NotificationSettings.css';

const NotificationSettings = () => {
  const [settings, setSettings] = useState(null);
  const [minutesInput, setMinutesInput] = useState('15');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/settings/notifications');
      setSettings(res.data.settings);
      setMinutesInput(String(res.data.settings.classReminderMinutesBefore));
    } catch (err) {
      setError('Could not load notification settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await api.put('/settings/notifications', {
        classReminderEnabled: settings.classReminderEnabled,
        classReminderMinutesBefore: parseInt(minutesInput) || 15,
        absenceAlertEnabled: settings.absenceAlertEnabled,
      });
      setSettings(res.data.settings);
      setMinutesInput(String(res.data.settings.classReminderMinutesBefore));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="ns-page">Loading…</div>;
  if (!settings) return <div className="ns-page">{error || 'Settings unavailable.'}</div>;

  return (
    <div className="ns-page">
      <div className="ns-header">
        <Bell size={22} />
        <div>
          <h1>Notification Settings</h1>
          <p className="text-muted">Control the automated push notifications sent to families.</p>
        </div>
      </div>

      <div className="ns-card">
        <div className="ns-row">
          <div>
            <h3>Class starting-soon reminder</h3>
            <p>Notifies enrolled students' parents shortly before class begins.</p>
          </div>
          <label className="ns-switch">
            <input
              type="checkbox"
              checked={settings.classReminderEnabled}
              onChange={(e) => setSettings({ ...settings, classReminderEnabled: e.target.checked })}
            />
            <span className="ns-slider" />
          </label>
        </div>

        {settings.classReminderEnabled && (
          <div className="ns-subrow">
            <label htmlFor="ns-minutes">Send reminder</label>
            <input
              id="ns-minutes"
              type="number"
              min="1"
              max="180"
              value={minutesInput}
              onChange={(e) => setMinutesInput(e.target.value)}
              className="ns-minutes-input"
            />
            <span>minute(s) before class starts</span>
          </div>
        )}
      </div>

      <div className="ns-card">
        <div className="ns-row">
          <div>
            <h3>Absence alert</h3>
            <p>Notifies a student's parent(s) as soon as a teacher marks them absent.</p>
          </div>
          <label className="ns-switch">
            <input
              type="checkbox"
              checked={settings.absenceAlertEnabled}
              onChange={(e) => setSettings({ ...settings, absenceAlertEnabled: e.target.checked })}
            />
            <span className="ns-slider" />
          </label>
        </div>
      </div>

      {error && <div className="ns-error">{error}</div>}

      <button className="ns-save-btn" onClick={handleSave} disabled={saving}>
        <Save size={16} />
        {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Changes'}
      </button>
    </div>
  );
};

export default NotificationSettings;
