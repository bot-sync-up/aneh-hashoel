import React, { useState, useCallback, useEffect } from 'react';
import { clsx } from 'clsx';
import {
  Search,
  Plus,
  MoreVertical,
  UserCheck,
  UserX,
  Shield,
  ScrollText,
  ChevronDown,
  Trash2,
} from 'lucide-react';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Input from '../../components/ui/Input';
import { get, patch } from '../../lib/api';
import AddRabbiModal from '../../components/admin/AddRabbiModal';

// ─── Skeleton row ──────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <tr className="border-b border-[var(--border-default)]">
      {[...Array(8)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="skeleton h-4 rounded" style={{ width: `${60 + (i % 3) * 20}%` }} />
        </td>
      ))}
    </tr>
  );
}

// ─── Role badge ────────────────────────────────────────────────────────────
const ROLE_CONFIG = {
  admin:   { label: 'מנהל',  status: 'info' },
  rabbi:   { label: 'רב',    status: 'default' },
  senior:  { label: 'בכיר',  status: 'warning' },
};

function RoleBadge({ role }) {
  const cfg = ROLE_CONFIG[role] || { label: role, status: 'default' };
  return <Badge status={cfg.status} label={cfg.label} withDot />;
}

// ─── Row actions dropdown ──────────────────────────────────────────────────
function RowActions({ rabbi, onEdit, onToggleActive, onChangeRole, onAuditLog }) {
  const [open, setOpen] = useState(false);

  const action = (fn) => () => { setOpen(false); fn(); };

  return (
    <div className="relative inline-block" dir="rtl">
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
          <div className="absolute left-0 top-9 z-20 w-48 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-card)] py-1 font-heebo text-sm">
            <button
              className="flex w-full items-center gap-2 px-4 py-2 hover:bg-[var(--bg-muted)] text-[var(--text-primary)] transition-colors"
              onClick={action(onEdit)}
            >
              <Shield size={14} /> ערוך פרטים
            </button>
            <button
              className={clsx(
                'flex w-full items-center gap-2 px-4 py-2 transition-colors',
                rabbi.isActive
                  ? 'hover:bg-red-50 text-red-600'
                  : 'hover:bg-emerald-50 text-emerald-600'
              )}
              onClick={action(onToggleActive)}
            >
              {rabbi.isActive ? <UserX size={14} /> : <UserCheck size={14} />}
              {rabbi.isActive ? 'השבת חשבון' : 'הפעל חשבון'}
            </button>
            <button
              className="flex w-full items-center gap-2 px-4 py-2 hover:bg-[var(--bg-muted)] text-[var(--text-primary)] transition-colors"
              onClick={action(onChangeRole)}
            >
              <Shield size={14} /> שנה תפקיד
            </button>
            <hr className="my-1 border-[var(--border-default)]" />
            <button
              className="flex w-full items-center gap-2 px-4 py-2 hover:bg-[var(--bg-muted)] text-[var(--text-muted)] transition-colors"
              onClick={action(onAuditLog)}
            >
              <ScrollText size={14} /> יומן פעילות
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────
export default function RabbisAdminPage() {
  const [rabbis, setRabbis] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [selected, setSelected] = useState(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadRabbis = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get('/admin/rabbis');
      setRabbis(Array.isArray(data) ? data : data.rabbis ?? []);
    } catch {
      // Use demo data if API is unavailable
      setRabbis(DEMO_RABBIS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRabbis(); }, [loadRabbis]);

  const filtered = rabbis.filter((r) => {
    const matchSearch =
      !search ||
      r.name?.includes(search) ||
      r.email?.toLowerCase().includes(search.toLowerCase());
    const matchStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && r.isActive) ||
      (statusFilter === 'inactive' && !r.isActive);
    const matchRole = roleFilter === 'all' || r.role === roleFilter;
    return matchSearch && matchStatus && matchRole;
  });

  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const toggleAll = () => {
    if (allSelected) {
      setSelected((s) => { const ns = new Set(s); filtered.forEach((r) => ns.delete(r.id)); return ns; });
    } else {
      setSelected((s) => { const ns = new Set(s); filtered.forEach((r) => ns.add(r.id)); return ns; });
    }
  };
  const toggleOne = (id) =>
    setSelected((s) => { const ns = new Set(s); ns.has(id) ? ns.delete(id) : ns.add(id); return ns; });

  const handleToggleActive = async (rabbi) => {
    try {
      await patch(`/admin/rabbis/${rabbi.id}`, { isActive: !rabbi.isActive });
      setRabbis((prev) => prev.map((r) => r.id === rabbi.id ? { ...r, isActive: !r.isActive } : r));
      showToast(rabbi.isActive ? 'החשבון הושבת' : 'החשבון הופעל');
    } catch {
      showToast('שגיאה בעדכון', 'error');
    }
  };

  const handleBulkDeactivate = async () => {
    setBulkLoading(true);
    try {
      await Promise.all([...selected].map((id) => patch(`/admin/rabbis/${id}`, { isActive: false })));
      setRabbis((prev) => prev.map((r) => selected.has(r.id) ? { ...r, isActive: false } : r));
      setSelected(new Set());
      showToast(`${selected.size} חשבונות הושבתו`);
    } catch {
      showToast('שגיאה בפעולה קבוצתית', 'error');
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      {/* Toast */}
      {toast && (
        <div
          className={clsx(
            'fixed top-5 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-lg shadow-lg font-heebo text-sm text-white transition-all',
            toast.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'
          )}
        >
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[var(--text-primary)] font-heebo">ניהול רבנים</h2>
          <p className="text-sm text-[var(--text-muted)] font-heebo mt-0.5">
            {loading ? '...' : `${rabbis.length} רבנים רשומים`}
          </p>
        </div>
        <Button
          variant="primary"
          leftIcon={<Plus size={16} />}
          onClick={() => setShowAddModal(true)}
        >
          הוסף רב
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[220px]">
          <Input
            type="search"
            placeholder="חפש לפי שם או מייל..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-10 px-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm font-heebo text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
        >
          <option value="all">כל הסטטוסים</option>
          <option value="active">פעיל</option>
          <option value="inactive">מושבת</option>
        </select>

        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="h-10 px-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm font-heebo text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
        >
          <option value="all">כל התפקידים</option>
          <option value="rabbi">רב</option>
          <option value="senior">בכיר</option>
          <option value="admin">מנהל</option>
        </select>
      </div>

      {/* Bulk toolbar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[#1B2B5E] text-white font-heebo text-sm animate-fade-in">
          <span>{selected.size} נבחרו</span>
          <Button
            variant="danger"
            size="sm"
            loading={bulkLoading}
            leftIcon={<UserX size={14} />}
            onClick={handleBulkDeactivate}
          >
            השבת נבחרים
          </Button>
          <button
            className="mr-auto text-white/70 hover:text-white text-xs underline"
            onClick={() => setSelected(new Set())}
          >
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
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded"
                  />
                </th>
                <th className="px-4 py-3 text-right font-semibold">שם</th>
                <th className="px-4 py-3 text-right font-semibold">מייל</th>
                <th className="px-4 py-3 text-right font-semibold">תפקיד</th>
                <th className="px-4 py-3 text-right font-semibold">סטטוס</th>
                <th className="px-4 py-3 text-right font-semibold">תשובות החודש</th>
                <th className="px-4 py-3 text-right font-semibold">כניסה אחרונה</th>
                <th className="px-4 py-3 text-right font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => <SkeletonRow key={i} />)
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-16 text-[var(--text-muted)]">
                    <div className="flex flex-col items-center gap-2">
                      <Users size={36} strokeWidth={1} className="opacity-30" />
                      <span className="text-base">לא נמצאו רבנים</span>
                      {search && (
                        <button
                          className="text-sm text-[#B8973A] underline"
                          onClick={() => setSearch('')}
                        >
                          נקה חיפוש
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((rabbi) => (
                  <tr
                    key={rabbi.id}
                    className={clsx(
                      'border-t border-[var(--border-default)] transition-colors',
                      'hover:bg-[var(--bg-surface-raised)]',
                      selected.has(rabbi.id) && 'bg-blue-50/40'
                    )}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(rabbi.id)}
                        onChange={() => toggleOne(rabbi.id)}
                        className="rounded"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#1B2B5E] text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {rabbi.name?.charAt(0) ?? '?'}
                        </div>
                        <span className="font-medium text-[var(--text-primary)]">{rabbi.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{rabbi.email}</td>
                    <td className="px-4 py-3">
                      <RoleBadge role={rabbi.role} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        status={rabbi.isActive ? 'success' : 'hidden'}
                        label={rabbi.isActive ? 'פעיל' : 'מושבת'}
                        withDot
                      />
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)] tabular-nums">
                      {rabbi.answersThisMonth ?? 0}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)] text-xs">
                      {rabbi.lastLogin
                        ? new Date(rabbi.lastLogin).toLocaleDateString('he-IL')
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <RowActions
                        rabbi={rabbi}
                        onEdit={() => {}}
                        onToggleActive={() => handleToggleActive(rabbi)}
                        onChangeRole={() => {}}
                        onAuditLog={() => {}}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AddRabbiModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={() => { setShowAddModal(false); loadRabbis(); showToast('הרב נוסף בהצלחה'); }}
      />
    </div>
  );
}

// ─── Demo data (fallback) ──────────────────────────────────────────────────
const DEMO_RABBIS = [
  { id: 1, name: 'הרב אברהם כהן', email: 'avraham@merkaz.org', role: 'senior', isActive: true, answersThisMonth: 42, lastLogin: '2026-03-15' },
  { id: 2, name: 'הרב יוסף לוי', email: 'yosef@merkaz.org', role: 'rabbi', isActive: true, answersThisMonth: 28, lastLogin: '2026-03-14' },
  { id: 3, name: 'הרב שמואל גרינברג', email: 'shmuel@merkaz.org', role: 'rabbi', isActive: false, answersThisMonth: 0, lastLogin: '2026-02-10' },
  { id: 4, name: 'הרב דוד פרידמן', email: 'david@merkaz.org', role: 'admin', isActive: true, answersThisMonth: 15, lastLogin: '2026-03-16' },
  { id: 5, name: 'הרב משה הורוויץ', email: 'moshe@merkaz.org', role: 'rabbi', isActive: true, answersThisMonth: 33, lastLogin: '2026-03-13' },
];
