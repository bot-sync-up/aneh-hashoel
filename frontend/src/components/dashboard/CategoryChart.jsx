import React, { useState } from 'react';
import { clsx } from 'clsx';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Sector,
} from 'recharts';
import Spinner from '../ui/Spinner';

// Category Hebrew labels (mirrors utils.js)
const CATEGORY_LABELS = {
  shabbat: 'שבת ומועדים',
  kashrut: 'כשרות',
  family: 'דיני משפחה',
  prayer: 'תפילה',
  business: 'ממונות',
  general: 'כללי',
  nidda: 'טהרת המשפחה',
  mourning: 'אבלות',
  blessings: 'ברכות',
  other: 'אחר',
};

// Palette — lighter tones that work in both light and dark mode
const PALETTE = [
  '#5B7BC2', // medium blue (replaces navy — visible on dark backgrounds)
  '#D4AF57', // light gold
  '#6B8FD4', // sky blue
  '#B8973A', // gold
  '#4EAD7B', // teal-green
  '#D46B6B', // rose
  '#8B6FBF', // purple
  '#4EA8C4', // teal
  '#C4A04E', // warm gold
  '#5AAD5A', // green
];

function getLabel(key) {
  return CATEGORY_LABELS[key] || key || 'אחר';
}

/**
 * Custom active shape — enlarges the hovered slice.
 */
function ActiveShape(props) {
  const {
    cx, cy, innerRadius, outerRadius,
    startAngle, endAngle, fill,
  } = props;

  return (
    <Sector
      cx={cx}
      cy={cy}
      innerRadius={innerRadius - 4}
      outerRadius={outerRadius + 8}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={fill}
    />
  );
}

/**
 * Custom Hebrew tooltip for the pie.
 */
function HebrewTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div
      className={clsx(
        'rounded-lg border shadow-lg px-4 py-3',
        'bg-[var(--bg-surface)] border-[var(--border-default)]',
        'text-[var(--text-primary)] font-heebo text-sm'
      )}
      dir="rtl"
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: item.payload.fill }}
        />
        <span className="font-semibold">{item.name}</span>
      </div>
      <p className="text-[var(--text-secondary)] text-xs">
        {item.value} {item.value === 1 ? 'שאלה' : 'שאלות'}
        {item.payload.percent !== undefined && (
          <span className="mr-1">
            ({(item.payload.percent * 100).toFixed(1)}%)
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * CategoryChart — PieChart of question category breakdown (admin only).
 *
 * @param {Array<{ category: string, count: number }>} data
 * @param {boolean} loading
 */
export default function CategoryChart({ data = [], loading = false }) {
  const [activeIndex, setActiveIndex] = useState(null);

  // Normalise data
  const chartData = data.map((item, i) => ({
    name: getLabel(item.category || item.name),
    value: item.count ?? item.value ?? 0,
    fill: PALETTE[i % PALETTE.length],
  }));

  const total = chartData.reduce((sum, d) => sum + d.value, 0);

  // Add percent to each item for tooltip
  const enriched = chartData.map((d) => ({
    ...d,
    percent: total > 0 ? d.value / total : 0,
  }));

  return (
    <div
      className={clsx(
        'rounded-xl border bg-[var(--bg-surface)] border-[var(--border-default)]',
        'shadow-soft dark:shadow-dark-soft p-5'
      )}
    >
      {/* Card header */}
      <div className="mb-5">
        <h3 className="text-base font-bold text-[var(--text-primary)] font-heebo">
          פילוח לפי קטגוריה
        </h3>
        <p className="text-xs text-[var(--text-muted)] font-heebo mt-0.5">
          {total > 0 ? `סה"כ ${total} ${total === 1 ? 'שאלה' : 'שאלות'}` : 'אין נתונים להצגה'}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-52">
          <Spinner size="md" />
        </div>
      ) : enriched.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-52 text-[var(--text-muted)] font-heebo text-sm gap-2">
          <span className="text-3xl opacity-30">📊</span>
          <span>אין נתוני קטגוריות</span>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Pie chart */}
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={enriched}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={2}
                dataKey="value"
                nameKey="name"
                activeIndex={activeIndex}
                activeShape={<ActiveShape />}
                onMouseEnter={(_, index) => setActiveIndex(index)}
                onMouseLeave={() => setActiveIndex(null)}
              >
                {enriched.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.fill}
                    stroke="var(--bg-surface)"
                    strokeWidth={2}
                  />
                ))}
              </Pie>
              <Tooltip content={<HebrewTooltip />} />
            </PieChart>
          </ResponsiveContainer>

          {/* Legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-2 justify-center">
            {enriched.map((item, i) => (
              <button
                key={i}
                className={clsx(
                  'flex items-center gap-1.5 text-xs font-heebo',
                  'transition-opacity duration-150',
                  activeIndex !== null && activeIndex !== i
                    ? 'opacity-40'
                    : 'opacity-100'
                )}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseLeave={() => setActiveIndex(null)}
                aria-label={`${item.name}: ${item.value} שאלות`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: item.fill }}
                />
                <span className="text-[var(--text-secondary)]">{item.name}</span>
                <span className="text-[var(--text-muted)] font-semibold">
                  ({item.value})
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
