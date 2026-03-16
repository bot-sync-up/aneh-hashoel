import React, { useMemo } from 'react';
import { clsx } from 'clsx';
import { ChevronRight, ChevronLeft } from 'lucide-react';

/**
 * Builds the page number sequence with ellipsis.
 * Always shows first, last, current ± 1 pages, and fills with '...' gaps.
 *
 * @param {number} current  — 1-based current page
 * @param {number} total    — total page count
 * @returns {(number|'...')[]}
 */
function buildPageSequence(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages = new Set([1, total, current, current - 1, current + 1]);
  const filtered = [...pages]
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b);

  const result = [];
  for (let i = 0; i < filtered.length; i++) {
    if (i > 0 && filtered[i] - filtered[i - 1] > 1) {
      result.push('...');
    }
    result.push(filtered[i]);
  }
  return result;
}

/**
 * Pagination — RTL-aware page navigator.
 *
 * @param {number}   currentPage      — 1-based current page
 * @param {number}   totalPages       — total number of pages
 * @param {(page: number) => void} onPageChange — called with the new page number
 * @param {string}   [className]      — extra wrapper classes
 */
export default function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  className,
}) {
  const pages = useMemo(
    () => buildPageSequence(currentPage, totalPages),
    [currentPage, totalPages]
  );

  if (totalPages <= 1) return null;

  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  // Shared base classes for each page button
  const btnBase = clsx(
    'inline-flex items-center justify-center',
    'min-w-[2.25rem] h-9 px-2 rounded-md',
    'text-sm font-medium font-heebo',
    'transition-all duration-150',
    'focus-visible:outline-none focus-visible:ring-2',
    'select-none'
  );

  const ringStyle = { '--tw-ring-color': 'rgba(184,151,58,0.5)' };

  return (
    <nav
      role="navigation"
      aria-label="ניווט בין עמודים"
      dir="rtl"
      className={clsx('flex items-center gap-1', className)}
    >
      {/* "הקודם" — previous (in RTL this is the right arrow, going back means higher page) */}
      <button
        type="button"
        onClick={() => hasPrev && onPageChange(currentPage - 1)}
        disabled={!hasPrev}
        aria-label="עמוד קודם"
        className={clsx(
          btnBase,
          'gap-1 px-3',
          hasPrev
            ? 'hover:bg-[var(--bg-muted)] text-[var(--text-secondary)] cursor-pointer'
            : 'opacity-35 cursor-not-allowed text-[var(--text-muted)]'
        )}
        style={ringStyle}
      >
        {/* In RTL "previous" navigates to a lower numbered page, visually right */}
        <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
        <span>הקודם</span>
      </button>

      {/* Page numbers */}
      {pages.map((page, index) => {
        if (page === '...') {
          return (
            <span
              key={`ellipsis-${index}`}
              className="inline-flex items-center justify-center min-w-[2.25rem] h-9 text-sm select-none"
              style={{ color: 'var(--text-muted)' }}
              aria-hidden="true"
            >
              ···
            </span>
          );
        }

        const isActive = page === currentPage;
        return (
          <button
            key={page}
            type="button"
            onClick={() => !isActive && onPageChange(page)}
            aria-label={`עמוד ${page}`}
            aria-current={isActive ? 'page' : undefined}
            disabled={isActive}
            className={clsx(
              btnBase,
              isActive
                ? 'cursor-default font-semibold'
                : 'hover:bg-[var(--bg-muted)] cursor-pointer'
            )}
            style={
              isActive
                ? {
                    backgroundColor: '#1B2B5E',
                    color: '#FFFFFF',
                    ...ringStyle,
                  }
                : {
                    color: 'var(--text-secondary)',
                    ...ringStyle,
                  }
            }
          >
            {page}
          </button>
        );
      })}

      {/* "הבא" — next */}
      <button
        type="button"
        onClick={() => hasNext && onPageChange(currentPage + 1)}
        disabled={!hasNext}
        aria-label="עמוד הבא"
        className={clsx(
          btnBase,
          'gap-1 px-3',
          hasNext
            ? 'hover:bg-[var(--bg-muted)] text-[var(--text-secondary)] cursor-pointer'
            : 'opacity-35 cursor-not-allowed text-[var(--text-muted)]'
        )}
        style={ringStyle}
      >
        <span>הבא</span>
        <ChevronLeft size={15} strokeWidth={2} aria-hidden="true" />
      </button>
    </nav>
  );
}
