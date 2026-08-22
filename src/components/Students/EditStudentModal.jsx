import React, { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import api from '../../lib/api';
import { useToast } from '../Layout/ToastProvider';
import { GRADE_LEVELS } from '../../constants/gradeLevels';
import './AddStudentModal.css';

const toDateInput = (value) => (value ? String(value).slice(0, 10) : '');
const orBlank = (value) => (value && value !== 'N/A' ? value : '');

const EditStudentModal = ({ student, onClose, onSaved }) => {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [families, setFamilies] = useState([]);
  
  const [form, setForm] = useState({
    fullName: student.name || '',
    email: orBlank(student.email),
    phone: orBlank(student.phone),
    status: (student.status || 'Active').toUpperCase(),
    birthday: toDateInput(student.birthday),
    allergies: student.allergies === 'None' ? '' : (student.allergies || ''),
    gradeLevel: orBlank(student.gradeLevel),
    accommodationNotes: student.accommodationNotes || '',
    familyId: student.familyId || '',
  });

  useEffect(() => {
    let cancelled = false;
    api.get('/families').then(res => {
      if (!cancelled) {
        setFamilies(res.data.families || []);
      }
    }).catch(err => console.error("Error loading families:", err));
    return () => { cancelled = true; };
  }, []);

  const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const canSave = form.fullName.trim() && form.email.trim();

  const handleSave = async () => {
    if (saving || !canSave) return;
    setSaving(true);
    try {
      const res = await api.put(`/students/${student.id}/info`, {
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        status: form.status,
        birthday: form.birthday,
        allergies: form.allergies.trim(),
        gradeLevel: form.gradeLevel,
        accommodationNotes: form.accommodationNotes.trim(),
        familyId: form.familyId || undefined,
      });
      toast.success('Student updated.');
      await onSaved?.(res.data.student);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || err.userMessage || 'Could not update the student.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content add-student-modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="asm-header">
          <h2>Edit Student</h2>
          <button className="icon-btn" onClick={onClose}><X size={22} /></button>
        </div>

        <div className="asm-body">
          <div className="asm-section">
            <div className="asm-row">
              <div className="asm-field">
                <label>Full Name <span className="required">*</span></label>
                <input type="text" value={form.fullName} onChange={e => update('fullName', e.target.value)} />
              </div>
              <div className="asm-field">
                <label>Status</label>
                <select value={form.status} onChange={e => update('status', e.target.value)}>
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                  <option value="SUSPENDED">Suspended</option>
                </select>
              </div>
            </div>

            <div className="asm-row">
              <div className="asm-field">
                <label>Email <span className="required">*</span></label>
                <input type="email" value={form.email} onChange={e => update('email', e.target.value)} />
              </div>
              <div className="asm-field">
                <label>Phone</label>
                <input type="tel" value={form.phone} onChange={e => update('phone', e.target.value)} />
              </div>
            </div>

            <div className="asm-row">
              <div className="asm-field">
                <label>Birthday</label>
                <input type="date" value={form.birthday} onChange={e => update('birthday', e.target.value)} />
              </div>
              <div className="asm-field">
                <label>Grade Level</label>
                <select value={form.gradeLevel} onChange={e => update('gradeLevel', e.target.value)}>
                  <option value="">Select...</option>
                  {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            </div>

            <div className="asm-field">
              <label>Allergies</label>
              <input type="text" placeholder="e.g. Peanuts, Shellfish (or leave blank)" value={form.allergies} onChange={e => update('allergies', e.target.value)} />
            </div>

            <div className="asm-field">
              <label>Family Assignment</label>
              <select value={form.familyId} onChange={e => update('familyId', e.target.value)}>
                <option value="">No Family</option>
                {families.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>

            <div className="asm-field">
              <label>Accommodation Notes</label>
              <textarea
                placeholder="Visible to teachers on the roster..."
                value={form.accommodationNotes}
                onChange={e => update('accommodationNotes', e.target.value)}
                rows={3}
              />
            </div>
          </div>
        </div>

        <div className="asm-footer">
          <button className="action-btn outline" onClick={onClose}>Cancel</button>
          <button className="action-btn primary" onClick={handleSave} disabled={saving || !canSave}>
            <Check size={16} /> {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditStudentModal;
