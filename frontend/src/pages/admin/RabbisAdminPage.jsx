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
  Users,
  X,
  Save,
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
  admin:            { label: 'מנהל',           status: 'info' },
  rabbi:            { label: 'רב',             status: 'default' },
  customer_service: { label: 'שירות לקוחות',  status: 'warning' },
};

function RoleBadge({ role }) {
  const cfg = ROLE_CONFIG[role] || { label: role, status: 'default' };
  return <Badge status={cfg.status} label={cfg.label} withDot />;
}

// ─── Edit Rabbi Modal ──────────────────────────────────────────────────────
function EditRabbiModal({ rabbi, onClose, onSave }) {
  const [form, setForm] = useState({
    name: rabbi.name || '',
    email: rabbi.email || '',
    phone: rabbi.phone || '',
    whatsapp_number: rabbi.whatsapp_number || '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.email) { setError('שם ואימייל נדרשים'); return; }
    setLoading(true);
    setError('');
    try {
      const data = await patch(`/admin/rabbis/${rabbi.id}`, form);
      onSave({ ...rabbi, ...form, ...(data.rabbi || {}) });
    } catch (err) {
      setError(err?.message || 'שגיאה בעדכון');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" dir="rtl">
      <div className="bg-[var(--bg-surface)] rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold font-heebo text-[var(--text-primary)]">עריכת פרטי רב</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-muted)]"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-heebo text-[var(--text-secondary)] mb-1">שם מלא *</label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          </div>
          <div>
            <label className="block text-sm font-heebo text-[var(--text-secondary)] mb-1">וואטסאפ</label>
            <Input value={form.whatsapp_number} onChange={e => setForm(f => ({ ...f, whatsapp_number: e.target.value }))} placeholder="050-0000000" dir="ltr" />
          </div>
          <div>
            <label className="block text-sm font-heebo text-[var(--text-secondary)] mb-1">אימייל *</label>
            <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
          </div>
          <div>
            <label className="block text-sm font-heebo text-[var(--text-secondary)] mb-1">טלפון</label>
            <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="050-0000000" />
          </div>
          {error && <p className="text-sm text-red-500 font-heebo">{error}</p>}
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-heebo border border-[var(--border-default)] hover:bg-[var(--bg-muted)]">בטל</button>
            <Button variant="primary" type="submit" loading={loading} leftIcon={<Save size={14} />}>שמור</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Change Role Modal ─────────────────────────────────────────────────────
function ChangeRoleModal({ rabbi, onClose, onSave }) {
  const [role, setRole] = useState(rabbi.role || 'rabbi');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await patch(`/admin/rabbis/${rabbi.id}`, { role });
      onSave({ ...rabbi, role });
    } catch (err) {
      setError(err?.message || 'שגיאה בעדכון');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" dir="rtl">
      <div className="bg-[var(--bg-surface)] rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold font-heebo text-[var(--text-primary)]">שינוי תפקיד — {rabbi.name}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-muted)]"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            {[
              { value: 'rabbi',            label: 'רב — יכול לראות ולענות שאלות' },
              { value: 'admin',            label: 'מנהל — גישה מלאה למערכת' },
              { value: 'customer_service', label: 'שירות לקוחות — ניהול לידים ופניות' },
            ].map(opt => (
              <label key={opt.value} className={clsx(
                'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                role === opt.value
                  ? 'border-[#1B2B5E] bg-[#1B2B5E]/5'
                  : 'border-[var(--border-default)] hover:bg-[var(--bg-muted)]'
              )}>
                <input type="radio" name="role" value={opt.value} checked={role === opt.value} onChange={() => setRole(opt.value)} className="accent-[#1B2B5E]" />
                <div>
                  <div className="font-heebo font-medium text-[var(--text-primary)] text-sm">{ROLE_CONFIG[opt.value]?.label}</div>
                  <div className="font-heebo text-xs text-[var(--text-muted)]">{opt.label.split(' — ')[1]}</div>
                </div>
              </label>
            ))}
          </div>
          {error && <p className="text-sm text-red-500 font-heebo">{error}</p>}
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-heebo border border-[var(--border-default)] hover:bg-[var(--bg-muted)]">בטל</button>
            <Button variant="primary" type="submit" loading={loading} leftIcon={<Shield size={14} />}>עדכן תפקיד</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Audit Log Modal ───────────────────────────────────────────────────────
function AuditLogModal({ rabbi, onClose }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    get(`/admin/audit-log?entity_type=rabbi&entity_id=${rabbi.id}&limit=20`)
      .then(data => setLogs(Array.isArray(data) ? data : data.entries ?? data.logs ?? []))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, [rabbi.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" dir="rtl">
      <div className="bg-[var(--bg-surface)] rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold font-heebo text-[var(--text-primary)]">יומן פעילות — {rabbi.name}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-muted)]"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="skeleton h-12 rounded" />)}</div>
          ) : logs.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-muted)] font-heebo">אין רישומי פעילות</div>
          ) : (
            <div className="space-y-2">
              {logs.map((log, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-[var(--bg-muted)] text-sm font-heebo">
                  <div className="flex-1">
                    <div className="font-medium text-[var(--text-primary)]">{log.action || log.action_type}</div>
                    {log.details && <div className="text-xs text-[var(--text-muted)] mt-0.5">{typeof log.details === 'string' ? log.details : JSON.stringify(log.details)}</div>}
                  </div>
                  <div className="text-xs text-[var(--text-muted)] whitespace-nowrap">
                    {log.created_at ? new Date(log.created_at).toLocaleString('he-IL') : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
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
  const [editRabbi, setEditRabbi] = useState(null);
  const [changeRoleRabbi, setChangeRoleRabbi] = useState(null);
  const [auditRabbi, setAuditRabbi] = useState(null);
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
      setRabbis([]);
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

  const handleEditSave = (updated) => {
    setRabbis(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
    setEditRabbi(null);
    showToast('הפרטים עודכנו בהצלחה');
  };

  const handleRoleSave = (updated) => {
    setRabbis(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
    setChangeRoleRabbi(null);
    showToast('התפקיד עודכן בהצלחה');
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

      {/* Modals */}
      {editRabbi && (
        <EditRabbiModal rabbi={editRabbi} onClose={() => setEditRabbi(null)} onSave={handleEditSave} />
      )}
      {changeRoleRabbi && (
        <ChangeRoleModal rabbi={changeRoleRabbi} onClose={() => setChangeRoleRabbi(null)} onSave={handleRoleSave} />
      )}
      {auditRabbi && (
        <AuditLogModal rabbi={auditRabbi} onClose={() => setAuditRabbi(null)} />
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
          <option value="admin">מנהל</option>
          <option value="customer_service">שירות לקוחות</option>
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
                        <div>
                          <div className="font-medium text-[var(--text-primary)]">{rabbi.name}</div>
                          {rabbi.display_name && rabbi.display_name !== rabbi.name && (
                            <div className="text-xs text-[var(--text-muted)]">{rabbi.display_name}</div>
                          )}
                        </div>
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
                        onEdit={() => setEditRabbi(rabbi)}
                        onToggleActive={() => handleToggleActive(rabbi)}
                        onChangeRole={() => setChangeRoleRabbi(rabbi)}
                        onAuditLog={() => setAuditRabbi(rabbi)}
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
