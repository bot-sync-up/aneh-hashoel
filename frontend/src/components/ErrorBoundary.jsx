import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-6" dir="rtl">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-lg font-bold font-heebo text-[var(--text-primary)] mb-2">
              אירעה שגיאה
            </h2>
            <p className="text-sm text-[var(--text-muted)] font-heebo mb-6">
              משהו השתבש בטעינת הדף. נסה לרענן או לחזור לדף הבית.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1B2B5E] text-white text-sm font-medium font-heebo hover:bg-[#152348] transition-colors"
              >
                <RefreshCw size={15} />
                רענן דף
              </button>
              <a
                href="/"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border-default)] text-sm font-medium font-heebo text-[var(--text-primary)] hover:bg-[var(--bg-muted)] transition-colors"
              >
                <Home size={15} />
                דף הבית
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
