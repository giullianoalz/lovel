import React, { useState } from 'react';
import { UserPlus } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

/**
 * "Add me as a teacher" — sits next to a teacher picker that is missing the
 * admin using it.
 *
 * A class can only be assigned to an account that holds the TEACHER role, so an
 * admin who runs a COVE or a tutoring slot herself was simply unassignable: she
 * never appeared in any of these dropdowns. One click grants her own account the
 * role and reloads the list, after which she is an ordinary option and this
 * button is gone.
 *
 * `teacherIds` is the list currently in the picker — the button hides itself as
 * soon as the caller's reload brings the account back in it.
 */
const AddSelfAsTeacher = ({ teacherIds = [], onAdded, onError }) => {
  const { user, hasRole } = useAuth();
  const [saving, setSaving] = useState(false);

  if (!user || !hasRole('ADMIN') || hasRole('TEACHER')) return null;
  if (teacherIds.includes(user.id)) return null;

  const handleClick = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/users/${user.id}/teaching-role`);
      // The parent owns the list, so it reloads it — and this button disappears
      // once the account comes back as an option.
      if (onAdded) await onAdded(user.id);
    } catch (error) {
      const message = error.response?.data?.message || 'Could not add you as a teacher.';
      if (onError) onError(message);
    }
    setSaving(false);
  };

  return (
    <button
      type="button"
      className="btn-text"
      onClick={handleClick}
      disabled={saving}
      title="Lets classes and sessions be assigned to your own account"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '4px 0' }}
    >
      <UserPlus size={14} />
      {saving ? 'Adding you…' : 'Add me as a teacher'}
    </button>
  );
};

export default AddSelfAsTeacher;
