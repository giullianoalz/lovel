import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { 
  ShieldCheck, 
  User, 
  Users, 
  GraduationCap, 
  Lock, 
  Mail, 
  KeyRound,
  AlertCircle
} from 'lucide-react';
import './Login.css';

const Login = () => {
  const { loginWithEmail, loginAsSeededUser } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await loginWithEmail(email, password);
      navigate('/'); // SmartRoot routes each role to its portal
    } catch (err) {
      console.error(err);
      setError('Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDevBypass = async (seededEmail) => {
    setError('');
    setLoading(true);
    try {
      await loginAsSeededUser(seededEmail);
      navigate('/'); // SmartRoot routes each role to its portal
    } catch (err) {
      console.error(err);
      setError('The server is waking up — please wait a moment and try again.');
    } finally {
      setLoading(false);
    }
  };

  const seededUsers = [
    {
      name: 'Admin',
      role: 'ADMIN',
      email: 'lovelearningfl@gmail.com',
      icon: <ShieldCheck size={20} />,
      color: '#dc2626',
      bg: '#fef2f2'
    },
    {
      name: 'Prof. David Brown',
      role: 'TEACHER',
      email: 'david.brown@academy.com',
      icon: <GraduationCap size={20} />,
      color: '#1d4ed8',
      bg: '#eff6ff'
    },
    {
      name: 'Prof. Sarah Jenkins',
      role: 'TEACHER',
      email: 'sarah.jenkins@academy.com',
      icon: <GraduationCap size={20} />,
      color: '#1d4ed8',
      bg: '#eff6ff'
    },
    {
      name: 'Elena Garcia',
      role: 'PARENT',
      email: 'elena.garcia@example.com',
      icon: <Users size={20} />,
      color: '#7c3aed',
      bg: '#f5f3ff'
    },
    {
      name: 'Michael Doe',
      role: 'PARENT',
      email: 'michael.doe@example.com',
      icon: <Users size={20} />,
      color: '#7c3aed',
      bg: '#f5f3ff'
    },
    {
      name: 'Carlos Ramirez',
      role: 'PARENT',
      email: 'carlos.ramirez@example.com',
      icon: <Users size={20} />,
      color: '#7c3aed',
      bg: '#f5f3ff'
    },
    {
      name: 'Maria Garcia',
      role: 'STUDENT',
      email: 'maria.garcia@student.academy.com',
      icon: <User size={20} />,
      color: '#15803d',
      bg: '#f0fdf4'
    },
    {
      name: 'John Doe',
      role: 'STUDENT',
      email: 'john.doe@student.academy.com',
      icon: <User size={20} />,
      color: '#15803d',
      bg: '#f0fdf4'
    },
    {
      name: 'Sofia Ramirez',
      role: 'STUDENT',
      email: 'sofia.ramirez@student.academy.com',
      icon: <User size={20} />,
      color: '#15803d',
      bg: '#f0fdf4'
    }
  ];

  return (
    <div className="login-page">
      <div className="login-background-decor">
        <div className="blob blob-1"></div>
        <div className="blob blob-2"></div>
      </div>
      
      <div className="login-card glass">
        <div className="login-header">
          <img
            src="/logo.png"
            alt="Love Learning Explorers Logo"
            className="login-logo"
          />
          <h2>Love Learning Explorers</h2>
          <p>Sign in to your learning portal</p>
        </div>

        {error && (
          <div className="login-error-banner">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="login-form">
          <div className="input-group">
            <label htmlFor="email">Email</label>
            <div className="input-field">
              <Mail size={18} className="input-icon" />
              <input 
                id="email"
                type="email" 
                placeholder="example@lovelearning.com" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                required
              />
            </div>
          </div>

          <div className="input-group">
            <label htmlFor="password">Password</label>
            <div className="input-field">
              <Lock size={18} className="input-icon" />
              <input 
                id="password"
                type="password" 
                placeholder="••••••••" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
              />
            </div>
          </div>

          <button type="submit" className="login-submit-btn" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="login-signup-cta">
          New family? <Link to="/signup">Create an account</Link>
        </p>

        {(import.meta.env.DEV || import.meta.env.VITE_ENABLE_TEST_LOGIN === 'true') && (
          <>
            <div className="login-divider">
              <span>OR SIGN IN AS A TEST USER</span>
            </div>

            <div className="dev-bypass-section">
              <p className="dev-bypass-subtitle">Select one of the seeded profiles in Neon PostgreSQL:</p>
              <div className="dev-bypass-grid">
                {seededUsers.map((u, i) => (
                  <button
                    key={i}
                    type="button"
                    className="dev-bypass-btn"
                    style={{ '--accent-color': u.color, '--bg-color': u.bg }}
                    onClick={() => handleDevBypass(u.email)}
                    disabled={loading}
                  >
                    <div className="dev-bypass-icon" style={{ color: u.color, backgroundColor: u.bg }}>
                      {u.icon}
                    </div>
                    <div className="dev-bypass-text">
                      <span className="dev-bypass-name">{u.name}</span>
                      <span className="dev-bypass-role">{u.role}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Login;
