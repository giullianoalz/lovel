import React, { useState, useEffect, useRef } from 'react';
import { Camera, Star, Zap, Upload, X, Check, Calendar, Image, ChevronDown, Eye, Clock, User, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import api from '../../lib/api';
import { useToast } from '../Layout/ToastProvider';
import ProtectedImage from '../Layout/ProtectedImage';
import './MarketingHub.css';

const MarketingHub = () => {
  const { hasRole } = useAuth();
  const toast = useToast();
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('submit'); // 'submit' | 'gallery'
  const [filterWeek, setFilterWeek] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  // { photos: [...], index } — the whole submission travels with the lightbox
  // so a card showing only its first four thumbs can still be paged through.
  const [lightbox, setLightbox] = useState(null);

  // Submit form state
  const [photoFiles, setPhotoFiles] = useState([]);
  const [photoPreviews, setPhotoPreviews] = useState([]);
  const [photoDescription, setPhotoDescription] = useState('');
  const [sotwForm, setSotwForm] = useState({ title: '', description: '', photos: [], previews: [] });
  const [aotwForm, setAotwForm] = useState({ title: '', description: '', photos: [], previews: [] });
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const photoInputRef = useRef(null);
  const sotwInputRef = useRef(null);
  const aotwInputRef = useRef(null);

  const getThisFriday = () => {
    const now = new Date();
    const day = now.getDay();
    const diff = (5 - day + 7) % 7 || 7; // days until next Friday, or 7 if today is Friday
    const friday = new Date(now);
    if (day === 5) return friday.toISOString().split('T')[0]; // Today is Friday
    friday.setDate(now.getDate() + diff);
    return friday.toISOString().split('T')[0];
  };

  const loadSubmissions = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterWeek) params.weekOf = filterWeek;
      const response = await api.get('/marketing/submissions', { params });
      setSubmissions(response.data.submissions);
    } catch (error) {
      console.error('Error loading submissions:', error);
    }
    setLoading(false);
  };

  useEffect(() => { loadSubmissions(); }, [filterWeek]);

  const stepLightbox = (delta) => {
    setLightbox(prev => {
      if (!prev) return prev;
      const next = (prev.index + delta + prev.photos.length) % prev.photos.length;
      return { ...prev, index: next };
    });
  };

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setLightbox(null);
      if (e.key === 'ArrowRight') stepLightbox(1);
      if (e.key === 'ArrowLeft') stepLightbox(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  // Matches the server's upload.array('photos', 20) — a block that goes over
  // this gets rejected as one request with no partial success, so the cap has
  // to be enforced here too, before a teacher fills out the whole form only to
  // have the submit fail.
  //
  // iOS Safari's own photo picker limits how many images it hands back from a
  // single "Photo Library" pick (a phone with a big camera roll may cap that
  // well under 20). That's the OS, not this page — nothing here can raise it.
  // What this page can do is make adding a second round obvious, since the
  // dropzone and "Add Photo" already accumulate across picks with no extra
  // step needed.
  const MAX_PHOTOS_PER_BLOCK = 20;

  // Photo handlers
  const handlePhotoSelect = (e, target) => {
    const incoming = Array.from(e.target.files);
    const current = target === 'bulk' ? photoFiles : target === 'sotw' ? sotwForm.photos : aotwForm.photos;
    const room = MAX_PHOTOS_PER_BLOCK - current.length;
    const files = incoming.slice(0, Math.max(room, 0));
    if (files.length < incoming.length) {
      toast.error(`Only added ${files.length} of ${incoming.length} photos — a submission can hold up to ${MAX_PHOTOS_PER_BLOCK}.`);
    }
    // Clear the input so selecting the same photos again (e.g. after being
    // trimmed by the cap above) still fires a change event.
    e.target.value = '';
    const previews = files.map(f => URL.createObjectURL(f));

    if (target === 'bulk') {
      setPhotoFiles(prev => [...prev, ...files]);
      setPhotoPreviews(prev => [...prev, ...previews]);
    } else if (target === 'sotw') {
      setSotwForm(prev => ({ ...prev, photos: [...prev.photos, ...files], previews: [...prev.previews, ...previews] }));
    } else if (target === 'aotw') {
      setAotwForm(prev => ({ ...prev, photos: [...prev.photos, ...files], previews: [...prev.previews, ...previews] }));
    }
  };

  const removePhoto = (index, target) => {
    if (target === 'bulk') {
      setPhotoFiles(prev => prev.filter((_, i) => i !== index));
      setPhotoPreviews(prev => { URL.revokeObjectURL(prev[index]); return prev.filter((_, i) => i !== index); });
    } else if (target === 'sotw') {
      setSotwForm(prev => ({
        ...prev,
        photos: prev.photos.filter((_, i) => i !== index),
        previews: (() => { URL.revokeObjectURL(prev.previews[index]); return prev.previews.filter((_, i) => i !== index); })(),
      }));
    } else if (target === 'aotw') {
      setAotwForm(prev => ({
        ...prev,
        photos: prev.photos.filter((_, i) => i !== index),
        previews: (() => { URL.revokeObjectURL(prev.previews[index]); return prev.previews.filter((_, i) => i !== index); })(),
      }));
    }
  };

  // Every submission must say what the activity was; blank ones are what filled
  // the gallery with "Weekly Photos" entries nobody could interpret.
  // `requiresPhotos` marks the block whose photos ARE the content — a Weekly
  // Photos card without images is the blank entry that made the gallery
  // unreadable. Student/Activity of the Week carry their meaning in the text,
  // so there photos stay optional.
  const blocks = [
    { key: 'photos', label: 'Weekly Photos', type: 'PHOTOS', title: 'Weekly Photos', description: photoDescription, photos: photoFiles, requiresPhotos: true },
    { key: 'sotw', label: 'Student of the Week', type: 'STUDENT_OF_WEEK', title: sotwForm.title, description: sotwForm.description, photos: sotwForm.photos, requiresPhotos: false },
    { key: 'aotw', label: 'Activity of the Week', type: 'ACTIVITY_OF_WEEK', title: aotwForm.title, description: aotwForm.description, photos: aotwForm.photos, requiresPhotos: false },
  ];
  // "Started" = the teacher put something in this card, so it must be completed
  // rather than silently skipped. The photos card has no title of its own.
  const isStarted = (b) => b.photos.length > 0 || !!b.description.trim() || (b.key !== 'photos' && !!b.title.trim());
  const missingFor = (b) => {
    const missing = [];
    if (b.requiresPhotos && b.photos.length === 0) missing.push('at least one photo');
    if (!b.title.trim()) missing.push(b.key === 'sotw' ? "the student's name" : 'a title');
    if (!b.description.trim()) missing.push('a description of the activity');
    return missing;
  };
  const startedBlocks = blocks.filter(isStarted);
  const incompleteBlocks = startedBlocks.filter(b => missingFor(b).length > 0);
  const canSubmit = startedBlocks.length > 0 && incompleteBlocks.length === 0;

  const uploadPhotosForSubmission = async (submissionId, files) => {
    if (files.length === 0) return;
    const formData = new FormData();
    files.forEach(f => formData.append('photos', f));
    await api.post(`/marketing/submissions/${submissionId}/photos`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  };

  // Create-then-upload isn't atomic, so a failed upload used to leave a blank
  // submission behind forever. Discard it when the photos were the whole point;
  // otherwise keep the record — its text is still worth posting — and warn.
  const submitBlock = async (weekOf, block) => {
    const res = await api.post('/marketing/submissions', {
      weekOf,
      type: block.type,
      title: block.title.trim(),
      description: block.description.trim(),
    });
    const submissionId = res.data.submission.id;
    try {
      await uploadPhotosForSubmission(submissionId, block.photos);
    } catch (uploadError) {
      if (!block.requiresPhotos) {
        toast.error(`${block.label} was saved, but its photos could not be uploaded.`);
        return;
      }
      try {
        await api.delete(`/marketing/submissions/${submissionId}`);
      } catch (cleanupError) {
        console.error('Could not roll back the empty submission:', cleanupError);
      }
      throw uploadError;
    }
  };

  const handleSubmitAll = async () => {
    if (!canSubmit) return;
    const weekOf = getThisFriday();
    setSubmitting(true);
    setSubmitSuccess(false);

    try {
      for (const block of startedBlocks) {
        await submitBlock(weekOf, block);
      }

      // Reset all
      setPhotoFiles([]); setPhotoPreviews([]); setPhotoDescription('');
      setSotwForm({ title: '', description: '', photos: [], previews: [] });
      setAotwForm({ title: '', description: '', photos: [], previews: [] });
      setSubmitSuccess(true);
      setTimeout(() => setSubmitSuccess(false), 4000);
      await loadSubmissions();
    } catch (error) {
      console.error('Error submitting:', error);
      toast.error(error.response?.data?.message || 'Error submitting content. Please try again.');
    }
    setSubmitting(false);
  };

  const handleApprove = async (id) => {
    try {
      await api.patch(`/marketing/submissions/${id}`, { status: 'approved' });
      await loadSubmissions();
    } catch (error) {
      console.error('Error approving:', error);
    }
  };

  const handleMarkPosted = async (id) => {
    try {
      await api.patch(`/marketing/submissions/${id}`, { status: 'posted' });
      await loadSubmissions();
    } catch (error) {
      console.error('Error marking as posted:', error);
    }
  };

  const handleDelete = async (sub) => {
    const photoCount = sub.photos?.length || 0;
    const what = sub.title ? `"${sub.title}"` : 'this submission';
    if (!window.confirm(
      `Delete ${what}${photoCount > 0 ? ` and its ${photoCount} photo${photoCount === 1 ? '' : 's'}` : ''}? ` +
      'The photos are removed from Drive too. This cannot be undone.'
    )) return;

    setDeletingId(sub.id);
    try {
      await api.delete(`/marketing/submissions/${sub.id}`);
      toast.success('Submission deleted.');
      await loadSubmissions();
    } catch (error) {
      console.error('Error deleting submission:', error);
      toast.error(error.response?.data?.message || 'Could not delete this submission.');
    }
    setDeletingId(null);
  };

  const typeConfig = {
    PHOTOS: { label: 'Weekly Photos', icon: <Camera size={16} />, color: '#3b82f6', bg: '#dbeafe' },
    STUDENT_OF_WEEK: { label: 'Student of the Week', icon: <Star size={16} />, color: '#f59e0b', bg: '#fef3c7' },
    ACTIVITY_OF_WEEK: { label: 'Activity of the Week', icon: <Zap size={16} />, color: '#8b5cf6', bg: '#ede9fe' },
  };

  const statusStyles = {
    submitted: { label: 'Pending Review', color: '#64748b', bg: '#f1f5f9' },
    approved: { label: 'Approved', color: '#10b981', bg: '#d1fae5' },
    posted: { label: 'Posted', color: '#6366f1', bg: '#e0e7ff' },
  };
  const statusOrder = ['submitted', 'approved', 'posted'];

  return (
    <div className="marketing-container">
      <header className="marketing-header">
        <div>
          <p className="text-muted">Weekly photo uploads, Student & Activity of the Week submissions.</p>
        </div>
      </header>

      {/* Section Tabs */}
      <div className="mkt-tabs">
        <button className={`mkt-tab ${activeSection === 'submit' ? 'active' : ''}`} onClick={() => setActiveSection('submit')}>
          <Upload size={14} /> Friday Submission
        </button>
        <button className={`mkt-tab ${activeSection === 'gallery' ? 'active' : ''}`} onClick={() => setActiveSection('gallery')}>
          <Eye size={14} /> All Submissions
        </button>
      </div>

      {/* Submit Section (Teacher Friday Form) */}
      {activeSection === 'submit' && (
        <div className="submit-section">
          {submitSuccess && (
            <div className="success-banner">
              <Check size={18} />
              <span>All content submitted successfully! Your manager will review it soon.</span>
            </div>
          )}

          <div className="submission-grid">
            {/* Bulk Photo Upload */}
            <div className="submission-card photos-card">
              <div className="card-icon-header">
                <div className="card-icon" style={{ background: '#dbeafe', color: '#3b82f6' }}>
                  <Camera size={22} />
                </div>
                <h3>Weekly Photos</h3>
              </div>
              <p className="card-subtitle">Upload student photos from this week's activities.</p>

              <div
                className="dropzone"
                onClick={() => photoInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); handlePhotoSelect({ target: { files: e.dataTransfer.files } }, 'bulk'); }}
              >
                <Image size={32} />
                <span>Drag photos here or click to browse</span>
                <span className="dropzone-hint">JPG, PNG, WEBP — up to 10MB each</span>
                <input ref={photoInputRef} type="file" accept="image/*" multiple hidden onChange={(e) => handlePhotoSelect(e, 'bulk')} />
              </div>

              {photoPreviews.length > 0 && (
                <div className="photo-grid">
                  {photoPreviews.map((url, i) => (
                    <div key={i} className="photo-thumb">
                      <img src={url} alt={`Photo ${i + 1}`} />
                      <button className="remove-thumb" onClick={() => removePhoto(i, 'bulk')}><X size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
              <div className="photo-count">
                {photoFiles.length} of {MAX_PHOTOS_PER_BLOCK} photo{photoFiles.length !== 1 ? 's' : ''} selected
                {photoFiles.length > 0 && photoFiles.length < MAX_PHOTOS_PER_BLOCK && (
                  <span className="photo-count-hint"> — if your phone only lets you pick a few at a time, tap here again to add more</span>
                )}
              </div>

              <textarea
                className="form-control"
                rows="3"
                placeholder="What activity are these photos from? Which class or group?"
                value={photoDescription}
                onChange={(e) => setPhotoDescription(e.target.value)}
              />
            </div>

            {/* Student of the Week */}
            <div className="submission-card sotw-card">
              <div className="card-icon-header">
                <div className="card-icon" style={{ background: '#fef3c7', color: '#f59e0b' }}>
                  <Star size={22} />
                </div>
                <h3>Student of the Week</h3>
              </div>

              <div className="mini-form">
                <input
                  type="text"
                  className="form-control"
                  placeholder="Student's name..."
                  value={sotwForm.title}
                  onChange={(e) => setSotwForm({ ...sotwForm, title: e.target.value })}
                />
                <textarea
                  className="form-control"
                  rows="3"
                  placeholder="Why is this student special this week?"
                  value={sotwForm.description}
                  onChange={(e) => setSotwForm({ ...sotwForm, description: e.target.value })}
                />
                <button className="mini-upload-btn" onClick={() => sotwInputRef.current?.click()}>
                  <Camera size={14} /> Add Photo
                </button>
                <input ref={sotwInputRef} type="file" accept="image/*" multiple hidden onChange={(e) => handlePhotoSelect(e, 'sotw')} />
                {sotwForm.previews.length > 0 && (
                  <div className="photo-grid mini-grid">
                    {sotwForm.previews.map((url, i) => (
                      <div key={i} className="photo-thumb">
                        <img src={url} alt="" />
                        <button className="remove-thumb" onClick={() => removePhoto(i, 'sotw')}><X size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Activity of the Week */}
            <div className="submission-card aotw-card">
              <div className="card-icon-header">
                <div className="card-icon" style={{ background: '#ede9fe', color: '#8b5cf6' }}>
                  <Zap size={22} />
                </div>
                <h3>Activity of the Week</h3>
              </div>

              <div className="mini-form">
                <input
                  type="text"
                  className="form-control"
                  placeholder="Activity name..."
                  value={aotwForm.title}
                  onChange={(e) => setAotwForm({ ...aotwForm, title: e.target.value })}
                />
                <textarea
                  className="form-control"
                  rows="3"
                  placeholder="Describe the activity and what students learned..."
                  value={aotwForm.description}
                  onChange={(e) => setAotwForm({ ...aotwForm, description: e.target.value })}
                />
                <button className="mini-upload-btn" onClick={() => aotwInputRef.current?.click()}>
                  <Camera size={14} /> Add Photo
                </button>
                <input ref={aotwInputRef} type="file" accept="image/*" multiple hidden onChange={(e) => handlePhotoSelect(e, 'aotw')} />
                {aotwForm.previews.length > 0 && (
                  <div className="photo-grid mini-grid">
                    {aotwForm.previews.map((url, i) => (
                      <div key={i} className="photo-thumb">
                        <img src={url} alt="" />
                        <button className="remove-thumb" onClick={() => removePhoto(i, 'aotw')}><X size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {incompleteBlocks.length > 0 && (
            <div className="submit-warnings">
              {incompleteBlocks.map(b => (
                <p key={b.key}><strong>{b.label}</strong> still needs {missingFor(b).join(', ')}.</p>
              ))}
            </div>
          )}

          <div className="submit-footer">
            <div className="week-indicator">
              <Calendar size={14} />
              <span>Submitting for week of: <strong>{getThisFriday()}</strong></span>
            </div>
            <button
              className="submit-all-btn"
              onClick={handleSubmitAll}
              disabled={submitting || !canSubmit}
            >
              {submitting ? 'Submitting...' : 'Submit All Content'}
            </button>
          </div>
        </div>
      )}

      {/* Gallery / Admin Review Section */}
      {activeSection === 'gallery' && (
        <div className="gallery-section">
          <div className="gallery-filters">
            <input
              type="date"
              className="form-control"
              value={filterWeek}
              onChange={(e) => setFilterWeek(e.target.value)}
              style={{ maxWidth: '200px' }}
            />
            <button className="btn-clear-filter" onClick={() => setFilterWeek('')}>Show All</button>
          </div>

          {loading ? (
            <div className="gallery-loading"><span className="app-inline-loader"><span className="app-spinner-sm" />Loading submissions…</span></div>
          ) : submissions.length === 0 ? (
            <div className="gallery-empty">
              <Camera size={40} />
              <p>No submissions found for this period.</p>
            </div>
          ) : (
            // Grouped by status (not one flat grid) so approving/posting visibly
            // moves a card into the next column instead of just relabeling it in place.
            statusOrder.map(statusKey => {
              const group = submissions.filter(s => s.status === statusKey);
              if (group.length === 0) return null;
              const ss = statusStyles[statusKey];

              return (
                <div key={statusKey} className="status-group">
                  <div className="status-group-header">
                    <span className="status-label" style={{ background: ss.bg, color: ss.color }}>{ss.label}</span>
                    <span className="status-group-count">{group.length}</span>
                  </div>
                  <div className="gallery-grid">
                    {group.map(sub => {
                      const tc = typeConfig[sub.type] || typeConfig.PHOTOS;
                      const date = new Date(sub.createdAt);

                      return (
                        <div key={sub.id} className="gallery-card">
                          <div className="gallery-card-header">
                            <span className="type-label" style={{ background: tc.bg, color: tc.color }}>
                              {tc.icon} {tc.label}
                            </span>
                          </div>

                          {sub.title && <h4 className="gallery-title">{sub.title}</h4>}
                          {sub.description && <p className="gallery-desc">{sub.description}</p>}

                          {sub.photos && sub.photos.length > 0 && (
                            <div className="gallery-photos">
                              {sub.photos.slice(0, 4).map((photo, i) => (
                                <button
                                  key={photo.id}
                                  type="button"
                                  className="gallery-photo-thumb"
                                  title="Click to view full size"
                                  onClick={() => setLightbox({ photos: sub.photos, index: i })}
                                >
                                  <ProtectedImage apiPath={`/marketing/photos/${photo.id}/file`} alt={photo.fileName} />
                                  {i === 3 && sub.photos.length > 4 && (
                                    <div className="more-overlay">+{sub.photos.length - 4}</div>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}

                          <div className="gallery-card-footer">
                            <div className="gallery-meta">
                              <span><User size={12} /> {sub.teacher?.fullName}</span>
                              <span><Clock size={12} /> {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                            </div>
                            {hasRole('ADMIN') && (
                              <div className="gallery-actions">
                                {sub.status === 'submitted' && (
                                  <button className="approve-btn" onClick={() => handleApprove(sub.id)}>
                                    <Check size={14} /> Approve
                                  </button>
                                )}
                                {sub.status === 'approved' && (
                                  <button className="posted-btn" onClick={() => handleMarkPosted(sub.id)}>
                                    Mark as Posted
                                  </button>
                                )}
                                <button
                                  className="delete-btn"
                                  title="Delete this submission and its photos"
                                  disabled={deletingId === sub.id}
                                  onClick={() => handleDelete(sub)}
                                >
                                  <Trash2 size={14} /> {deletingId === sub.id ? 'Deleting…' : 'Delete'}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {lightbox && (
        <div className="mkt-lightbox" onClick={() => setLightbox(null)} role="dialog" aria-modal="true">
          <button className="mkt-lightbox-close" aria-label="Close" onClick={() => setLightbox(null)}>
            <X size={22} />
          </button>

          {lightbox.photos.length > 1 && (
            <button
              className="mkt-lightbox-nav prev"
              aria-label="Previous photo"
              onClick={(e) => { e.stopPropagation(); stepLightbox(-1); }}
            >
              <ChevronLeft size={26} />
            </button>
          )}

          <ProtectedImage
            key={lightbox.photos[lightbox.index].id}
            apiPath={`/marketing/photos/${lightbox.photos[lightbox.index].id}/file`}
            alt={lightbox.photos[lightbox.index].fileName}
            className="mkt-lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />

          {lightbox.photos.length > 1 && (
            <>
              <button
                className="mkt-lightbox-nav next"
                aria-label="Next photo"
                onClick={(e) => { e.stopPropagation(); stepLightbox(1); }}
              >
                <ChevronRight size={26} />
              </button>
              <div className="mkt-lightbox-count">{lightbox.index + 1} / {lightbox.photos.length}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default MarketingHub;
