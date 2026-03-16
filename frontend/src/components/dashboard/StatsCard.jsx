import React from 'react';
import { clsx } from 'clsx';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

/**
 * StatsCard — KPI tile for the dashboard stats row.
 *
 * Props (spec-aligned):
 * @param {string}          title      — Hebrew card title
 * @param {string|number}   value      — headline metric
 * @param {string}          [subtitle] — secondary line below value
 * @param {React.ReactNode} [icon]     — lucide-react icon element
 * @param {'navy'|'gold'|'emerald'|'amber'|'blue'|'rose'|string} [color]
 *   Named variant or raw Tailwind bg class applied to the icon background.
 * @param {string}  [trend]    — e.g. "+12% לעומת השבוע שעבר"
 * @param {boolean} [pulse]    — show subtle pulse animation (live update)
 * @param {boolean} [loading]  — show skeleton shimmer
 * @param {string}  [className]
 */
export default function StatsCard({
  title,
  value,
  subtitle,
  icon,
  color = 'navy',
  trend,
  pulse = false,
  loading = false,
  className,
}) {
  // ── Color mappings ─────────────────────────────────────────────────────
  const colorMap = {
    navy: {
      bg: 'bg-[#1B2B5E]',
      iconBg: 'bg-white/15',
      iconColor: 'text-[#D4AF57]',
      accent: 'border-[#2A3F7E]',
      text: 'text-white',
      muted: 'text-white/70',
      stripe: 'bg-[#D4AF57]',
    },
    gold: {
      bg: 'bg-[var(--bg-surface)]',
      iconBg: 'bg-[#B8973A]/12',
      iconColor: 'text-[#B8973A]',
      accent: 'border-[#B8973A]',
      text: 'text-[var(--text-primary)]',
      muted: 'text-[var(--text-secondary)]',
      stripe: 'bg-[#B8973A]',
    },
    emerald: {
      bg: 'bg-[var(--bg-surface)]',
      iconBg: 'bg-emerald-100 dark:bg-emerald-900/30',
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      accent: 'border-[var(--border-default)]',
      text: 'text-[var(--text-primary)]',
      muted: 'text-[var(--text-secondary)]',
      stripe: 'bg-emerald-500',
    },
    amber: {
      bg: 'bg-[var(--bg-surface)]',
      iconBg: 'bg-amber-100 dark:bg-amber-900/30',
      iconColor: 'text-amber-600 dark:text-amber-400',
      accent: 'border-[var(--border-default)]',
      text: 'text-[var(--text-primary)]',
      muted: 'text-[var(--text-secondary)]',
      stripe: 'bg-amber-500',
    },
    blue: {
      bg: 'bg-[var(--bg-surface)]',
      iconBg: 'bg-blue-100 dark:bg-blue-900/30',
      iconColor: 'text-blue-600 dark:text-blue-400',
      accent: 'border-[var(--border-default)]',
      text: 'text-[var(--text-primary)]',
      muted: 'text-[var(--text-secondary)]',
      stripe: 'bg-blue-500',
    },
    rose: {
      bg: 'bg-[var(--bg-surface)]',
      iconBg: 'bg-rose-100 dark:bg-rose-900/30',
      iconColor: 'text-rose-600 dark:text-rose-400',
      accent: 'border-[var(--border-default)]',
      text: 'text-[var(--text-primary)]',
      muted: 'text-[var(--text-secondary)]',
      stripe: 'bg-rose-500',
    },
  };

  const c = colorMap[color] || colorMap.navy;
  const isNavy = color === 'navy';

  // ── Trend parsing ──────────────────────────────────────────────────────
  let trendValue = null;
  let trendLabel = '';
  if (trend) {
    // e.g. "+12% לעומת השבוע שעבר" or "-5%"
    const match = trend.match(/^([+-]?\d+(?:\.\d+)?%?)/);
    if (match) {
      const raw = parseFloat(match[1]);
      trendValue = raw;
      trendLabel = trend.slice(match[0].length).trim();
    } else {
      trendLabel = trend;
    }
  }
  const hasTrend = trend !== undefined && trend !== null;
  const trendUp = hasTrend && trendValue !== null && trendValue > 0;
  const trendDown = hasTrend && trendValue !== null && trendValue < 0;
  const TrendIcon = trendUp ? TrendingUp : trendDown ? TrendingDown : Minus;

  if (loading) {
    return (
      <div
        className={clsx(
          'relative rounded-xl border p-5 overflow-hidden',
          c.bg,
          c.accent,
          className
        )}
      >
        <div className="flex items-start gap-4">
          <div className={clsx('skeleton w-11 h-11 rounded-xl', isNavy && 'opacity-30')} />
          <div className="flex-1 space-y-2 pt-0.5">
            <div className={clsx('skeleton h-8 w-16 rounded', isNavy && 'opacity-30')} />
            <div className={clsx('skeleton h-4 w-28 rounded', isNavy && 'opacity-30')} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        'relative rounded-xl border overflow-hidden group',
        'transition-all duration-200',
        'hover:shadow-lg hover:-translate-y-0.5',
        pulse && 'animate-pulse-once',
        c.bg,
        c.accent,
        className
      )}
    >
      {/* Colored left border stripe (RTL = right side visually) */}
      <div
        className={clsx(
          'absolute top-0 bottom-0 right-0 w-1',
          c.stripe
        )}
        aria-hidden="true"
      />

      <div className="p-5">
        <div className="flex items-start gap-4">
          {/* Icon */}
          {icon && (
            <div
              className={clsx(
                'flex items-center justify-center w-11 h-11 rounded-xl flex-shrink-0',
                c.iconBg
              )}
            >
              {React.cloneElement(icon, {
                className: clsx('w-5 h-5', c.iconColor),
                'aria-hidden': true,
              })}
            </div>
          )}

          {/* Text content */}
          <div className="flex-1 min-w-0">
            <p
              className={clsx(
                'text-xs font-medium font-heebo uppercase tracking-wide mb-1',
                c.muted
              )}
            >
              {title}
            </p>
            <div
              className={clsx(
                'text-3xl font-bold font-heebo leading-none tabular-nums',
                c.text
              )}
              aria-label={`${value} — ${title}`}
            >
              {value ?? '—'}
            </div>

            {subtitle && (
              <p className={clsx('text-xs font-heebo mt-1', c.muted)}>
                {subtitle}
              </p>
            )}

            {hasTrend && (
              <div
                className={clsx(
                  'flex items-center gap-1 text-xs font-semibold font-heebo mt-2',
                  trendUp && !isNavy && 'text-emerald-600 dark:text-emerald-400',
                  trendUp && isNavy && 'text-emerald-300',
                  trendDown && !isNavy && 'text-red-500 dark:text-red-400',
                  trendDown && isNavy && 'text-red-300',
                  !trendUp && !trendDown && !isNavy && 'text-[var(--text-muted)]',
                  !trendUp && !trendDown && isNavy && 'text-white/50'
                )}
              >
                <TrendIcon className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                <span>{trend}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
