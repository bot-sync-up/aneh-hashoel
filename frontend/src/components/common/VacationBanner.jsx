import React, { useState, useCallback } from 'react';
import { Palmtree, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { put } from '../../lib/api';
import { showToast } from './Toast';

/**
 * VacationBanner — amber top-of-page banner shown when the logged-in rabbi
 * has vacation mode enabled (rabbi.is_vacation === true).
 *
 * - Only visible to the rabbi who owns the flag (not to admins viewing other profiles).
 * - Sends PUT /api/rabbis/profile with is_vacation: false when the rabbi dismisses it.
 * - Can be locally dismissed for the current session via the X button.
 */
export default function VacationBanner() {
  const { rabbi, updateRabbi } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(false);

  // Only render for the logged-in rabbi when vacation mode is on
  const shouldShow =
    rabbi &&
    rabbi.is_vacation === true &&
    !dismissed;

  const handleRemoveVacation = useCallback(async () => {
    setLoading(true);
    try {
      await put('/rabbis/profile', { is_vacation: false });
      // Update local auth context so the banner disappears immediately
      updateRabbi({ is_vacation: false });
      showToast.success('מצב החופשה הוסר בהצלחה');
    } catch (err) {
      const message =
        err?.response?.data?.message || 'אירעה שגיאה. אנא נסה שוב.';
      showToast.error(message);
    } finally {
      setLoading(false);
    }
  }, [updateRabbi]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  if (!shouldShow) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      dir="rtl"
      className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium font-heebo animate-fade-in"
      style={{
        backgroundColor: '#FEF3C7',
        borderBottom: '1px solid #FCD34D',
        color: '#92400E',
      }}
    >
      {/* Left: icon + message */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Palmtree
          size={16}
          strokeWidth={2}
          className="flex-shrink-0"
          aria-hidden="true"
          style={{ color: '#D97706' }}
        />
        <span className="truncate">
          אתה במצב חופשה — שאלות לא ישלחו אליך כרגע
        </span>
      </div>

      {/* Right: action + dismiss */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <button
          type="button"
          onClick={handleRemoveVacation}
          disabled={loading}
          className="text-sm font-semibold underline underline-offset-2 transition-opacity duration-150 hover:opacity-75 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 rounded"
          style={{ color: '#92400E', '--tw-ring-color': '#D97706' }}
        >
          {loading ? 'מעדכן...' : 'הסר מצב חופשה'}
        </button>

        <button
          type="button"
          onClick={handleDismiss}
          aria-label="סגור הודעה"
          className="p-0.5 rounded transition-opacity duration-150 hover:opacity-60 focus-visible:outline-none focus-visible:ring-2"
          style={{ color: '#92400E', '--tw-ring-color': '#D97706' }}
        >
          <X size={15} strokeWidth={2.5} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
