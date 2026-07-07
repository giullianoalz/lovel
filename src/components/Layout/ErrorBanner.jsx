import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Displays a user-facing error message with an optional retry button.
 *
 * Usage:
 *   <ErrorBanner message={error} onRetry={retry} />
 */
const ErrorBanner = ({ message, onRetry }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '14px 18px', background: '#fef2f2', border: '1px solid #fecaca',
    borderRadius: '12px', margin: '16px 0',
  }}>
    <AlertTriangle size={18} style={{ color: '#dc2626', flexShrink: 0 }} />
    <span style={{ flex: 1, fontSize: '14px', color: '#991b1b', fontWeight: 500 }}>
      {message || 'An error occurred while loading data.'}
    </span>
    {onRetry && (
      <button
        onClick={onRetry}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '6px 12px', background: '#dc2626', color: 'white',
          border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        <RefreshCw size={13} /> Retry
      </button>
    )}
  </div>
);

export default ErrorBanner;
