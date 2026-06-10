import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  MessageSquare,
  Calendar,
  Users,
  CreditCard,
  ShieldCheck,
  LogOut,
  LayoutDashboard,
  Menu,
  X,
  ClipboardList,
  Bell,
  AlertTriangle,
  Camera,
  Activity,
  UserCircle,
  Compass,
  Clock,
  Inbox,
  Archive
} from 'lucide-react';
import api from '../../lib/api';
import './Sidebar.css';

const Sidebar = () => {
  const { user, role, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [dismissedIds, setDismissedIds] = useState(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem('notif_dismissed') || '[]')); }
    catch { return new Set(); }
  });
  const [showArchive, setShowArchive] = useState(false);
  const dropdownRef = useRef(null);

  const closeMenu = () => setIsOpen(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (role !== 'ADMIN' && role !== 'TEACHER') return;
    api.get('/announcements').then(res => {
      const items = (res.data.announcements || []).slice(0, 20).map(a => ({
        id: a.id,
        text: a.title,
        time: new Date(a.createdAt),
        path: '/dashboard',
        unread: !a.isRead,
      }));
      setNotifications(items);
    }).catch(() => {});
  }, [role]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsNotifOpen(false);
        setShowArchive(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const activeNotifs = notifications.filter(n => !dismissedIds.has(n.id));
  const archivedNotifs = notifications.filter(n => dismissedIds.has(n.id));
  const unreadCount = activeNotifs.filter(n => n.unread).length;

  const handleNotifClick = () => {
    setIsNotifOpen(prev => !prev);
    setShowArchive(false);
  };

  const handleDismiss = (id, e) => {
    e.stopPropagation();
    const next = new Set(dismissedIds);
    next.add(id);
    setDismissedIds(next);
    sessionStorage.setItem('notif_dismissed', JSON.stringify([...next]));
  };

  const handleRestoreAll = () => {
    setDismissedIds(new Set());
    sessionStorage.removeItem('notif_dismissed');
  };

  const handleNotifAction = (path) => {
    setIsNotifOpen(false);
    navigate(path);
  };

  const formatTime = (date) => {
    const diffMins = Math.floor((Date.now() - date) / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const h = Math.floor(diffMins / 60);
    if (h < 24) return `${h}h ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <>
      {/* Mobile Top Header */}
      <div className="mobile-header">
        <button className="mobile-toggle" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
        
        <img 
          src="https://static.wixstatic.com/media/eb9967_0719931637634500ba7ba4e8b4b9193b~mv2.png/v1/fill/w_372,h_260,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/67389084_2346556398731120_57365730817873.png" 
          alt="Lovelearning Logo" 
          className="mobile-logo"
        />
        
        <div className="notif-wrapper" ref={dropdownRef} style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', display: 'flex', zIndex: 100 }}>
          <button className="global-notif-bell" onClick={handleNotifClick}
            style={{ position: 'relative', background: 'transparent', border: 'none', padding: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Bell size={20} color="var(--text-main)" />
            {unreadCount > 0 && (
              <span className="notif-badge" style={{ position: 'absolute', top: '-2px', right: '-2px', background: '#ef4444', color: 'white', width: '18px', height: '18px', borderRadius: '50%', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', border: '2px solid white' }}>
                {unreadCount}
              </span>
            )}
          </button>

          {isNotifOpen && (
            <div className="notif-dropdown">
              <div className="notif-header">
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button className={`notif-tab-btn ${!showArchive ? 'active' : ''}`} onClick={() => setShowArchive(false)}>
                    <Inbox size={13} /> Inbox {activeNotifs.length > 0 && `(${activeNotifs.length})`}
                  </button>
                  <button className={`notif-tab-btn ${showArchive ? 'active' : ''}`} onClick={() => setShowArchive(true)}>
                    <Archive size={13} /> Seen later {archivedNotifs.length > 0 && `(${archivedNotifs.length})`}
                  </button>
                </div>
                <button onClick={() => setIsNotifOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={16}/></button>
              </div>

              <div className="notif-body">
                {!showArchive ? (
                  activeNotifs.length === 0 ? (
                    <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                      <Bell size={28} style={{ opacity: 0.3, marginBottom: '8px' }} />
                      <p style={{ margin: 0 }}>All caught up!</p>
                    </div>
                  ) : (
                    activeNotifs.map(n => (
                      <div key={n.id} className={`notif-item ${n.unread ? 'unread' : ''}`}>
                        <div onClick={() => handleNotifAction(n.path)} style={{ cursor: 'pointer', flex: 1 }}>
                          <p style={{ margin: '0 0 4px 0', fontSize: '13px' }}>{n.text}</p>
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <Clock size={10} /> {formatTime(n.time)}
                          </span>
                        </div>
                        <button className="notif-dismiss-btn" onClick={(e) => handleDismiss(n.id, e)} title="See later">
                          <Clock size={13} />
                        </button>
                      </div>
                    ))
                  )
                ) : (
                  archivedNotifs.length === 0 ? (
                    <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                      <p style={{ margin: 0 }}>No deferred notifications.</p>
                    </div>
                  ) : (
                    archivedNotifs.map(n => (
                      <div key={n.id} className="notif-item archived">
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: '0 0 4px 0', fontSize: '13px', opacity: 0.7 }}>{n.text}</p>
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                            <Clock size={10} /> {formatTime(n.time)}
                          </span>
                        </div>
                      </div>
                    ))
                  )
                )}
              </div>

              {showArchive && archivedNotifs.length > 0 && (
                <div className="notif-footer">
                  <button className="notif-footer-btn" onClick={handleRestoreAll}>Move all back to inbox</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Overlay for mobile blur effect */}
      {isOpen && <div className="sidebar-overlay" onClick={closeMenu}></div>}

      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-brand desk-only">
          <img 
            src="https://static.wixstatic.com/media/eb9967_0719931637634500ba7ba4e8b4b9193b~mv2.png/v1/fill/w_372,h_260,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/67389084_2346556398731120_57365730817873.png" 
            alt="Lovelearning Logo" 
            className="brand-logo"
          />
        </div>

        
        <nav className="sidebar-nav">
          <div className="nav-section">
            <p className="nav-label">Principal</p>
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
            {(role === 'ADMIN' || role === 'TEACHER') && (
              <NavLink to="/dashboard" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <LayoutDashboard size={20} />
                <span>Dashboard</span>
              </NavLink>
            )}
            <NavLink to="/chat" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
              <MessageSquare size={20} />
              <span>Chat Hub</span>
            </NavLink>
            <NavLink to="/calendar" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
              <Calendar size={20} />
              <span>Calendario</span>
            </NavLink>
            {(role === 'ADMIN' || role === 'TEACHER') && (
              <NavLink to="/students" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <Users size={20} />
                <span>Directorio</span>
              </NavLink>
            )}
          </div>

          {(role === 'ADMIN' || role === 'TEACHER') && (
            <div className="nav-section">
              <p className="nav-label">Administración</p>
              {role === 'ADMIN' && (
                <>
                  <NavLink to="/billing" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                    <CreditCard size={20} />
                    <span>Facturación</span>
                  </NavLink>
                  <NavLink to="/registration" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                    <ClipboardList size={20} />
                    <span>Registros y Términos</span>
                  </NavLink>

                </>
              )}
              <NavLink to="/session" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <ShieldCheck size={20} />
                <span>Sesión de Clase</span>
              </NavLink>
              <NavLink to="/behavior" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <AlertTriangle size={20} />
                <span>Comportamiento</span>
              </NavLink>
              <NavLink to="/class-fit" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <Activity size={20} />
                <span>Class-Fit Report</span>
              </NavLink>
              <NavLink to="/marketing" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <Camera size={20} />
                <span>Marketing Hub</span>
              </NavLink>
            </div>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-profile">
            <div className="avatar">
              {user ? user.fullName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : 'U'}
            </div>
            <div className="user-info">
              <p className="user-name">{user ? user.fullName : 'Usuario'}</p>
              <p className="user-role">
                {role === 'ADMIN' && 'Administrador'}
                {role === 'TEACHER' && 'Profesor'}
                {role === 'PARENT' && 'Padre'}
                {role === 'STUDENT' && 'Estudiante'}
              </p>
            </div>
          </div>
          <button className="logout-btn" onClick={logout} title="Cerrar Sesión">
            <LogOut size={18} />
          </button>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
