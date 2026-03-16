import React, { useId } from 'react';
import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';

/**
 * RTL-compatible Select dropdown.
 *
 * @param {Array<{value: string, label: string, disabled?: boolean}>} options
 * @param {string} placeholder  — shown as disabled first option
 */
const Select = React.forwardRef(function Select(
  {
    id: externalId,
    label,
    error,
    helperText,
    options = [],
    placeholder,
    required,
    disabled,
    className,
    wrapperClassName,
    ...props
  },
  ref
) {
  const generatedId = useId();
  const id = externalId || generatedId;
  const hasError = Boolean(error);

  return (
    <div className={clsx('flex flex-col gap-1.5', wrapperClassName)}>
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

      <div className="relative">
        <select
          ref={ref}
          id={id}
          disabled={disabled}
          required={required}
          aria-invalid={hasError}
          aria-describedby={
            error
              ? `${id}-error`
              : helperText
              ? `${id}-helper`
              : undefined
          }
          className={clsx(
            // Base
            'w-full rounded-md border font-heebo text-sm',
            'bg-[var(--bg-surface)] text-[var(--text-primary)]',
            'transition-colors duration-150',
            'focus:outline-none focus:ring-2',
            'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-[var(--bg-muted)]',
            // Appearance — hide native arrow, we use our own
            'appearance-none',
            // RTL padding: right for text, left for arrow icon
            'pr-3 pl-10 py-2.5',
            // Cursor
            'cursor-pointer',
            // Variant
            hasError
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
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option
              key={opt.value}
              value={opt.value}
              disabled={opt.disabled}
            >
              {opt.label}
            </option>
          ))}
        </select>

        {/* Custom chevron (RTL: left side) */}
        <div
          className={clsx(
            'absolute inset-y-0 left-0 flex items-center pl-3',
            'pointer-events-none',
            hasError
              ? 'text-red-500'
              : 'text-[var(--text-muted)]'
          )}
          aria-hidden="true"
        >
          <ChevronDown size={16} strokeWidth={2} />
        </div>
      </div>

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

Select.displayName = 'Select';

export default Select;
