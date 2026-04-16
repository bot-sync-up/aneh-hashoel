import React, { useState, useEffect } from 'react';
import { Trophy, Crown, Award, ChevronLeft } from 'lucide-react';
import { clsx } from 'clsx';
import { useNavigate } from 'react-router-dom';
import { get } from '../../lib/api';
import Card from '../ui/Card';

/**
 * Compact leaderboard for the rabbi dashboard.
 * Pulls from GET /rabbis/leaderboard (non-admin endpoint) and shows the top 5.
 * Highlights the current rabbi's row with `is_me`.
 */
function rankBadge(rank) {
  if (rank === 1) {
    return <Crown size={14} className="text-[#B8973A]" />;
  }
  if (rank === 2) {
    return <Award size={14} className="text-gray-400" />;
  }
  if (rank === 3) {
    return <Award size={14} className="text-amber-700" />;
  }
  return (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--bg-muted)] text-[11px] font-bold text-[var(--text-muted)]">
      {rank}
    </span>
  );
}

export default function LeaderboardWidget({ limit = 5 }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get('/rabbis/leaderboard', { limit });
        const list = Array.isArray(data) ? data : data.leaderboard ?? [];
        if (!cancelled) setRows(list.slice(0, limit));
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [limit]);

  return (
    <Card className="!p-0 overflow-hidden" dir="rtl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)] bg-[var(--bg-surface-raised)]">
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-[#B8973A]" />
          <h3 className="text-sm font-bold font-heebo text-[var(--text-primary)]">
            לוח המצטיינים
          </h3>
        </div>
        <button
          onClick={() => navigate('/leaderboard')}
          className="flex items-center gap-0.5 text-xs text-[var(--text-muted)] hover:text-[#1B2B5E] font-heebo"
        >
          לכל הדירוג
          <ChevronLeft size={12} />
        </button>
      </div>

      {loading ? (
        <div className="px-4 py-3 space-y-2">
          {[...Array(limit)].map((_, i) => (
            <div key={i} className="skeleton h-9 w-full rounded-md" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-[var(--text-muted)] font-heebo">
          אין נתונים להצגה
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-default)]">
          {rows.map((r, idx) => {
            const rank = idx + 1;
            const name = r.rabbi_name || r.name || 'רב';
            const answers = r.answers_count ?? r.totalAnswers ?? r.count ?? 0;
            const thanks = r.thanks_count ?? r.thanks ?? 0;
            return (
              <li
                key={r.rabbi_id || r.id || idx}
                className={clsx(
                  'flex items-center gap-3 px-4 py-2.5',
                  r.is_me && 'bg-[#B8973A]/10'
                )}
              >
                <div className="flex-shrink-0 w-5 flex items-center justify-center">
                  {rankBadge(rank)}
                </div>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span
                    className={clsx(
                      'text-sm font-heebo truncate',
                      r.is_me ? 'font-bold text-[#1B2B5E]' : 'text-[var(--text-primary)]'
                    )}
                  >
                    {name}
                  </span>
                  {r.is_me && (
                    <span className="text-[10px] font-bold text-[#B8973A] bg-[#B8973A]/15 px-1.5 rounded font-heebo">
                      את/ה
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)] font-heebo tabular-nums">
                  <span>{answers} תשובות</span>
                  {thanks > 0 && <span>· {thanks} תודות</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
