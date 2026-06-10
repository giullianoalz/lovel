import React, { useEffect, useRef } from 'react';
import { Bell, X, Inbox, Archive, BookMarked, CheckCheck, RotateCcw, Clock } from 'lucide-react';
import './NotifDrawer.css';

const formatTime = (date) => {
  const diffMins = Math.floor((Date.now() - new Date(date)) / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const h = Math.floor(diffMins / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const NotifDrawer = ({
  open,
  onClose,
  activeTab,
  setActiveTab,
  inboxItems,
  laterItems,
  archiveItems,
  markRead,
  markLater,
  restoreToInbox,
  markAllRead,
  anchorRef,    // optional: ref to the trigger button for positioning
  position = 'right', // 'right' (default, slides from right) | 'sidebar' (left of sidebar)
}) => {
  const drawerRef = useRef(null);

  /* Close on outside click */
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      const inDrawer  = drawerRef.current?.contains(e.target);
      const inAnchor  = anchorRef?.current?.contains(e.target);
      if (!inDrawer && !inAnchor) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose, anchorRef]);

  /* Close on Escape */
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const tabs = [
    { key: 'inbox',   label: 'Inbox',       icon: <Inbox size={14} />,      items: inboxItems,   count: inboxItems.length },
    { key: 'later',   label: 'Read Later',   icon: <BookMarked size={14} />, items: laterItems,   count: laterItems.length },
    { key: 'archive', label: 'Archive',      icon: <Archive size={14} />,    items: archiveItems, count: archiveItems.length },
  ];
  const currentItems = tabs.find(t => t.key === activeTab)?.items || [];

  return (
    <>
      <div className="notif-drawer-backdrop" onClick={onClose} />
      <div className={`notif-drawer notif-drawer--${position}`} ref={drawerRef}>

        {/* Header */}
        <div className="notif-drawer-header">
          <div className="notif-drawer-title">
            <Bell size={18} />
            <span>Notifications</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {activeTab === 'inbox' && inboxItems.length > 0 && (
              <button className="notif-mark-all-btn" onClick={markAllRead}>
                <CheckCheck size={14} /> Mark all read
              </button>
            )}
            <button className="notif-close-btn" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        {/* Tabs */}
        <div className="notif-drawer-tabs">
          {tabs.map(tab => (
            <button key={tab.key} className={`notif-drawer-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}>
              {tab.icon} {tab.label}
              {tab.count > 0 && <span className="notif-tab-count">{tab.count}</span>}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="notif-drawer-body">
          {currentItems.length === 0 ? (
            <div className="notif-drawer-empty">
              {activeTab === 'inbox'   && <><Bell size={32} /><p>All caught up!</p><span>No new notifications</span></>}
              {activeTab === 'later'   && <><BookMarked size={32} /><p>Nothing saved</p><span>Use "Read later" to save notifications here</span></>}
              {activeTab === 'archive' && <><Archive size={32} /><p>Archive empty</p><span>Read notifications appear here</span></>}
            </div>
          ) : (
            currentItems.map(n => (
              <div key={n.id} className={`notif-drawer-item ${!n.isRead && activeTab === 'inbox' ? 'unread' : ''}`}>
                <div className="notif-item-dot" />
                <div className="notif-item-body">
                  <p className="notif-item-title">{n.title}</p>
                  {n.body && (
                    <p className="notif-item-preview">
                      {n.body.length > 100 ? n.body.slice(0, 100) + '…' : n.body}
                    </p>
                  )}
                  <span className="notif-item-meta">
                    <Clock size={10} /> {formatTime(n.time)} · {n.author}
                  </span>
                </div>
                <div className="notif-item-actions">
                  {activeTab === 'inbox' && (
                    <>
                      <button className="notif-action-btn later" onClick={(e) => markLater(n.id, e)} title="Read later">
                        <BookMarked size={13} />
                      </button>
                      <button className="notif-action-btn read" onClick={(e) => markRead(n.id, e)} title="Mark as read">
                        <CheckCheck size={13} />
                      </button>
                    </>
                  )}
                  {(activeTab === 'later' || activeTab === 'archive') && (
                    <button className="notif-action-btn restore" onClick={(e) => restoreToInbox(n.id, e)} title="Move to inbox">
                      <RotateCcw size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

      </div>
    </>
  );
};

export default NotifDrawer;
