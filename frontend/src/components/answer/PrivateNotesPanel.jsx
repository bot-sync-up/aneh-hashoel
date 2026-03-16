import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
} from 'react';
import { Lock, ChevronDown, ChevronUp } from 'lucide-react';
import { clsx } from 'clsx';
import api from '../../lib/api';

const MAX_CHARS = 2000;
const DEBOUNCE_MS = 1000;

/**
 * PrivateNotesPanel
 *
 * Collapsible panel for rabbi's internal notes on a question.
 * Visible only to the assigned rabbi (caller is responsible for conditional render).
 *
 * Auto-saves on blur (debounced 1 s) via PUT /api/questions/:id/notes
 *
 * Props:
 *   questionId    {string|number}
 *   initialNotes  {string}         — pre-loaded notes text
 */
export default function PrivateNotesPanel({ questionId, initialNotes = '' }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [saveError, setSaveError] = useState(null);

  const debounceRef = useRef(null);
  const latestNotesRef = useRef(notes);

  // Keep ref in sync so the debounced callback always uses the latest value
  useEffect(() => {
    latestNotesRef.current = notes;
  }, [notes]);

  // ── Save helper ──────────────────────────────────────────────────────────
  const persistNotes = useCallback(async () => {
    if (!questionId) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.put(`/questions/${questionId}/notes`, {
        notes: latestNotesRef.current,
      });
      setLastSaved(new Date());
    } catch (err) {
      setSaveError(
        err?.response?.data?.message || 'שגיאה בשמירת ההערות.'
      );
    } finally {
      setSaving(false);
    }
  }, [questionId]);

  // ── Handle change with debounce ──────────────────────────────────────────
  const handleChange = (e) => {
    const val = e.target.value;
    if (val.length > MAX_CHARS) return;
    setNotes(val);
  };

  // ── Blur → debounced save ────────────────────────────────────────────────
  const handleBlur = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      persistNotes();
    }, DEBOUNCE_MS);
  }, [persistNotes]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ── Format last-saved time ────────────────────────────────────────────────
  function formatSavedAt(date) {
    return date.toLocaleTimeString('he-IL', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const charCount = notes.length;
  const charPct = (charCount / MAX_CHARS) * 100;
  const charWarning = charCount >= MAX_CHARS * 0.9;

  return (
    <div
      className="rounded-lg border border-[var(--border-default)] overflow-hidden"
      dir="rtl"
    >
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={clsx(
          'w-full flex items-center gap-2 px-4 py-3',
          'bg-[var(--bg-surface-raised)]',
          'text-sm font-medium font-heebo text-[var(--text-secondary)]',
          'hover:bg-[var(--bg-muted)] transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-gold'
        )}
      >
        <Lock
          size={14}
          strokeWidth={2.2}
          className="text-[var(--text-muted)] flex-shrink-0"
          aria-hidden="true"
        />
        <span className="flex-1 text-start">
          הערות פנימיות — לא יפורסמו לציבור
        </span>
        {open ? (
          <ChevronUp size={16} strokeWidth={2} aria-hidden="true" />
        ) : (
          <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
        )}
      </button>

      {/* Collapsible body */}
      {open && (
        <div className="border-t border-[var(--border-default)] bg-[var(--bg-surface)]">
          <div className="px-4 pt-3 pb-2">
            <textarea
              value={notes}
              onChange={handleChange}
              onBlur={handleBlur}
              placeholder="הוסף הערות פנימיות — נראות רק לך..."
              dir="rtl"
              rows={5}
              maxLength={MAX_CHARS}
              aria-label="הערות פנימיות"
              className={clsx(
                'w-full px-3 py-2 resize-y',
                'text-sm font-heebo text-[var(--text-primary)] leading-relaxed',
                'bg-[var(--bg-surface-raised)]',
                'border border-[var(--border-default)] rounded-md',
                'placeholder:text-[var(--text-muted)]',
                'focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-transparent',
                'transition-colors duration-150'
              )}
            />
          </div>

          {/* Bottom bar */}
          <div className="px-4 pb-3 flex items-center justify-between gap-4">
            {/* Status */}
            <span className="text-xs font-heebo text-[var(--text-muted)]">
              {saving && 'שומר...'}
              {!saving && saveError && (
                <span className="text-red-500">{saveError}</span>
              )}
              {!saving && !saveError && lastSaved && (
                <span>נשמר ב-{formatSavedAt(lastSaved)}</span>
              )}
            </span>

            {/* Character count */}
            <span
              className={clsx(
                'text-xs font-heebo tabular-nums',
                charWarning
                  ? 'text-amber-600 dark:text-amber-400 font-semibold'
                  : 'text-[var(--text-muted)]'
              )}
              aria-live="polite"
            >
              {charCount.toLocaleString('he-IL')} / {MAX_CHARS.toLocaleString('he-IL')} תווים
            </span>
          </div>

          {/* Progress bar when near limit */}
          {charWarning && (
            <div className="h-0.5 bg-[var(--bg-muted)] mx-4 mb-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 transition-all duration-300 rounded-full"
                style={{ width: `${Math.min(charPct, 100)}%` }}
                aria-hidden="true"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
