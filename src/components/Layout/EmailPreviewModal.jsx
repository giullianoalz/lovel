import React, { useState, useEffect, useRef } from 'react';
import { X, Send } from 'lucide-react';
import api from '../../lib/api';
import './EmailPreviewModal.css';

const PREVIEW_ENDPOINT = {
  invite: '/email/preview/invite',
  billing: '/email/preview/billing',
  invoice: '/email/preview/invoice',
};
const PREVIEW_DEBOUNCE_MS = 400;

/**
 * Lets an admin read and edit an email before it goes out.
 *
 * Every email the academy sends to a family passes through here — nothing
 * addressed to a parent leaves without someone having read it first. Only the
 * subject and the opening message are editable; the action button, the
 * expiry notes, and the billing figures are built by the server, because those
 * aren't copy — they're what makes the email work and what the family owes.
 *
 * The right-hand pane renders the *actual* email template the server would
 * send — same builder function, same logo, same colors — not a mockup of it,
 * so what an admin approves here is what a family gets.
 *
 * @param {Array}  recipients      [{ id, fullName, email }] — drives the header.
 * @param {string} defaultSubject  Prefilled subject line.
 * @param {string} defaultMessage  Prefilled body paragraph.
 * @param {string} [note]          Extra line explaining what stays fixed.
 * @param {'invite'|'billing'|'invoice'} previewType    Which template to render.
 * @param {object} previewContext  Fields the template needs besides subject/message
 *                                 (e.g. { fullName, isReminder } or { studentName, className, request, term }).
 */
const EmailPreviewModal = ({
  recipients,
  defaultSubject,
  defaultMessage,
  note,
  previewType,
  previewContext,
  onClose,
  onConfirm,
  sending,
}) => {
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);
  const [previewHtml, setPreviewHtml] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState(null);
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);

  const canSend = subject.trim().length > 0 && message.trim().length > 0 && !sending;

  useEffect(() => {
    if (!previewType) return undefined;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const thisRequest = ++requestIdRef.current;
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const res = await api.post(PREVIEW_ENDPOINT[previewType], { subject, message, ...previewContext });
        // A slower, stale response landing after a newer one would flicker the
        // preview backwards — only the most recent request may write state.
        if (thisRequest === requestIdRef.current) setPreviewHtml(res.data.html);
      } catch (err) {
        if (thisRequest === requestIdRef.current) {
          setPreviewError(err.userMessage || "Couldn't render the preview.");
        }
      } finally {
        if (thisRequest === requestIdRef.current) setPreviewLoading(false);
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
    // previewContext is an object literal from the caller on every render;
    // stringify it so the effect only re-fires when its actual content changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, message, previewType, JSON.stringify(previewContext)]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content iep-modal" onClick={(e) => e.stopPropagation()}>
        <div className="iep-header">
          <div>
            <h2>Review before sending</h2>
            <p>
              {recipients.length === 1
                ? `To ${recipients[0].fullName} (${recipients[0].email})`
                : `To ${recipients.length} people`}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>

        <div className="iep-split">
          <div className="iep-body">
            <label className="iep-label" htmlFor="iep-subject">Subject</label>
            <input
              id="iep-subject"
              className="iep-input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={150}
            />

            <label className="iep-label" htmlFor="iep-message">Message</label>
            <textarea
              id="iep-message"
              className="iep-textarea"
              rows={6}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={2000}
            />

            <p className="iep-note">
              {note || "The academy logo, the action button and the footer are added automatically and can't be edited here — only the subject and this message."}
            </p>

            {recipients.length > 1 && (
              <details className="iep-recipients">
                <summary>{recipients.length} recipients</summary>
                <ul>
                  {recipients.map((r) => (
                    <li key={r.id}>{r.fullName} — {r.email}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {previewType && (
            <div className="iep-preview-pane">
              <div className="iep-preview-label">
                Preview — exactly what a family would see
                {previewLoading && <span className="iep-preview-spinner" aria-hidden="true" />}
              </div>
              <div className="iep-preview-frame-wrap">
                {previewError ? (
                  <div className="iep-preview-error">{previewError}</div>
                ) : (
                  <iframe
                    title="Email preview"
                    className="iep-preview-frame"
                    srcDoc={previewHtml || ''}
                    sandbox=""
                  />
                )}
              </div>
            </div>
          )}
        </div>

        <div className="iep-footer">
          <button className="iep-btn-secondary" onClick={onClose} disabled={sending}>Cancel</button>
          <button
            className="iep-btn-primary"
            onClick={() => onConfirm({ subject: subject.trim(), message: message.trim() })}
            disabled={!canSend}
          >
            <Send size={15} /> {sending ? 'Sending…' : `Send${recipients.length > 1 ? ` to ${recipients.length}` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EmailPreviewModal;
