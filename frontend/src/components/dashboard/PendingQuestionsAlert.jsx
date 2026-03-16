import React, { useState, useEffect } from 'react';
import { clsx } from 'clsx';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, X, ArrowLeft } from 'lucide-react';

const SESSION_KEY = 'pending_alert_dismissed';

/**
 * PendingQuestionsAlert — amber alert bar shown when pendingCount > 0.
 * Dismissible per session (sessionStorage).
 *
 * @param {number}  pendingCount
 * @param {boolean} loading
 */
export default function PendingQuestionsAlert({ pendingCount = 0, loading = false }) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(SESSION_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Reset dismiss state if count changes to 0 so bar auto-hides cleanly
  useEffect(() => {
    if (pendingCount === 0) {
      try {
        sessionStorage.removeItem(SESSION_KEY);
      } catch {}
      setDismissed(false);
    }
  }, [pendingCount]);

  if (loading || pendingCount === 0 || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(SESSION_KEY, 'true');
    } catch {}
  };

  const handleNavigate = () => {
    navigate('/questions?status=pending');
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      className={clsx(
        'flex items-center gap-3 px-4 py-3',
        'bg-amber-50 dark:bg-amber-900/20',
        'border-b border-amber-200 dark:border-amber-700',
        'text-amber-800 dark:text-amber-300',
        'font-heebo text-sm'
      )}
      dir="rtl"
    >
      {/* Icon */}
      <AlertTriangle
        className="w-4 h-4 flex-shrink-0 text-amber-500"
        aria-hidden="true"
      />

      {/* Message — clickable */}
      <button
        onClick={handleNavigate}
        className={clsx(
          'flex-1 text-right font-medium',
          'hover:underline underline-offset-2',
          'transition-colors duration-150',
          'focus:outline-none focus-visible:underline'
        )}
      >
        יש{' '}
        <span className="font-bold text-amber-700 dark:text-amber-200">
          {pendingCount}
        </span>{' '}
        {pendingCount === 1 ? 'שאלה הממתינה' : 'שאלות הממתינות'} לתגובה
      </button>

      {/* CTA */}
      <button
        onClick={handleNavigate}
        className={clsx(
          'flex items-center gap-1 text-xs font-semibold',
          'px-3 py-1 rounded-full',
          'bg-amber-200 dark:bg-amber-800/60 text-amber-800 dark:text-amber-200',
          'hover:bg-amber-300 dark:hover:bg-amber-700/70',
          'transition-colors duration-150 flex-shrink-0',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400'
        )}
        aria-label="עבור לשאלות ממתינות"
      >
        <span>לצפייה</span>
        <ArrowLeft className="w-3 h-3" aria-hidden="true" />
      </button>

      {/* Dismiss */}
      <button
        onClick={handleDismiss}
        aria-label="סגור התראה"
        className={clsx(
          'flex-shrink-0 p-1 rounded',
          'text-amber-500 hover:text-amber-700 dark:hover:text-amber-200',
          'hover:bg-amber-100 dark:hover:bg-amber-800/40',
          'transition-colors duration-150',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400'
        )}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
