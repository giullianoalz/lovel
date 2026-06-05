import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
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
      setError('Por favor, ingresa correo y contraseña.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await loginWithEmail(email, password);
      navigate('/dashboard');
    } catch (err) {
      console.error(err);
      setError('Credenciales inválidas. Por favor intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handleDevBypass = async (seededEmail) => {
    setError('');
    setLoading(true);
    try {
      await loginAsSeededUser(seededEmail);
      navigate('/dashboard');
    } catch (err) {
      console.error(err);
      setError('Error al conectar con la base de datos de desarrollo.');
    } finally {
      setLoading(false);
    }
  };

  const seededUsers = [
    {
      name: 'Admin',
      role: 'ADMIN',
      email: 'admin@academy.com',
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
      name: 'Elena Garcia',
      role: 'PARENT',
      email: 'elena.garcia@example.com',
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
            src="https://static.wixstatic.com/media/eb9967_0719931637634500ba7ba4e8b4b9193b~mv2.png/v1/fill/w_372,h_260,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/67389084_2346556398731120_57365730817873.png" 
            alt="Lovelearning Logo" 
            className="login-logo"
          />
          <h2>Academy Management System</h2>
          <p>Ingresa a tu portal de aprendizaje</p>
        </div>

        {error && (
          <div className="login-error-banner">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="login-form">
          <div className="input-group">
            <label htmlFor="email">Correo Electrónico</label>
            <div className="input-field">
              <Mail size={18} className="input-icon" />
              <input 
                id="email"
                type="email" 
                placeholder="ejemplo@lovelearning.com" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                required
              />
            </div>
          </div>

          <div className="input-group">
            <label htmlFor="password">Contraseña</label>
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
            {loading ? 'Accediendo...' : 'Iniciar Sesión'}
          </button>
        </form>

        <div className="login-divider">
          <span>O ACCEDE COMO USUARIO DE PRUEBA</span>
        </div>

        <div className="dev-bypass-section">
          <p className="dev-bypass-subtitle">Selecciona uno de los perfiles sembrados en Neon PostgreSQL:</p>
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
      </div>
    </div>
  );
};

export default Login;
