import React, { useState, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import { Palmtree, AlertTriangle, CalendarDays, CheckCircle, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import Button from '../ui/Button';

// ── Toggle switch ─────────────────────────────────────────────────────────────

function BigToggle({ checked, onChange, loading }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="מצב חופשה"
      disabled={loading}
      onClick={() => !loading && onChange(!checked)}
      className={clsx(
        'relative inline-flex h-8 w-16 flex-shrink-0 cursor-pointer rounded-full',
        'border-2 border-transparent transition-colors duration-300',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2',
        checked ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600',
        loading && 'opacity-60 cursor-not-allowed'
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          'pointer-events-none inline-block h-7 w-7 transform rounded-full',
          'bg-white shadow-md ring-0 transition-transform duration-300',
          checked ? 'translate-x-0' : 'translate-x-8'
        )}
      />
    </button>
  );
}

// ── Vacation Banner (exported for use in Layout) ───────────────────────────────

export function VacationBanner() {
  const [isVacation, setIsVacation] = useState(false);

  useEffect(() => {
    api.get('/rabbis/profile/vacation')
      .then(({ data }) => setIsVacation(data?.is_vacation ?? false))
      .catch(() => {});
  }, []);

  if (!isVacation) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        'flex items-center justify-center gap-2 py-2.5 px-4',
        'bg-amber-50 dark:bg-amber-900/20',
        'border-b border-amber-200 dark:border-amber-800',
        'text-amber-800 dark:text-amber-300',
        'text-sm font-heebo font-medium'
      )}
    >
      <Palmtree className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
      אתה במצב חופשה — שאלות לא ישלחו אליך
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function VacationMode({ onChange }) {
  const [isVacation, setIsVacation] = useState(false);
  const [returnDate, setReturnDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // 'success' | 'error'
  const [error, setError] = useState(null);

  // ── Load vacation state ────────────────────────────────────────────────────

  const fetchVacation = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/rabbis/profile/vacation');
      setIsVacation(data?.is_vacation ?? false);
      setReturnDate(
        data?.return_date
          ? new Date(data.return_date).toISOString().split('T')[0]
          : ''
      );
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVacation();
  }, [fetchVacation]);

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = async (newVacationState, newReturnDate) => {
    setSaving(true);
    setSaveStatus(null);
    setError(null);
    try {
      await api.put('/rabbis/profile/vacation', {
        is_vacation: newVacationState,
        return_date: newReturnDate || null,
      });
      setSaveStatus('success');
      if (onChange) onChange(newVacationState);
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'שגיאה בשמירה. נסה שוב.');
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = (val) => {
    setIsVacation(val);
    setSaveStatus(null);
    // Auto-save toggle immediately
    handleSave(val, returnDate);
  };

  const handleDateChange = (e) => {
    setReturnDate(e.target.value);
    setSaveStatus(null);
  };

  // ── Today's date for min constraint ───────────────────────────────────────

  const todayStr = new Date().toISOString().split('T')[0];

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin text-brand-navy dark:text-brand-gold" aria-label="טוען" />
      </div>
    );
  }

  return (
    <div className="space-y-5" dir="rtl">
      {/* Main toggle card */}
      <div
        className={clsx(
          'rounded-xl border p-5 transition-colors duration-200',
          isVacation
            ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-700'
            : 'bg-[var(--bg-surface)] border-[var(--border-default)]'
        )}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={clsx(
                'flex items-center justify-center w-12 h-12 rounded-xl',
                isVacation
                  ? 'bg-amber-100 dark:bg-amber-800/30 text-amber-600 dark:text-amber-400'
                  : 'bg-[var(--bg-muted)] text-[var(--text-muted)]'
              )}
            >
              <Palmtree className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-base font-semibold font-heebo text-[var(--text-primary)]">
                מצב חופשה
              </h3>
              <p className="text-sm text-[var(--text-muted)] font-heebo">
                {isVacation ? 'מצב חופשה פעיל' : 'כרגע אתה זמין לשאלות'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {saving && (
              <Loader2 className="w-4 h-4 animate-spin text-[var(--text-muted)]" aria-label="שומר" />
            )}
            <BigToggle
              checked={isVacation}
              onChange={handleToggle}
              loading={saving}
            />
          </div>
        </div>

        {/* Warning when active */}
        {isVacation && (
          <div
            role="status"
            className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-amber-100 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 text-sm font-heebo"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <span>בזמן החופשה לא תקבל שאלות. השאלות יופנו לרבנים אחרים.</span>
          </div>
        )}
      </div>

      {/* Return date picker — only when vacation is ON */}
      {isVacation && (
        <div
          className={clsx(
            'rounded-xl border p-5 space-y-3',
            'bg-[var(--bg-surface)] border-[var(--border-default)]'
          )}
        >
          <div className="flex items-center gap-2 mb-1">
            <CalendarDays className="w-4 h-4 text-[var(--text-muted)]" aria-hidden="true" />
            <h4 className="text-sm font-semibold font-heebo text-[var(--text-primary)]">
              תאריך חזרה משוער (אופציונלי)
            </h4>
          </div>

          <input
            type="date"
            id="return-date"
            name="return_date"
            value={returnDate}
            min={todayStr}
            onChange={handleDateChange}
            className={clsx(
              'block w-full max-w-xs px-3 py-2 rounded-lg border text-sm font-heebo',
              'bg-[var(--bg-surface)] border-[var(--border-default)]',
              'text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
              'focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-brand-gold',
              'transition-colors duration-150'
            )}
            aria-label="תאריך חזרה משוער"
          />

          <Button
            variant="primary"
            size="sm"
            onClick={() => handleSave(isVacation, returnDate)}
            loading={saving}
          >
            עדכן תאריך
          </Button>
        </div>
      )}

      {/* Status messages */}
      {saveStatus === 'success' && (
        <p
          role="status"
          className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400 font-heebo"
        >
          <CheckCircle className="w-4 h-4" aria-hidden="true" />
          מצב החופשה עודכן בהצלחה
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400 font-heebo"
        >
          <AlertTriangle className="w-4 h-4" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}
