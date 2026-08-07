import React, { useState } from 'react';
import { X, Send } from 'lucide-react';
import './EmailPreviewModal.css';

/**
 * Lets an admin read and edit an email before it goes out.
 *
 * Every email the academy sends to a family passes through here — nothing
 * addressed to a parent leaves without someone having read it first. Only the
 * subject and the opening message are editable; the action button, the
 * expiry notes, and the billing figures are built by the server, because those
 * aren't copy — they're what makes the email work and what the family owes.
 *
 * @param {Array}  recipients     [{ id, fullName, email }] — drives the header.
 * @param {string} defaultSubject Prefilled subject line.
 * @param {string} defaultMessage Prefilled body paragraph.
 * @param {string} [note]         Extra line explaining what stays fixed.
 */
const EmailPreviewModal = ({
  recipients,
  defaultSubject,
  defaultMessage,
  note,
  onClose,
  onConfirm,
  sending,
}) => {
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);

  const canSend = subject.trim().length > 0 && message.trim().length > 0 && !sending;

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
