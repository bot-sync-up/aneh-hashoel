import React, { useEffect, useState, useCallback } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { clsx } from 'clsx';
import {
  MessageSquare,
  Eye,
  Heart,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  Award,
  Star,
  Zap,
  Shield,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, prevValue, unit = '', icon: Icon, iconColor, loading }) {
  const numCurrent = Number(value) || 0;
  const numPrev = Number(prevValue);
  const hasTrend = !isNaN(numPrev) && numPrev > 0;
  const diff = hasTrend ? numCurrent - numPrev : null;
  const pct = hasTrend ? Math.round((diff / numPrev) * 100) : null;
  const up = diff > 0;
  const flat = diff === 0;

  return (
    <Card className="h-full">
      <div className="flex items-start gap-4">
        <div className={clsx('flex items-center justify-center w-12 h-12 rounded-xl flex-shrink-0', iconColor || 'bg-[var(--bg-muted)] text-[var(--text-muted)]')}>
          <Icon className="w-6 h-6" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="space-y-2">
              <div className="skeleton h-8 w-16 rounded" />
              <div className="skeleton h-3 w-24 rounded" />
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold font-heebo text-[var(--text-primary)]">
                  {value ?? '—'}
                </span>
                {unit && <span className="text-sm text-[var(--text-muted)] font-heebo">{unit}</span>}
              </div>
              <p className="text-sm text-[var(--text-muted)] font-heebo mt-0.5">{label}</p>
              {hasTrend && (
                <div className={clsx(
                  'flex items-center gap-1 mt-1.5 text-xs font-heebo font-medium',
                  flat ? 'text-[var(--text-muted)]' : up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
                )}>
                  {flat ? <Minus className="w-3 h-3" aria-hidden="true" /> :
                   up   ? <TrendingUp className="w-3 h-3" aria-hidden="true" /> :
                          <TrendingDown className="w-3 h-3" aria-hidden="true" />}
                  {flat ? 'ללא שינוי' : `${up ? '+' : ''}${pct}% לעומת החודש שעבר`}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Custom chart tooltip ──────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-lg px-3 py-2 font-heebo text-sm text-right">
      <p className="font-semibold text-[var(--text-primary)] mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} style={{ color: entry.color || entry.fill }}>
          {entry.value} {entry.name || ''}
        </p>
      ))}
    </div>
  );
}

// ── Achievement badge ─────────────────────────────────────────────────────────

const BADGES = [
  { key: 'first_answer',     label: 'תשובה ראשונה',       desc: 'ענה על שאלתך הראשונה',        icon: '🎯', threshold: 1,   field: 'totalAnswers' },
  { key: 'ten_answers',      label: 'עשר תשובות',          desc: '10 תשובות שפורסמו',           icon: '⭐', threshold: 10,  field: 'totalAnswers' },
  { key: 'fifty_answers',    label: 'חמישים תשובות',       desc: '50 תשובות שפורסמו',           icon: '🏆', threshold: 50,  field: 'totalAnswers' },
  { key: 'hundred_answers',  label: 'מאה תשובות',          desc: '100 תשובות שפורסמו',          icon: '💯', threshold: 100, field: 'totalAnswers' },
  { key: 'first_thanks',     label: 'תודה ראשונה',         desc: 'קיבלת תודה ראשונה',           icon: '💛', threshold: 1,   field: 'totalThanks' },
  { key: 'ten_thanks',       label: 'עשר תודות',           desc: '10 תודות מגולשים',            icon: '💎', threshold: 10,  field: 'totalThanks' },
  { key: 'fast_responder',   label: 'מגיב מהיר',           desc: 'זמן מענה ממוצע מתחת לשעה',   icon: '⚡', threshold: 60,  field: 'avgResponseMinutes', inverted: true },
  { key: 'views_1000',       label: 'אלף קוראים',          desc: '1,000 צפיות בתשובותיך',       icon: '👁', threshold: 1000, field: 'totalViews' },
];

function BadgeItem({ badge, unlocked }) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center text-center p-4 rounded-xl border transition-all duration-200',
        unlocked
          ? 'bg-gradient-to-b from-amber-50 to-white dark:from-amber-900/20 dark:to-transparent border-amber-200 dark:border-amber-700'
          : 'bg-[var(--bg-muted)] border-[var(--border-default)] opacity-50 grayscale'
      )}
      aria-label={`${badge.label} — ${unlocked ? 'פתוח' : 'נעול'}`}
    >
      <span className="text-3xl mb-2" aria-hidden="true">{badge.icon}</span>
      <p className={clsx('text-xs font-semibold font-heebo', unlocked ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]')}>
        {badge.label}
      </p>
      <p className="text-[10px] text-[var(--text-muted)] font-heebo mt-0.5 leading-snug">
        {badge.desc}
      </p>
      {!unlocked && (
        <span className="mt-2 text-[10px] font-heebo text-[var(--text-muted)]">🔒 נעול</span>
      )}
    </div>
  );
}

// ── Featured question card ────────────────────────────────────────────────────

function FeaturedQuestion({ question }) {
  if (!question) return null;
  return (
    <div className={clsx(
      'p-4 rounded-xl border',
      'bg-gradient-to-b from-amber-50/60 to-transparent dark:from-amber-900/10',
      'border-amber-200 dark:border-amber-800'
    )}>
      <div className="flex items-start gap-3">
        <span className="text-2xl flex-shrink-0" aria-hidden="true">🏆</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-heebo text-amber-700 dark:text-amber-400 font-medium mb-1">
            השאלה שקיבלה הכי הרבה תודות
          </p>
          <p className="text-sm font-semibold font-heebo text-[var(--text-primary)] line-clamp-2">
            {question.title || question.text || '—'}
          </p>
          <div className="flex items-center gap-3 mt-2 text-xs text-[var(--text-muted)] font-heebo">
            <span className="flex items-center gap-1">
              <Heart className="w-3.5 h-3.5 text-red-400" aria-hidden="true" />
              {question.thanksCount ?? question.thanks ?? 0} תודות
            </span>
            {question.viewCount !== undefined && (
              <span className="flex items-center gap-1">
                <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                {question.viewCount} צפיות
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main StatsPage ────────────────────────────────────────────────────────────

export default function StatsPage() {
  const { rabbi } = useAuth();

  const [stats, setStats] = useState(null);
  const [weeklyData, setWeeklyData] = useState([]);
  const [categoryData, setCategoryData] = useState([]);
  const [topQuestion, setTopQuestion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, activityRes] = await Promise.allSettled([
        api.get('/rabbis/stats'),
        api.get('/rabbis/stats/history'),
      ]);

      if (statsRes.status === 'fulfilled') {
        const d = statsRes.value.data;
        // Backend returns { this_week, last_week, all_time }
        const current = d?.this_week || d?.stats || d?.current || d;
        const prev    = d?.last_week || null;
        setStats({
          answersThisMonth:    current?.answers_count   ?? current?.answers   ?? current?.answersThisMonth,
          answersLastMonth:    prev?.answers_count      ?? prev?.answers,
          viewsThisMonth:      current?.views_count     ?? current?.views     ?? current?.viewsThisMonth,
          viewsLastMonth:      prev?.views_count        ?? prev?.views,
          thanksThisMonth:     current?.thanks_count    ?? current?.thanks    ?? current?.thanksThisMonth,
          thanksLastMonth:     prev?.thanks_count       ?? prev?.thanks,
          avgResponseTime:     current?.avg_response_minutes ?? current?.avgResponseMinutes ?? current?.avgResponseTime,
          avgResponseTimePrev: prev?.avg_response_minutes ?? prev?.avgResponseMinutes,
          totalAnswers:        d?.all_time?.answers_count ?? current?.answers_count ?? 0,
          totalThanks:         d?.all_time?.thanks_count  ?? current?.thanks_count  ?? 0,
          totalViews:          d?.all_time?.views_count   ?? current?.views_count   ?? 0,
          avgResponseMinutes:  current?.avg_response_minutes ?? current?.avgResponseMinutes,
          ...current,
        });
        setCategoryData(
          (d?.byCategory || d?.categories || []).map((c) => ({
            label: c.label || c.name || c.category || c.key || '—',
            count: c.count || c.answers || 0,
          }))
        );
        setTopQuestion(d?.topQuestion || d?.featuredQuestion || null);
      }

      if (activityRes.status === 'fulfilled') {
        const d = activityRes.value.data;
        // Backend returns { history: [{week_start, answers_count, ...}], weeks }
        const rows = d?.history || d?.weekly || d?.weeklyActivity || (Array.isArray(d) ? d : []);
        setWeeklyData(rows.map((row) => ({
          label: row.label || row.week_start
            ? new Date(row.week_start).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })
            : '—',
          count: row.count ?? row.answers_count ?? row.answers ?? 0,
        })));
      }
    } catch {
      setError('לא ניתן לטעון את הסטטיסטיקות שלך. נסה שוב.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // ── Badge unlock logic ────────────────────────────────────────────────────

  const isUnlocked = (badge) => {
    if (!stats) return false;
    const val = stats[badge.field];
    if (val == null) return false;
    return badge.inverted ? val <= badge.threshold : val >= badge.threshold;
  };

  // ── Loading skeleton ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="page-enter p-6 space-y-6 max-w-5xl mx-auto" dir="rtl">
        <div className="skeleton h-8 w-48 rounded-lg" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl border border-[var(--border-default)] p-5">
              <div className="skeleton h-20 w-full rounded" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="skeleton h-56 rounded-xl" />
          <div className="skeleton h-56 rounded-xl" />
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="page-enter p-6 flex flex-col items-center justify-center min-h-[40vh] gap-4" dir="rtl">
        <p className="text-[var(--text-secondary)] font-heebo text-center">{error}</p>
        <Button variant="outline" onClick={fetchStats} leftIcon={<RefreshCw className="w-4 h-4" />}>
          נסה שוב
        </Button>
      </div>
    );
  }

  // ── KPI values ────────────────────────────────────────────────────────────

  const kpis = [
    {
      label:     'תשובות החודש',
      value:     stats?.answersThisMonth ?? stats?.answers ?? '—',
      prevValue: stats?.answersLastMonth,
      icon:      MessageSquare,
      iconColor: 'bg-brand-navy/10 dark:bg-brand-navy/20 text-brand-navy dark:text-blue-300',
    },
    {
      label:     'צפיות',
      value:     stats?.viewsThisMonth ?? stats?.views ?? '—',
      prevValue: stats?.viewsLastMonth,
      icon:      Eye,
      iconColor: 'bg-sky-100 dark:bg-sky-900/20 text-sky-600 dark:text-sky-400',
    },
    {
      label:     'תודות',
      value:     stats?.thanksThisMonth ?? stats?.thanks ?? '—',
      prevValue: stats?.thanksLastMonth,
      icon:      Heart,
      iconColor: 'bg-red-100 dark:bg-red-900/20 text-red-500 dark:text-red-400',
    },
    {
      label:     'זמן מענה ממוצע',
      value:     stats?.avgResponseTime ?? stats?.avgResponseMinutes != null
                   ? `${Math.round(stats?.avgResponseTime ?? stats?.avgResponseMinutes)}`
                   : '—',
      unit:      'דקות',
      prevValue: stats?.avgResponseTimePrev,
      icon:      Clock,
      iconColor: 'bg-amber-100 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
    },
  ];

  return (
    <div className="page-enter p-6 space-y-8 max-w-5xl mx-auto" dir="rtl">

      {/* Heading */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold font-heebo text-[var(--text-primary)]">הסטטיסטיקות שלי</h1>
          <p className="text-sm text-[var(--text-muted)] font-heebo mt-1">
            נתוני ביצועים חודשיים ופעילות
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchStats}
          leftIcon={<RefreshCw className="w-4 h-4" />} aria-label="רענן נתונים">
          רענן
        </Button>
      </div>

      {/* KPI cards */}
      <section aria-labelledby="kpi-heading">
        <h2 id="kpi-heading" className="sr-only">נתונים חודשיים</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map((kpi, i) => (
            <KpiCard key={i} {...kpi} loading={false} />
          ))}
        </div>
      </section>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Line chart: weekly activity */}
        <Card header={
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[var(--accent)]" aria-hidden="true" />
            <Card.Title>פעילות שבועית — 12 שבועות אחרונים</Card.Title>
          </div>
        }>
          {weeklyData.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-[var(--text-muted)] font-heebo text-sm">
              אין נתונים להצגה
            </div>
          ) : (
            <div className="h-48" aria-label="גרף פעילות שבועית">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weeklyData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fontFamily: 'Heebo, sans-serif', fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fontFamily: 'Heebo, sans-serif', fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#7B8EC2"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#7B8EC2', strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: '#D4AF57', strokeWidth: 0 }}
                    name="תשובות"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Bar chart: by category */}
        <Card header={
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4 text-[var(--accent)]" aria-hidden="true" />
            <Card.Title>תשובות לפי קטגוריה</Card.Title>
          </div>
        }>
          {categoryData.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-[var(--text-muted)] font-heebo text-sm">
              אין נתונים להצגה
            </div>
          ) : (
            <div className="h-48" aria-label="גרף תשובות לפי קטגוריה">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fontFamily: 'Heebo, sans-serif', fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fontFamily: 'Heebo, sans-serif', fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={90} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--bg-muted)' }} />
                  <Bar dataKey="count" fill="#D4AF57" radius={[0, 4, 4, 0]} maxBarSize={20} name="תשובות" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* Featured question */}
      {topQuestion && (
        <section aria-labelledby="top-question-heading">
          <h2 id="top-question-heading" className="text-base font-bold font-heebo text-[var(--text-primary)] mb-3">
            השאלה הפופולרית ביותר
          </h2>
          <FeaturedQuestion question={topQuestion} />
        </section>
      )}

      {/* Achievement badges */}
      <section aria-labelledby="badges-heading">
        <h2 id="badges-heading" className="text-base font-bold font-heebo text-[var(--text-primary)] mb-3">
          הישגים
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {BADGES.map((badge) => (
            <BadgeItem key={badge.key} badge={badge} unlocked={isUnlocked(badge)} />
          ))}
        </div>
        <p className="text-xs text-[var(--text-muted)] font-heebo mt-3">
          {BADGES.filter(isUnlocked).length} מתוך {BADGES.length} הישגים פתוחים
        </p>
      </section>
    </div>
  );
}
