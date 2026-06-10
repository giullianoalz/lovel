import { useState, useEffect } from 'react';
import api from '../lib/api';

const LS_READ  = 'notif_read_ids';
const LS_LATER = 'notif_later_ids';
const loadSet  = (key) => { try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); } };
const saveSet  = (key, set) => localStorage.setItem(key, JSON.stringify([...set]));

export const useNotifications = (role) => {
  const [notifications, setNotifications] = useState([]);
  const [readIds,  setReadIds]  = useState(() => loadSet(LS_READ));
  const [laterIds, setLaterIds] = useState(() => loadSet(LS_LATER));

  useEffect(() => {
    if (role !== 'ADMIN' && role !== 'TEACHER') return;
    api.get('/announcements').then(res => {
      const items = (res.data.announcements || []).slice(0, 50).map(a => ({
        id: a.id,
        title: a.title,
        body: a.body || '',
        author: a.author?.fullName || 'Academy',
        time: new Date(a.createdAt),
        isRead: a.isRead,
      }));
      setNotifications(items);
    }).catch(() => {});
  }, [role]);

  const inboxItems   = notifications.filter(n => !readIds.has(n.id) && !laterIds.has(n.id));
  const laterItems   = notifications.filter(n => laterIds.has(n.id));
  const archiveItems = notifications.filter(n => readIds.has(n.id));
  const unreadCount  = inboxItems.length;

  const markRead = async (id, e) => {
    e?.stopPropagation();
    const nextRead  = new Set(readIds);  nextRead.add(id);
    const nextLater = new Set(laterIds); nextLater.delete(id);
    setReadIds(nextRead);   saveSet(LS_READ, nextRead);
    setLaterIds(nextLater); saveSet(LS_LATER, nextLater);
    try { await api.post(`/announcements/${id}/read`); } catch { /* noop */ }
  };

  const markLater = (id, e) => {
    e?.stopPropagation();
    const nextLater = new Set(laterIds); nextLater.add(id);
    const nextRead  = new Set(readIds);  nextRead.delete(id);
    setLaterIds(nextLater); saveSet(LS_LATER, nextLater);
    setReadIds(nextRead);   saveSet(LS_READ, nextRead);
  };

  const restoreToInbox = (id, e) => {
    e?.stopPropagation();
    const nextLater = new Set(laterIds); nextLater.delete(id);
    const nextRead  = new Set(readIds);  nextRead.delete(id);
    setLaterIds(nextLater); saveSet(LS_LATER, nextLater);
    setReadIds(nextRead);   saveSet(LS_READ, nextRead);
  };

  const markAllRead = async () => {
    const nextRead  = new Set(readIds);
    const nextLater = new Set(laterIds);
    inboxItems.forEach(n => { nextRead.add(n.id); nextLater.delete(n.id); });
    setReadIds(nextRead);   saveSet(LS_READ, nextRead);
    setLaterIds(nextLater); saveSet(LS_LATER, nextLater);
    try { await Promise.all(inboxItems.map(n => api.post(`/announcements/${n.id}/read`))); } catch { /* noop */ }
  };

  return { inboxItems, laterItems, archiveItems, unreadCount, markRead, markLater, restoreToInbox, markAllRead };
};
