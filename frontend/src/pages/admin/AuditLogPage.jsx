import React, { useState, useEffect, useCallback, useRef } from 'react';
import { clsx } from 'clsx';
import { Search, ScrollText, Filter } from 'lucide-react';
import Input from '../../components/ui/Input';
import { get } from '../../lib/api';

// ─── Action type config ────────────────────────────────────────────────────
const ACTION_CONFIG = {
  login:     { label: 'כניסה למערכת',     color: 'bg-blue-100 text-blue-700 border-blue-200' },
  logout:    { label: 'יציאה מהמערכת',    color: 'bg-gray-100 text-gray-600 border-gray-200' },
  claim:     { label: 'תפיסת שאלה',       color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  release:   { label: 'שחרור שאלה',       color: 'bg-teal-100 text-teal-600 border-teal-200' },
  answer:    { label: 'תשובה',            color: 'bg-amber-100 text-amber-700 border-amber-200' },
  edit:      { label: 'עריכה',            color: 'bg-indigo-100 text-indigo-600 border-indigo-200' },
  delete:    { label: 'מחיקה',           color: 'bg-red-100 text-red-700 border-red-200' },
  create:    { label: 'יצירה',            color: 'bg-violet-100 text-violet-700 border-violet-200' },
  broadcast: { label: 'שידור חירום',     color: 'bg-orange-100 text-orange-700 border-orange-200' },
  settings:  { label: 'שינוי הגדרות',    color: 'bg-cyan-100 text-cyan-600 border-cyan-200' },
};

const ACTION_OPTIONS = [
  { value: 'all', label: 'כל הפעולות' },
  ...Object.entries(ACTION_CONFIG).map(([value, cfg]) => ({ value, label: cfg.label })),
];

// ─── Skeleton row ──────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <tr className="border-b border-[var(--border-default)]">
      {[70, 120, 100, 120, 200].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div className="skeleton h-4 rounded" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

// ─── Action badge ──────────────────────────────────────────────────────────
function ActionBadge({ type }) {
  const cfg = ACTION_CONFIG[type] ?? { label: type, color: 'bg-gray-100 text-gray-600 border-gray-200' };
  return (
    <span className={clsx('inline-flex items-center px-2.5 py-0.5 rounded-full border text-xs font-medium font-heebo whitespace-nowrap', cfg.color)}>
      {cfg.label}
    </span>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────
export default function AuditLogPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);

  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [rabbiFilter, setRabbiFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const sentinelRef = useRef(null);

  const load = useCallback(async (pageNum = 1, append = false) => {
    if (pageNum === 1) setLoading(true); else setLoadingMore(true);
    try {
      const params = { page: pageNum, limit: 25 };
      if (actionFilter !== 'all') params.action = actionFilter;
      if (rabbiFilter) params.rabbi = rabbiFilter;
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;

      const data = await get('/admin/audit-log', params);
      const items = Array.isArray(data) ? data : data.logs ?? DEMO_LOGS;
      const total = data.total ?? items.length;

      setLogs((prev) => append ? [...prev, ...items] : items);
      setHasMore(items.length === 25 && (pageNum * 25) < total);
      setPage(pageNum);
    } catch {
      if (!append) setLogs(DEMO_LOGS);
      setHasMore(false);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [actionFilter, rabbiFilter, dateFrom, dateTo]);

  // Reload on filter change
  useEffect(() => { load(1, false); }, [load]);

  // Infinite scroll observer
  useEffect(() => {
    if (!sentinelRef.current) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && hasMore && !loadingMore) load(page + 1, true); },
      { rootMargin: '200px' }
    );
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [hasMore, loadingMore, page, load]);

  const filtered = logs.filter((l) =>
    !search ||
    l.rabbiName?.includes(search) ||
    l.entity?.includes(search) ||
    l.details?.includes(search)
  );

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)] font-heebo">יומן פעילות</h2>
        <p className="text-sm text-[var(--text-muted)] font-heebo mt-0.5">מעקב אחר כל פעולות הרבנים והמנהלים</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <Input
            type="search"
            placeholder="חפש לפי רב, ישות, פרטים..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium font-heebo text-[var(--text-muted)]">סוג פעולה</label>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="h-10 px-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm font-heebo text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
          >
            {ACTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium font-heebo text-[var(--text-muted)]">מתאריך</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-10 px-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm font-heebo text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium font-heebo text-[var(--text-muted)]">עד תאריך</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-10 px-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm font-heebo text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
          />
        </div>
        {(actionFilter !== 'all' || dateFrom || dateTo) && (
          <button
            className="h-10 px-3 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] font-heebo underline"
            onClick={() => { setActionFilter('all'); setDateFrom(''); setDateTo(''); setRabbiFilter(''); }}
          >
            נקה סינון
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden shadow-[var(--shadow-soft)]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-heebo">
            <thead>
              <tr className="bg-[var(--bg-surface-raised)] text-[var(--text-secondary)]">
                <th className="px-4 py-3 text-right font-semibold whitespace-nowrap">זמן</th>
                <th className="px-4 py-3 text-right font-semibold">רב</th>
                <th className="px-4 py-3 text-right font-semibold">פעולה</th>
                <th className="px-4 py-3 text-right font-semibold">ישות</th>
                <th className="px-4 py-3 text-right font-semibold">פרטים</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(8)].map((_, i) => <SkeletonRow key={i} />)
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-16 text-[var(--text-muted)]">
                    <div className="flex flex-col items-center gap-2">
                      <ScrollText size={36} strokeWidth={1} className="opacity-30" />
                      <span>לא נמצאו רשומות</span>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((log) => (
                  <tr
                    key={log.id}
                    className="border-t border-[var(--border-default)] hover:bg-[var(--bg-surface-raised)] transition-colors"
                  >
                    <td className="px-4 py-3 text-xs text-[var(--text-muted)] whitespace-nowrap tabular-nums">
                      {new Date(log.timestamp).toLocaleString('he-IL', {
                        day: '2-digit', month: '2-digit', year: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                      {log.rabbiName}
                    </td>
                    <td className="px-4 py-3">
                      <ActionBadge type={log.action} />
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{log.entity ?? '—'}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)] max-w-xs">
                      <span className="line-clamp-2 text-xs">{log.details ?? '—'}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Infinite scroll sentinel */}
        <div ref={sentinelRef} className="h-4" />
        {loadingMore && (
          <div className="flex justify-center py-4">
            <div className="w-5 h-5 border-2 border-[#B8973A] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!loading && !hasMore && filtered.length > 0 && (
          <p className="text-center text-xs text-[var(--text-muted)] py-4 font-heebo">
            הוצגו כל {filtered.length} הרשומות
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Demo data ─────────────────────────────────────────────────────────────
const DEMO_LOGS = [
  { id: 1, timestamp: '2026-03-16T08:32:00', rabbiName: 'הרב אברהם כהן', action: 'login', entity: 'מערכת', details: 'כניסה מכתובת IP 192.168.1.1' },
  { id: 2, timestamp: '2026-03-16T08:35:00', rabbiName: 'הרב אברהם כהן', action: 'claim', entity: 'שאלה #1004', details: 'תפיסת שאלה בנושא פסח' },
  { id: 3, timestamp: '2026-03-16T09:10:00', rabbiName: 'הרב יוסף לוי', action: 'login', entity: 'מערכת', details: 'כניסה מכתובת IP 10.0.0.5' },
  { id: 4, timestamp: '2026-03-16T09:45:00', rabbiName: 'הרב אברהם כהן', action: 'answer', entity: 'שאלה #1004', details: 'פרסום תשובה — 320 מילים' },
  { id: 5, timestamp: '2026-03-16T10:02:00', rabbiName: 'הרב דוד פרידמן', action: 'settings', entity: 'הגדרות מערכת', details: 'שינוי זמן נעילה מ-2 ל-4 שעות' },
  { id: 6, timestamp: '2026-03-16T10:30:00', rabbiName: 'הרב יוסף לוי', action: 'claim', entity: 'שאלה #1002', details: 'תפיסת שאלה בנושא שבת' },
  { id: 7, timestamp: '2026-03-16T11:00:00', rabbiName: 'הרב משה הורוויץ', action: 'login', entity: 'מערכת', details: 'כניסה מכתובת IP 172.16.0.3' },
  { id: 8, timestamp: '2026-03-16T11:15:00', rabbiName: 'הרב דוד פרידמן', action: 'broadcast', entity: 'כל הרבנים', details: 'שידור הודעת חירום: עדכון הלכתי דחוף' },
  { id: 9, timestamp: '2026-03-15T20:00:00', rabbiName: 'הרב שמואל גרינברג', action: 'logout', entity: 'מערכת', details: 'יציאה מהמערכת' },
  { id: 10, timestamp: '2026-03-15T18:45:00', rabbiName: 'הרב משה הורוויץ', action: 'answer', entity: 'שאלה #998', details: 'פרסום תשובה — 180 מילים' },
  { id: 11, timestamp: '2026-03-15T17:30:00', rabbiName: 'הרב אברהם כהן', action: 'edit', entity: 'שאלה #995', details: 'עריכת תשובה קיימת' },
  { id: 12, timestamp: '2026-03-15T16:00:00', rabbiName: 'הרב דוד פרידמן', action: 'create', entity: 'קטגוריה: פסח', details: 'יצירת קטגוריה חדשה' },
];
