import React, { useState, useEffect, useCallback, useId } from 'react';
import { clsx } from 'clsx';
import {
  FileText,
  Plus,
  PenLine,
  Trash2,
  Search,
  Clock,
  Hash,
  BarChart2,
  Tag,
} from 'lucide-react';
import PageHeader from '../components/layout/PageHeader';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import { BlockSpinner } from '../components/ui/Spinner';
import { get, post, put, del } from '../lib/api';
import { formatRelative } from '../lib/utils';

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filterCategoryId, setFilterCategoryId] = useState('');
  const [categories, setCategories] = useState([]);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState(null); // template id
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const searchId = useId();

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get('/rabbis/templates');
      setTemplates(data?.templates ?? []);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'שגיאה בטעינת התבניות.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // Fetch categories for filter dropdown
  useEffect(() => {
    get('/categories').then((data) => {
      const flat = [];
      const walk = (nodes, depth = 0) => nodes?.forEach(n => {
        flat.push({ ...n, depth });
        if (n.children?.length) walk(n.children, depth + 1);
      });
      walk(data.categories ?? []);
      setCategories(flat);
    }).catch(() => {});
  }, []);

  // ── Filtered list ──────────────────────────────────────────────────────────

  const filtered = templates.filter((t) => {
    const q = search.trim().toLowerCase();
    if (q && !(
      t.title?.toLowerCase().includes(q) ||
      t.shortcut?.toLowerCase().includes(q) ||
      t.content?.toLowerCase().includes(q)
    )) return false;
    if (filterCategoryId && String(t.category_id) !== String(filterCategoryId)) return false;
    return true;
  });

  // ── Modal handlers ─────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditingTemplate(null);
    setModalOpen(true);
  };

  const openEdit = (template) => {
    setEditingTemplate(template);
    setModalOpen(true);
  };

  const handleSaveSuccess = () => {
    setModalOpen(false);
    setEditingTemplate(null);
    fetchTemplates();
  };

  // ── Delete ─────────────────────────────────────────────────────────────────

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await del(`/rabbis/templates/${deleteTarget}`);
      setTemplates((prev) => prev.filter((t) => t.id !== deleteTarget));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err?.response?.data?.error || 'שגיאה במחיקת התבנית.');
    } finally {
      setDeleting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const isEmpty = !loading && !error && templates.length === 0;

  return (
    <div className="page-enter" dir="rtl">
      <PageHeader
        title="תבניות תשובה"
        subtitle="ניהול תבניות מוכנות לשימוש חוזר בתשובות"
        actions={
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Plus size={15} />}
            onClick={openCreate}
          >
            תבנית חדשה
          </Button>
        }
      />

      <div className="p-6 space-y-4">

        {/* Explanation banner */}
        <div className="rounded-xl border border-blue-200 bg-blue-50/50 dark:bg-blue-900/10 dark:border-blue-800 px-5 py-3.5">
          <p className="text-sm text-blue-800 dark:text-blue-300 font-heebo leading-relaxed">
            תבניות הן טקסטים מוכנים מראש שניתן להכניס בתשובה בלחיצה אחת. צור תבניות לתשובות נפוצות כדי לחסוך זמן.
          </p>
        </div>

        {/* Search + filter bar — shown only when there are templates */}
        {!loading && !error && templates.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative max-w-sm flex-1">
              <Search
                size={15}
                className="absolute top-1/2 -translate-y-1/2 end-3 text-[var(--text-muted)] pointer-events-none"
              />
              <input
                id={searchId}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="חיפוש לפי כותרת, קיצור, תוכן..."
                dir="rtl"
                className={clsx(
                  'w-full pe-9 ps-3 py-2',
                  'text-sm font-heebo text-[var(--text-primary)]',
                  'bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg',
                  'placeholder:text-[var(--text-muted)]',
                  'focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-transparent',
                  'transition-colors duration-150'
                )}
              />
            </div>
            {categories.length > 0 && (
              <select
                value={filterCategoryId}
                onChange={(e) => setFilterCategoryId(e.target.value)}
                dir="rtl"
                className={clsx(
                  'pe-3 ps-3 py-2',
                  'text-sm font-heebo text-[var(--text-primary)]',
                  'bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg',
                  'focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-transparent',
                  'transition-colors duration-150'
                )}
              >
                <option value="">כל הקטגוריות</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {'　'.repeat(cat.depth)}{cat.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* Loading */}
        {loading && <BlockSpinner label="טוען תבניות..." />}

        {/* Error */}
        {!loading && error && (
          <div className="text-center py-12">
            <p className="text-red-600 dark:text-red-400 font-heebo mb-4">{error}</p>
            <Button variant="outline" onClick={fetchTemplates}>
              נסה שוב
            </Button>
          </div>
        )}

        {/* Empty state */}
        {isEmpty && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-[var(--bg-muted)] flex items-center justify-center mb-4">
              <FileText size={28} className="text-[var(--text-muted)]" />
            </div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)] font-heebo mb-2">
              אין תבניות עדיין
            </h3>
            <p className="text-sm text-[var(--text-muted)] font-heebo mb-4">
              צור תבניות תשובה מוכנות לשימוש חוזר מהיר בעת מענה לשאלות.
            </p>
            <Button variant="primary" size="sm" leftIcon={<Plus size={15} />} onClick={openCreate}>
              צור תבנית ראשונה
            </Button>
          </div>
        )}

        {/* No search results */}
        {!loading && !error && templates.length > 0 && filtered.length === 0 && (
          <div className="text-center py-12">
            <p className="text-[var(--text-muted)] font-heebo text-sm">
              לא נמצאו תבניות התואמות לחיפוש &quot;{search}&quot;.
            </p>
          </div>
        )}

        {/* Template grid */}
        {!loading && !error && filtered.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onEdit={() => openEdit(template)}
                onDelete={() => setDeleteTarget(template.id)}
                isDeleting={deleting && deleteTarget === template.id}
                deleteConfirm={deleteTarget === template.id}
                onDeleteCancel={() => setDeleteTarget(null)}
                onDeleteConfirm={confirmDelete}
                deleteError={deleteTarget === template.id ? deleteError : null}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      <TemplateFormModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingTemplate(null);
        }}
        onSuccess={handleSaveSuccess}
        existingTemplate={editingTemplate}
      />
    </div>
  );
}

// ── Template card ──────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  onEdit,
  onDelete,
  isDeleting,
  deleteConfirm,
  onDeleteCancel,
  onDeleteConfirm,
  deleteError,
}) {
  const { title, content, shortcut, usage_count, created_at, category_name } = template;

  // Strip HTML tags for preview
  const plainContent = content
    ? content.replace(/<[^>]*>/g, '').trim()
    : '';

  const preview = plainContent.length > 100
    ? plainContent.slice(0, 100) + '...'
    : plainContent;

  return (
    <div
      className={clsx(
        'bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-card shadow-soft',
        'flex flex-col overflow-hidden',
        'transition-shadow duration-150 hover:shadow-lg',
        deleteConfirm && 'border-red-300 dark:border-red-700'
      )}
    >
      {/* Header */}
      <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] font-heebo leading-snug">
            {title}
          </h3>

          {/* Badges row */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {shortcut && (
              <span className={clsx(
                'inline-flex items-center gap-1',
                'text-xs font-mono font-medium',
                'bg-brand-navy/5 text-brand-navy/80 dark:bg-dark-accent/10 dark:text-dark-accent',
                'px-2 py-0.5 rounded-full border border-brand-navy/15'
              )}>
                <Hash size={9} strokeWidth={2.5} />
                {shortcut}
              </span>
            )}
            {category_name && (
              <span className={clsx(
                'inline-flex items-center gap-1',
                'text-xs font-heebo font-medium',
                'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400',
                'px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-700'
              )}>
                <Tag size={9} strokeWidth={2.5} />
                {category_name}
              </span>
            )}
            {typeof usage_count === 'number' && (
              <span className={clsx(
                'inline-flex items-center gap-1',
                'text-xs font-heebo font-medium',
                'bg-[var(--bg-muted)] text-[var(--text-muted)]',
                'px-2 py-0.5 rounded-full'
              )}>
                <BarChart2 size={9} strokeWidth={2.5} />
                {usage_count} שימושים
              </span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={onEdit}
            title="ערוך תבנית"
            aria-label="ערוך תבנית"
            className={clsx(
              'p-1.5 rounded text-[var(--text-muted)]',
              'hover:text-brand-navy hover:bg-[var(--bg-muted)]',
              'transition-colors duration-150'
            )}
          >
            <PenLine size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="מחק תבנית"
            aria-label="מחק תבנית"
            className={clsx(
              'p-1.5 rounded text-[var(--text-muted)]',
              'hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20',
              'transition-colors duration-150'
            )}
          >
            <Trash2 size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Content preview */}
      {preview && (
        <div className="px-5 pb-3 flex-1">
          <p className="text-xs text-[var(--text-secondary)] font-heebo leading-relaxed">
            {preview}
          </p>
        </div>
      )}

      {/* Footer */}
      <div className="px-5 py-2.5 border-t border-[var(--border-default)] bg-[var(--bg-muted)] flex items-center justify-between">
        <span className="text-xs text-[var(--text-muted)] font-heebo flex items-center gap-1">
          <Clock size={10} />
          {created_at ? formatRelative(created_at) : ''}
        </span>

        {deleteConfirm ? (
          <div className="flex items-center gap-2">
            {deleteError && (
              <span className="text-xs text-red-600 font-heebo">{deleteError}</span>
            )}
            <button
              type="button"
              onClick={onDeleteCancel}
              className="text-xs font-heebo text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              בטל
            </button>
            <button
              type="button"
              onClick={onDeleteConfirm}
              disabled={isDeleting}
              className={clsx(
                'text-xs font-semibold font-heebo px-2 py-1 rounded',
                'text-white bg-red-600 hover:bg-red-700',
                'transition-colors duration-150',
                isDeleting && 'opacity-60 cursor-not-allowed'
              )}
            >
              {isDeleting ? 'מוחק...' : 'מחק'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onEdit}
            className="text-xs font-medium font-heebo text-brand-navy dark:text-dark-accent hover:underline"
          >
            ערוך
          </button>
        )}
      </div>
    </div>
  );
}

// ── Create / Edit modal ────────────────────────────────────────────────────────

function TemplateFormModal({ isOpen, onClose, onSuccess, existingTemplate }) {
  const isEdit = Boolean(existingTemplate);

  const titleId = useId();
  const contentId = useId();
  const shortcutId = useId();
  const categoryFormId = useId();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [shortcut, setShortcut] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [categories, setCategories] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Fetch categories for selector
  useEffect(() => {
    if (!isOpen) return;
    get('/categories').then((data) => {
      const flat = [];
      const walk = (nodes, depth = 0) => nodes?.forEach(n => {
        flat.push({ ...n, depth });
        if (n.children?.length) walk(n.children, depth + 1);
      });
      walk(data.categories ?? []);
      setCategories(flat);
    }).catch(() => {});
  }, [isOpen]);

  // Populate fields when modal opens
  useEffect(() => {
    if (!isOpen) return;
    if (isEdit && existingTemplate) {
      setTitle(existingTemplate.title ?? '');
      setShortcut(existingTemplate.shortcut ?? '');
      setCategoryId(existingTemplate.category_id ? String(existingTemplate.category_id) : '');
      // Strip HTML tags for plain-text display
      const plain = existingTemplate.content
        ? existingTemplate.content.replace(/<[^>]*>/g, '').trim()
        : '';
      setContent(plain);
    } else {
      setTitle('');
      setContent('');
      setShortcut('');
      setCategoryId('');
    }
    setError(null);
  }, [isOpen, isEdit, existingTemplate]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!title.trim()) {
      setError('יש להזין כותרת לתבנית.');
      return;
    }
    if (!content.trim()) {
      setError('יש להזין תוכן לתבנית.');
      return;
    }

    setError(null);
    setSaving(true);

    const payload = {
      title: title.trim(),
      content: content.trim(),
      ...(shortcut.trim() ? { shortcut: shortcut.trim().replace(/^\//, '') } : {}),
      category_id: categoryId ? parseInt(categoryId, 10) : null,
    };

    try {
      if (isEdit) {
        const tid = existingTemplate._id ?? existingTemplate.id;
        await put(`/rabbis/templates/${tid}`, payload);
      } else {
        await post('/rabbis/templates', payload);
      }
      onSuccess?.();
    } catch (err) {
      setError(
        err?.response?.data?.error ||
          err?.response?.data?.message ||
          'שגיאה בשמירת התבנית. אנא נסה שוב.'
      );
    } finally {
      setSaving(false);
    }
  };

  const inputClass = clsx(
    'w-full px-3 py-2',
    'text-sm font-heebo text-[var(--text-primary)]',
    'bg-[var(--bg-surface-raised)]',
    'border border-[var(--border-default)] rounded-md',
    'placeholder:text-[var(--text-muted)]',
    'focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-transparent',
    'transition-colors duration-150'
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'עריכת תבנית' : 'תבנית חדשה'}
      size="md"
      closeOnBackdrop={!saving}
      footer={
        <div className="flex items-center justify-start gap-3 flex-wrap" dir="rtl">
          <Button
            variant="primary"
            size="md"
            loading={saving}
            onClick={handleSubmit}
            type="submit"
          >
            שמור
          </Button>
          <Button
            variant="ghost"
            size="md"
            disabled={saving}
            onClick={onClose}
          >
            בטל
          </Button>
        </div>
      }
    >
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4"
        dir="rtl"
        noValidate
      >
        {/* Title */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={titleId}
            className="text-sm font-medium font-heebo text-[var(--text-primary)]"
          >
            כותרת <span className="text-red-500">*</span>
          </label>
          <input
            id={titleId}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="למשל: ברכה לאחר הסעודה..."
            dir="rtl"
            maxLength={120}
            className={inputClass}
          />
        </div>

        {/* Content */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor={contentId}
              className="text-sm font-medium font-heebo text-[var(--text-primary)]"
            >
              תוכן <span className="text-red-500">*</span>
            </label>
            <span className="text-xs text-[var(--text-muted)] font-heebo tabular-nums">
              {content.length.toLocaleString('he-IL')} תווים
            </span>
          </div>
          <textarea
            id={contentId}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="הקלד את תוכן התבנית כאן..."
            dir="rtl"
            rows={8}
            className={clsx(inputClass, 'resize-y leading-relaxed')}
          />
        </div>

        {/* Shortcut */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={shortcutId}
            className="text-sm font-medium font-heebo text-[var(--text-primary)]"
          >
            קיצור דרך{' '}
            <span className="text-xs font-normal text-[var(--text-muted)]">(אופציונלי)</span>
          </label>
          <div className="relative">
            <span className="absolute top-1/2 -translate-y-1/2 end-3 text-[var(--text-muted)] text-sm font-mono select-none pointer-events-none">
              /
            </span>
            <input
              id={shortcutId}
              type="text"
              value={shortcut}
              onChange={(e) => {
                // strip leading slash if user types it
                setShortcut(e.target.value.replace(/^\//, ''));
              }}
              placeholder="שבת"
              dir="ltr"
              maxLength={30}
              className={clsx(inputClass, 'pe-7 text-left')}
            />
          </div>
          <p className="text-xs text-[var(--text-muted)] font-heebo">
            קיצור דרך מאפשר הכנסת התבנית מהיר בעורך התשובה.
          </p>
        </div>

        {/* Category */}
        {categories.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={categoryFormId}
              className="text-sm font-medium font-heebo text-[var(--text-primary)]"
            >
              קטגוריה{' '}
              <span className="text-xs font-normal text-[var(--text-muted)]">(אופציונלי)</span>
            </label>
            <select
              id={categoryFormId}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              dir="rtl"
              className={inputClass}
            >
              <option value="">-- ללא קטגוריה --</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {'　'.repeat(cat.depth)}{cat.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Error */}
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400 font-heebo">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
