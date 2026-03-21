import React, { useState, useEffect, useCallback, useId } from 'react';
import { clsx } from 'clsx';
import {
  FileText,
  Plus,
  PenLine,
  Trash2,
  Search,
  Clock,
  Tag,
} from 'lucide-react';
import PageHeader from '../components/layout/PageHeader';
import Button from '../components/ui/Button';
import { BlockSpinner } from '../components/ui/Spinner';
import SaveTemplateModal from '../components/answer/SaveTemplateModal';
import { get, del } from '../lib/api';
import { formatRelative } from '../lib/utils';

export default function TemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState(null); // template id
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const searchId = useId();

  // ── Fetch ───────────────────────────────────────────────────────────────────

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

  // ── Filtered list ───────────────────────────────────────────────────────────

  const filtered = templates.filter((t) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      t.title?.toLowerCase().includes(q) ||
      t.category_name?.toLowerCase().includes(q) ||
      t.content?.toLowerCase().includes(q)
    );
  });

  // ── Modal handlers ──────────────────────────────────────────────────────────

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

  // ── Delete ──────────────────────────────────────────────────────────────────

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

  // ── Render ──────────────────────────────────────────────────────────────────

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

        {/* Search */}
        {!loading && !error && templates.length > 0 && (
          <div className="relative max-w-sm">
            <Search
              size={15}
              className="absolute top-1/2 -translate-y-1/2 end-3 text-[var(--text-muted)] pointer-events-none"
            />
            <input
              id={searchId}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש לפי כותרת, קטגוריה, תוכן..."
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
      <SaveTemplateModal
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

// ── Template card ─────────────────────────────────────────────────────────────

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
  const { title, content, category_name, created_at } = template;

  // Strip HTML tags for preview
  const plainContent = content
    ? content.replace(/<[^>]*>/g, '').trim()
    : '';

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
          {category_name && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-navy/70 font-heebo bg-brand-navy/5 px-2 py-0.5 rounded-full mb-2">
              <Tag size={10} />
              {category_name}
            </span>
          )}
          <h3 className="text-sm font-semibold text-[var(--text-primary)] font-heebo leading-snug">
            {title}
          </h3>
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
      {plainContent && (
        <div className="px-5 pb-3 flex-1">
          <p className="text-xs text-[var(--text-secondary)] font-heebo leading-relaxed line-clamp-4">
            {plainContent}
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
              ביטול
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
