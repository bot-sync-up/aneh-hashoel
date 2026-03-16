import React, { useCallback, useId } from 'react';
import { clsx } from 'clsx';
import { Calendar } from 'lucide-react';

/**
 * Format a Date to the YYYY-MM-DD string required by <input type="date">.
 */
function toInputDate(date) {
  if (!date) return '';
  if (typeof date === 'string') return date.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

/**
 * DateRangePicker — two date inputs ("מתאריך" / "עד תאריך") in RTL layout.
 *
 * @param {{ from: string|Date|null, to: string|Date|null }} value
 *   Current range. Dates can be ISO strings or Date objects.
 * @param {(range: { from: string, to: string }) => void} onChange
 *   Called with the updated range whenever either date changes.
 *   `to` is validated to be >= `from`; if not, it is cleared.
 * @param {string}  [className]    — extra wrapper classes
 * @param {boolean} [disabled]     — disables both inputs
 * @param {string}  [minDate]      — ISO date string for the `min` attr on "from"
 * @param {string}  [maxDate]      — ISO date string for the `max` attr on "to"
 */
export default function DateRangePicker({
  value = { from: '', to: '' },
  onChange,
  className,
  disabled = false,
  minDate,
  maxDate,
}) {
  const uid = useId();
  const fromId = `${uid}-from`;
  const toId = `${uid}-to`;

  const fromStr = toInputDate(value?.from);
  const toStr = toInputDate(value?.to);

  const handleFromChange = useCallback(
    (e) => {
      const newFrom = e.target.value;
      // If "to" is now before "from", clear it
      const newTo = toStr && toStr < newFrom ? '' : toStr;
      onChange?.({ from: newFrom, to: newTo });
    },
    [toStr, onChange]
  );

  const handleToChange = useCallback(
    (e) => {
      const newTo = e.target.value;
      // Validate: to must be >= from
      if (fromStr && newTo && newTo < fromStr) return;
      onChange?.({ from: fromStr, to: newTo });
    },
    [fromStr, onChange]
  );

  // Shared input classes
  const inputClass = clsx(
    'h-9 rounded-lg border text-sm font-heebo px-3',
    'transition-all duration-150',
    'focus:outline-none focus:ring-2',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    'w-full'
  );

  const inputStyle = {
    backgroundColor: 'var(--bg-surface)',
    borderColor: 'var(--border-default)',
    color: 'var(--text-primary)',
    '--tw-ring-color': 'rgba(184,151,58,0.4)',
    colorScheme: 'light',
  };

  const labelClass = 'text-xs font-medium font-heebo mb-1 block';

  return (
    <div
      className={clsx('flex items-end gap-3 flex-row', className)}
      dir="rtl"
      role="group"
      aria-label="טווח תאריכים"
    >
      {/* "מתאריך" (from) */}
      <div className="flex flex-col flex-1 min-w-0">
        <label
          htmlFor={fromId}
          className={labelClass}
          style={{ color: 'var(--text-secondary)' }}
        >
          <span className="flex items-center gap-1">
            <Calendar size={12} strokeWidth={2} aria-hidden="true" />
            מתאריך
          </span>
        </label>
        <input
          id={fromId}
          type="date"
          value={fromStr}
          onChange={handleFromChange}
          disabled={disabled}
          min={minDate}
          max={maxDate || toStr || undefined}
          className={inputClass}
          style={inputStyle}
        />
      </div>

      {/* Separator */}
      <div
        className="pb-2 text-sm font-heebo flex-shrink-0"
        aria-hidden="true"
        style={{ color: 'var(--text-muted)' }}
      >
        —
      </div>

      {/* "עד תאריך" (to) */}
      <div className="flex flex-col flex-1 min-w-0">
        <label
          htmlFor={toId}
          className={labelClass}
          style={{ color: 'var(--text-secondary)' }}
        >
          <span className="flex items-center gap-1">
            <Calendar size={12} strokeWidth={2} aria-hidden="true" />
            עד תאריך
          </span>
        </label>
        <input
          id={toId}
          type="date"
          value={toStr}
          onChange={handleToChange}
          disabled={disabled}
          min={fromStr || minDate || undefined}
          max={maxDate}
          className={inputClass}
          style={inputStyle}
        />
      </div>

      {/* Clear both button — only shown when either date is set */}
      {(fromStr || toStr) && !disabled && (
        <button
          type="button"
          onClick={() => onChange?.({ from: '', to: '' })}
          aria-label="נקה טווח תאריכים"
          className="pb-1 text-xs font-heebo underline underline-offset-2 flex-shrink-0 transition-opacity hover:opacity-60 focus-visible:outline-none focus-visible:ring-2 rounded"
          style={{
            color: 'var(--text-muted)',
            '--tw-ring-color': 'rgba(184,151,58,0.4)',
          }}
        >
          נקה
        </button>
      )}
    </div>
  );
}
