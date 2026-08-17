import React, { useState, useEffect } from 'react';
import { X, Check, Users } from 'lucide-react';
import api from '../../lib/api';
import { useToast } from '../Layout/ToastProvider';
import './AddStudentModal.css';

/**
 * Edits the family account behind a student's profile: the family name and
 * each guardian's name/phone. Email is deliberately left out — it's tied to
 * the guardian's Firebase login, and changing it here without also touching
 * that account would just break their sign-in.
 */
const EditFamilyModal = ({ familyId, onClose, onSaved }) => {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [familyName, setFamilyName] = useState('');
  const [guardians, setGuardians] = useState([]); // [{ memberId, userId, fullName, email, phone }]

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/families/${familyId}`);
        const family = res.data.family;
        if (cancelled) return;
        setFamilyName(family.name || '');
        setGuardians(
          (family.members || [])
            .filter(m => m.user?.role === 'PARENT')
            .map(m => ({
              memberId: m.id,
              userId: m.user.id,
              fullName: m.user.fullName || '',
              email: m.user.email || '',
              phone: m.user.phone || '',
            }))
        );
      } catch (err) {
        toast.error(err.response?.data?.message || err.userMessage || 'Could not load the family.');
        onClose();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [familyId]);

  const updateGuardian = (userId, field, value) =>
    setGuardians(prev => prev.map(g => (g.userId === userId ? { ...g, [field]: value } : g)));

  const canSave = familyName.trim() && guardians.every(g => g.fullName.trim());

  const handleSave = async () => {
    if (saving || !canSave) return;
    setSaving(true);
    try {
      await api.put(`/families/${familyId}`, { name: familyName.trim() });
      await Promise.all(
        guardians.map(g =>
          api.put(`/users/${g.userId}`, { fullName: g.fullName.trim(), phone: g.phone.trim() })
        )
      );
      toast.success('Family updated.');
      await onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not update the family.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content add-student-modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="asm-header">
          <h2>Edit Family</h2>
          <button className="icon-btn" onClick={onClose}><X size={22} /></button>
        </div>

        {loading ? (
          <div className="asm-body">
            <p className="text-muted">Loading family…</p>
          </div>
        ) : (
          <div className="asm-body">
            <div className="asm-section">
              <div className="asm-field">
                <label>Family Name <span className="required">*</span></label>
                <input type="text" value={familyName} onChange={e => setFamilyName(e.target.value)} />
              </div>
            </div>

            <div className="asm-section">
              <div className="asm-section-title">
                <Users size={18} />
                <span>Guardians</span>
              </div>

              {guardians.length === 0 ? (
                <p className="text-muted" style={{ fontSize: 13 }}>No guardians on this family yet.</p>
              ) : (
                guardians.map(g => (
                  <div key={g.userId} className="asm-row" style={{ marginBottom: 12 }}>
                    <div className="asm-field">
                      <label>Name <span className="required">*</span></label>
                      <input type="text" value={g.fullName} onChange={e => updateGuardian(g.userId, 'fullName', e.target.value)} />
                    </div>
                    <div className="asm-field">
                      <label>Phone</label>
                      <input type="tel" value={g.phone} onChange={e => updateGuardian(g.userId, 'phone', e.target.value)} />
                    </div>
                  </div>
                ))
              )}
              {guardians.length > 0 && (
                <span className="asm-hint">Email isn't editable here — it's tied to each guardian's sign-in.</span>
              )}
            </div>
          </div>
        )}

        <div className="asm-footer">
          <button className="action-btn outline" onClick={onClose}>Cancel</button>
          <button className="action-btn primary" onClick={handleSave} disabled={loading || saving || !canSave}>
            <Check size={16} /> {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditFamilyModal;
