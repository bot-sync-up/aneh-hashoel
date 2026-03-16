import React from 'react';
import { clsx } from 'clsx';

const sizeMap = {
  xs: 'w-3 h-3 border-[1.5px]',
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-8 h-8 border-[3px]',
  xl: 'w-12 h-12 border-4',
};

const colorMap = {
  brand: 'border-brand-navy/20 border-t-brand-navy dark:border-dark-accent/20 dark:border-t-dark-accent',
  gold: 'border-brand-gold/20 border-t-brand-gold',
  white: 'border-white/30 border-t-white',
  current: 'border-current/20 border-t-current',
  gray: 'border-gray-300 border-t-gray-600 dark:border-gray-700 dark:border-t-gray-400',
};

/**
 * Loading spinner.
 *
 * @param {'xs'|'sm'|'md'|'lg'|'xl'} size
 * @param {'brand'|'gold'|'white'|'current'|'gray'} color
 * @param {string} label  — screen-reader label (default: 'טוען...')
 */
export function Spinner({
  size = 'md',
  color = 'brand',
  label = 'טוען...',
  className,
  ...props
}) {
  return (
    <span
      role="status"
      aria-label={label}
      className={clsx('inline-flex items-center justify-center', className)}
      {...props}
    >
      <span
        className={clsx(
          'rounded-full animate-spin',
          sizeMap[size] || sizeMap.md,
          colorMap[color] || colorMap.brand
        )}
        aria-hidden="true"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Full-page loading overlay
 */
export function FullPageSpinner({ label = 'טוען...' }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-page)]"
      role="status"
      aria-label={label}
    >
      <div className="flex flex-col items-center gap-4">
        <Spinner size="xl" color="brand" />
        <p className="text-sm text-[var(--text-muted)] font-heebo">{label}</p>
      </div>
    </div>
  );
}

/**
 * Inline loading block (centered in its container)
 */
export function BlockSpinner({ label = 'טוען...', className }) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center gap-3 py-12',
        className
      )}
      role="status"
      aria-label={label}
    >
      <Spinner size="lg" color="brand" />
      <p className="text-sm text-[var(--text-muted)] font-heebo">{label}</p>
    </div>
  );
}

export default Spinner;
