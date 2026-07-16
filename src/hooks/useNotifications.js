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
    // Every signed-in role gets a bell (Facebook-style): parents/students see
    // their own personal notifications + the announcements targeted at them.
    if (!role) return;

    // Two feeds share the bell: broadcast announcements and per-user in-app
    // notifications (behavior reports, alerts, medical incidents, billing, etc.).
    // allSettled so one failing endpoint doesn't wipe the other out.
    Promise.allSettled([
      api.get('/announcements'),
      api.get('/notifications'),
    ]).then(([annRes, notifRes]) => {
      const announcements = annRes.status === 'fulfilled'
        ? (annRes.value.data.announcements || []).slice(0, 50).map(a => ({
            id: a.id,
            source: 'announcement',
            title: a.title,
            body: a.body || '',
            author: a.author?.fullName || 'Academy',
            time: new Date(a.createdAt),
            serverRead: !!a.isRead,
          }))
        : [];

      const inApp = notifRes.status === 'fulfilled'
        ? (notifRes.value.data.notifications || []).slice(0, 50).map(n => ({
            id: n.id,
            source: 'notification',
            title: n.title,
            body: n.message || '',
            author: 'Academy',
            time: new Date(n.createdAt),
            serverRead: !!n.isRead,
          }))
        : [];

      const merged = [...announcements, ...inApp].sort((a, b) => b.time - a.time);
      setNotifications(merged);
    });
  }, [role]);

  // An item is read if the server says so or the user marked it read locally.
  const isReadItem = (n) => n.serverRead || readIds.has(n.id);

  const inboxItems   = notifications.filter(n => !isReadItem(n) && !laterIds.has(n.id));
  const laterItems   = notifications.filter(n => laterIds.has(n.id) && !isReadItem(n));
  const archiveItems = notifications.filter(n => isReadItem(n));
  const unreadCount  = inboxItems.length;

  // Route the read call to the right backend for this item's source.
  const persistRead = (item) => {
    if (!item) return Promise.resolve();
    const url = item.source === 'notification'
      ? `/notifications/${item.id}/read`
      : `/announcements/${item.id}/read`;
    return api.post(url).catch(() => { /* noop */ });
  };

  const markRead = async (id, e) => {
    e?.stopPropagation();
    const nextRead  = new Set(readIds);  nextRead.add(id);
    const nextLater = new Set(laterIds); nextLater.delete(id);
    setReadIds(nextRead);   saveSet(LS_READ, nextRead);
    setLaterIds(nextLater); saveSet(LS_LATER, nextLater);
    await persistRead(notifications.find(n => n.id === id));
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
    try { await Promise.all(inboxItems.map(persistRead)); } catch { /* noop */ }
  };

  return { inboxItems, laterItems, archiveItems, unreadCount, markRead, markLater, restoreToInbox, markAllRead };
};
