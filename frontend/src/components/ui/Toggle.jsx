import React, { useId } from 'react';
import { clsx } from 'clsx';

/**
 * Accessible toggle switch component.
 *
 * @param {boolean} checked         — controlled value
 * @param {(checked: boolean) => void} onChange — change handler
 * @param {string} label            — visible label text
 * @param {string} description      — optional helper text below the label
 * @param {'sm'|'md'|'lg'} size     — toggle size (default: 'md')
 * @param {boolean} disabled        — disables interaction
 * @param {'right'|'left'} labelPlacement — where the label sits (RTL: 'right' = visually after)
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

  // Use translate + RTL-aware inset so toggle direction is correct in RTL layouts.
  // OFF: thumb sits at the start (inline-start).  ON: thumb slides to the end.
  const thumbTranslate = {
    sm: checked ? 'translate-x-4 rtl:-translate-x-4' : 'translate-x-0',
    md: checked ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0',
    lg: checked ? 'translate-x-7 rtl:-translate-x-7' : 'translate-x-0',
  };

  const handleKeyDown = (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!disabled) onChange?.(!checked);
    }
  };

  const track = (
    <span
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
      {/* Thumb — uses translate for correct RTL/LTR behavior */}
      <span
        aria-hidden="true"
        className={clsx(
          'inline-block rounded-full bg-white shadow-sm',
          'transition-transform duration-200 ease-in-out',
          'mt-0.5 ms-0.5',
          thumbSize[size] || thumbSize.md,
          thumbTranslate[size] || thumbTranslate.md
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
