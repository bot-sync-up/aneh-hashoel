import React from 'react';
import { clsx } from 'clsx';
import { Inbox } from 'lucide-react';
import Button from './Button';

/**
 * Empty state placeholder with icon, title, description, and optional action button.
 *
 * @param {React.ReactNode} icon          - lucide icon component or custom node
 * @param {string} title                  - main heading
 * @param {string} description            - explanatory text
 * @param {string} actionLabel            - button text
 * @param {() => void} onAction           - button click handler
 * @param {'primary'|'secondary'|'ghost'} actionVariant - button variant
 */
function EmptyState({
  icon,
  title = 'אין נתונים להצגה',
  description,
  actionLabel,
  onAction,
  actionVariant = 'primary',
  className,
  children,
}) {
  const IconComponent = icon;

  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center text-center',
        'py-16 px-6',
        'animate-fade-in',
        className
      )}
    >
      {/* Icon */}
      <div
        className={clsx(
          'w-16 h-16 rounded-full',
          'bg-[var(--bg-muted)] dark:bg-dark-surface',
          'flex items-center justify-center',
          'mb-4'
        )}
      >
        {icon ? (
          typeof icon === 'function' ? (
            <IconComponent
              size={28}
              strokeWidth={1.5}
              className="text-[var(--text-muted)]"
            />
          ) : (
            <span className="text-[var(--text-muted)]">{icon}</span>
          )
        ) : (
          <Inbox
            size={28}
            strokeWidth={1.5}
            className="text-[var(--text-muted)]"
          />
        )}
      </div>

      {/* Title */}
      <h3 className="text-lg font-semibold text-[var(--text-primary)] font-heebo mb-1">
        {title}
      </h3>

      {/* Description */}
      {description && (
        <p className="text-sm text-[var(--text-muted)] font-heebo max-w-sm mb-5 leading-relaxed">
          {description}
        </p>
      )}

      {/* Action button */}
      {actionLabel && onAction && (
        <Button
          variant={actionVariant}
          size="md"
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      )}

      {/* Custom content slot */}
      {children}
    </div>
  );
}

export default EmptyState;
