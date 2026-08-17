import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, DoorOpen, RefreshCw } from 'lucide-react';
import api from '../../lib/api';
import ErrorBanner from '../Layout/ErrorBanner';
import './FamilyCodeModal.css';

/**
 * The household's standing check-in code — the QR shown at the door every day,
 * on the way in and on the way out.
 *
 * Different from the pickup authorisation in every way that matters: no date,
 * no named person, and it covers whoever in the family actually turned up. That
 * is only safe because the desk still picks which child it applies to, so a
 * permanent code can never mark a sibling present who stayed home.
 *
 * Shown in both portals: the parent has it on their phone, and a student old
 * enough to arrive alone has the same code on theirs. Only the parent may
 * replace it — doing so voids every saved copy.
 */
const FamilyCodeModal = ({ onClose, canRotate = false }) => {
  const [families, setFamilies] = useState(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState(null);
  const [rotating, setRotating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/portal/family/check-in-code')
      .then(({ data }) => { if (!cancelled) setFamilies(data.families); })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.message || 'Could not load your check-in code.');
      });
    return () => { cancelled = true; };
  }, []);

  const family = families?.[active] || null;

  const handleRotate = async () => {
    if (!family) return;
    // Every copy of the old QR stops working the instant this is written, and
    // that includes the one on the other parent's phone.
    if (!window.confirm('Replace this code? Every saved copy of the old QR will stop working.')) return;
    setRotating(true);
    try {
      const { data } = await api.post('/portal/family/check-in-code/rotate', { familyId: family.id });
      setFamilies((prev) => prev.map((f, i) => (i === active ? { ...f, code: data.code } : f)));
      setError(null);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not replace the code.');
    } finally {
      setRotating(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fcm-modal">
        <button className="fcm-close" onClick={onClose}><X size={18} /></button>

        <div className="fcm-header">
          <div className="fcm-icon"><DoorOpen size={22} /></div>
          <div>
            <h2>Check-In QR</h2>
            <p>Show this at the front desk on arrival and at pickup.</p>
          </div>
        </div>

        {error && <ErrorBanner message={error} />}

        {!families && !error && <p className="fcm-note">Loading your code&hellip;</p>}

        {families?.length === 0 && (
          <p className="fcm-note">
            This account isn&rsquo;t linked to a family yet — ask the front desk to connect it.
          </p>
        )}

        {family && (
          <div className="fcm-body">
            {families.length > 1 && (
              <select
                className="fcm-select"
                value={active}
                onChange={(e) => setActive(Number(e.target.value))}
              >
                {families.map((f, i) => <option key={f.id} value={i}>{f.name}</option>)}
              </select>
            )}

            <h3 className="fcm-family">{family.name}</h3>

            <div className="fcm-qr">
              <QRCodeSVG
                value={JSON.stringify({ code: family.code })}
                size={220} bgColor="#ffffff" fgColor="#1e293b" level="M" includeMargin
              />
            </div>

            <p className="fcm-note">
              This code doesn&rsquo;t expire. Save it to your phone — the desk checks in whichever
              children are with you.
            </p>

            <div className="fcm-actions">
              {canRotate && (
                <button className="fcm-btn" disabled={rotating} onClick={handleRotate}>
                  <RefreshCw size={14} /> {rotating ? 'Replacing…' : 'Replace code'}
                </button>
              )}
              <button className="fcm-btn fcm-btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FamilyCodeModal;
