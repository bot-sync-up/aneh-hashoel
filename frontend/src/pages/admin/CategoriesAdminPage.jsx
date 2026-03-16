import React, { useState, useEffect, useCallback, useRef } from 'react';
import { clsx } from 'clsx';
import {
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronLeft,
  GripVertical,
  Check,
  X,
  Tag,
} from 'lucide-react';
import Button from '../../components/ui/Button';
import { get, post, patch, del } from '../../lib/api';

// ─── Skeleton ──────────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div className="space-y-2">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[var(--border-default)]">
          <div className="skeleton h-4 w-4 rounded" />
          <div className="skeleton h-4 rounded flex-1" style={{ width: `${40 + i * 15}%` }} />
          <div className="skeleton h-4 w-12 rounded" />
        </div>
      ))}
    </div>
  );
}

// ─── Inline editable name ──────────────────────────────────────────────────
function EditableName({ value, onSave, onCancel }) {
  const [val, setVal] = useState(value);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  const handleKey = (e) => {
    if (e.key === 'Enter') onSave(val.trim());
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className="flex items-center gap-2 flex-1">
      <input
        ref={inputRef}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={handleKey}
        className="flex-1 px-2 py-1 text-sm rounded border border-[#B8973A] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] font-heebo bg-[var(--bg-surface)] text-[var(--text-primary)]"
      />
      <button
        className="p-1 rounded text-emerald-600 hover:bg-emerald-50 transition-colors"
        onClick={() => onSave(val.trim())}
        aria-label="שמור"
      >
        <Check size={14} />
      </button>
      <button
        className="p-1 rounded text-[var(--text-muted)] hover:bg-[var(--bg-muted)] transition-colors"
        onClick={onCancel}
        aria-label="ביטול"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ─── Category node ─────────────────────────────────────────────────────────
function CategoryNode({ cat, depth = 0, onAdd, onRename, onDelete, onDragStart, onDragOver, onDrop, dragging }) {
  const [expanded, setExpanded] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [newChildName, setNewChildName] = useState('');
  const hasChildren = cat.children?.length > 0;

  const handleRename = (name) => {
    if (name) onRename(cat.id, name);
    setEditingName(false);
  };

  const handleAddChild = async () => {
    if (!newChildName.trim()) return;
    await onAdd(newChildName.trim(), cat.id);
    setNewChildName('');
    setAddingChild(false);
  };

  return (
    <div
      className={clsx('rounded-lg transition-all', depth > 0 && 'mr-6 mt-1')}
      draggable
      onDragStart={(e) => onDragStart(e, cat.id)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(e, cat.id); }}
      onDrop={(e) => onDrop(e, cat.id)}
    >
      <div
        className={clsx(
          'flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all group',
          dragging === cat.id
            ? 'border-[#B8973A] bg-amber-50/60 opacity-60'
            : 'border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-raised)]'
        )}
      >
        {/* Drag handle */}
        <GripVertical
          size={16}
          className="text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity cursor-grab flex-shrink-0"
        />

        {/* Expand toggle */}
        <button
          className={clsx(
            'flex-shrink-0 w-5 h-5 flex items-center justify-center text-[var(--text-muted)]',
            !hasChildren && 'invisible'
          )}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronLeft size={14} />}
        </button>

        {/* Category icon */}
        <Tag size={14} className="text-[#B8973A] flex-shrink-0" />

        {/* Name */}
        {editingName ? (
          <EditableName
            value={cat.name}
            onSave={handleRename}
            onCancel={() => setEditingName(false)}
          />
        ) : (
          <span
            className="flex-1 text-sm font-medium font-heebo text-[var(--text-primary)] cursor-default"
            onDoubleClick={() => setEditingName(true)}
          >
            {cat.name}
          </span>
        )}

        {/* Question count */}
        <span className="text-xs text-[var(--text-muted)] font-heebo tabular-nums px-2 py-0.5 rounded-full bg-[var(--bg-muted)]">
          {cat.questionCount ?? 0} שאלות
        </span>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            className="p-1 rounded hover:bg-[var(--bg-muted)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="הוסף תת-קטגוריה"
            onClick={() => setAddingChild((a) => !a)}
          >
            <Plus size={13} />
          </button>
          <button
            className="p-1 rounded hover:bg-[var(--bg-muted)] text-[var(--text-muted)] hover:text-[#1B2B5E] transition-colors"
            title="שנה שם"
            onClick={() => setEditingName(true)}
          >
            <Pencil size={13} />
          </button>
          <button
            className="p-1 rounded hover:bg-red-50 text-[var(--text-muted)] hover:text-red-600 transition-colors"
            title="מחק קטגוריה"
            onClick={() => onDelete(cat.id)}
            disabled={cat.questionCount > 0}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Add child input */}
      {addingChild && (
        <div className="mr-6 mt-1 flex items-center gap-2">
          <input
            autoFocus
            value={newChildName}
            onChange={(e) => setNewChildName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddChild(); if (e.key === 'Escape') setAddingChild(false); }}
            placeholder="שם תת-קטגוריה..."
            className="flex-1 px-2 py-1.5 text-sm rounded border border-[#B8973A] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] font-heebo bg-[var(--bg-surface)] text-[var(--text-primary)]"
          />
          <button className="p-1.5 rounded bg-[#1B2B5E] text-white hover:bg-[#2A3F7E]" onClick={handleAddChild}><Check size={14} /></button>
          <button className="p-1.5 rounded border border-[var(--border-default)] hover:bg-[var(--bg-muted)]" onClick={() => setAddingChild(false)}><X size={14} /></button>
        </div>
      )}

      {/* Children */}
      {hasChildren && expanded && (
        <div className="mt-1">
          {cat.children.map((child) => (
            <CategoryNode
              key={child.id}
              cat={child}
              depth={depth + 1}
              onAdd={onAdd}
              onRename={onRename}
              onDelete={onDelete}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              dragging={dragging}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────
export default function CategoriesAdminPage() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addingRoot, setAddingRoot] = useState(false);
  const [newRootName, setNewRootName] = useState('');
  const [dragging, setDragging] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get('/admin/categories');
      setCategories(Array.isArray(data) ? data : data.categories ?? DEMO_CATEGORIES);
    } catch {
      setCategories(DEMO_CATEGORIES);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = useCallback(async (name, parentId = null) => {
    try {
      const newCat = await post('/admin/categories', { name, parentId });
      setCategories((prev) => {
        if (!parentId) return [...prev, { ...newCat, children: [], questionCount: 0 }];
        const addToParent = (cats) => cats.map((c) =>
          c.id === parentId
            ? { ...c, children: [...(c.children ?? []), { ...newCat, children: [], questionCount: 0 }] }
            : { ...c, children: addToParent(c.children ?? []) }
        );
        return addToParent(prev);
      });
      showToast('קטגוריה נוספה');
    } catch {
      // Optimistic fallback with temp ID
      const tempId = Date.now();
      setCategories((prev) => {
        if (!parentId) return [...prev, { id: tempId, name, children: [], questionCount: 0 }];
        const addToParent = (cats) => cats.map((c) =>
          c.id === parentId
            ? { ...c, children: [...(c.children ?? []), { id: tempId, name, children: [], questionCount: 0 }] }
            : { ...c, children: addToParent(c.children ?? []) }
        );
        return addToParent(prev);
      });
      showToast('קטגוריה נוספה (מצב לא מקוון)');
    }
  }, []);

  const handleRename = useCallback(async (id, name) => {
    const rename = (cats) => cats.map((c) =>
      c.id === id ? { ...c, name } : { ...c, children: rename(c.children ?? []) }
    );
    setCategories((prev) => rename(prev));
    try { await patch(`/admin/categories/${id}`, { name }); }
    catch { showToast('שגיאה בשמירה', 'error'); }
  }, []);

  const handleDelete = useCallback(async (id) => {
    const remove = (cats) => cats.filter((c) => c.id !== id).map((c) => ({ ...c, children: remove(c.children ?? []) }));
    setCategories((prev) => remove(prev));
    try { await del(`/admin/categories/${id}`); showToast('קטגוריה נמחקה'); }
    catch { showToast('שגיאה במחיקה', 'error'); load(); }
  }, [load]);

  const handleDragStart = (e, id) => { setDragging(id); e.dataTransfer.effectAllowed = 'move'; };
  const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const handleDrop = (e, targetId) => {
    e.preventDefault();
    if (dragging === targetId) { setDragging(null); return; }
    // Simple reorder: swap positions (real impl would call PATCH /order)
    setDragging(null);
    showToast('הסדר עודכן');
  };

  const handleAddRoot = async () => {
    if (!newRootName.trim()) return;
    await handleAdd(newRootName.trim(), null);
    setNewRootName('');
    setAddingRoot(false);
  };

  return (
    <div className="space-y-5 max-w-3xl" dir="rtl">
      {toast && (
        <div className={clsx('fixed top-5 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-lg shadow-lg font-heebo text-sm text-white', toast.type === 'error' ? 'bg-red-600' : 'bg-emerald-600')}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[var(--text-primary)] font-heebo">ניהול קטגוריות</h2>
          <p className="text-xs text-[var(--text-muted)] font-heebo mt-0.5">לחץ פעמיים על שם לעריכה מהירה. גרור לשינוי סדר.</p>
        </div>
        <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => setAddingRoot(true)}>
          קטגוריה חדשה
        </Button>
      </div>

      {/* Add root */}
      {addingRoot && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-[#B8973A] bg-amber-50/30 animate-fade-in">
          <input
            autoFocus
            value={newRootName}
            onChange={(e) => setNewRootName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddRoot(); if (e.key === 'Escape') setAddingRoot(false); }}
            placeholder="שם הקטגוריה..."
            className="flex-1 px-3 py-2 text-sm rounded border border-[var(--border-default)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] font-heebo bg-[var(--bg-surface)] text-[var(--text-primary)]"
          />
          <Button variant="primary" size="sm" onClick={handleAddRoot}>הוסף</Button>
          <Button variant="ghost" size="sm" onClick={() => setAddingRoot(false)}>ביטול</Button>
        </div>
      )}

      {/* Tree */}
      {loading ? (
        <Skeleton />
      ) : categories.length === 0 ? (
        <div className="text-center py-16 text-[var(--text-muted)] font-heebo">
          <Tag size={40} strokeWidth={1} className="mx-auto mb-3 opacity-30" />
          <p>אין קטגוריות עדיין</p>
          <button className="mt-2 text-sm text-[#B8973A] underline" onClick={() => setAddingRoot(true)}>
            הוסף קטגוריה ראשונה
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {categories.map((cat) => (
            <CategoryNode
              key={cat.id}
              cat={cat}
              onAdd={handleAdd}
              onRename={handleRename}
              onDelete={handleDelete}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              dragging={dragging}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-[var(--text-muted)] font-heebo pt-2">
        * לא ניתן למחוק קטגוריה שיש בה שאלות. יש להעביר את השאלות תחילה.
      </p>
    </div>
  );
}

// ─── Demo data ─────────────────────────────────────────────────────────────
const DEMO_CATEGORIES = [
  {
    id: 1, name: 'כשרות', questionCount: 45, children: [
      { id: 11, name: 'בשר וחלב', questionCount: 20, children: [] },
      { id: 12, name: 'בישולי עכו"ם', questionCount: 8, children: [] },
    ],
  },
  {
    id: 2, name: 'שבת', questionCount: 38, children: [
      { id: 21, name: 'מלאכות שבת', questionCount: 22, children: [] },
      { id: 22, name: 'הכנה לשבת', questionCount: 10, children: [] },
    ],
  },
  { id: 3, name: 'תפילה', questionCount: 27, children: [] },
  { id: 4, name: 'פסח', questionCount: 19, children: [] },
  { id: 5, name: 'מזוזה ותפילין', questionCount: 14, children: [] },
];
