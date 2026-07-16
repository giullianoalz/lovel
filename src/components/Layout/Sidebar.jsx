import React, { useState, useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  MessageSquare,
  Calendar,
  Users,
  CreditCard,
  LogOut,
  Menu,
  X,
  ClipboardList,
  Bell,
  AlertTriangle,
  Camera,
  UserCircle,
  Compass,
  BookOpenCheck,
  Wallet,
  MoonStar,
  Check,
  Heart,
  BookOpen,
  Megaphone,
  Plug,
} from 'lucide-react';
import api from '../../lib/api';
import { requestAndSaveFcmToken, listenForForegroundMessages } from '../../lib/fcm';
import NotifDrawer from '../Notifications/NotifDrawer';
import { useNotifications } from '../../hooks/useNotifications';
import { useToast } from './ToastProvider';
import { InstallNavItem } from './InstallNavItem';
import './Sidebar.css';

const Sidebar = () => {
  const { user, role, logout } = useAuth();
  const toast = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [notifTab, setNotifTab] = useState('inbox');
  const notif = useNotifications(role);
  const bellRef = useRef(null);

  /* Push Notifications (FCM) — register device token once per session, show toast for foreground pushes */
  useEffect(() => {
    if (!user?.id) return;
    requestAndSaveFcmToken(user.id);
    const unsubscribe = listenForForegroundMessages((notification) => {
      if (notification?.title) toast.info(`${notification.title}${notification.body ? `: ${notification.body}` : ''}`, 8000);
    });
    return unsubscribe;
  }, [user?.id]);

  /* Quiet Hours */
  const [quietOpen, setQuietOpen] = useState(false);
  const [quietActive, setQuietActive] = useState(false);
  const [quietStart, setQuietStart] = useState('17:00');
  const [quietEnd, setQuietEnd] = useState('09:00');
  const [quietMsg, setQuietMsg] = useState('I have quiet hours enabled and will respond within 1 business day.');
  const [quietSaving, setQuietSaving] = useState(false);

  useEffect(() => {
    if (role === 'TEACHER' && user?.id) {
      api.get(`/users/${user.id}`).then(r => {
        const u = r.data.user || r.data;
        if (u.quietHoursStart) {
          setQuietActive(true);
          setQuietStart(u.quietHoursStart);
          setQuietEnd(u.quietHoursEnd || '09:00');
          setQuietMsg(u.autoResponderMessage || 'I have quiet hours enabled and will respond within 1 business day.');
        }
      }).catch(() => {});
    }
  }, [role, user?.id]);

  const handleQuietSave = async () => {
    setQuietSaving(true);
    try {
      await api.put(`/users/${user.id}`, {
        quietHoursStart: quietActive ? quietStart : null,
        quietHoursEnd: quietActive ? quietEnd : null,
        autoResponderMessage: quietActive ? quietMsg : null,
      });
    } catch { /* silent */ }
    setQuietSaving(false);
    setQuietOpen(false);
  };

  const closeMenu = () => setIsOpen(false);

  return (
    <>
      {/* Mobile Top Header */}
      <div className="mobile-header">
        <button className="mobile-toggle" onClick={() => setIsOpen(!isOpen)} aria-label={isOpen ? 'Close menu' : 'Open menu'}>
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
        
        <img
          src="/logo.png"
          alt="Love Learning Explorers Logo"
          className="mobile-logo"
        />
        
        {role && (
          <div style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', zIndex: 200 }}>
            <button ref={bellRef} className="global-notif-bell" onClick={() => setIsNotifOpen(p => !p)}
              aria-label={notif.unreadCount > 0 ? `Notifications, ${notif.unreadCount} unread` : 'Notifications'}
              style={{ position: 'relative', background: 'transparent', border: 'none', padding: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Bell size={20} color="var(--text-main)" />
              {notif.unreadCount > 0 && (
                <span className="notif-badge" style={{ position: 'absolute', top: '-2px', right: '-2px', background: '#ef4444', color: 'white', width: '18px', height: '18px', borderRadius: '50%', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', border: '2px solid white' }}>
                  {notif.unreadCount > 9 ? '9+' : notif.unreadCount}
                </span>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Overlay for mobile blur effect */}
      {isOpen && <div className="sidebar-overlay" onClick={closeMenu}></div>}

      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-brand desk-only">
          <img
            src="/logo.png"
            alt="Love Learning Explorers Logo"
            className="brand-logo"
          />
        </div>

        {/* Desktop bell — pinned to the top-right corner of the sidebar */}
        {role && (
          <div className="sidebar-notif-anchor desk-only">
            <button ref={bellRef} className="sidebar-bell-btn" onClick={() => setIsNotifOpen(p => !p)} aria-label="Notifications">
              <Bell size={18} />
              {notif.unreadCount > 0 && (
                <span className="sidebar-notif-pill">{notif.unreadCount > 9 ? '9+' : notif.unreadCount}</span>
              )}
            </button>
          </div>
        )}

        <nav className="sidebar-nav">
          <div className="nav-section">
            <p className="nav-label">Main</p>
            {role === 'STUDENT' && (
              <NavLink to="/portal/student" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <UserCircle size={20} />
                <span>My Portal</span>
              </NavLink>
            )}
            {role === 'PARENT' && (
              <NavLink to="/portal/parent" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <Users size={20} />
                <span>Family Portal</span>
              </NavLink>
            )}
            {user?.role === 'ADMIN' && (
              <NavLink to="/alerts" onClick={closeMenu} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <Bell size={20} />
                <span>Front Desk Alerts</span>
              </NavLink>
            )}
            {(role === 'TEACHER' || role === 'ADMIN') && (
              <NavLink to="/portal/teacher" onClick={closeMenu} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <Compass size={20} />
                <span>Teacher Portal</span>
              </NavLink>
            )}
            <NavLink to="/feed" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
              <Megaphone size={20} />
              <span>Announcements</span>
            </NavLink>
            <NavLink to="/chat" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
              <MessageSquare size={20} />
              <span>Chat Hub</span>
            </NavLink>
            <NavLink to="/calendar" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
              <Calendar size={20} />
              <span>Calendar</span>
            </NavLink>
            {(role === 'ADMIN' || role === 'TEACHER') && (
              <NavLink to="/students" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <Users size={20} />
                <span>Directory</span>
              </NavLink>
            )}
            {role === 'TEACHER' && (
              <NavLink to="/my-payroll" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <Wallet size={20} />
                <span>My Payroll</span>
              </NavLink>
            )}
            <InstallNavItem onNavigate={closeMenu} />
          </div>

          {(role === 'ADMIN' || role === 'TEACHER') && (
            <div className="nav-section">
              <p className="nav-label">Administration</p>
              {role === 'ADMIN' && (
                <>
                  <NavLink to="/billing" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                    <CreditCard size={20} />
                    <span>Billing</span>
                  </NavLink>
                  <NavLink to="/registration" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                    <ClipboardList size={20} />
                    <span>Registration & Terms</span>
                  </NavLink>

                </>
              )}
<NavLink to="/behavior" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <AlertTriangle size={20} />
                <span>Behavior</span>
              </NavLink>
              <NavLink to="/marketing" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <Camera size={20} />
                <span>Marketing Hub</span>
              </NavLink>
              {role === 'ADMIN' && (
                <NavLink to="/supervision" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                  <BookOpenCheck size={20} />
                  <span>Academic Supervision</span>
                </NavLink>
              )}
              {role === 'ADMIN' && (
                <NavLink to="/medical" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                  <Heart size={20} />
                  <span>Medical Incidents</span>
                </NavLink>
              )}
              {role === 'ADMIN' && (
                <NavLink to="/lesson-plans" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                  <BookOpen size={20} />
                  <span>Lesson Plans</span>
                </NavLink>
              )}
              {role === 'ADMIN' && (
                <NavLink to="/settings/notifications" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                  <Bell size={20} />
                  <span>Notification Settings</span>
                </NavLink>
              )}
              {role === 'ADMIN' && (
                <NavLink to="/settings/integrations" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                  <Plug size={20} />
                  <span>Integrations</span>
                </NavLink>
              )}
            </div>
          )}
        </nav>

        {role === 'TEACHER' && (
          <div className="quiet-hours-section">
            <button className={`quiet-toggle-btn ${quietActive ? 'active' : ''}`} onClick={() => setQuietOpen(!quietOpen)}>
              <MoonStar size={16} />
              <span>{quietActive ? 'Quiet Hours On' : 'Quiet Hours'}</span>
              {quietActive && <span className="quiet-dot" />}
            </button>
            {quietOpen && (
              <div className="quiet-popup">
                <div className="quiet-popup-header">
                  <h4><MoonStar size={16} /> Quiet Hours</h4>
                  <button className="quiet-popup-close" onClick={() => setQuietOpen(false)}><X size={16} /></button>
                </div>
                <label className="quiet-switch-label">
                  <input type="checkbox" checked={quietActive} onChange={e => setQuietActive(e.target.checked)} />
                  <span>{quietActive ? 'Enabled' : 'Disabled'}</span>
                </label>
                {quietActive && (
                  <>
                    <div className="quiet-time-row">
                      <div className="quiet-time-field">
                        <label>From</label>
                        <input type="time" value={quietStart} onChange={e => setQuietStart(e.target.value)} />
                      </div>
                      <div className="quiet-time-field">
                        <label>To</label>
                        <input type="time" value={quietEnd} onChange={e => setQuietEnd(e.target.value)} />
                      </div>
                    </div>
                    <div className="quiet-msg-field">
                      <label>Auto-response message</label>
                      <textarea value={quietMsg} onChange={e => setQuietMsg(e.target.value)} rows={2} />
                    </div>
                  </>
                )}
                <button className="quiet-save-btn" onClick={handleQuietSave} disabled={quietSaving}>
                  <Check size={14} /> {quietSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="sidebar-footer">
          <div className="user-profile">
            <div className="avatar">
              {user ? user.fullName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : 'U'}
            </div>
            <div className="user-info">
              <p className="user-name">{user ? user.fullName : 'User'}</p>
              <p className="user-role">
                {role === 'ADMIN' && 'Administrator'}
                {role === 'TEACHER' && 'Teacher'}
                {role === 'PARENT' && 'Parent'}
                {role === 'STUDENT' && 'Student'}
              </p>
            </div>
          </div>
          <button className="logout-btn" onClick={logout} title="Sign Out">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      {/* Shared NotifDrawer — opens from sidebar bell (desktop) or mobile bell */}
      <NotifDrawer
        open={isNotifOpen}
        onClose={() => setIsNotifOpen(false)}
        activeTab={notifTab}
        setActiveTab={setNotifTab}
        anchorRef={bellRef}
        position="sidebar"
        inboxItems={notif.inboxItems}
        laterItems={notif.laterItems}
        archiveItems={notif.archiveItems}
        markRead={notif.markRead}
        markLater={notif.markLater}
        restoreToInbox={notif.restoreToInbox}
        markAllRead={notif.markAllRead}
      />
    </>
  );
};

export default Sidebar;
