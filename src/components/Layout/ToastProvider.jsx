import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';
import './ToastProvider.css';

const ToastContext = createContext(null);

/**
 * App-wide toast notifications. Replaces native alert().
 * Usage:  const toast = useToast();  toast.success('Saved'); toast.error('Oops');
 */
export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const push = useCallback((message, type = 'info', duration = 4000) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts(prev => [...prev, { id, message, type }]);
    if (duration > 0) setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  const api = {
    show: push,
    success: (m, d) => push(m, 'success', d),
    error: (m, d) => push(m, 'error', d ?? 6000),
    info: (m, d) => push(m, 'info', d),
  };

  const ICONS = { success: <CheckCircle size={18} />, error: <AlertCircle size={18} />, info: <Info size={18} /> };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-host" role="region" aria-live="polite" aria-label="Notifications">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast--${t.type}`} role="status">
            <span className="toast-icon">{ICONS[t.type]}</span>
            <span className="toast-msg">{t.message}</span>
            <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Close notification">
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const ctx = useContext(ToastContext);
  // Fallback so components never crash if used outside the provider.
  if (!ctx) {
    return {
      show: (m) => console.log('[toast]', m),
      success: (m) => console.log('[toast:success]', m),
      error: (m) => console.error('[toast:error]', m),
      info: (m) => console.log('[toast:info]', m),
    };
  }
  return ctx;
};
