import React, { useState, useEffect, useRef } from 'react';
import { Camera, Star, Zap, Upload, X, Check, Calendar, Image, ChevronDown, Eye, Clock, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import api from '../../lib/api';
import { useToast } from '../Layout/ToastProvider';
import ProtectedImage from '../Layout/ProtectedImage';
import './MarketingHub.css';

const MarketingHub = () => {
  const { role } = useAuth();
  const toast = useToast();
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('submit'); // 'submit' | 'gallery'
  const [filterWeek, setFilterWeek] = useState('');

  // Submit form state
  const [photoFiles, setPhotoFiles] = useState([]);
  const [photoPreviews, setPhotoPreviews] = useState([]);
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

  // Photo handlers
  const handlePhotoSelect = (e, target) => {
    const files = Array.from(e.target.files);
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

  const uploadPhotosForSubmission = async (submissionId, files) => {
    if (files.length === 0) return;
    const formData = new FormData();
    files.forEach(f => formData.append('photos', f));
    await api.post(`/marketing/submissions/${submissionId}/photos`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  };

  const handleSubmitAll = async () => {
    const weekOf = getThisFriday();
    setSubmitting(true);
    setSubmitSuccess(false);

    try {
      // 1. Bulk photos
      if (photoFiles.length > 0) {
        const res = await api.post('/marketing/submissions', { weekOf, type: 'PHOTOS', title: 'Weekly Photos' });
        await uploadPhotosForSubmission(res.data.submission.id, photoFiles);
      }

      // 2. Student of the Week
      if (sotwForm.title) {
        const res = await api.post('/marketing/submissions', {
          weekOf, type: 'STUDENT_OF_WEEK',
          title: sotwForm.title,
          description: sotwForm.description,
        });
        if (sotwForm.photos.length > 0) {
          await uploadPhotosForSubmission(res.data.submission.id, sotwForm.photos);
        }
      }

      // 3. Activity of the Week
      if (aotwForm.title) {
        const res = await api.post('/marketing/submissions', {
          weekOf, type: 'ACTIVITY_OF_WEEK',
          title: aotwForm.title,
          description: aotwForm.description,
        });
        if (aotwForm.photos.length > 0) {
          await uploadPhotosForSubmission(res.data.submission.id, aotwForm.photos);
        }
      }

      // Reset all
      setPhotoFiles([]); setPhotoPreviews([]);
      setSotwForm({ title: '', description: '', photos: [], previews: [] });
      setAotwForm({ title: '', description: '', photos: [], previews: [] });
      setSubmitSuccess(true);
      setTimeout(() => setSubmitSuccess(false), 4000);
      await loadSubmissions();
    } catch (error) {
      console.error('Error submitting:', error);
      toast.error('Error submitting content. Please try again.');
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

  const typeConfig = {
    PHOTOS: { label: 'Weekly Photos', icon: <Camera size={16} />, color: '#3b82f6', bg: '#dbeafe' },
    STUDENT_OF_WEEK: { label: 'Student of the Week', icon: <Star size={16} />, color: '#f59e0b', bg: '#fef3c7' },
    ACTIVITY_OF_WEEK: { label: 'Activity of the Week', icon: <Zap size={16} />, color: '#8b5cf6', bg: '#ede9fe' },
  };

  const statusStyles = {
    submitted: { label: 'Submitted', color: '#64748b', bg: '#f1f5f9' },
    approved: { label: 'Approved', color: '#10b981', bg: '#d1fae5' },
    posted: { label: 'Posted', color: '#6366f1', bg: '#e0e7ff' },
  };

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
              <div className="photo-count">{photoFiles.length} photo{photoFiles.length !== 1 ? 's' : ''} selected</div>
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

          <div className="submit-footer">
            <div className="week-indicator">
              <Calendar size={14} />
              <span>Submitting for week of: <strong>{getThisFriday()}</strong></span>
            </div>
            <button
              className="submit-all-btn"
              onClick={handleSubmitAll}
              disabled={submitting || (photoFiles.length === 0 && !sotwForm.title && !aotwForm.title)}
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
            <div className="gallery-grid">
              {submissions.map(sub => {
                const tc = typeConfig[sub.type] || typeConfig.PHOTOS;
                const ss = statusStyles[sub.status] || statusStyles.submitted;
                const date = new Date(sub.createdAt);

                return (
                  <div key={sub.id} className="gallery-card">
                    <div className="gallery-card-header">
                      <span className="type-label" style={{ background: tc.bg, color: tc.color }}>
                        {tc.icon} {tc.label}
                      </span>
                      <span className="status-label" style={{ background: ss.bg, color: ss.color }}>
                        {ss.label}
                      </span>
                    </div>

                    {sub.title && <h4 className="gallery-title">{sub.title}</h4>}
                    {sub.description && <p className="gallery-desc">{sub.description}</p>}

                    {sub.photos && sub.photos.length > 0 && (
                      <div className="gallery-photos">
                        {sub.photos.slice(0, 4).map((photo, i) => (
                          <div key={photo.id} className="gallery-photo-thumb">
                            <ProtectedImage apiPath={`/marketing/photos/${photo.id}/file`} alt={photo.fileName} />
                            {i === 3 && sub.photos.length > 4 && (
                              <div className="more-overlay">+{sub.photos.length - 4}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="gallery-card-footer">
                      <div className="gallery-meta">
                        <span><User size={12} /> {sub.teacher?.fullName}</span>
                        <span><Clock size={12} /> {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      </div>
                      {role === 'ADMIN' && (
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
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MarketingHub;
