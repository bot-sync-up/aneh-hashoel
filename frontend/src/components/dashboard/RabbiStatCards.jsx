import React from 'react';
import {
  MessageCircle,
  Timer,
  Heart,
  Inbox,
  BarChart2,
} from 'lucide-react';
import StatsCard from './StatsCard';

/**
 * RabbiStatCards — 5-card stats row for the individual rabbi view.
 *
 * @param {object}  stats        — raw stats from API or local aggregation
 * @param {boolean} loading
 */
export default function RabbiStatCards({ stats = {}, loading = false }) {
  const cards = [
    {
      title: 'שאלות שעניתי החודש',
      value: stats.answeredThisMonth ?? 0,
      subtitle: 'החודש הנוכחי',
      icon: <MessageCircle />,
      color: 'navy',
      trend: stats.answeredTrend ?? null,
    },
    {
      title: 'סה"כ שאלות שעניתי',
      value: stats.totalAnswered ?? 0,
      subtitle: 'מתחילת הדרך',
      icon: <BarChart2 />,
      color: 'blue',
      trend: null,
    },
    {
      title: 'ממוצע זמן תגובה',
      value: stats.avgResponseTimeLabel ?? '—',
      subtitle: 'שעות בממוצע',
      icon: <Timer />,
      color: 'blue',
      trend: stats.responseTrend ?? null,
    },
    {
      title: 'תודות שקיבלתי',
      value: stats.thanksReceived ?? 0,
      subtitle: 'מתחילת הדרך',
      icon: <Heart />,
      color: 'rose',
      trend: stats.thanksTrend ?? null,
    },
    {
      title: 'שאלות פתוחות אצלי',
      value: stats.openQuestions ?? 0,
      subtitle: 'ממתינות לתגובה',
      icon: <Inbox />,
      color: (stats.openQuestions ?? 0) > 0 ? 'amber' : 'emerald',
      trend: null,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
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
