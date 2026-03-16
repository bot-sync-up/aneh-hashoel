import React, { useId, useState } from 'react';
import { clsx } from 'clsx';
import { Eye, EyeOff, Search } from 'lucide-react';

/**
 * RTL Input with label, error, helper text, and optional icons.
 * Supports text, email, password (with toggle visibility), and search types.
 *
 * @param {'default'|'error'} variant
 * @param {React.ReactNode} startIcon - icon displayed on the right side (RTL start)
 * @param {React.ReactNode} endIcon   - icon displayed on the left side (RTL end)
 */
const Input = React.forwardRef(function Input(
  {
    id: externalId,
    label,
    error,
    helperText,
    variant,
    type = 'text',
    startIcon,
    endIcon,
    className,
    wrapperClassName,
    required,
    disabled,
    ...props
  },
  ref
) {
  const generatedId = useId();
  const id = externalId || generatedId;
  const hasError = variant === 'error' || Boolean(error);
  const [showPassword, setShowPassword] = useState(false);

  const isPassword = type === 'password';
  const isSearch = type === 'search';
  const inputType = isPassword ? (showPassword ? 'text' : 'password') : type;

  const resolvedStartIcon = startIcon || (isSearch ? <Search size={16} /> : null);
  const hasStartIcon = Boolean(resolvedStartIcon);

  const hasEndAction = isPassword;
  const hasEndIcon = Boolean(endIcon) || hasEndAction;

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
        {/* Start icon (RTL: right side) */}
        {hasStartIcon && (
          <div
            className={clsx(
              'absolute inset-y-0 right-0 flex items-center pr-3',
              'pointer-events-none text-[var(--text-muted)]',
              '[&>svg]:w-4 [&>svg]:h-4'
            )}
          >
            {resolvedStartIcon}
          </div>
        )}

        <input
          ref={ref}
          id={id}
          type={inputType}
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
            'placeholder:text-[var(--text-muted)]',
            'transition-colors duration-150',
            'focus:outline-none focus:ring-2',
            'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-[var(--bg-muted)]',
            // Direction
            'direction-rtl text-right',
            // Padding based on icons
            hasStartIcon ? 'pr-10' : 'pr-3',
            hasEndIcon ? 'pl-10' : 'pl-3',
            'py-2.5',
            // Variant
            hasError
              ? [
                  'border-red-400 dark:border-red-500',
                  'focus:ring-red-300 dark:focus:ring-red-600',
                  'focus:border-red-500',
                ]
              : [
                  'border-[var(--border-default)]',
                  'focus:ring-brand-gold/40 dark:focus:ring-dark-accent/40',
                  'focus:border-brand-gold dark:focus:border-dark-accent',
                  'hover:border-[var(--border-strong)]',
                ],
            className
          )}
          {...props}
        />

        {/* End icon / password toggle (RTL: left side) */}
        {isPassword ? (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={showPassword ? 'הסתר סיסמה' : 'הצג סיסמה'}
            className={clsx(
              'absolute inset-y-0 left-0 flex items-center pl-3',
              'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
              'transition-colors duration-150',
              '[&>svg]:w-4 [&>svg]:h-4'
            )}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        ) : endIcon ? (
          <div
            className={clsx(
              'absolute inset-y-0 left-0 flex items-center pl-3',
              'pointer-events-none text-[var(--text-muted)]',
              '[&>svg]:w-4 [&>svg]:h-4'
            )}
          >
            {endIcon}
          </div>
        ) : null}
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

      {/* Helper text (shown only when no error) */}
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

Input.displayName = 'Input';

export default Input;
