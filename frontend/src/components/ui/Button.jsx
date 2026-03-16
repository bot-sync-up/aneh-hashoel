import React from 'react';
import { clsx } from 'clsx';
import Spinner from './Spinner';

const variantClasses = {
  primary: [
    'bg-brand-navy text-white',
    'hover:bg-brand-navy-light',
    'active:bg-brand-navy-dark',
    'focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2',
    'dark:bg-brand-gold dark:text-brand-navy dark:hover:bg-brand-gold-light',
    'disabled:bg-gray-300 dark:disabled:bg-gray-600',
  ],
  secondary: [
    'bg-brand-gold text-white',
    'hover:bg-brand-gold-dark',
    'active:bg-brand-gold-dark',
    'focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2',
    'dark:bg-dark-accent dark:text-dark-bg dark:hover:bg-dark-accent-light',
    'disabled:bg-amber-200 dark:disabled:bg-amber-900',
  ],
  outline: [
    'bg-transparent border border-brand-navy text-brand-navy',
    'hover:bg-brand-navy hover:text-white',
    'active:bg-brand-navy-dark active:text-white',
    'focus-visible:ring-2 focus-visible:ring-brand-navy focus-visible:ring-offset-2',
    'dark:border-dark-accent dark:text-dark-accent dark:hover:bg-dark-accent dark:hover:text-dark-bg',
    'disabled:border-gray-300 disabled:text-gray-400 dark:disabled:border-gray-600 dark:disabled:text-gray-500',
  ],
  ghost: [
    'bg-transparent text-brand-navy',
    'hover:bg-brand-bg-muted',
    'active:bg-brand-bg',
    'focus-visible:ring-2 focus-visible:ring-brand-navy focus-visible:ring-offset-2',
    'dark:text-dark-text dark:hover:bg-dark-surface-raised',
    'disabled:text-gray-400 dark:disabled:text-gray-600',
  ],
  danger: [
    'bg-red-600 text-white',
    'hover:bg-red-700',
    'active:bg-red-800',
    'focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2',
    'dark:bg-red-700 dark:hover:bg-red-600',
    'disabled:bg-red-300 dark:disabled:bg-red-900',
  ],
};

const sizeClasses = {
  sm: 'h-8 px-3 text-sm gap-1.5 rounded',
  md: 'h-10 px-4 text-sm gap-2 rounded-md',
  lg: 'h-12 px-6 text-base gap-2 rounded-lg',
};

const iconSizeClasses = {
  sm: 'h-8 w-8 rounded',
  md: 'h-10 w-10 rounded-md',
  lg: 'h-12 w-12 rounded-lg',
};

/**
 * Button component
 *
 * @param {'primary'|'secondary'|'outline'|'ghost'|'danger'} variant
 * @param {'sm'|'md'|'lg'} size
 * @param {boolean} loading
 * @param {boolean} iconOnly  — square aspect ratio for icon-only buttons
 * @param {React.ReactNode} leftIcon  — icon on the right in RTL (visually first)
 * @param {React.ReactNode} rightIcon — icon on the left in RTL (visually last)
 */
const Button = React.forwardRef(function Button(
  {
    children,
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled = false,
    iconOnly = false,
    leftIcon,
    rightIcon,
    className,
    type = 'button',
    ...props
  },
  ref
) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      className={clsx(
        // Base
        'inline-flex items-center justify-center font-medium font-heebo',
        'transition-all duration-150',
        'cursor-pointer select-none',
        'disabled:cursor-not-allowed disabled:opacity-60',
        'whitespace-nowrap',
        // Variant
        variantClasses[variant] || variantClasses.primary,
        // Size
        iconOnly
          ? iconSizeClasses[size] || iconSizeClasses.md
          : sizeClasses[size] || sizeClasses.md,
        className
      )}
      {...props}
    >
      {loading && (
        <Spinner
          size={size === 'lg' ? 'sm' : 'xs'}
          className={children ? 'ms-0 me-1' : ''}
          color="current"
        />
      )}

      {!loading && leftIcon && (
        <span className="flex-shrink-0">{leftIcon}</span>
      )}

      {children && <span>{children}</span>}

      {!loading && rightIcon && (
        <span className="flex-shrink-0">{rightIcon}</span>
      )}
    </button>
  );
});

Button.displayName = 'Button';

export default Button;
