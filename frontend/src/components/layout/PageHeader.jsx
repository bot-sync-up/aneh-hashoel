import React from 'react';
import { clsx } from 'clsx';

/**
 * Page header with title, optional subtitle, breadcrumb, and action buttons.
 *
 * @param {string} title
 * @param {string} subtitle
 * @param {React.ReactNode} actions     — right-aligned (RTL: left side) action buttons
 * @param {React.ReactNode} breadcrumb  — breadcrumb nav element
 * @param {boolean} divider             — show bottom border (default true)
 * @param {'sm'|'md'|'lg'} size         — padding scale
 */
function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
  divider = true,
  size = 'md',
  className,
  titleClassName,
  actionsClassName,
}) {
  const paddingMap = {
    sm: 'px-4 py-4',
    md: 'px-6 py-5',
    lg: 'px-8 py-6',
  };

  return (
    <header
      className={clsx(
        'bg-[var(--bg-surface)]',
        divider && 'border-b border-[var(--border-default)]',
        paddingMap[size] || paddingMap.md,
        className
      )}
    >
      {/* Breadcrumb row */}
      {breadcrumb && (
        <div className="mb-2">{breadcrumb}</div>
      )}

      {/* Title + actions row */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        {/* Text block */}
        <div className="min-w-0">
          <h1
            className={clsx(
              'font-bold text-[var(--text-primary)] font-heebo leading-tight',
              {
                'text-xl': size === 'sm',
                'text-2xl': size === 'md',
                'text-3xl': size === 'lg',
              },
              titleClassName
            )}
          >
            {title}
          </h1>

          {subtitle && (
            <p
              className={clsx(
                'text-[var(--text-muted)] font-heebo mt-1',
                {
                  'text-sm': size === 'sm',
                  'text-base': size === 'md' || size === 'lg',
                }
              )}
            >
              {subtitle}
            </p>
          )}
        </div>

        {/* Actions */}
        {actions && (
          <div
            className={clsx(
              'flex items-center gap-2 flex-shrink-0 flex-wrap',
              actionsClassName
            )}
          >
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}

/**
 * Breadcrumb helper component
 */
export function Breadcrumb({ items = [] }) {
  return (
    <nav aria-label="פירורי לחם">
      <ol className="flex items-center gap-1 text-sm font-heebo text-[var(--text-muted)]">
        {items.map((item, index) => (
          <React.Fragment key={index}>
            {index > 0 && (
              <li aria-hidden="true" className="text-[var(--border-strong)] text-xs">
                /
              </li>
            )}
            <li>
              {item.href ? (
                <a
                  href={item.href}
                  className={clsx(
                    'hover:text-[var(--text-primary)] transition-colors duration-150',
                    index === items.length - 1
                      ? 'text-[var(--text-primary)] font-medium pointer-events-none'
                      : 'hover:underline'
                  )}
                  aria-current={
                    index === items.length - 1 ? 'page' : undefined
                  }
                >
                  {item.label}
                </a>
              ) : (
                <span
                  className={
                    index === items.length - 1
                      ? 'text-[var(--text-primary)] font-medium'
                      : ''
                  }
                  aria-current={
                    index === items.length - 1 ? 'page' : undefined
                  }
                >
                  {item.label}
                </span>
              )}
            </li>
          </React.Fragment>
        ))}
      </ol>
    </nav>
  );
}

export default PageHeader;
