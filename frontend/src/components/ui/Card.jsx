import React from 'react';
import { clsx } from 'clsx';

/**
 * Card container component.
 *
 * @param {React.ReactNode} header  — rendered above the body, separated by a divider
 * @param {React.ReactNode} footer  — rendered below the body, separated by a divider
 * @param {boolean} hoverable       — adds lift shadow on hover
 * @param {boolean} noPadding       — remove default body padding
 * @param {'sm'|'md'|'lg'} size     — controls padding scale
 */
function Card({
  children,
  header,
  footer,
  hoverable = false,
  noPadding = false,
  size = 'md',
  className,
  headerClassName,
  bodyClassName,
  footerClassName,
  onClick,
  ...props
}) {
  const paddingMap = {
    sm: 'p-4',
    md: 'p-5',
    lg: 'p-6',
  };

  const isInteractive = hoverable || Boolean(onClick);

  return (
    <div
      className={clsx(
        'rounded-card bg-[var(--bg-surface)]',
        'border border-[var(--border-default)]',
        'shadow-soft dark:shadow-dark-soft',
        'transition-all duration-200',
        isInteractive && [
          'cursor-pointer',
          'hover:shadow-card-hover dark:hover:shadow-dark-card',
          'hover:-translate-y-0.5',
        ],
        className
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick(e);
              }
            }
          : undefined
      }
      {...props}
    >
      {/* Header */}
      {header && (
        <div
          className={clsx(
            'border-b border-[var(--border-default)]',
            paddingMap[size] || paddingMap.md,
            headerClassName
          )}
        >
          {header}
        </div>
      )}

      {/* Body */}
      <div
        className={clsx(
          !noPadding && (paddingMap[size] || paddingMap.md),
          bodyClassName
        )}
      >
        {children}
      </div>

      {/* Footer */}
      {footer && (
        <div
          className={clsx(
            'border-t border-[var(--border-default)]',
            paddingMap[size] || paddingMap.md,
            footerClassName
          )}
        >
          {footer}
        </div>
      )}
    </div>
  );
}

/**
 * CardTitle — convenience sub-component for consistent card headings
 */
Card.Title = function CardTitle({ children, className, ...props }) {
  return (
    <h3
      className={clsx(
        'text-base font-semibold text-[var(--text-primary)] font-heebo',
        className
      )}
      {...props}
    >
      {children}
    </h3>
  );
};

/**
 * CardDescription — muted subtitle under the card title
 */
Card.Description = function CardDescription({ children, className, ...props }) {
  return (
    <p
      className={clsx(
        'text-sm text-[var(--text-muted)] font-heebo mt-0.5',
        className
      )}
      {...props}
    >
      {children}
    </p>
  );
};

export default Card;
