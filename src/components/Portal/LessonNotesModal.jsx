import React, { useEffect, useMemo, useState } from 'react';
import { X, BookOpen, Download, Search, Clock } from 'lucide-react';
import api from '../../lib/api';
import { formatTimeOfDay, formatDateOnly } from '../../lib/time';
import ErrorBanner from '../Layout/ErrorBanner';
import './LessonNotesModal.css';

// The portal card only carries the next few sessions, so this modal is where a
// student reads back over the whole class: every note a manager has published,
// newest first, with the day they were in class marked.

// Session.date is a date-only column stamped at UTC midnight — compare it on
// its UTC parts, or anyone behind UTC sees yesterday's class marked "Today".
const dayKey = (value) => String(value).split('T')[0];

const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

// studentId is only passed when a parent opens this for one of their
// children — a student opening their own history hits the /student route,
// which needs no id since the token already says who they are.
const LessonNotesModal = ({ classId, className, studentId, onClose }) => {
  const base = studentId
    ? `/portal/parent/children/${studentId}/classes/${classId}/notes`
    : `/portal/student/classes/${classId}/notes`;

  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [query, setQuery]       = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(base);
      setData(res.data);
    } catch (err) {
      setError(err.userMessage || 'Could not load the lesson notes.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [classId, studentId]);

  // Esc closes, the same as clicking the backdrop.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const today = todayKey();

  const rows = useMemo(() => {
    const all = data?.notes || [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (n) => n.notes.toLowerCase().includes(q) || formatDateOnly(n.date, { month: 'long', day: 'numeric' }).toLowerCase().includes(q)
    );
  }, [data, query]);

  // The PDF sits behind the same auth as everything else, so it has to be
  // fetched with the token rather than opened as a plain link.
  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      const res = await api.get(`${base}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `lesson-notes-${(data?.class?.name || className || 'class').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(err.userMessage || 'Could not download the PDF. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="lnm-overlay" onClick={onClose}>
      <div className="lnm-modal" onClick={(e) => e.stopPropagation()}>
        <header className="lnm-header">
          <div className="lnm-header-icon"><BookOpen size={20} /></div>
          <div className="lnm-header-text">
            <h3>Lesson notes</h3>
            <p>
              {data?.class?.name || className}
              {data?.class?.teacherName ? ` · with ${data.class.teacherName}` : ''}
            </p>
          </div>
          <button className="lnm-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </header>

        <div className="lnm-toolbar">
          <div className="lnm-search">
            <Search size={15} />
            <input
              type="text"
              value={query}
              placeholder="Search notes or a date…"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="lnm-download"
            onClick={handleDownload}
            disabled={downloading || loading || !(data?.notes?.length)}
          >
            <Download size={15} />
            {downloading ? 'Preparing…' : 'Download PDF'}
          </button>
        </div>

        <div className="lnm-body">
          {downloadError && <ErrorBanner message={downloadError} onRetry={handleDownload} />}

          {loading ? (
            <div className="lnm-loading"><span className="lnm-spinner" />Loading notes…</div>
          ) : error ? (
            <ErrorBanner message={error} onRetry={load} />
          ) : rows.length === 0 ? (
            <div className="lnm-empty">
              <BookOpen size={36} />
              <p>{query ? 'No notes match that search.' : 'No lesson notes have been published for this class yet.'}</p>
            </div>
          ) : (
            <ul className="lnm-list">
              {rows.map((n) => {
                const key = dayKey(n.date);
                const isToday = key === today;
                const isUpcoming = key > today;
                return (
                  <li key={n.sessionId} className={`lnm-item ${isToday ? 'today' : ''}`}>
                    <div className="lnm-item-head">
                      <span className="lnm-item-date">
                        {formatDateOnly(n.date, { weekday: 'short', month: 'short', day: 'numeric' })}
                      </span>
                      {n.startTime && (
                        <span className="lnm-item-time">
                          <Clock size={12} /> {formatTimeOfDay(n.startTime)}
                        </span>
                      )}
                      {isToday && <span className="lnm-badge today">Today</span>}
                      {isUpcoming && <span className="lnm-badge next">Upcoming</span>}
                    </div>
                    <p className="lnm-item-notes">{n.notes}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default LessonNotesModal;
