import React from 'react';
import { clsx } from 'clsx';

// Status configuration: colors and Hebrew labels
const STATUS_CONFIG = {
  pending: {
    label: 'ממתין',
    classes: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700',
    dot: 'bg-amber-500',
  },
  in_process: {
    label: 'בטיפול',
    classes: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700',
    dot: 'bg-blue-500',
  },
  answered: {
    label: 'נענה',
    classes: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700',
    dot: 'bg-emerald-500',
  },
  hidden: {
    label: 'מוסתר',
    classes: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
    dot: 'bg-gray-400',
  },
  urgent: {
    label: 'דחוף',
    classes: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700',
    dot: 'bg-red-500',
  },
  hot: {
    label: 'חם',
    classes: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700',
    dot: 'bg-orange-500',
  },
  // Generic color variants
  success: {
    label: 'הצלחה',
    classes: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700',
    dot: 'bg-emerald-500',
  },
  warning: {
    label: 'אזהרה',
    classes: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700',
    dot: 'bg-amber-500',
  },
  error: {
    label: 'שגיאה',
    classes: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700',
    dot: 'bg-red-500',
  },
  info: {
    label: 'מידע',
    classes: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700',
    dot: 'bg-blue-500',
  },
  default: {
    label: '',
    classes: 'bg-[var(--bg-muted)] text-[var(--text-secondary)] border-[var(--border-default)]',
    dot: 'bg-gray-400',
  },
};

const sizeClasses = {
  xs: 'text-xs px-1.5 py-0.5 gap-1',
  sm: 'text-xs px-2 py-0.5 gap-1',
  md: 'text-sm px-2.5 py-1 gap-1.5',
  lg: 'text-sm px-3 py-1.5 gap-1.5',
};

/**
 * Badge component for status display.
 *
 * @param {'pending'|'in_process'|'answered'|'hidden'|'urgent'|'hot'|'success'|'warning'|'error'|'info'|'default'} status
 * @param {'xs'|'sm'|'md'|'lg'} size
 * @param {boolean} withDot   — show colored dot indicator
 * @param {string}  label     — override the default Hebrew label
 */
function Badge({
  status = 'default',
  size = 'sm',
  withDot = false,
  label,
  children,
  className,
  ...props
}) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.default;
  const displayText = children || label || config.label;

  return (
    <span
      className={clsx(
        'inline-flex items-center font-medium font-heebo',
        'rounded-full border',
        'whitespace-nowrap',
        config.classes,
        sizeClasses[size] || sizeClasses.sm,
        className
      )}
      {...props}
    >
      {withDot && (
        <span
          className={clsx('rounded-full flex-shrink-0', config.dot, {
            'w-1.5 h-1.5': size === 'xs' || size === 'sm',
            'w-2 h-2': size === 'md' || size === 'lg',
          })}
          aria-hidden="true"
        />
      )}
      {displayText}
    </span>
  );
}

// Export status config for external use
export { STATUS_CONFIG };
export default Badge;
