import React, { useState, useEffect } from 'react';
import { Trophy, Crown, Award, ThumbsUp, Clock, Eye } from 'lucide-react';
import { clsx } from 'clsx';
import { get } from '../../lib/api';
import Card from '../ui/Card';

// ─── Achievement tier badge ──────────────────────────────────────────────────
function AchievementBadge({ count }) {
  if (count >= 100) return <span title="100+ תשובות" className="text-base select-none">💎</span>;
  if (count >= 50)  return <span title="50+ תשובות"  className="text-base select-none">🌟</span>;
  if (count >= 10)  return <span title="10+ תשובות"  className="text-base select-none">🏆</span>;
  return <span className="text-[var(--text-muted)] text-xs">—</span>;
}

// ─── Rank badge (#1 / #2 / #3 get colored) ───────────────────────────────────
function RankBadge({ rank }) {
  if (rank === 1) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#B8973A] text-white font-bold text-sm shadow-sm">
        <Crown size={14} />
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-300 text-gray-700 font-bold text-sm">
        2
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-700/60 text-white font-bold text-sm">
        3
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[var(--bg-muted)] text-[var(--text-muted)] font-medium text-sm">
      {rank}
    </span>
  );
}

// ─── Skeleton row while loading ──────────────────────────────────────────────
function SkeletonRow() {
  return (
    <tr className="border-t border-[var(--border-default)]">
      {[40, 140, 50, 60, 50, 40].map((w, i) => (
        <td key={i} className="px-3 py-3">
          <div className="skeleton h-4 rounded" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

/**
 * Full leaderboard card for the rabbi dashboard.
 * Pulls from GET /rabbis/leaderboard?limit=10 (non-admin endpoint — anonymized
 * for everyone except the viewing rabbi and top 3).
 */
export default function LeaderboardWidget({ limit = 10 }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get('/rabbis/leaderboard', { limit });
        const list = Array.isArray(data) ? data : data.leaderboard ?? [];
        if (!cancelled) setRows(list);
      } catch (err) {
        if (!cancelled) setError('שגיאה בטעינת לוח המצטיינים');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [limit]);

  return (
    <Card className="!p-0 overflow-hidden" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-default)] bg-[var(--bg-surface-raised)]">
        <div className="flex items-center gap-2.5">
          <Trophy size={18} className="text-[#B8973A]" />
          <div>
            <h3 className="text-sm font-bold font-heebo text-[var(--text-primary)]">
              לוח המצטיינים
            </h3>
            <p className="text-[11px] text-[var(--text-muted)] font-heebo">
              דירוג לפי מספר תשובות החודש
            </p>
          </div>
        </div>
        {/* Legend */}
        <div className="hidden sm:flex items-center gap-3 text-[10px] text-[var(--text-muted)] font-heebo">
          <span>🏆 10+</span>
          <span>🌟 50+</span>
          <span>💎 100+</span>
        </div>
      </div>

      {/* Body */}
      {error ? (
        <div className="px-5 py-8 text-center text-sm text-red-600 font-heebo">
          {error}
        </div>
      ) : !loading && rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-[var(--text-muted)] font-heebo">
          <Trophy size={32} className="mx-auto mb-2 opacity-30" strokeWidth={1} />
          אין נתונים להצגה
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-heebo">
            <thead>
              <tr className="bg-[var(--bg-muted)] text-[var(--text-muted)] text-xs">
                <th className="px-3 py-2 text-right font-semibold w-14">דירוג</th>
                <th className="px-3 py-2 text-right font-semibold">שם</th>
                <th className="px-3 py-2 text-right font-semibold">תשובות</th>
                <th className="px-3 py-2 text-right font-semibold">זמן ממוצע</th>
                <th className="px-3 py-2 text-right font-semibold">תודות</th>
                <th className="px-3 py-2 text-right font-semibold w-14">תג</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? [...Array(5)].map((_, i) => <SkeletonRow key={i} />)
                : rows.map((r, idx) => {
                    const rank = r.rank ?? (idx + 1);
                    const isMe = !!r.is_me;
                    const isTop3 = rank <= 3;
                    // API anonymizes name for non-admins (hides it for others).
                    // Self and admin get rabbi_name/name; everyone else gets null.
                    const displayName = r.rabbi_name
                      ?? r.name
                      ?? (isMe ? 'אני' : `רב אנונימי #${rank}`);
                    const answers = r.answers_count ?? r.answers ?? 0;
                    const thanks  = r.thanks_count  ?? r.thanks  ?? 0;
                    const avgHours = r.avg_response_hours ?? r.avgTimeHours;
                    const totalAnswers = r.totalAnswers ?? answers;

                    return (
                      <tr
                        key={r.rabbi_id ?? r.id ?? `row-${idx}`}
                        className={clsx(
                          'border-t border-[var(--border-default)] transition-colors',
                          isMe
                            ? 'bg-[#B8973A]/10 hover:bg-[#B8973A]/15'
                            : 'hover:bg-[var(--bg-surface-raised)]',
                          rank === 1 && !isMe && 'bg-amber-50/40 dark:bg-amber-900/10'
                        )}
                      >
                        <td className="px-3 py-3">
                          <RankBadge rank={rank} />
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2.5">
                            <div
                              className={clsx(
                                'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
                                isMe
                                  ? 'bg-[#B8973A] text-white ring-2 ring-[#1B2B5E]'
                                  : isTop3
                                    ? 'bg-[#1B2B5E] text-white ring-2 ring-[#B8973A]'
                                    : 'bg-[var(--bg-muted)] text-[var(--text-secondary)]'
                              )}
                            >
                              {displayName.charAt(0)}
                            </div>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className={clsx(
                                  'truncate',
                                  isMe
                                    ? 'font-bold text-[#1B2B5E] dark:text-[#B8973A]'
                                    : isTop3
                                      ? 'font-semibold text-[var(--text-primary)]'
                                      : 'text-[var(--text-primary)]'
                                )}
                              >
                                {displayName}
                              </span>
                              {isMe && (
                                <span className="text-[10px] font-bold text-[#B8973A] bg-[#B8973A]/15 px-1.5 py-0.5 rounded font-heebo flex-shrink-0">
                                  את/ה
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 tabular-nums font-semibold text-[var(--text-primary)]">
                          {answers}
                        </td>
                        <td className="px-3 py-3 tabular-nums text-[var(--text-secondary)] text-xs">
                          {avgHours && parseFloat(avgHours) > 0
                            ? `${parseFloat(avgHours).toFixed(1)}ש'`
                            : '—'}
                        </td>
                        <td className="px-3 py-3 tabular-nums text-[var(--text-secondary)]">
                          <span className="inline-flex items-center gap-1">
                            <ThumbsUp size={11} className="text-emerald-500" />
                            {thanks}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <AchievementBadge count={totalAnswers} />
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer note — mobile legend */}
      <div className="sm:hidden flex items-center justify-center gap-3 px-5 py-2 bg-[var(--bg-muted)] text-[10px] text-[var(--text-muted)] font-heebo border-t border-[var(--border-default)]">
        <span>🏆 10+ תשובות</span>
        <span>🌟 50+</span>
        <span>💎 100+</span>
      </div>
    </Card>
  );
}
