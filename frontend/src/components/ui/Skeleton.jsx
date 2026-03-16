import React from 'react';
import { clsx } from 'clsx';

/**
 * Skeleton loading placeholder.
 *
 * @param {'text'|'card'|'avatar'|'button'|'line'|'block'} variant
 * @param {'sm'|'md'|'lg'} size   — affects height for text/line variants
 * @param {string} width          — Tailwind width class (e.g. 'w-32', 'w-full')
 * @param {string} height         — Tailwind height class override
 * @param {number} lines          — for 'text' variant: number of text lines
 * @param {boolean} rounded       — use full rounding (pill shape)
 * @param {string} className      — additional classes
 */
function Skeleton({
  variant = 'line',
  size = 'md',
  width,
  height,
  lines = 3,
  rounded = false,
  className,
  ...props
}) {
  const baseClasses = clsx(
    'skeleton',
    rounded ? 'rounded-full' : 'rounded-md',
    className
  );

  // ── Text variant: stacked lines ──────────────────────────────────────
  if (variant === 'text') {
    const lineHeights = { sm: 'h-3', md: 'h-4', lg: 'h-5' };
    const lineH = lineHeights[size] || lineHeights.md;

    return (
      <div className="flex flex-col gap-2" {...props}>
        {Array.from({ length: lines }).map((_, i) => (
          <span
            key={i}
            className={clsx(
              'skeleton block rounded-md',
              lineH,
              // Last line is shorter for a natural look
              i === lines - 1 && lines > 1 ? 'w-3/5' : 'w-full'
            )}
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  // ── Avatar variant: circle ───────────────────────────────────────────
  if (variant === 'avatar') {
    const avatarSizes = {
      sm: 'w-8 h-8',
      md: 'w-10 h-10',
      lg: 'w-14 h-14',
    };
    return (
      <span
        className={clsx(
          'skeleton block rounded-full flex-shrink-0',
          avatarSizes[size] || avatarSizes.md,
          width,
          height,
          className
        )}
        aria-hidden="true"
        {...props}
      />
    );
  }

  // ── Card variant: full card placeholder ─────────────────────────────
  if (variant === 'card') {
    return (
      <div
        className={clsx(
          'rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5',
          'space-y-4',
          width || 'w-full',
          className
        )}
        aria-hidden="true"
        {...props}
      >
        {/* Card header row */}
        <div className="flex items-center gap-3">
          <span className="skeleton block rounded-full w-10 h-10 flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <span className="skeleton block h-4 w-2/3 rounded-md" />
            <span className="skeleton block h-3 w-1/3 rounded-md" />
          </div>
        </div>

        {/* Body lines */}
        <div className="space-y-2">
          <span className="skeleton block h-4 w-full rounded-md" />
          <span className="skeleton block h-4 w-5/6 rounded-md" />
          <span className="skeleton block h-4 w-4/6 rounded-md" />
        </div>

        {/* Footer row */}
        <div className="flex items-center gap-2 pt-1">
          <span className="skeleton block h-6 w-16 rounded-full" />
          <span className="skeleton block h-6 w-20 rounded-full" />
        </div>
      </div>
    );
  }

  // ── Button variant ───────────────────────────────────────────────────
  if (variant === 'button') {
    const buttonSizes = {
      sm: 'h-8 w-24',
      md: 'h-10 w-32',
      lg: 'h-12 w-40',
    };
    return (
      <span
        className={clsx(
          'skeleton block rounded-md',
          buttonSizes[size] || buttonSizes.md,
          width,
          height,
          className
        )}
        aria-hidden="true"
        {...props}
      />
    );
  }

  // ── Block variant: generic rectangle ────────────────────────────────
  if (variant === 'block') {
    return (
      <span
        className={clsx(
          baseClasses,
          width || 'w-full',
          height || 'h-32',
        )}
        aria-hidden="true"
        {...props}
      />
    );
  }

  // ── Default / line variant ───────────────────────────────────────────
  const lineHeights = { sm: 'h-3', md: 'h-4', lg: 'h-5' };
  return (
    <span
      className={clsx(
        baseClasses,
        lineHeights[size] || lineHeights.md,
        width || 'w-full',
        height
      )}
      aria-hidden="true"
      {...props}
    />
  );
}

/**
 * SkeletonList — renders N card skeletons for list loading states.
 */
export function SkeletonList({ count = 3, className }) {
  return (
    <div className={clsx('flex flex-col gap-4', className)} aria-busy="true" aria-label="טוען...">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} variant="card" />
      ))}
    </div>
  );
}

/**
 * SkeletonTable — renders a table-like loading skeleton.
 */
export function SkeletonTable({ rows = 5, cols = 4, className }) {
  return (
    <div className={clsx('space-y-2', className)} aria-busy="true" aria-label="טוען...">
      {/* Header row */}
      <div className="flex gap-3 pb-2 border-b border-[var(--border-default)]">
        {Array.from({ length: cols }).map((_, i) => (
          <span key={i} className="skeleton block h-4 flex-1 rounded-md" aria-hidden="true" />
        ))}
      </div>
      {/* Data rows */}
      {Array.from({ length: rows }).map((_, ri) => (
        <div key={ri} className="flex gap-3 py-2">
          {Array.from({ length: cols }).map((_, ci) => (
            <span
              key={ci}
              className={clsx(
                'skeleton block h-4 rounded-md flex-1',
                ci === cols - 1 ? 'max-w-[80px]' : ''
              )}
              aria-hidden="true"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default Skeleton;
