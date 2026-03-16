import React, { useMemo } from 'react';
import { clsx } from 'clsx';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { subDays, format } from 'date-fns';
import { he } from 'date-fns/locale';
import Spinner from '../ui/Spinner';

// Brand palette
const NAVY = '#1B2B5E';
const GOLD = '#B8973A';

/**
 * Build placeholder 7-day data when real data is absent.
 */
function buildEmptyWeek() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = subDays(new Date(), 6 - i);
    return {
      date: d.toISOString(),
      newQuestions: 0,
      answers: 0,
    };
  });
}

/**
 * Custom Hebrew tooltip for the line chart.
 */
function HebrewTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className={clsx(
        'rounded-lg border shadow-lg px-4 py-3',
        'bg-[var(--bg-surface)] border-[var(--border-default)]',
        'text-[var(--text-primary)] font-heebo text-sm'
      )}
      dir="rtl"
    >
      <p className="font-semibold mb-2 text-[var(--text-secondary)] text-xs">{label}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2 mb-1 last:mb-0">
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-[var(--text-secondary)]">{entry.name}:</span>
          <span className="font-bold">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * ActivityChart — Line chart of last 7 days activity.
 *
 * @param {Array}   data    — array of { date, newQuestions, answers }
 * @param {boolean} loading
 */
export default function ActivityChart({ data, loading = false }) {
  const chartData = useMemo(() => {
    const source = data?.length ? data : buildEmptyWeek();
    return source.map((item) => ({
      ...item,
      label: format(
        typeof item.date === 'string' ? new Date(item.date) : item.date,
        'EEE d/M',
        { locale: he }
      ),
    }));
  }, [data]);

  return (
    <div
      className={clsx(
        'rounded-xl border bg-[var(--bg-surface)] border-[var(--border-default)]',
        'shadow-soft dark:shadow-dark-soft p-5'
      )}
    >
      {/* Card header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-base font-bold text-[var(--text-primary)] font-heebo">
            פעילות השבוע
          </h3>
          <p className="text-xs text-[var(--text-muted)] font-heebo mt-0.5">
            7 הימים האחרונים
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs font-heebo">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 rounded-full bg-[#1B2B5E] inline-block" />
            <span className="text-[var(--text-secondary)]">שאלות חדשות</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 rounded-full bg-[#B8973A] inline-block" />
            <span className="text-[var(--text-secondary)]">תשובות</span>
          </span>
        </div>
      </div>

      {/* Chart area */}
      {loading ? (
        <div className="flex items-center justify-center h-52">
          <Spinner size="md" />
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart
            data={chartData}
            margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border-default)"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{
                fontSize: 11,
                fontFamily: 'Heebo, sans-serif',
                fill: 'var(--text-muted)',
              }}
              axisLine={false}
              tickLine={false}
              reversed={true}
            />
            <YAxis
              tick={{
                fontSize: 11,
                fontFamily: 'Heebo, sans-serif',
                fill: 'var(--text-muted)',
              }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
              width={28}
            />
            <Tooltip
              content={<HebrewTooltip />}
              cursor={{
                stroke: 'var(--border-strong)',
                strokeWidth: 1,
                strokeDasharray: '4 2',
              }}
            />
            <Line
              type="monotone"
              dataKey="newQuestions"
              name="שאלות חדשות"
              stroke={NAVY}
              strokeWidth={2.5}
              dot={{ fill: NAVY, r: 3, strokeWidth: 0 }}
              activeDot={{ r: 5, strokeWidth: 0 }}
            />
            <Line
              type="monotone"
              dataKey="answers"
              name="תשובות"
              stroke={GOLD}
              strokeWidth={2.5}
              dot={{ fill: GOLD, r: 3, strokeWidth: 0 }}
              activeDot={{ r: 5, strokeWidth: 0 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
