import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

// App-wide safety net. Without this, a runtime error in ANY screen unmounts
// the whole React tree and the user is left staring at a blank white page
// (this is exactly what a broken socket import did to Front Desk Alerts).
// Here we catch it, keep the rest of the shell alive, and offer a way out.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Keep a breadcrumb for debugging; swap for a real logger if one exists.
    console.error('[ErrorBoundary] Caught a render error:', error, info?.componentStack);
  }

  // Reset so a route change or retry can re-render cleanly.
  handleRetry = () => this.setState({ hasError: false });

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-loader" role="alert">
          <div className="error-boundary-icon">
            <AlertTriangle size={28} />
          </div>
          <span className="app-loader-text">Something went wrong on this screen</span>
          <span className="app-loader-sub">The rest of the app is still fine — try again or reload.</span>
          <div className="error-boundary-actions">
            <button className="error-boundary-btn" onClick={this.handleRetry}>
              <RefreshCw size={15} /> Try again
            </button>
            <button className="error-boundary-btn ghost" onClick={() => window.location.reload()}>
              Reload app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
