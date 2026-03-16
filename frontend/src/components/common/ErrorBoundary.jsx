import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

const IS_DEV = import.meta.env.DEV;

/**
 * ErrorBoundary — React class component that catches render-time errors
 * in the subtree below it and displays a friendly Hebrew error UI.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <SomeComponent />
 *   </ErrorBoundary>
 *
 * In development mode the raw error message and component stack are shown.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
    this.handleReload = this.handleReload.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });

    // Log to console in all environments; in production you could send to
    // a monitoring service (Sentry, LogRocket, etc.) here.
    console.error('[ErrorBoundary] Caught a render error:', error, errorInfo);
  }

  handleReload() {
    window.location.reload();
  }

  render() {
    const { hasError, error, errorInfo } = this.state;
    const { children, fallback } = this.props;

    if (!hasError) return children;

    // Allow a custom fallback to be passed via props
    if (fallback) return fallback;

    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-6 py-16 animate-fade-in"
        style={{ backgroundColor: 'var(--bg-page)' }}
        dir="rtl"
      >
        {/* Icon */}
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mb-6"
          style={{
            backgroundColor: 'rgba(239,68,68,0.10)',
          }}
        >
          <AlertTriangle
            size={36}
            strokeWidth={1.5}
            style={{ color: '#DC2626' }}
          />
        </div>

        {/* Heading */}
        <h1
          className="text-2xl font-bold text-center mb-3 font-heebo"
          style={{ color: 'var(--text-primary)' }}
        >
          משהו השתבש
        </h1>

        {/* Body */}
        <p
          className="text-base text-center mb-8 max-w-sm leading-relaxed font-heebo"
          style={{ color: 'var(--text-muted)' }}
        >
          אירעה שגיאה בלתי צפויה. ניתן לנסות לרענן את הדף,
          ואם הבעיה ממשיכה — פנה לצוות התמיכה.
        </p>

        {/* Retry button */}
        <button
          type="button"
          onClick={this.handleReload}
          className="inline-flex items-center gap-2 px-6 h-11 rounded-lg font-medium font-heebo text-sm transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{
            backgroundColor: '#1B2B5E',
            color: '#FFFFFF',
            '--tw-ring-color': '#B8973A',
          }}
        >
          <RefreshCw size={16} strokeWidth={2} />
          <span>רענן את הדף</span>
        </button>

        {/* Dev-mode error details */}
        {IS_DEV && error && (
          <details
            className="mt-10 w-full max-w-2xl rounded-xl overflow-hidden text-left"
            style={{
              border: '1px solid #FECACA',
              backgroundColor: '#FEF2F2',
            }}
          >
            <summary
              className="px-4 py-3 cursor-pointer text-sm font-semibold font-heebo select-none"
              style={{ color: '#991B1B', direction: 'rtl', textAlign: 'right' }}
            >
              פרטי שגיאה (מצב פיתוח)
            </summary>
            <div className="px-4 pb-4" dir="ltr">
              <pre
                className="text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap break-all mt-3"
                style={{ color: '#7F1D1D', fontFamily: 'monospace' }}
              >
                {error.toString()}
              </pre>
              {errorInfo?.componentStack && (
                <pre
                  className="text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap break-all mt-3 pt-3"
                  style={{
                    color: '#B91C1C',
                    fontFamily: 'monospace',
                    borderTop: '1px solid #FECACA',
                  }}
                >
                  {errorInfo.componentStack}
                </pre>
              )}
            </div>
          </details>
        )}
      </div>
    );
  }
}

export default ErrorBoundary;
