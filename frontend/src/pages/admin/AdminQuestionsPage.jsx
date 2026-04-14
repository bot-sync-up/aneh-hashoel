import React, { useState, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import { useNavigate } from 'react-router-dom';
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
  Trash2,
  X,
  CheckCircle,
} from 'lucide-react';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Input from '../../components/ui/Input';
import { get, patch, del } from '../../lib/api';
import api from '../../lib/api';
import { decodeHTML } from '../../lib/utils';

// ─── Question Preview Modal ───────────────────────────────────────────────
function QuestionPreviewModal({ question, onClose }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    get(`/questions/${question.id}`)
      .then((data) => setDetails(data.question || data))
      .catch(() => setDetails(null))
      .finally(() => setLoading(false));
  }, [question.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="relative bg-[var(--bg-surface)] rounded-xl shadow-2xl w-[95vw] max-w-[700px] max-h-[85vh] overflow-hidden"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-default)] bg-[var(--bg-surface-raised)]">
          <div>
            <h3 className="text-base font-bold text-[var(--text-primary)] font-heebo">
              {decodeHTML(question.title)}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <Badge status={question.status} withDot />
              {question.category && <span className="text-xs text-[var(--text-muted)] font-heebo">{question.category}</span>}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-muted)] transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5 space-y-4" style={{ maxHeight: 'calc(85vh - 60px)' }}>
          {loading ? (
            <div className="text-center py-8 text-[var(--text-muted)] font-heebo">טוען...</div>
          ) : !details ? (
            <div className="text-center py-8 text-red-500 font-heebo">שגיאה בטעינת השאלה</div>
          ) : (
            <>
              {/* Question content */}
              <div>
                <h4 className="text-xs font-bold text-[var(--text-muted)] font-heebo mb-2">תוכן השאלה</h4>
                <div
                  className="prose prose-sm max-w-none text-[var(--text-secondary)] font-heebo leading-relaxed bg-[var(--bg-muted)] rounded-lg p-4"
                  dangerouslySetInnerHTML={{ __html: details.content || '<em>אין תוכן</em>' }}
                />
              </div>

              {/* Answer (including private — visible to admin) */}
              {details.answer_content && (
                <div>
                  <h4 className="text-xs font-bold text-[var(--text-muted)] font-heebo mb-2 flex items-center gap-2">
                    תשובת הרב {details.rabbi_name || ''}
                    {details.answer_is_private && (
                      <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">פרטי — גלוי רק למנהל</span>
                    )}
                  </h4>
                  <div
                    className="prose prose-sm max-w-none text-[var(--text-primary)] font-heebo leading-relaxed bg-emerald-50 dark:bg-emerald-900/10 rounded-lg p-4 border border-emerald-200 dark:border-emerald-800"
                    dangerouslySetInnerHTML={{ __html: details.answer_content }}
                  />
                </div>
              )}

              {/* Meta info */}
              <div className="flex flex-wrap gap-4 text-xs text-[var(--text-muted)] font-heebo pt-2 border-t border-[var(--border-default)]">
                {details.asker_name && <span>שואל: {details.asker_name}</span>}
                {details.rabbi_name && <span>רב: {details.rabbi_name}</span>}
                {details.created_at && <span>נוצר: {new Date(details.created_at).toLocaleDateString('he-IL')}</span>}
                {details.view_count > 0 && <span>צפיות: {details.view_count}</span>}
                {details.thank_count > 0 && <span>תודות: {details.thank_count}</span>}
              </div>

              {/* Open in full page */}
              <div className="text-center pt-2">
                <Button variant="outline" size="sm" onClick={() => window.open(`/questions/${question.id}`, '_blank')}>
                  פתח בדף מלא
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

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
function RowActions({ question, onStatusChange, onAssign, onHide, onDelete, onOpenDiscussion }) {
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
            {question.status !== 'answered' && (
              <button className="flex w-full items-center gap-2 px-4 py-2 hover:bg-emerald-50 text-emerald-600" onClick={act(() => onStatusChange('answered'))}>
                <CheckCircle size={14} /> סמן כנענה
              </button>
            )}
            <button className="flex w-full items-center gap-2 px-4 py-2 hover:bg-[var(--bg-muted)] text-amber-600" onClick={act(onHide)}>
              <EyeOff size={14} /> הסתר שאלה
            </button>
            <hr className="my-1 border-[var(--border-default)]" />
            <button className="flex w-full items-center gap-2 px-4 py-2 hover:bg-[var(--bg-muted)] text-[var(--text-primary)]" onClick={act(onOpenDiscussion)}>
              <MessageSquare size={14} /> פתח דיון
            </button>
            <button className="flex w-full items-center gap-2 px-4 py-2 hover:bg-red-50 text-red-600" onClick={act(onDelete)}>
              <Trash2 size={14} /> מחק לצמיתות
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Status Modal ──────────────────────────────────────────────────────────
function StatusModal({ question, onClose, onSave }) {
  const [status, setStatus] = useState(question.status);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 font-heebo" dir="rtl">
      <div className="bg-[var(--bg-surface)] rounded-xl shadow-xl w-72 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-[var(--text-primary)]">שינוי סטטוס</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={16}/></button>
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="w-full h-10 px-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm text-[var(--text-primary)]">
          {STATUS_OPTIONS.filter(o => o.value !== 'all').map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>ביטול</Button>
          <Button variant="primary" size="sm" onClick={() => onSave(status)}>שמור</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Assign Modal ──────────────────────────────────────────────────────────
function AssignModal({ question, rabbis, onClose, onSave }) {
  const [rabbiId, setRabbiId] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 font-heebo" dir="rtl">
      <div className="bg-[var(--bg-surface)] rounded-xl shadow-xl w-80 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-[var(--text-primary)]">הצמד לרב</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={16}/></button>
        </div>
        <select value={rabbiId} onChange={e => setRabbiId(e.target.value)}
          className="w-full h-10 px-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm text-[var(--text-primary)]">
          <option value="">בחר רב...</option>
          {rabbis.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>ביטול</Button>
          <Button variant="primary" size="sm" disabled={!rabbiId} onClick={() => onSave(rabbiId)}>הצמד</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Confirm Delete Modal ────────────────────────────────────────────────
function ConfirmDeleteModal({ message, onClose, onConfirm, loading }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 font-heebo" dir="rtl">
      <div className="bg-[var(--bg-surface)] rounded-xl shadow-xl w-80 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-red-600">מחיקת שאלה</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={16}/></button>
        </div>
        <p className="text-sm text-[var(--text-primary)]">{message}</p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>ביטול</Button>
          <Button variant="danger" size="sm" loading={loading} onClick={onConfirm}>
            <Trash2 size={14} className="ml-1" />
            מחק לצמיתות
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────
export default function AdminQuestionsPage() {
  const navigate = useNavigate();
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [sortBy, setSortBy] = useState('created_at_desc');
  const [exportLoading, setExportLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [categories, setCategories] = useState([]);
  const [rabbis, setRabbis] = useState([]);
  const [statusModal, setStatusModal] = useState(null);
  const [previewQuestion, setPreviewQuestion] = useState(null);
  const [assignModal, setAssignModal] = useState(null);
  const [deleteModal, setDeleteModal] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [bulkAssignModal, setBulkAssignModal] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const PAGE_SIZE = 50;

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [qData, catData, rabbiData] = await Promise.all([
        get(`/admin/questions?page=${page}&limit=${PAGE_SIZE}`),
        get('/categories').catch(() => ({ categories: [] })),
        get('/admin/rabbis').catch(() => ({ rabbis: [] })),
      ]);
      const rawQuestions = Array.isArray(qData) ? qData : qData.questions ?? [];
      const total = qData.total ?? rawQuestions.length;
      setTotalCount(total);
      setTotalPages(Math.max(1, Math.ceil(total / PAGE_SIZE)));
      setQuestions(rawQuestions.map((q) => ({
        ...q,
        createdAt:      q.createdAt      ?? q.created_at,
        assignedRabbi:  q.assignedRabbi  ?? q.rabbi_name,
        categoryId:     q.categoryId     ?? q.category_id,
        category:       q.category       ?? q.category_name,
        isUrgent:       q.isUrgent       ?? (q.urgency === 'urgent'),
      })));
      setCategories(Array.isArray(catData) ? catData : catData.categories ?? []);
      setRabbis(Array.isArray(rabbiData) ? rabbiData : rabbiData.rabbis ?? []);
    } catch {
      setQuestions([]);
    } finally {
      setLoading(false);
    }
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const filtered = questions.filter((q) => {
    const matchSearch = !search || q.title?.includes(search) || String(q.id).includes(search);
    const matchStatus = statusFilter === 'all' || q.status === statusFilter;
    const matchCat = categoryFilter === 'all' || String(q.categoryId) === categoryFilter;
    const matchUrgent = !urgentOnly || q.isUrgent;
    return matchSearch && matchStatus && matchCat && matchUrgent;
  }).sort((a, b) => {
    if (sortBy === 'created_at_asc') {
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    }
    if (sortBy === 'urgent_first') {
      const aUrgent = a.isUrgent ? 0 : 1;
      const bUrgent = b.isUrgent ? 0 : 1;
      if (aUrgent !== bUrgent) return aUrgent - bUrgent;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    }
    // default: created_at_desc
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
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

  const handleHide = async (question) => {
    try {
      await patch(`/admin/questions/${question.id}`, { status: 'hidden' });
      setQuestions((prev) => prev.map((q) => q.id === question.id ? { ...q, status: 'hidden' } : q));
      showToast('השאלה הוסתרה');
    } catch { showToast('שגיאה בפעולה', 'error'); }
  };

  const handleStatusSave = async (status) => {
    const question = statusModal;
    setStatusModal(null);
    try {
      await patch(`/admin/questions/${question.id}`, { status });
      setQuestions((prev) => prev.map((q) => q.id === question.id ? { ...q, status } : q));
      showToast('הסטטוס עודכן');
    } catch { showToast('שגיאה בפעולה', 'error'); }
  };

  const handleStatusChange = async (questionId, newStatus) => {
    try {
      await patch(`/admin/questions/${questionId}`, { status: newStatus });
      setQuestions((prev) => prev.map((q) => q.id === questionId ? { ...q, status: newStatus } : q));
      showToast(newStatus === 'answered' ? 'השאלה סומנה כנענה' : 'הסטטוס עודכן');
    } catch { showToast('שגיאה בפעולה', 'error'); }
  };

  const handleAssignSave = async (rabbiId) => {
    const question = assignModal;
    setAssignModal(null);
    const rabbi = rabbis.find(r => String(r.id) === String(rabbiId));
    try {
      await patch(`/admin/questions/${question.id}`, { assigned_rabbi_id: rabbiId, status: 'in_process' });
      setQuestions((prev) => prev.map((q) => q.id === question.id
        ? { ...q, status: 'in_process', assignedRabbi: rabbi?.name ?? '—' }
        : q));
      showToast('השאלה הוצמדה לרב');
    } catch { showToast('שגיאה בפעולה', 'error'); }
  };

  const handleBulkRelease = async () => {
    try {
      await Promise.all([...selected].map((id) => patch(`/admin/questions/${id}`, { status: 'pending', assignedRabbiId: null })));
      setQuestions((prev) => prev.map((q) => selected.has(q.id) ? { ...q, status: 'pending', rabbi_name: null, assignedRabbi: null } : q));
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

  const handleBulkMarkAnswered = async () => {
    try {
      await Promise.all([...selected].map((id) => patch(`/admin/questions/${id}`, { status: 'answered' })));
      setQuestions((prev) => prev.map((q) => selected.has(q.id) ? { ...q, status: 'answered' } : q));
      setSelected(new Set());
      showToast('השאלות סומנו כנענו');
    } catch { showToast('שגיאה בפעולה', 'error'); }
  };

  const handleDelete = async () => {
    if (!deleteModal) return;
    setDeleteLoading(true);
    try {
      await del(`/admin/questions/${deleteModal.id}`);
      setQuestions((prev) => prev.filter((q) => q.id !== deleteModal.id));
      setSelected((prev) => { const ns = new Set(prev); ns.delete(deleteModal.id); return ns; });
      showToast('השאלה נמחקה לצמיתות');
    } catch {
      showToast('שגיאה במחיקת השאלה', 'error');
    } finally {
      setDeleteLoading(false);
      setDeleteModal(null);
    }
  };

  const handleBulkAssignSave = async (rabbiId) => {
    setBulkAssignModal(false);
    const rabbi = rabbis.find(r => String(r.id) === String(rabbiId));
    try {
      await Promise.all([...selected].map((id) =>
        patch(`/admin/questions/${id}`, { assigned_rabbi_id: rabbiId, status: 'in_process' })
      ));
      setQuestions((prev) => prev.map((q) =>
        selected.has(q.id)
          ? { ...q, status: 'in_process', assignedRabbi: rabbi?.name ?? '—' }
          : q
      ));
      setSelected(new Set());
      showToast(`${selected.size} שאלות הועברו ל${rabbi?.name ?? 'רב'}`);
    } catch { showToast('שגיאה בהעברה לרב', 'error'); }
  };

  const handleBulkDelete = async () => {
    setDeleteLoading(true);
    try {
      await api.post('/admin/questions/bulk', {
        questionIds: [...selected],
        action: 'delete',
      });
      setQuestions((prev) => prev.filter((q) => !selected.has(q.id)));
      showToast(`${selected.size} שאלות נמחקו לצמיתות`);
      setSelected(new Set());
    } catch {
      showToast('שגיאה במחיקה קבוצתית', 'error');
    } finally {
      setDeleteLoading(false);
      setDeleteModal(null);
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      {/* Modals */}
      {previewQuestion && (
        <QuestionPreviewModal question={previewQuestion} onClose={() => setPreviewQuestion(null)} />
      )}
      {statusModal && (
        <StatusModal question={statusModal} onClose={() => setStatusModal(null)} onSave={handleStatusSave} />
      )}
      {assignModal && (
        <AssignModal question={assignModal} rabbis={rabbis} onClose={() => setAssignModal(null)} onSave={handleAssignSave} />
      )}
      {bulkAssignModal && (
        <AssignModal question={{ id: 'bulk' }} rabbis={rabbis} onClose={() => setBulkAssignModal(false)} onSave={handleBulkAssignSave} />
      )}
      {deleteModal && (
        <ConfirmDeleteModal
          message={deleteModal.bulk
            ? `האם אתה בטוח שברצונך למחוק ${deleteModal.count} שאלות? פעולה זו בלתי הפיכה`
            : 'האם אתה בטוח שברצונך למחוק את השאלה? פעולה זו בלתי הפיכה'}
          onClose={() => setDeleteModal(null)}
          onConfirm={deleteModal.bulk ? handleBulkDelete : handleDelete}
          loading={deleteLoading}
        />
      )}

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
            {loading ? '...' : `${filtered.length} ${filtered.length === 1 ? 'שאלה' : 'שאלות'}`}
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
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="h-10 px-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm font-heebo text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
        >
          <option value="created_at_desc">חדשות ראשון</option>
          <option value="created_at_asc">ישנות ראשון</option>
          <option value="urgent_first">דחוף ראשון</option>
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
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/10" onClick={handleBulkMarkAnswered}>
            <CheckCircle size={14} className="ml-1" />
            סמן כנענה
          </Button>
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/10" onClick={handleBulkRelease}>
            שחרר נבחרים
          </Button>
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/10" onClick={() => setBulkAssignModal(true)}>
            העבר לרב
          </Button>
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/10" onClick={handleBulkHide}>
            הסתר נבחרים
          </Button>
          <Button variant="danger" size="sm" onClick={() => setDeleteModal({ bulk: true, count: selected.size })}>
            <Trash2 size={14} className="ml-1" />
            מחק נבחרים
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
                filtered.map((q, index) => (
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
                    <td className="px-3 py-3 text-[var(--text-muted)] tabular-nums">{q.question_number || q.wp_post_id || index + 1}</td>
                    <td className="px-3 py-3 max-w-[260px]">
                      <button
                        className="text-[var(--text-primary)] font-medium line-clamp-1 hover:text-brand-navy hover:underline transition-colors text-right"
                        onClick={() => setPreviewQuestion(q)}
                      >
                        {decodeHTML(q.title)}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-[var(--text-secondary)]">{q.category ?? '—'}</td>
                    <td className="px-3 py-3">
                      <Badge status={STATUS_BADGE[q.status] ?? 'default'} withDot>
                        {STATUS_OPTIONS.find(o => o.value === q.status)?.label ?? q.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-[var(--text-secondary)]">
                      {q.assignedRabbi ? (
                        <button
                          className="text-[var(--text-primary)] hover:text-brand-navy hover:underline transition-colors"
                          onClick={() => navigate(`/admin/rabbis?highlight=${q.assigned_rabbi_id || ''}`)}
                        >
                          {q.assignedRabbi}
                        </button>
                      ) : (
                        <span className="text-[var(--text-muted)] italic">לא נתפסה</span>
                      )}
                    </td>
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
                        onStatusChange={(directStatus) => {
                          if (directStatus) {
                            handleStatusChange(q.id, directStatus);
                          } else {
                            setStatusModal(q);
                          }
                        }}
                        onAssign={() => setAssignModal(q)}
                        onHide={() => handleHide(q)}
                        onDelete={() => setDeleteModal(q)}
                        onOpenDiscussion={() => navigate(`/questions/${q.id}`)}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 pt-4 font-heebo text-sm">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              הקודם
            </Button>
            <span className="text-[var(--text-secondary)]">
              עמוד {page} מתוך {totalPages} ({totalCount} שאלות)
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              הבא
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

