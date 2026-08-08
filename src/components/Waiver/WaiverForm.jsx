import React, { useEffect, useState } from 'react';
import { X, FileSignature, ShieldCheck, AlertCircle } from 'lucide-react';
import api from '../../lib/api';
import SignaturePad from './SignaturePad';
import './WaiverForm.css';

/**
 * The liability waiver, shown in a modal for one child at a time.
 *
 * The wording is fetched from the server rather than kept here: the same array
 * is what the downloadable PDF is built from, and a signed record that shows
 * different text than the parent read would be worth nothing.
 */
const WaiverForm = ({ child, parentName = '', onClose, onSigned }) => {
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [guardian, setGuardian] = useState(parentName);
  const [signature, setSignature] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [photoOptOut, setPhotoOptOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/waivers/document')
      .then(res => { if (!cancelled) setDoc(res.data); })
      .catch(() => { if (!cancelled) setError('Could not load the waiver. Please try again.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const problem = () => {
    if (guardian.trim().length < 2) return 'Please enter your full name.';
    if (!signature) return 'Please draw your signature.';
    if (!agreed) return 'Please confirm that you have read and agree to the waiver.';
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const invalid = problem();
    if (invalid) { setError(invalid); return; }

    setError('');
    setSubmitting(true);
    try {
      const res = await api.post('/waivers', {
        studentId: child.id,
        minorName: child.fullName,
        parentName: guardian.trim(),
        signatureData: signature,
        photoOptOut,
      });
      onSigned?.(res.data);
    } catch (err) {
      console.error(err);
      setError(
        err?.response?.data?.message ||
        'Could not save your signature. Please try again.'
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="waiver-modal">
        <button className="modal-close" onClick={onClose}><X size={18} /></button>

        <div className="modal-header">
          <div className="modal-icon"><FileSignature size={22} /></div>
          <div>
            <h2>Liability Waiver</h2>
            <p>For {child?.fullName}. Please read in full before signing.</p>
          </div>
        </div>

        {loading ? (
          <div className="waiver-loading"><span className="pp-spinner" /> Loading waiver...</div>
        ) : (
          <form onSubmit={handleSubmit} className="waiver-form">
            <div className="waiver-doc">
              <h3 className="waiver-doc-title">{doc?.title}</h3>
              {doc?.sections?.map(section => (
                <section key={section.heading} className="waiver-section">
                  <h4>{section.heading}</h4>
                  {section.paragraphs?.map((p, i) => <p key={i}>{p}</p>)}
                  {section.bullets && (
                    <ul>{section.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
                  )}
                  {/* The paper form's opt-out is a blank line under this exact
                      section for the parent to hand-write "No Photos" on — the
                      checkbox belongs right there, not bundled with the other
                      fields below where it would read as just another input. */}
                  {section.heading === 'PHOTO & VIDEO RELEASE' && (
                    <label className="waiver-photo-optout">
                      <input
                        type="checkbox"
                        checked={photoOptOut}
                        onChange={e => setPhotoOptOut(e.target.checked)}
                      />
                      <span>No Photos — do not use {child?.fullName?.split(' ')[0]}'s photo or video.</span>
                    </label>
                  )}
                </section>
              ))}
            </div>

            <div className="waiver-fields">
              <div className="form-group">
                <label>Print Parent/Guardian Name *</label>
                <input type="text" value={guardian} onChange={e => setGuardian(e.target.value)} />
              </div>
            </div>

            <SignaturePad onChange={setSignature} disabled={submitting} />

            <label className="waiver-agree">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
              <span>
                I have read and understand this waiver, I am the parent or legal guardian
                of {child?.fullName}, and I am freely signing this agreement.
              </span>
            </label>

            {error && (
              <div className="waiver-error"><AlertCircle size={15} /> {error}</div>
            )}

            <button type="submit" className="pp-primary-btn" disabled={submitting}>
              {submitting ? 'Saving...' : <><ShieldCheck size={16} /> Sign waiver</>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default WaiverForm;
