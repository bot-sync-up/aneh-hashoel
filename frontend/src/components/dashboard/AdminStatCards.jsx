import React from 'react';
import {
  Clock,
  Loader2,
  CheckCircle2,
  Wifi,
  Timer,
  Heart,
} from 'lucide-react';
import StatsCard from './StatsCard';

/**
 * AdminStatCards — 6-card stats row for the admin view.
 *
 * @param {object}  stats    — raw stats from GET /api/admin/dashboard/stats
 * @param {boolean} loading
 */
export default function AdminStatCards({ stats = {}, loading = false }) {
  const cards = [
    {
      title: 'ממתינות',
      value: stats.pendingCount ?? 0,
      subtitle: 'שאלות ממתינות לטיפול',
      icon: <Clock />,
      color: 'amber',
      trend: stats.pendingTrend ?? null,
    },
    {
      title: 'בטיפול',
      value: stats.inProcessCount ?? 0,
      subtitle: 'שאלות בטיפול פעיל',
      icon: <Loader2 />,
      color: 'blue',
      trend: stats.inProcessTrend ?? null,
    },
    {
      title: 'נענו השבוע',
      value: stats.answeredThisWeek ?? 0,
      subtitle: '7 הימים האחרונים',
      icon: <CheckCircle2 />,
      color: 'emerald',
      trend: stats.answeredTrend ?? null,
    },
    {
      title: 'רבנים מחוברים',
      value: stats.onlineRabbis ?? 0,
      subtitle: 'כרגע מחוברים',
      icon: <Wifi />,
      color: 'navy',
      trend: null,
    },
    {
      title: 'ממוצע זמן תגובה',
      value: stats.avgResponseTimeLabel ?? '—',
      subtitle: 'שעות בממוצע',
      icon: <Timer />,
      color: 'gold',
      trend: stats.responseTrend ?? null,
    },
    {
      title: 'סה"כ תודות',
      value: stats.totalThanks ?? 0,
      subtitle: 'מכל הרבנים',
      icon: <Heart />,
      color: 'rose',
      trend: stats.thanksTrend ?? null,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      {cards.map((card) => (
        <StatsCard
          key={card.title}
          title={card.title}
          value={loading ? undefined : card.value}
          subtitle={card.subtitle}
          icon={card.icon}
          color={card.color}
          trend={card.trend}
          loading={loading}
        />
      ))}
    </div>
  );
}
