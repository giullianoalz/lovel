import React, { useState } from 'react';
import { X, Tags, Plus, Trash2, Save, GraduationCap, Coffee } from 'lucide-react';
import { database } from '../../lib/database';
import { useAsyncData } from '../../lib/useAsyncData';
import { useToast } from '../Layout/ToastProvider';
import ErrorBanner from '../Layout/ErrorBanner';
import './PayCategoriesPanel.css';

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Enough to tell the kinds of work apart at a glance on the calendar, and no
// more: a free colour picker produces twelve shades of blue nobody can read.
const SWATCHES = ['#6366f1', '#0ea5e9', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#ec4899', '#64748b'];

/**
 * The kinds of work the academy pays for, and what each one pays.
 *
 * This is the screen the whole pay model hangs off: set "front desk = $20"
 * here once, and every hour anybody is scheduled for front desk prices itself.
 * Nobody has to remember to also set a rate, and nobody has to work out what a
 * month cost by reading a calendar.
 */
const PayCategoriesPanel = ({ onClose }) => {
  const toast = useToast();
  const { data, loading, error, retry } = useAsyncData(() => database.fetchPayCategories(), []);
  const categories = data || [];

  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newCat, setNewCat] = useState({ label: '', defaultRate: '', teaching: false, color: SWATCHES[0] });

  const draftFor = (c) => drafts[c.key] ?? {
    label: c.label,
    defaultRate: c.defaultRate != null ? String(c.defaultRate) : '',
    color: c.color || SWATCHES[0],
    active: c.active,
  };

  const setDraft = (key, patch) =>
    setDrafts((d) => ({ ...d, [key]: { ...(d[key] ?? {}), ...patch } }));

  const dirty = (c) => {
    const d = drafts[c.key];
    if (!d) return false;
    return (
      d.label !== c.label ||
      d.defaultRate !== (c.defaultRate != null ? String(c.defaultRate) : '') ||
      d.color !== (c.color || SWATCHES[0]) ||
      d.active !== c.active
    );
  };

  const handleSave = async (c) => {
    const d = draftFor(c);
    setSaving(c.key);
    try {
      await database.updatePayCategory(c.id, {
        label: d.label,
        // '' clears the rate server-side; the category then falls through to
        // whatever the person's own rate is.
        defaultRate: d.defaultRate.trim(),
        color: d.color,
        active: d.active,
      });
      setDrafts((prev) => { const next = { ...prev }; delete next[c.key]; return next; });
      await retry();
      toast.success(`"${d.label}" updated.`);
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not save that category.');
    } finally {
      setSaving(null);
    }
  };

  const handleCreate = async () => {
    if (!newCat.label.trim()) return;
    setSaving('__new__');
    try {
      await database.createPayCategory({
        label: newCat.label.trim(),
        defaultRate: newCat.defaultRate.trim(),
        teaching: newCat.teaching,
        color: newCat.color,
      });
      setNewCat({ label: '', defaultRate: '', teaching: false, color: SWATCHES[0] });
      setAdding(false);
      await retry();
      toast.success('Category added.');
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not add that category.');
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async (c) => {
    setSaving(c.key);
    try {
      const res = await database.deletePayCategory(c.id);
      await retry();
      toast.success(res.message || 'Category removed.');
    } catch (err) {
      // The server refuses to delete a category with hours booked to it and
      // says why, including the "retire it instead" way out — that message is
      // more useful than anything this screen could invent.
      toast.error(err.response?.data?.message || err.userMessage || 'Could not remove that category.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content pay-cat-panel" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}><X size={24} /></button>

        <header className="pay-cat-header">
          <Tags size={22} />
          <div>
            <h2>Pay categories</h2>
            <p>What each kind of work pays per hour. Scheduling somebody for it is what prices the hour.</p>
          </div>
        </header>

        {loading ? (
          <div className="pay-cat-state">
            <div className="app-loader"><div className="app-spinner" /><span className="app-loader-text">Loading the rates…</span></div>
          </div>
        ) : error ? (
          <ErrorBanner message={error} onRetry={retry} />
        ) : (
          <div className="pay-cat-body">
            {categories.map((c) => {
              const d = draftFor(c);
              return (
                <div className={`pay-cat-row${d.active ? '' : ' pay-cat-row-retired'}`} key={c.key}>
                  <div className="pay-cat-swatches">
                    {SWATCHES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`pay-cat-swatch${d.color === s ? ' is-selected' : ''}`}
                        style={{ background: s }}
                        aria-label={`Colour ${s}`}
                        onClick={() => setDraft(c.key, { ...d, color: s })}
                      />
                    ))}
                  </div>

                  <div className="pay-cat-main">
                    <input
                      className="form-control pay-cat-label"
                      value={d.label}
                      onChange={(e) => setDraft(c.key, { ...d, label: e.target.value })}
                    />
                    <span className="pay-cat-kind">
                      {c.teaching ? <><GraduationCap size={12} /> teaching</> : <><Coffee size={12} /> shift</>}
                    </span>
                  </div>

                  <div className="pay-cat-rate">
                    <span className="pay-cat-currency">$</span>
                    <input
                      type="number" min="0" step="0.01" inputMode="decimal"
                      className="form-control"
                      value={d.defaultRate}
                      onChange={(e) => setDraft(c.key, { ...d, defaultRate: e.target.value })}
                      placeholder="no rate"
                    />
                    <span className="pay-cat-per">/hr</span>
                  </div>

                  {/* Retiring keeps every hour already booked to it adding up,
                      and just stops it being offered when scheduling. */}
                  <label className="pay-cat-active" title={d.active ? 'Offered when scheduling' : 'Retired — past pay still counts'}>
                    <input
                      type="checkbox"
                      checked={d.active}
                      onChange={(e) => setDraft(c.key, { ...d, active: e.target.checked })}
                    />
                    <span>{d.active ? 'In use' : 'Retired'}</span>
                  </label>

                  <div className="pay-cat-actions">
                    {dirty(c) && (
                      <button className="save-btn" onClick={() => handleSave(c)} disabled={saving === c.key}>
                        <Save size={13} /> {saving === c.key ? 'Saving…' : 'Save'}
                      </button>
                    )}
                    <button
                      className="pay-cat-delete"
                      onClick={() => handleDelete(c)}
                      disabled={saving === c.key}
                      title="Remove — only possible if nothing has been booked to it"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}

            {adding ? (
              <div className="pay-cat-row pay-cat-row-new">
                <div className="pay-cat-swatches">
                  {SWATCHES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`pay-cat-swatch${newCat.color === s ? ' is-selected' : ''}`}
                      style={{ background: s }}
                      aria-label={`Colour ${s}`}
                      onClick={() => setNewCat((n) => ({ ...n, color: s }))}
                    />
                  ))}
                </div>
                <div className="pay-cat-main">
                  <input
                    className="form-control pay-cat-label"
                    value={newCat.label}
                    onChange={(e) => setNewCat((n) => ({ ...n, label: e.target.value }))}
                    placeholder="e.g. Junior Jams class"
                    autoFocus
                  />
                  <label className="pay-cat-kind pay-cat-kind-toggle">
                    <input
                      type="checkbox"
                      checked={newCat.teaching}
                      onChange={(e) => setNewCat((n) => ({ ...n, teaching: e.target.checked }))}
                    />
                    <span>Teaching (offered on class sessions)</span>
                  </label>
                </div>
                <div className="pay-cat-rate">
                  <span className="pay-cat-currency">$</span>
                  <input
                    type="number" min="0" step="0.01" inputMode="decimal"
                    className="form-control"
                    value={newCat.defaultRate}
                    onChange={(e) => setNewCat((n) => ({ ...n, defaultRate: e.target.value }))}
                    placeholder="0.00"
                  />
                  <span className="pay-cat-per">/hr</span>
                </div>
                <div className="pay-cat-actions">
                  <button className="cancel-btn" onClick={() => setAdding(false)}>Cancel</button>
                  <button className="save-btn" onClick={handleCreate} disabled={saving === '__new__' || !newCat.label.trim()}>
                    <Save size={13} /> {saving === '__new__' ? 'Adding…' : 'Add'}
                  </button>
                </div>
              </div>
            ) : (
              <button className="pay-cat-add" onClick={() => setAdding(true)}>
                <Plus size={15} /> Add a kind of work
              </button>
            )}

            <p className="pay-cat-hint">
              A rate here applies to everyone. Someone paid differently for the same work gets
              their own rate on their payroll card, and that wins — as does a rate typed onto a
              single calendar entry. Leave a category with no rate and it falls through to each
              person's base hourly rate. Changing a rate only affects work that hasn't been confirmed
              yet: an hour already marked complete keeps the rate it was worked at, so raising a rate
              today never rewrites a month that was already signed off.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PayCategoriesPanel;
