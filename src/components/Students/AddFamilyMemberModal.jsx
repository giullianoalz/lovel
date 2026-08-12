import React, { useState } from 'react';
import { X, UserPlus, GraduationCap, Check } from 'lucide-react';
import api from '../../lib/api';
import { useToast } from '../Layout/ToastProvider';
import './AddStudentModal.css';
import './AddFamilyMemberModal.css';

const INITIAL_GUARDIAN = { fullName: '', email: '', phone: '', isInvoiceRecipient: false };

/**
 * Entry point for "add another family member" from the Directory's parent
 * card. A family's account so far only grows by importing a new student
 * (AddStudentModal) or by a script (add-family-guardian.js) — this gives the
 * guardian half of that a UI, and hands off to AddStudentModal (already
 * knows how to attach a child to an existing family) for the student half.
 */
const AddFamilyMemberModal = ({ family, onClose, onSaved, onAddStudent }) => {
  const toast = useToast();
  const [guardian, setGuardian] = useState(INITIAL_GUARDIAN);
  const [saving, setSaving] = useState(false);

  const updateGuardian = (field, value) => setGuardian(prev => ({ ...prev, [field]: value }));

  const canSave = guardian.fullName.trim() && guardian.email.trim();

  const handleSave = async () => {
    if (saving || !canSave) return;
    setSaving(true);
    try {
      await api.post(`/families/${family.id}/members`, {
        fullName: guardian.fullName.trim(),
        email: guardian.email.trim(),
        phone: guardian.phone.trim(),
        role: 'parent',
        isInvoiceRecipient: guardian.isInvoiceRecipient,
      });
      toast.success(`${guardian.fullName.trim()} added to ${family.name}.`);
      await onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not add this guardian.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content afm-modal" onClick={e => e.stopPropagation()}>
        <div className="asm-header">
          <h2>Add to {family.name}</h2>
          <button className="icon-btn" onClick={onClose}><X size={22} /></button>
        </div>

        <div className="asm-body">
          <div className="asm-section">
            <div className="asm-section-title">
              <UserPlus size={18} />
              <span>New Guardian</span>
            </div>
            <p className="asm-section-desc">
              Give this family a second guardian — e.g. a spouse who needs their own login instead of
              sharing the other parent's invite email.
            </p>

            <div className="asm-row">
              <div className="asm-field">
                <label>Full Name <span className="required">*</span></label>
                <input type="text" placeholder="e.g. Ana Ruiz" value={guardian.fullName} onChange={e => updateGuardian('fullName', e.target.value)} />
              </div>
              <div className="asm-field">
                <label>Email <span className="required">*</span></label>
                <input type="email" placeholder="parent@email.com" value={guardian.email} onChange={e => updateGuardian('email', e.target.value)} />
              </div>
            </div>

            <div className="asm-row">
              <div className="asm-field">
                <label>Mobile Phone</label>
                <input type="tel" placeholder="(555) 123-4567" value={guardian.phone} onChange={e => updateGuardian('phone', e.target.value)} />
                <span className="asm-hint">Optional</span>
              </div>
            </div>

            <label className="asm-checkbox">
              <input type="checkbox" checked={guardian.isInvoiceRecipient} onChange={e => updateGuardian('isInvoiceRecipient', e.target.checked)} />
              <span>Send invoices to this guardian</span>
            </label>
          </div>

          <button
            type="button"
            className="afm-switch-mode"
            onClick={() => { onAddStudent(family.id); onClose(); }}
          >
            <GraduationCap size={16} />
            Adding a student instead? Do that here.
          </button>
        </div>

        <div className="asm-footer">
          <button className="action-btn outline" onClick={onClose}>Cancel</button>
          <button className="action-btn primary" onClick={handleSave} disabled={saving || !canSave}>
            <Check size={16} /> {saving ? 'Adding…' : 'Add Guardian'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddFamilyMemberModal;
