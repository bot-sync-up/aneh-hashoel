import React, { useState, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import { Trophy, Star, Award, Clock, ThumbsUp, Crown } from 'lucide-react';
import { get } from '../../lib/api';

// ─── Badge thresholds ──────────────────────────────────────────────────────
function AchievementBadge({ count }) {
  if (count >= 100) return <span title="100+ תשובות" className="text-lg select-none">💎</span>;
  if (count >= 50)  return <span title="50+ תשובות"  className="text-lg select-none">🌟</span>;
  if (count >= 10)  return <span title="10+ תשובות"  className="text-lg select-none">🏆</span>;
  return null;
}

// ─── Rank badge ────────────────────────────────────────────────────────────
function RankBadge({ rank }) {
  if (rank === 1) return <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#B8973A] text-white font-bold text-sm">1</span>;
  if (rank === 2) return <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-300 text-gray-700 font-bold text-sm">2</span>;
  if (rank === 3) return <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-700/60 text-white font-bold text-sm">3</span>;
  return <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[var(--bg-muted)] text-[var(--text-muted)] font-medium text-sm">{rank}</span>;
}

// ─── Skeleton ──────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <tr className="border-b border-[var(--border-default)]">
      {[40, 160, 80, 80, 80, 60].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div className="skeleton h-4 rounded" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

// ─── "Rabbi of the week" highlight card ───────────────────────────────────
function TopRabbiCard({ rabbi, loading }) {
  if (loading) {
    return (
      <div className="rounded-2xl border-2 border-[#B8973A] bg-gradient-to-bl from-amber-50 to-white p-6 flex flex-col gap-3">
        <div className="skeleton h-5 w-32 rounded" />
        <div className="skeleton h-12 w-48 rounded" />
        <div className="flex gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-10 w-20 rounded" />)}
        </div>
      </div>
    );
  }

  if (!rabbi) return null;

  return (
    <div className="rounded-2xl border-2 border-[#B8973A] bg-gradient-to-bl from-amber-50 to-white shadow-[0_4px_24px_rgba(184,151,58,0.18)] p-6 animate-fade-in">
      <div className="flex items-center gap-2 mb-4">
        <Crown size={18} className="text-[#B8973A]" />
        <span className="text-sm font-bold font-heebo text-[#B8973A] uppercase tracking-wide">רב השבוע</span>
      </div>

      <div className="flex items-center gap-4 mb-5">
        <div className="w-14 h-14 rounded-full bg-[#1B2B5E] text-white flex items-center justify-center text-2xl font-bold flex-shrink-0 border-2 border-[#B8973A]">
          {rabbi.name?.charAt(0) ?? '?'}
        </div>
        <div>
          <h3 className="text-xl font-bold font-heebo text-[#1B2B5E]">{rabbi.name}</h3>
          <div className="flex items-center gap-2 mt-0.5">
            <AchievementBadge count={rabbi.totalAnswers} />
            <span className="text-sm text-[var(--text-muted)] font-heebo">{rabbi.totalAnswers} תשובות סה"כ</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: Trophy, label: 'תשובות השבוע', value: rabbi.answersThisWeek, color: 'text-[#B8973A]' },
          { icon: Clock,  label: 'זמן ממוצע',     value: `${rabbi.avgTimeHours}ש'`, color: 'text-blue-500' },
          { icon: ThumbsUp, label: 'תודות',        value: rabbi.thanks, color: 'text-emerald-500' },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="rounded-xl bg-white border border-[var(--border-default)] p-3 text-center">
            <Icon size={18} className={clsx('mx-auto mb-1', color)} />
            <p className="text-lg font-bold font-heebo text-[var(--text-primary)] tabular-nums">{value}</p>
            <p className="text-xs text-[var(--text-muted)] font-heebo">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Period selector ───────────────────────────────────────────────────────
const PERIODS = [
  { value: 'week',     label: 'השבוע' },
  { value: 'month',    label: 'החודש' },
  { value: 'alltime',  label: 'כל הזמן' },
];

// ─── Main page ─────────────────────────────────────────────────────────────
export default function LeaderboardPage() {
  const [rabbis, setRabbis] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('week');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get('/admin/leaderboard', { period });
      const list = Array.isArray(data) ? data : data.leaderboard ?? data.rabbis;
      setRabbis(Array.isArray(list) && list.length > 0 ? list : DEMO_RABBIS);
    } catch {
      setRabbis(DEMO_RABBIS);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const topRabbi = !loading && rabbis.length > 0 && period === 'week' ? rabbis[0] : null;

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-[var(--text-primary)] font-heebo">לוח מצטיינים</h2>
          <p className="text-sm text-[var(--text-muted)] font-heebo mt-0.5">דירוג רבנים לפי פעילות ומצוינות</p>
        </div>

        {/* Period tabs */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-muted)]">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={clsx(
                'px-4 py-2 rounded-lg text-sm font-medium font-heebo transition-all',
                period === p.value
                  ? 'bg-[var(--bg-surface)] text-[#1B2B5E] shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Top rabbi card (week only) */}
      {period === 'week' && (
        <div className="max-w-lg">
          <TopRabbiCard rabbi={topRabbi} loading={loading} />
        </div>
      )}

      {/* Badge legend */}
      <div className="flex items-center gap-4 text-xs text-[var(--text-muted)] font-heebo flex-wrap">
        <span className="font-semibold">תגי הישגים:</span>
        <span>🏆 10+ תשובות</span>
        <span>🌟 50+ תשובות</span>
        <span>💎 100+ תשובות</span>
      </div>

      {/* Full table */}
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden shadow-[var(--shadow-soft)]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-heebo">
            <thead>
              <tr className="bg-[var(--bg-surface-raised)] text-[var(--text-secondary)]">
                <th className="px-4 py-3 text-right font-semibold w-14">דירוג</th>
                <th className="px-4 py-3 text-right font-semibold">שם</th>
                <th className="px-4 py-3 text-right font-semibold">תשובות</th>
                <th className="px-4 py-3 text-right font-semibold">זמן ממוצע</th>
                <th className="px-4 py-3 text-right font-semibold">תודות</th>
                <th className="px-4 py-3 text-right font-semibold">תגים</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(6)].map((_, i) => <SkeletonRow key={i} />)
              ) : rabbis.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-16 text-[var(--text-muted)]">
                    <div className="flex flex-col items-center gap-2">
                      <Trophy size={36} strokeWidth={1} className="opacity-30" />
                      <span>אין נתונים לתקופה זו</span>
                    </div>
                  </td>
                </tr>
              ) : (
                rabbis.map((rabbi, index) => {
                  const rank = index + 1;
                  const isTop = rank <= 3;
                  return (
                    <tr
                      key={rabbi.id}
                      className={clsx(
                        'border-t border-[var(--border-default)] transition-colors',
                        'hover:bg-[var(--bg-surface-raised)]',
                        rank === 1 && 'bg-amber-50/30'
                      )}
                    >
                      <td className="px-4 py-3">
                        <RankBadge rank={rank} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div
                            className={clsx(
                              'w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0',
                              isTop
                                ? 'bg-[#1B2B5E] text-white ring-2 ring-[#B8973A]'
                                : 'bg-[var(--bg-muted)] text-[var(--text-secondary)]'
                            )}
                          >
                            {rabbi.name?.charAt(0) ?? '?'}
                          </div>
                          <span className={clsx('font-medium', isTop ? 'text-[#1B2B5E] font-bold' : 'text-[var(--text-primary)]')}>
                            {rabbi.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums font-semibold text-[var(--text-primary)]">
                        {rabbi.answers}
                      </td>
                      <td className="px-4 py-3 text-[var(--text-secondary)] tabular-nums">
                        {rabbi.avgTimeHours ? `${rabbi.avgTimeHours}ש'` : '—'}
                      </td>
                      <td className="px-4 py-3 text-[var(--text-secondary)] tabular-nums">
                        {rabbi.thanks ?? 0}
                      </td>
                      <td className="px-4 py-3">
                        <AchievementBadge count={rabbi.totalAnswers ?? rabbi.answers} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Demo data ─────────────────────────────────────────────────────────────
const DEMO_RABBIS = [
  { id: 1, name: 'הרב אברהם כהן',     answers: 18, avgTimeHours: 2.3, thanks: 14, totalAnswers: 124 },
  { id: 5, name: 'הרב משה הורוויץ',   answers: 15, avgTimeHours: 3.1, thanks: 11, totalAnswers: 87 },
  { id: 2, name: 'הרב יוסף לוי',      answers: 12, avgTimeHours: 4.0, thanks:  8, totalAnswers: 65 },
  { id: 4, name: 'הרב דוד פרידמן',    answers:  9, avgTimeHours: 5.5, thanks:  6, totalAnswers: 38 },
  { id: 3, name: 'הרב שמואל גרינברג', answers:  3, avgTimeHours: 8.0, thanks:  2, totalAnswers: 12 },
];

// Attach weeklyData for top card
DEMO_RABBIS[0].answersThisWeek = DEMO_RABBIS[0].answers;
