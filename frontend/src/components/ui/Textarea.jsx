import React, { useId, useRef, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';

/**
 * Auto-resizing Textarea with label, error, and optional character count.
 *
 * @param {number}  maxLength       — enables character count display
 * @param {boolean} autoResize      — auto-expand height as user types (default true)
 * @param {number}  minRows         — minimum visible rows (default 3)
 * @param {number}  maxRows         — max rows before scrollbar appears
 */
const Textarea = React.forwardRef(function Textarea(
  {
    id: externalId,
    label,
    error,
    helperText,
    maxLength,
    autoResize = true,
    minRows = 3,
    maxRows,
    required,
    disabled,
    className,
    wrapperClassName,
    onChange,
    value,
    defaultValue,
    ...props
  },
  ref
) {
  const generatedId = useId();
  const id = externalId || generatedId;
  const hasError = Boolean(error);
  const internalRef = useRef(null);
  const textareaRef = ref || internalRef;

  const charCount =
    typeof value === 'string'
      ? value.length
      : typeof defaultValue === 'string'
      ? defaultValue.length
      : 0;

  const isOverLimit = maxLength && charCount > maxLength;

  // Auto-resize logic
  const resize = useCallback(() => {
    const el = typeof textareaRef === 'function' ? null : textareaRef?.current;
    if (!el || !autoResize) return;

    el.style.height = 'auto';

    const lineHeight = parseInt(getComputedStyle(el).lineHeight) || 24;
    const paddingTop = parseInt(getComputedStyle(el).paddingTop) || 0;
    const paddingBottom = parseInt(getComputedStyle(el).paddingBottom) || 0;
    const minHeight = lineHeight * minRows + paddingTop + paddingBottom;
    const maxHeight = maxRows
      ? lineHeight * maxRows + paddingTop + paddingBottom
      : Infinity;

    const newHeight = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
    el.style.height = `${newHeight}px`;

    if (maxRows && el.scrollHeight > maxHeight) {
      el.style.overflowY = 'auto';
    } else {
      el.style.overflowY = 'hidden';
    }
  }, [autoResize, minRows, maxRows, textareaRef]);

  useEffect(() => {
    resize();
  }, [value, resize]);

  useEffect(() => {
    resize();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = useCallback(
    (e) => {
      resize();
      onChange?.(e);
    },
    [onChange, resize]
  );

  return (
    <div className={clsx('flex flex-col gap-1.5', wrapperClassName)}>
      {/* Label row */}
      <div className="flex items-baseline justify-between">
        {label && (
          <label
            htmlFor={id}
            className={clsx(
              'text-sm font-medium font-heebo',
              hasError
                ? 'text-red-600 dark:text-red-400'
                : 'text-[var(--text-primary)]'
            )}
          >
            {label}
            {required && (
              <span className="text-red-500 mr-1" aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}

        {maxLength && (
          <span
            className={clsx(
              'text-xs font-heebo tabular-nums',
              isOverLimit
                ? 'text-red-600 dark:text-red-400 font-semibold'
                : 'text-[var(--text-muted)]'
            )}
            aria-live="polite"
          >
            {charCount} / {maxLength}
          </span>
        )}
      </div>

      <textarea
        ref={textareaRef}
        id={id}
        disabled={disabled}
        required={required}
        maxLength={maxLength}
        value={value}
        defaultValue={defaultValue}
        onChange={handleChange}
        aria-invalid={hasError || isOverLimit}
        aria-describedby={
          error
            ? `${id}-error`
            : helperText
            ? `${id}-helper`
            : undefined
        }
        rows={minRows}
        className={clsx(
          // Base
          'w-full rounded-md border font-heebo text-sm',
          'bg-[var(--bg-surface)] text-[var(--text-primary)]',
          'placeholder:text-[var(--text-muted)]',
          'transition-colors duration-150',
          'focus:outline-none focus:ring-2',
          'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-[var(--bg-muted)]',
          // RTL
          'direction-rtl text-right',
          // Padding
          'px-3 py-2.5',
          // Resize
          autoResize ? 'resize-none overflow-hidden' : 'resize-y',
          // Variant
          hasError || isOverLimit
            ? [
                'border-red-400 dark:border-red-500',
                'focus:ring-red-300 dark:focus:ring-red-600',
                'focus:border-red-500',
              ]
            : [
                'border-[var(--border-default)]',
                'hover:border-[var(--border-strong)]',
                'focus:ring-brand-gold/40 dark:focus:ring-dark-accent/40',
                'focus:border-brand-gold dark:focus:border-dark-accent',
              ],
          className
        )}
        {...props}
      />

      {/* Error message */}
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-xs text-red-600 dark:text-red-400 font-heebo"
        >
          {error}
        </p>
      )}

      {/* Helper text */}
      {helperText && !error && (
        <p
          id={`${id}-helper`}
          className="text-xs text-[var(--text-muted)] font-heebo"
        >
          {helperText}
        </p>
      )}
    </div>
  );
});

Textarea.displayName = 'Textarea';

export default Textarea;
