import React, { useState, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import {
  Search,
  Download,
  MoreVertical,
  AlertTriangle,
  ChevronDown,
  EyeOff,
  MessageSquare,
  UserCheck,
  RefreshCw,
} from 'lucide-react';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Input from '../../components/ui/Input';
import { get, patch } from '../../lib/api';
import api from '../../lib/api';

// ─── Status map ────────────────────────────────────────────────────────────
const STATUS_OPTIONS = [
  { value: 'all',        label: 'כל הסטטוסים' },
  { value: 'pending',    label: 'ממתין' },
  { value: 'in_process', label: 'בטיפול' },
  { value: 'answered',   label: 'נענה' },
  { value: 'hidden',     label: 'מוסתר' },
];

const STATUS_BADGE = {
  pending:    'pending',
  in_process: 'in_process',
  answered:   'answered',
  hidden:     'hidden',
};

// ─── Skeleton ──────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <tr className="border-b border-[var(--border-default)]">
      {[...Array(9)].map((_, i) => (
        <td key={i} className="px-3 py-3">
          <div className="skeleton h-4 rounded" style={{ width: `${50 + (i * 13) % 40}%` }} />
        </td>
      ))}
    </tr>
  );
}

// ─── Row actions ───────────────────────────────────────────────────────────
function RowActions({ question, onStatusChange, onAssign, onHide, onOpenDiscussion }) {
  const [open, setOpen] = useState(false);
  const act = (fn) => () => { setOpen(false); fn(); };

  return (
    <div className="relative inline-block">
      <button
        className="p-2 rounded-md hover:bg-[var(--bg-muted)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        onClick={() => setOpen((o) => !o)}
        aria-label="פעולות"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-9 z-20 w-52 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-card)] py-1 font-heebo text-sm">
            <button className="flex w-full items-center gap-2 px-4 py-2 hover:bg-[var(--bg-muted)] text-[var(--text-primary)]" onClick={act(onStatusChange)}>
              <RefreshCw size={14} /> שנה סטטוס
            </button>
            <button className="flex w-full items-center gap-2 px-4 py-2 hover:bg-[var(--bg-muted)] text-[var(--text-primary)]" onClick={act(onAssign)}>
              <UserCheck size={14} /> הצמד לרב
            </button>
            <button className="flex w-full items-center gap-2 px-4 py-2 hover:bg-[var(--bg-muted)] text-amber-600" onClick={act(onHide)}>
              <EyeOff size={14} /> הסתר שאלה
            </button>
            <hr className="my-1 border-[var(--border-default)]" />
            <button className="flex w-full items-center gap-2 px-4 py-2 hover:bg-[var(--bg-muted)] text-[var(--text-primary)]" onClick={act(onOpenDiscussion)}>
              <MessageSquare size={14} /> פתח דיון
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────
export default function AdminQuestionsPage() {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [exportLoading, setExportLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [categories, setCategories] = useState([]);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [qData, catData] = await Promise.all([
        get('/admin/questions'),
        get('/admin/categories').catch(() => []),
      ]);
      setQuestions(Array.isArray(qData) ? qData : qData.questions ?? DEMO_QUESTIONS);
      setCategories(Array.isArray(catData) ? catData : catData.categories ?? []);
    } catch {
      setQuestions(DEMO_QUESTIONS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = questions.filter((q) => {
    const matchSearch = !search || q.title?.includes(search) || String(q.id).includes(search);
    const matchStatus = statusFilter === 'all' || q.status === statusFilter;
    const matchCat = categoryFilter === 'all' || String(q.categoryId) === categoryFilter;
    const matchUrgent = !urgentOnly || q.isUrgent;
    return matchSearch && matchStatus && matchCat && matchUrgent;
  });

  const allSelected = filtered.length > 0 && filtered.every((q) => selected.has(q.id));
  const toggleAll = () => {
    if (allSelected) setSelected((s) => { const ns = new Set(s); filtered.forEach((q) => ns.delete(q.id)); return ns; });
    else setSelected((s) => { const ns = new Set(s); filtered.forEach((q) => ns.add(q.id)); return ns; });
  };
  const toggleOne = (id) => setSelected((s) => { const ns = new Set(s); ns.has(id) ? ns.delete(id) : ns.add(id); return ns; });

  const handleExport = async () => {
    setExportLoading(true);
    try {
      const response = await api.get('/admin/questions/export', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `questions-${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
      showToast('הקובץ יוצא בהצלחה');
    } catch {
      showToast('שגיאה בייצוא', 'error');
    } finally {
      setExportLoading(false);
    }
  };

  const handleBulkRelease = async () => {
    try {
      await Promise.all([...selected].map((id) => patch(`/admin/questions/${id}`, { status: 'pending', assignedRabbiId: null })));
      setQuestions((prev) => prev.map((q) => selected.has(q.id) ? { ...q, status: 'pending', assignedRabbi: null } : q));
      setSelected(new Set());
      showToast('השאלות שוחררו');
    } catch { showToast('שגיאה בפעולה', 'error'); }
  };

  const handleBulkHide = async () => {
    try {
      await Promise.all([...selected].map((id) => patch(`/admin/questions/${id}`, { status: 'hidden' })));
      setQuestions((prev) => prev.map((q) => selected.has(q.id) ? { ...q, status: 'hidden' } : q));
      setSelected(new Set());
      showToast('השאלות הוסתרו');
    } catch { showToast('שגיאה בפעולה', 'error'); }
  };

  return (
    <div className="space-y-5" dir="rtl">
      {/* Toast */}
      {toast && (
        <div className={clsx('fixed top-5 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-lg shadow-lg font-heebo text-sm text-white', toast.type === 'error' ? 'bg-red-600' : 'bg-emerald-600')}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[var(--text-primary)] font-heebo">ניהול שאלות</h2>
          <p className="text-sm text-[var(--text-muted)] font-heebo mt-0.5">
            {loading ? '...' : `${filtered.length} שאלות`}
          </p>
        </div>
        <Button
          variant="outline"
          leftIcon={<Download size={16} />}
          loading={exportLoading}
          onClick={handleExport}
        >
          ייצוא CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[220px]">
          <Input
            type="search"
            placeholder="חפש לפי כותרת או מספר..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-10 px-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm font-heebo text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
        >
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="h-10 px-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm font-heebo text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
        >
          <option value="all">כל הקטגוריות</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm font-heebo text-[var(--text-primary)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={urgentOnly}
            onChange={(e) => setUrgentOnly(e.target.checked)}
            className="rounded"
          />
          דחוף בלבד
        </label>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[#1B2B5E] text-white font-heebo text-sm animate-fade-in">
          <span>{selected.size} נבחרו</span>
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/10" onClick={handleBulkRelease}>
            שחרר נבחרים
          </Button>
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/10" onClick={() => {}}>
            העבר לרב
          </Button>
          <Button variant="danger" size="sm" onClick={handleBulkHide}>
            הסתר נבחרים
          </Button>
          <button className="mr-auto text-white/70 hover:text-white text-xs underline" onClick={() => setSelected(new Set())}>
            בטל בחירה
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden shadow-[var(--shadow-soft)]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-heebo">
            <thead>
              <tr className="bg-[var(--bg-surface-raised)] text-[var(--text-secondary)]">
                <th className="px-3 py-3 w-10">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" />
                </th>
                <th className="px-3 py-3 text-right font-semibold w-16">#</th>
                <th className="px-3 py-3 text-right font-semibold">כותרת</th>
                <th className="px-3 py-3 text-right font-semibold">קטגוריה</th>
                <th className="px-3 py-3 text-right font-semibold">סטטוס</th>
                <th className="px-3 py-3 text-right font-semibold">רב מטפל</th>
                <th className="px-3 py-3 text-right font-semibold">תאריך</th>
                <th className="px-3 py-3 text-center font-semibold">דחוף</th>
                <th className="px-3 py-3 text-right font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(6)].map((_, i) => <SkeletonRow key={i} />)
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-16 text-[var(--text-muted)]">
                    <div className="flex flex-col items-center gap-2">
                      <MessageSquare size={36} strokeWidth={1} className="opacity-30" />
                      <span className="text-base">לא נמצאו שאלות</span>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((q) => (
                  <tr
                    key={q.id}
                    className={clsx(
                      'border-t border-[var(--border-default)] transition-colors hover:bg-[var(--bg-surface-raised)]',
                      selected.has(q.id) && 'bg-blue-50/40'
                    )}
                  >
                    <td className="px-3 py-3">
                      <input type="checkbox" checked={selected.has(q.id)} onChange={() => toggleOne(q.id)} className="rounded" />
                    </td>
                    <td className="px-3 py-3 text-[var(--text-muted)] tabular-nums">{q.id}</td>
                    <td className="px-3 py-3 max-w-[260px]">
                      <span className="text-[var(--text-primary)] font-medium line-clamp-1">{q.title}</span>
                    </td>
                    <td className="px-3 py-3 text-[var(--text-secondary)]">{q.category ?? '—'}</td>
                    <td className="px-3 py-3">
                      <Badge status={STATUS_BADGE[q.status] ?? 'default'} withDot />
                    </td>
                    <td className="px-3 py-3 text-[var(--text-secondary)]">{q.assignedRabbi ?? '—'}</td>
                    <td className="px-3 py-3 text-[var(--text-muted)] text-xs whitespace-nowrap">
                      {q.createdAt ? new Date(q.createdAt).toLocaleDateString('he-IL') : '—'}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {q.isUrgent && (
                        <AlertTriangle size={16} className="text-red-500 mx-auto" />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <RowActions
                        question={q}
                        onStatusChange={() => {}}
                        onAssign={() => {}}
                        onHide={() => {}}
                        onOpenDiscussion={() => {}}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Demo data ─────────────────────────────────────────────────────────────
const DEMO_QUESTIONS = [
  { id: 1001, title: 'האם מותר לאכול גבינה אחרי בשר בשעה אחת?', category: 'כשרות', status: 'pending', assignedRabbi: null, createdAt: '2026-03-15', isUrgent: true, categoryId: 1 },
  { id: 1002, title: 'שאלה בענין ברכת המזון בשבת', category: 'שבת', status: 'in_process', assignedRabbi: 'הרב אברהם כהן', createdAt: '2026-03-14', isUrgent: false, categoryId: 2 },
  { id: 1003, title: 'כיצד מתפללים ביחידות כשאין מניין', category: 'תפילה', status: 'answered', assignedRabbi: 'הרב יוסף לוי', createdAt: '2026-03-13', isUrgent: false, categoryId: 3 },
  { id: 1004, title: 'הלכות פסח - ביטול חמץ בשישים', category: 'פסח', status: 'pending', assignedRabbi: null, createdAt: '2026-03-12', isUrgent: true, categoryId: 4 },
  { id: 1005, title: 'שאלה על מזוזה בדירה שכורה', category: 'מזוזה', status: 'hidden', assignedRabbi: null, createdAt: '2026-03-10', isUrgent: false, categoryId: 5 },
];
