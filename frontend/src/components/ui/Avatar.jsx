import React, { useState } from 'react';
import { clsx } from 'clsx';

const sizeMap = {
  xs: { container: 'w-6 h-6', text: 'text-[10px]', border: 'border' },
  sm: { container: 'w-8 h-8', text: 'text-xs', border: 'border' },
  md: { container: 'w-10 h-10', text: 'text-sm', border: 'border-2' },
  lg: { container: 'w-12 h-12', text: 'text-base', border: 'border-2' },
  xl: { container: 'w-16 h-16', text: 'text-lg', border: 'border-2' },
  '2xl': { container: 'w-20 h-20', text: 'text-xl', border: 'border-[3px]' },
};

// Generate a deterministic background color from a string
function colorFromString(str) {
  const palette = [
    'bg-blue-600',
    'bg-indigo-600',
    'bg-purple-600',
    'bg-emerald-600',
    'bg-teal-600',
    'bg-rose-600',
    'bg-orange-600',
    'bg-amber-600',
    'bg-cyan-600',
    'bg-brand-navy',
  ];
  if (!str) return palette[0];
  const hash = [...str].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return palette[hash % palette.length];
}

// Extract Hebrew-friendly initials (first two characters / letters)
function getInitials(name) {
  if (!name) return '??';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * Rabbi avatar: shows photo or colored initials fallback.
 *
 * @param {string} src   — image URL
 * @param {string} name  — used for initials and alt text
 * @param {'xs'|'sm'|'md'|'lg'|'xl'|'2xl'} size
 * @param {boolean} showBorder
 * @param {boolean} online  — shows green presence dot when true
 */
function Avatar({
  src,
  name,
  size = 'md',
  showBorder = false,
  online,
  className,
  ...props
}) {
  const [imgError, setImgError] = useState(false);
  const sizes = sizeMap[size] || sizeMap.md;
  const initials = getInitials(name);
  const bgColor = colorFromString(name);
  const showImage = src && !imgError;

  return (
    <div
      className={clsx('relative inline-flex flex-shrink-0', className)}
      {...props}
    >
      <span
        className={clsx(
          'rounded-full overflow-hidden',
          'flex items-center justify-center',
          'select-none',
          sizes.container,
          showImage
            ? 'bg-transparent'
            : [bgColor, 'text-white font-semibold font-heebo'],
          showBorder && [
            sizes.border,
            'border-white dark:border-dark-surface',
          ]
        )}
        aria-label={name || 'אווטאר'}
        role="img"
      >
        {showImage ? (
          <img
            src={src}
            alt={name || 'תמונת פרופיל'}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <span className={clsx(sizes.text, 'leading-none')}>
            {initials}
          </span>
        )}
      </span>

      {/* Online presence dot */}
      {typeof online === 'boolean' && (
        <span
          aria-label={online ? 'מחובר' : 'לא מחובר'}
          className={clsx(
            'absolute bottom-0 left-0',
            'rounded-full border-2 border-white dark:border-dark-surface',
            online
              ? 'bg-emerald-500'
              : 'bg-gray-400 dark:bg-gray-600',
            {
              'w-1.5 h-1.5': size === 'xs' || size === 'sm',
              'w-2.5 h-2.5': size === 'md',
              'w-3 h-3': size === 'lg' || size === 'xl' || size === '2xl',
            }
          )}
        />
      )}
    </div>
  );
}

/**
 * Avatar group — stacked avatars with overflow count
 */
export function AvatarGroup({ avatars = [], max = 4, size = 'sm' }) {
  const visible = avatars.slice(0, max);
  const overflow = avatars.length - max;

  return (
    <div className="flex flex-row-reverse -space-x-2 space-x-reverse">
      {visible.map((av, i) => (
        <Avatar
          key={av.id || i}
          src={av.src}
          name={av.name}
          size={size}
          showBorder
          className="relative"
          style={{ zIndex: visible.length - i }}
        />
      ))}
      {overflow > 0 && (
        <span
          className={clsx(
            'rounded-full flex items-center justify-center',
            'bg-[var(--bg-muted)] text-[var(--text-secondary)]',
            'font-medium font-heebo text-xs',
            'border-2 border-white dark:border-dark-surface',
            sizeMap[size]?.container || sizeMap.sm.container
          )}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

export default Avatar;
