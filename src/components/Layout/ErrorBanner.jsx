import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import './ErrorBanner.css';

/**
 * Displays a user-facing error message with an optional retry button.
 *
 * Usage:
 *   <ErrorBanner message={error} onRetry={retry} />
 */
const ErrorBanner = ({ message, onRetry }) => (
  <div className="error-banner">
    <AlertTriangle size={18} className="error-banner-icon" />
    <span className="error-banner-message">
      {message || 'An error occurred while loading data.'}
    </span>
    {onRetry && (
      <button onClick={onRetry} className="error-banner-retry">
        <RefreshCw size={13} /> Retry
      </button>
    )}
  </div>
);

export default ErrorBanner;
