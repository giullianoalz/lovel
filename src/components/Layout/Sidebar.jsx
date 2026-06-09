import React, { useState } from 'react';
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
  Compass
} from 'lucide-react';
import './Sidebar.css';

const Sidebar = () => {
  const { user, role, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(2);

  const closeMenu = () => setIsOpen(false);

  const navigate = useNavigate();

  const handleNotifClick = () => {
    setIsNotifOpen(!isNotifOpen);
    setUnreadCount(0); // Clear alert number on click
  };

  const handleNotifAction = (path) => {
    setIsNotifOpen(false);
    navigate(path);
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
        
        <div className="notif-wrapper" style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', display: 'flex', zIndex: 100 }}>
          <button 
            className="global-notif-bell" 
            onClick={handleNotifClick}
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
                <h4 style={{ margin: 0, fontSize: '14px' }}>Notifications</h4>
                <button onClick={() => setIsNotifOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)' }}><X size={16}/></button>
              </div>
              <div className="notif-body">
                <div className="notif-item unread" onClick={() => handleNotifAction('/registration')} style={{ cursor: 'pointer' }}>
                  <p style={{ margin: '0 0 4px 0', fontSize: '13px' }}><strong>Maria Garcia</strong> submitted a registration form.</p>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>10 mins ago</span>
                </div>
                <div className="notif-item unread" onClick={() => handleNotifAction('/billing')} style={{ cursor: 'pointer' }}>
                  <p style={{ margin: '0 0 4px 0', fontSize: '13px' }}>New payment received from <strong>John Doe</strong>.</p>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>1 hour ago</span>
                </div>
              </div>
              <div className="notif-footer" style={{ borderTop: '1px solid var(--border-light)', padding: '8px', textAlign: 'center' }}>
                <button style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: '12px', fontWeight: 'bold' }}>Mark all as read</button>
              </div>
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
