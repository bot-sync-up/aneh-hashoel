import React, { useId } from 'react';
import { clsx } from 'clsx';

/**
 * Accessible toggle switch component — works correctly in RTL layouts.
 */
function Toggle({
  checked = false,
  onChange,
  label,
  description,
  size = 'md',
  disabled = false,
  labelPlacement = 'right',
  className,
  id: externalId,
  ...props
}) {
  const generatedId = useId();
  const id = externalId || generatedId;
  const descId = description ? `${id}-desc` : undefined;

  const trackSize = {
    sm: 'w-8 h-4',
    md: 'w-11 h-6',
    lg: 'w-14 h-7',
  };

  const thumbSize = {
    sm: 'w-3 h-3',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  };

  const handleKeyDown = (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!disabled) onChange?.(!checked);
    }
  };

  // Force LTR on the track so translate always works left→right
  const track = (
    <span
      dir="ltr"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      aria-describedby={descId}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={handleKeyDown}
      onClick={() => !disabled && onChange?.(!checked)}
      className={clsx(
        'relative inline-flex items-center flex-shrink-0 rounded-full',
        'transition-colors duration-200 ease-in-out',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2',
        'focus-visible:ring-offset-[var(--bg-surface)]',
        trackSize[size] || trackSize.md,
        checked
          ? 'bg-brand-navy dark:bg-dark-accent'
          : 'bg-gray-300 dark:bg-gray-600',
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : 'cursor-pointer'
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          'absolute top-0.5 left-0.5 rounded-full bg-white shadow-sm',
          'transition-transform duration-200 ease-in-out',
          thumbSize[size] || thumbSize.md,
          checked && size === 'sm' && 'translate-x-4',
          checked && (size === 'md' || !size) && 'translate-x-5',
          checked && size === 'lg' && 'translate-x-7',
        )}
      />
    </span>
  );

  if (!label) {
    return (
      <span className={clsx('inline-flex', className)} {...props}>
        {track}
      </span>
    );
  }

  return (
    <label
      htmlFor={id}
      className={clsx(
        'inline-flex items-start gap-3',
        labelPlacement === 'left' ? 'flex-row-reverse' : 'flex-row',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        className
      )}
      {...props}
    >
      {track}

      <span className="flex flex-col min-w-0">
        <span className="text-sm font-medium text-[var(--text-primary)] font-heebo leading-snug">
          {label}
        </span>
        {description && (
          <span
            id={descId}
            className="text-xs text-[var(--text-muted)] font-heebo mt-0.5"
          >
            {description}
          </span>
        )}
      </span>
    </label>
  );
}

export default Toggle;
