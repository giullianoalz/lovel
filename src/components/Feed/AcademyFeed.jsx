import React, { useState, useEffect, useRef } from 'react';
import {
  Megaphone, MapPin, Users, Home, Camera, ClipboardList, Pin, Trash2,
  ImagePlus, ImageOff, X, Send, Plus, Bell, ChevronLeft, ChevronRight, Film, Pencil,
  Clock, Check, Undo2,
} from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../Layout/ToastProvider';
import Linkified from '../../lib/linkify';
import { useProtectedMedia } from '../../hooks/useProtectedMedia';
import './AcademyFeed.css';

const CATEGORIES = [
  { value: 'general', label: 'General', icon: Megaphone, color: '#3b82f6' },
  { value: 'location_change', label: 'Location Change', icon: MapPin, color: '#f97316' },
  { value: 'staff_change', label: 'Staff Update', icon: Users, color: '#7c3aed' },
  { value: 'open_house', label: 'Open House', icon: Home, color: '#16a34a' },
  { value: 'photo_update', label: 'Photo Update', icon: Camera, color: '#ec4899' },
  { value: 'curriculum', label: 'Curriculum', icon: ClipboardList, color: '#0891b2' },
];

const AUDIENCES = [
  { value: 'all',     label: '👥 Everyone' },
  { value: 'parent',  label: '👨‍👩‍👧 Parents only' },
  { value: 'teacher', label: '🍎 Staff only' },
];

const MEDIA_BASE = import.meta.env.VITE_API_URL?.replace('/api', '') ?? '';

const categoryMeta = (cat) => CATEGORIES.find(c => c.value === cat) || CATEGORIES[0];

const timeAgo = (iso) => {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
};

/* ── One carousel item ──
   Announcement media lives in Drive, not on a public /uploads path, so an
   <img src> can't reach it: the bytes come back through the API with our auth
   header and are rendered from a blob URL, the same way chat attachments and
   marketing photos already work. */
const MediaItem = ({ item, alt, compact = false }) => {
  const { url, error } = useProtectedMedia(`/announcements/media/${item.id}/file`);

  // Posts from before the Drive migration point at files the container wiped.
  // Say so plainly instead of leaving a broken-image icon in the card.
  if (error) {
    return (
      <div className="feed-carousel-missing">
        <ImageOff size={22} />
        <span>{item.type === 'video' ? 'Video unavailable' : 'Image unavailable'}</span>
      </div>
    );
  }

  if (!url) return <div className="feed-carousel-loading" aria-busy="true" />;

  return item.type === 'video'
    ? <video src={url} controls={!compact} muted={compact} playsInline className="feed-carousel-media" />
    : <img src={url} alt={alt} className="feed-carousel-media" />;
};

/* ── Media carousel ──
   Arrows, dots and the counter are absolutely positioned over a fixed frame so
   a tall portrait photo and a wide screenshot both sit in the same box, instead
   of the card jumping every time you page through them. */
const MediaCarousel = ({ media, alt }) => {
  const [idx, setIdx] = useState(0);

  if (!media?.length) return null;

  const count   = media.length;
  const current = Math.min(idx, count - 1);
  const item    = media[current];
  // Stepped from `current`, not from the stored index: editing a post can drop
  // the item we were parked on, and `current` is the one actually on screen.
  const go      = (delta) => setIdx((current + delta + count) % count);

  return (
    <div
      className="feed-carousel"
      role="group"
      aria-roledescription="carousel"
      aria-label={alt}
      tabIndex={count > 1 ? 0 : -1}
      onKeyDown={e => {
        if (count < 2) return;
        if (e.key === 'ArrowLeft')  { e.preventDefault(); go(-1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      }}
    >
      <div className="feed-carousel-frame">
        <MediaItem
          key={item.id}
          item={item}
          alt={count > 1 ? `${alt} — ${current + 1} of ${count}` : alt}
        />
      </div>

      {count > 1 && (
        <>
          <button type="button" className="feed-carousel-nav prev" aria-label="Previous" onClick={() => go(-1)}>
            <ChevronLeft size={18} />
          </button>
          <button type="button" className="feed-carousel-nav next" aria-label="Next" onClick={() => go(1)}>
            <ChevronRight size={18} />
          </button>

          <span className="feed-carousel-count">{current + 1} / {count}</span>

          <div className="feed-carousel-dots">
            {media.map((m, i) => (
              <button
                type="button"
                key={m.id}
                className={`feed-carousel-dot${i === current ? ' active' : ''}`}
                aria-label={`Go to item ${i + 1}`}
                aria-current={i === current}
                onClick={() => setIdx(i)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

/* ── Replies ──
   A flat thread under each post. Deliberately not a chat: replies are visible
   to whoever the post was aimed at, and the answer to "are siblings welcome at
   the open house?" is worth as much to the family who didn't ask. */
const CommentThread = ({ post, currentUser, isAdmin }) => {
  const toast = useToast();
  const [comments, setComments] = useState(post.comments || []);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // Long threads collapse to the last three, so one busy post doesn't push
  // every later announcement off the screen.
  const [expanded, setExpanded] = useState(false);

  const visible = expanded || comments.length <= 3 ? comments : comments.slice(-3);
  const hidden = comments.length - visible.length;

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await api.post(`/announcements/${post.id}/comments`, { body });
      setComments(prev => [...prev, res.data.comment]);
      setDraft('');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not post your reply.');
    }
    setSending(false);
  };

  const handleDelete = async (commentId) => {
    if (!confirm('Remove this reply?')) return;
    try {
      await api.delete(`/announcements/${post.id}/comments/${commentId}`);
      setComments(prev => prev.filter(c => c.id !== commentId));
    } catch {
      toast.error('Could not remove the reply.');
    }
  };

  return (
    <div className="feed-comments">
      {comments.length > 0 && (
        <div className="feed-comment-list">
          {hidden > 0 && (
            <button className="feed-comments-more" onClick={() => setExpanded(true)}>
              Show {hidden} earlier {hidden === 1 ? 'reply' : 'replies'}
            </button>
          )}
          {visible.map(c => (
            <div key={c.id} className="feed-comment">
              <div className="feed-comment-avatar">{(c.author?.fullName || '?')[0]}</div>
              <div className="feed-comment-bubble">
                <div className="feed-comment-head">
                  <strong>{c.author?.fullName || 'Someone'}</strong>
                  <span className="feed-comment-time">{timeAgo(c.createdAt)}</span>
                  {(isAdmin || c.author?.id === currentUser?.id) && (
                    <button
                      className="feed-comment-delete"
                      onClick={() => handleDelete(c.id)}
                      title="Remove reply"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                <p><Linkified text={c.body} /></p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="feed-comment-composer">
        <input
          type="text"
          placeholder="Write a reply..."
          value={draft}
          onChange={e => setDraft(e.target.value)}
          // Enter sends: these are one-line answers, and a reply box that needs
          // a mouse to submit is a reply box nobody uses.
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          maxLength={2000}
        />
        <button onClick={handleSend} disabled={sending || !draft.trim()} title="Send reply">
          <Send size={14} />
        </button>
      </div>
    </div>
  );
};

/* ── Review banner ──
   The strip that says a post is not on the board yet. It shows to the author
   (so a submission doesn't just vanish) and to admins (who decide). Parents
   never see one: a post they can see is by definition already approved. */
const ReviewBanner = ({ post, isAdmin, onReview }) => {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const pending = post.status === 'PENDING';

  const decide = async (decision) => {
    setBusy(true);
    await onReview(post, decision, note.trim());
    setBusy(false);
    setRejecting(false);
    setNote('');
  };

  return (
    <div className={`feed-review-banner ${pending ? 'pending' : 'rejected'}`}>
      <div className="feed-review-line">
        {pending ? <Clock size={14} /> : <Undo2 size={14} />}
        <span>
          {pending
            ? (isAdmin ? `Waiting for your approval — submitted by ${post.author?.fullName || 'a teacher'}.` : 'Waiting for admin approval. Only you and the admins can see this.')
            : 'Sent back for changes. Edit the post to submit it again.'}
        </span>
      </div>

      {/* The admin's own words on why, kept where the author will read them. */}
      {post.status === 'REJECTED' && post.reviewNote && (
        <p className="feed-review-note">“{post.reviewNote}”</p>
      )}

      {isAdmin && pending && (
        rejecting ? (
          <div className="feed-review-reject-row">
            <input
              type="text"
              placeholder="What needs to change? (optional)"
              value={note}
              onChange={e => setNote(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') decide('reject'); }}
              maxLength={500}
              autoFocus
            />
            <button className="feed-review-btn reject" disabled={busy} onClick={() => decide('reject')}>
              Send back
            </button>
            <button className="feed-review-btn ghost" disabled={busy} onClick={() => { setRejecting(false); setNote(''); }}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="feed-review-actions">
            <button className="feed-review-btn approve" disabled={busy} onClick={() => decide('approve')}>
              <Check size={14} /> Approve &amp; publish
            </button>
            <button className="feed-review-btn reject" disabled={busy} onClick={() => setRejecting(true)}>
              <Undo2 size={14} /> Send back
            </button>
          </div>
        )
      )}
    </div>
  );
};

/* ── Edit Composer (inline) ── */
const EditComposer = ({ post, onSave, onCancel, isAdmin }) => {
  const toast = useToast();
  const fileInputRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: post.title,
    body: post.body,
    category: post.category || 'general',
    targetAudience: post.targetAudience || 'all',
    isPinned: post.isPinned || false,
  });
  // Track which existing media to remove
  const [removeIds, setRemoveIds] = useState([]);
  // New media to add
  const [newMedia, setNewMedia] = useState([]);

  const existingMedia = (post.media || []).filter(m => !removeIds.includes(m.id));

  const handleSave = async () => {
    if (!form.title.trim() || !form.body.trim()) return;
    setSaving(true);
    try {
      const data = new FormData();
      data.append('title', form.title);
      data.append('body', form.body);
      data.append('category', form.category);
      data.append('targetAudience', form.targetAudience);
      data.append('isPinned', form.isPinned);
      removeIds.forEach(id => data.append('removeMediaIds', id));
      newMedia.forEach(item => data.append('media', item.file));

      const res = await api.patch(`/announcements/${post.id}`, data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res.data.mediaWarning) toast.error(res.data.mediaWarning);
      // The server's own wording: a teacher's edit didn't just save, it went
      // back into the queue, and saying "Post updated!" would hide that.
      else toast.success(res.data.message || 'Post updated!');
      onSave(res.data.announcement);
    } catch {
      toast.error('Could not update the post.');
    }
    setSaving(false);
  };

  return (
    <div className="feed-composer feed-edit-composer">
      <div className="feed-edit-composer-header">
        <Pencil size={15} /> <span>Editing post</span>
        <button className="feed-edit-close-btn" onClick={onCancel}><X size={15} /></button>
      </div>

      <input
        className="composer-title-input"
        value={form.title}
        onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
        placeholder="Headline"
      />
      <textarea
        className="composer-body-input"
        rows={4}
        value={form.body}
        onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
        placeholder="Details..."
      />

      {/* Existing media — with individual remove buttons */}
      {existingMedia.length > 0 && (
        <div className="composer-media-grid">
          {existingMedia.map(m => (
            <div key={m.id} className="composer-media-thumb">
              <MediaItem item={m} alt="Attached media" compact />
              {m.type === 'video' && <span className="composer-media-video-tag"><Film size={12} /></span>}
              <button onClick={() => setRemoveIds(prev => [...prev, m.id])} title="Remove"><X size={12} /></button>
            </div>
          ))}
        </div>
      )}

      {/* New media to add */}
      {newMedia.length > 0 && (
        <div className="composer-media-grid">
          {newMedia.map((item, idx) => (
            <div key={idx} className="composer-media-thumb composer-media-new">
              {item.type === 'video'
                ? <video src={item.preview} muted />
                : <img src={item.preview} alt={`New ${idx + 1}`} />}
              {item.type === 'video' && <span className="composer-media-video-tag"><Film size={12} /></span>}
              <span className="composer-media-new-tag">New</span>
              <button onClick={() => setNewMedia(prev => prev.filter((_, i) => i !== idx))}><X size={12} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="composer-footer-row">
        <button
          className="composer-image-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={existingMedia.length + newMedia.length >= 10}
        >
          <ImagePlus size={16} /> Add Photos / Video
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={e => {
            const files = Array.from(e.target.files || []);
            setNewMedia(prev => [
              ...prev,
              ...files.slice(0, 10 - existingMedia.length - prev.length).map(f => ({
                file: f,
                preview: URL.createObjectURL(f),
                type: f.type.startsWith('video/') ? 'video' : 'image',
              })),
            ]);
          }}
        />
        <select
          className="composer-audience-select"
          value={form.targetAudience}
          onChange={e => setForm(f => ({ ...f, targetAudience: e.target.value }))}
        >
          {AUDIENCES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
        {isAdmin && (
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
        <button className="composer-cancel-btn" onClick={onCancel}>Cancel</button>
        <button
          className="composer-submit-btn"
          onClick={handleSave}
          disabled={saving || !form.title.trim() || !form.body.trim()}
        >
          <Send size={14} /> {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
};

/* ── Main Feed ── */
const AcademyFeed = () => {
  const { user, hasRole } = useAuth();
  const toast = useToast();
  const isAdmin = hasRole('ADMIN');
  // Teachers write; admins publish. The composer is the same one either way —
  // what changes is whether pressing the button puts the post on the board or
  // in the approval queue, and the button says which.
  const canPost = hasRole('ADMIN', 'TEACHER');

  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingPost, setEditingPost] = useState(null); // post object being edited
  const fileInputRef = useRef(null);

  const [form, setForm] = useState({
    title: '', body: '', category: 'general', targetAudience: 'all', isPinned: false,
  });
  const [mediaItems, setMediaItems] = useState([]); // [{ file, preview, type }]

  const clearComposer = () => {
    setForm({ title: '', body: '', category: 'general', targetAudience: 'all', isPinned: false });
    setMediaItems([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

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

  const removeMediaItem = (idx) => setMediaItems(prev => prev.filter((_, i) => i !== idx));

  const loadPosts = async () => {
    setLoading(true);
    try {
      const res = await api.get('/announcements');
      const loaded = res.data.announcements || [];
      setPosts(loaded);
      // Mark all unread announcements as read server-side so the sidebar
      // badge clears immediately when the user visits the feed.
      loaded.forEach(a => {
        if (!a.isRead) api.post(`/announcements/${a.id}/read`).catch(() => {});
      });
    } catch {
      toast.error('Could not load Announcements.');
    }
    setLoading(false);
  };

  useEffect(() => { loadPosts(); }, []);

  useEffect(() => {
    // Mark visible posts as read once loaded (lightweight — parents/teachers see it, admin doesn't need to)
    posts.forEach(p => {
      if (!p.isRead) {
        api.post(`/announcements/${p.id}/read`).catch(() => {});
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts.length]);

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

      const res = await api.post('/announcements', data, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (res.data.mediaWarning) toast.error(res.data.mediaWarning);
      else toast.success(isAdmin ? 'Posted to Announcements!' : 'Sent to the admins for approval.');
      clearComposer();
      setComposerOpen(false);
      await loadPosts();
    } catch {
      toast.error('Could not publish the post.');
    }
    setSubmitting(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this post?')) return;
    try {
      await api.delete(`/announcements/${id}`);
      setPosts(prev => prev.filter(p => p.id !== id));
      toast.success('Post removed.');
    } catch {
      toast.error('Could not remove the post.');
    }
  };

  const handleEditSave = (updated) => {
    setPosts(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p));
    setEditingPost(null);
  };

  // Pinned posts still lead; below them, anything awaiting review comes first
  // for an admin. Nobody else has an unapproved post in this list except their
  // own, and seeing it at the top is the point there too.
  const visiblePosts = [...posts].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    const aWaiting = a.status === 'PENDING' ? 1 : 0;
    const bWaiting = b.status === 'PENDING' ? 1 : 0;
    if (aWaiting !== bWaiting) return bWaiting - aWaiting;
    return new Date(b.publishedAt) - new Date(a.publishedAt);
  });

  const handleReview = async (post, decision, note) => {
    try {
      const res = await api.post(`/announcements/${post.id}/review`, { decision, note });
      const updated = res.data.announcement;
      // Merged rather than replaced: the review response doesn't carry the
      // reply thread, and dropping it would blank the comments under a post
      // that was just approved.
      setPosts(prev => prev.map(p => p.id === post.id ? { ...p, ...updated } : p));
      toast.success(decision === 'approve' ? 'Approved — it is on the board.' : 'Sent back to the author.');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save that decision.');
    }
  };

  return (
    <div className="feed-container">
      <header className="feed-header">
        <div>
          <h1><Megaphone size={24} /> Announcements</h1>
          <p>
            Location changes, staff updates, open houses, and news from the whole team — in one place.
            {canPost && !isAdmin && ' Your posts go up once an admin approves them.'}
          </p>
        </div>
        {canPost && !composerOpen && !editingPost && (
          <button className="feed-new-post-btn" onClick={() => setComposerOpen(true)}>
            <Plus size={16} /> {isAdmin ? 'New Post' : 'Write a Post'}
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

            {hasRole('ADMIN') && (
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
              <Send size={14} /> {submitting
                ? (isAdmin ? 'Posting...' : 'Submitting...')
                : (isAdmin ? 'Post Announcement' : 'Submit for Approval')}
            </button>
          </div>
        </div>
      )}

      <div className="feed-list">
        {loading ? (
          <div className="feed-empty"><span className="app-inline-loader"><span className="app-spinner-sm" />Loading Announcements…</span></div>
        ) : posts.length === 0 ? (
          <div className="feed-empty">
            <Megaphone size={32} />
            <p>No posts yet. {canPost ? 'Be the first to share an update!' : 'Check back soon for academy news.'}</p>
          </div>
        ) : (
          visiblePosts.map(post => {
            const cat = categoryMeta(post.category);
            const Icon = cat.icon;
            const canEdit = isAdmin || post.authorId === user?.id;
            const canDelete = canEdit;
            const isEditing = editingPost?.id === post.id;
            // Only ever true for the author or an admin — the list endpoint
            // doesn't hand anyone else an unapproved post in the first place.
            const underReview = post.status && post.status !== 'APPROVED';
            return (
              <div key={post.id} className={`feed-card ${post.isPinned ? 'pinned' : ''} ${underReview ? 'under-review' : ''}`}>
                {underReview && (
                  <ReviewBanner post={post} isAdmin={isAdmin} onReview={handleReview} />
                )}
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
                  {canEdit && (
                    <div className="feed-card-actions">
                      <button
                        className="feed-edit-btn"
                        onClick={() => setEditingPost(isEditing ? null : post)}
                        title="Edit post"
                      >
                        <Pencil size={14} />
                      </button>
                      {canDelete && (
                        <button className="feed-delete-btn" onClick={() => handleDelete(post.id)} title="Remove post">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <EditComposer
                    post={post}
                    isAdmin={isAdmin}
                    onSave={handleEditSave}
                    onCancel={() => setEditingPost(null)}
                  />
                ) : (
                  <>
                    <h3 className="feed-card-title">{post.title}</h3>
                    <p className="feed-card-body"><Linkified text={post.body} /></p>

                    {post.media && post.media.length > 0 ? (
                      <MediaCarousel media={post.media} alt={post.title} />
                    ) : post.imageUrl && (
                      <img className="feed-card-image" src={MEDIA_BASE + post.imageUrl} alt={post.title} />
                    )}

                    {/* No replies on a post nobody can see yet — the thread
                        would be a conversation with an empty room. */}
                    {!underReview && (
                      <CommentThread
                        key={post.id}
                        post={post}
                        currentUser={user}
                        isAdmin={isAdmin}
                      />
                    )}
                  </>
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
