import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
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
  ClipboardList
} from 'lucide-react';
import './Sidebar.css';

const Sidebar = () => {
  const [isOpen, setIsOpen] = useState(false);

  const closeMenu = () => setIsOpen(false);

  return (
    <>
      {/* Mobile Top Header */}
      <div className="mobile-header">
        <img 
          src="https://static.wixstatic.com/media/eb9967_0719931637634500ba7ba4e8b4b9193b~mv2.png/v1/fill/w_372,h_260,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/67389084_2346556398731120_57365730817873.png" 
          alt="Lovelearning Logo" 
          className="mobile-logo"
        />
        <button className="mobile-toggle" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
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
            <p className="nav-label">Main</p>
            <NavLink to="/dashboard" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
              <LayoutDashboard size={20} />
              <span>Dashboard</span>
            </NavLink>
            <NavLink to="/chat" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
              <MessageSquare size={20} />
              <span>Chat Hub</span>
            </NavLink>
            <NavLink to="/calendar" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
              <Calendar size={20} />
              <span>Calendar</span>
            </NavLink>
            <NavLink to="/students" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
              <Users size={20} />
              <span>Students</span>
            </NavLink>
          </div>

          <div className="nav-section">
            <p className="nav-label">Management</p>
            <NavLink to="/billing" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
              <CreditCard size={20} />
              <span>Unified Billing</span>
            </NavLink>
            <NavLink to="/registration" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
              <ClipboardList size={20} />
              <span>Registration & Terms</span>
            </NavLink>
            <NavLink to="/session" onClick={closeMenu} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
              <ShieldCheck size={20} />
              <span>Class Session</span>
            </NavLink>
          </div>
        </nav>

        <div className="sidebar-footer">
          <div className="user-profile">
            <div className="avatar">AD</div>
            <div className="user-info">
              <p className="user-name">Admin User</p>
              <p className="user-role">Administrator</p>
            </div>
          </div>
          <button className="logout-btn">
            <LogOut size={18} />
          </button>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
