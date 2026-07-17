import React, { useState, useEffect, useRef } from 'react';
import {
  Megaphone, MapPin, Users, Home, Camera, ClipboardList, Pin, Trash2,
  ImagePlus, X, Send, Plus, Bell, ChevronLeft, ChevronRight, Film,
} from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../Layout/ToastProvider';
import './AcademyFeed.css';

const CATEGORIES = [
  { value: 'general', label: 'General', icon: Megaphone, color: '#3b82f6' },
  { value: 'location_change', label: 'Location Change', icon: MapPin, color: '#f97316' },
  { value: 'staff_change', label: 'Staff Update', icon: Users, color: '#7c3aed' },
  { value: 'open_house', label: 'Open House', icon: Home, color: '#16a34a' },
  { value: 'marketing', label: 'Marketing', icon: Camera, color: '#db2777' },
  { value: 'registration', label: 'Registration', icon: ClipboardList, color: '#0d9488' },
];

const categoryMeta = (value) => CATEGORIES.find(c => c.value === value) || CATEGORIES[0];

const AUDIENCES = [
  { value: 'all', label: 'Everyone' },
  { value: 'parent', label: 'Parents Only' },
  { value: 'teacher', label: 'Teachers Only' },
];

const configuredApiUrl = import.meta.env.VITE_API_URL;
const isLocalDevDefault = !configuredApiUrl || configuredApiUrl === 'http://localhost:4000/api';
const BASE_API = isLocalDevDefault ? `http://${window.location.hostname}:4000/api` : configuredApiUrl;
const MEDIA_BASE = BASE_API.replace(/\/api\/?$/, '');

const timeAgo = (dateStr) => {
  const diffMs = new Date() - new Date(dateStr);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

/** Carousel for a post's photos/videos. Falls back to a single static item when there's just one. */
const MediaCarousel = ({ media, alt }) => {
  const [index, setIndex] = useState(0);
  if (!media || media.length === 0) return null;

  const item = media[index];
  const go = (delta) => setIndex((i) => (i + delta + media.length) % media.length);

  return (
    <div className="feed-carousel">
      {item.type === 'video' ? (
        <video className="feed-carousel-media" src={MEDIA_BASE + item.url} controls />
      ) : (
        <img className="feed-carousel-media" src={MEDIA_BASE + item.url} alt={alt} />
      )}
      {media.length > 1 && (
        <>
          <button className="feed-carousel-nav prev" onClick={() => go(-1)} aria-label="Previous">
            <ChevronLeft size={18} />
          </button>
          <button className="feed-carousel-nav next" onClick={() => go(1)} aria-label="Next">
            <ChevronRight size={18} />
          </button>
          <div className="feed-carousel-dots">
            {media.map((_, i) => (
              <button
                key={i}
                className={`feed-carousel-dot ${i === index ? 'active' : ''}`}
                onClick={() => setIndex(i)}
                aria-label={`Go to slide ${i + 1}`}
              />
            ))}
          </div>
          <span className="feed-carousel-count">{index + 1}/{media.length}</span>
        </>
      )}
    </div>
  );
};

const AcademyFeed = () => {
  const { user, role } = useAuth();
  const toast = useToast();
  const canPost = role === 'ADMIN';

  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  const [form, setForm] = useState({
    title: '', body: '', category: 'general', targetAudience: 'all', isPinned: false,
  });
  const [mediaItems, setMediaItems] = useState([]); // [{ file, preview, type }]

  const loadPosts = async () => {
    setLoading(true);
    try {
      const res = await api.get('/announcements');
      setPosts(res.data.announcements || []);
    } catch {
      toast.error('Could not load Announcements.');
    }
    setLoading(false);
  };

  useEffect(() => { loadPosts(); }, []);

  const handleMediaSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const next = files.slice(0, 10 - mediaItems.length).map(file => ({
      file,
      preview: URL.createObjectURL(file),
      type: file.type.startsWith('video/') ? 'video' : 'image',
    }));
    setMediaItems(prev => [...prev, ...next]);
    e.target.value = '';
  };

  const removeMediaItem = (idx) => {
    setMediaItems(prev => prev.filter((_, i) => i !== idx));
  };

  const clearComposer = () => {
    setForm({ title: '', body: '', category: 'general', targetAudience: 'all', isPinned: false });
    setMediaItems([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.body.trim()) return;
    setSubmitting(true);
    try {
      const data = new FormData();
      data.append('title', form.title);
      data.append('body', form.body);
      data.append('category', form.category);
      data.append('targetAudience', form.targetAudience);
      data.append('isPinned', form.isPinned);
      mediaItems.forEach(item => data.append('media', item.file));

      await api.post('/announcements', data, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Posted to Announcements!');
      clearComposer();
      setComposerOpen(false);
      await loadPosts();
    } catch {
      toast.error('Could not publish the post.');
    }
    setSubmitting(false);
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/announcements/${id}`);
      setPosts(prev => prev.filter(p => p.id !== id));
      toast.success('Post removed.');
    } catch {
      toast.error('Could not remove the post.');
    }
  };

  useEffect(() => {
    // Mark visible posts as read once loaded (lightweight — parents/teachers see it, admin doesn't need to)
    posts.forEach(p => {
      if (!p.isRead) {
        api.post(`/announcements/${p.id}/read`).catch(() => {});
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts.length]);

  return (
    <div className="feed-container">
      <header className="feed-header">
        <div>
          <h1><Megaphone size={24} /> Announcements</h1>
          <p>Location changes, staff updates, open houses, and news from the whole team — in one place.</p>
        </div>
        {canPost && !composerOpen && (
          <button className="feed-new-post-btn" onClick={() => setComposerOpen(true)}>
            <Plus size={16} /> New Post
          </button>
        )}
      </header>

      {canPost && composerOpen && (
        <div className="feed-composer">
          <input
            className="composer-title-input"
            placeholder="Headline (e.g. We're moving to a new location!)"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          />
          <textarea
            className="composer-body-input"
            placeholder="Share the details with parents and staff..."
            rows={4}
            value={form.body}
            onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
          />

          {mediaItems.length > 0 && (
            <div className="composer-media-grid">
              {mediaItems.map((item, idx) => (
                <div key={idx} className="composer-media-thumb">
                  {item.type === 'video' ? (
                    <video src={item.preview} muted />
                  ) : (
                    <img src={item.preview} alt={`Attachment ${idx + 1}`} />
                  )}
                  {item.type === 'video' && <span className="composer-media-video-tag"><Film size={12} /></span>}
                  <button onClick={() => removeMediaItem(idx)}><X size={12} /></button>
                </div>
              ))}
            </div>
          )}

          <div className="composer-footer-row">
            <button
              className="composer-image-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={mediaItems.length >= 10}
            >
              <ImagePlus size={16} /> {mediaItems.length > 0 ? 'Add More' : 'Add Photos / Video'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              hidden
              onChange={handleMediaSelect}
            />

            <select
              className="composer-audience-select"
              value={form.targetAudience}
              onChange={e => setForm(f => ({ ...f, targetAudience: e.target.value }))}
            >
              {AUDIENCES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>

            {role === 'ADMIN' && (
              <label className="composer-pin-toggle">
                <input
                  type="checkbox"
                  checked={form.isPinned}
                  onChange={e => setForm(f => ({ ...f, isPinned: e.target.checked }))}
                />
                <Pin size={13} /> Pin to top
              </label>
            )}
          </div>

          <div className="composer-actions">
            <button className="composer-cancel-btn" onClick={() => { clearComposer(); setComposerOpen(false); }}>Cancel</button>
            <button
              className="composer-submit-btn"
              onClick={handleSubmit}
              disabled={submitting || !form.title.trim() || !form.body.trim()}
            >
              <Send size={14} /> {submitting ? 'Posting...' : 'Post Announcement'}
            </button>
          </div>
        </div>
      )}

      <div className="feed-list">
        {loading ? (
          <div className="feed-empty">Loading Announcements...</div>
        ) : posts.length === 0 ? (
          <div className="feed-empty">
            <Megaphone size={32} />
            <p>No posts yet. {canPost ? 'Be the first to share an update!' : 'Check back soon for academy news.'}</p>
          </div>
        ) : (
          posts.map(post => {
            const cat = categoryMeta(post.category);
            const Icon = cat.icon;
            const canDelete = role === 'ADMIN' || post.authorId === user?.id;
            return (
              <div key={post.id} className={`feed-card ${post.isPinned ? 'pinned' : ''}`}>
                {post.isPinned && <div className="feed-pinned-tag"><Pin size={12} /> Pinned</div>}
                <div className="feed-card-top">
                  <div className="feed-card-author">
                    <div className="feed-avatar">{(post.author?.fullName || 'A')[0]}</div>
                    <div>
                      <strong>{post.author?.fullName || 'Academy'}</strong>
                      <div className="feed-card-meta">
                        <span className="feed-cat-badge" style={{ '--cat-color': cat.color }}>
                          <Icon size={12} /> {cat.label}
                        </span>
                        <span className="feed-time">{timeAgo(post.publishedAt)}</span>
                      </div>
                    </div>
                  </div>
                  {canDelete && (
                    <button className="feed-delete-btn" onClick={() => handleDelete(post.id)} title="Remove post">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>

                <h3 className="feed-card-title">{post.title}</h3>
                <p className="feed-card-body">{post.body}</p>

                {post.media && post.media.length > 0 ? (
                  <MediaCarousel media={post.media} alt={post.title} />
                ) : post.imageUrl && (
                  <img className="feed-card-image" src={MEDIA_BASE + post.imageUrl} alt={post.title} />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default AcademyFeed;
