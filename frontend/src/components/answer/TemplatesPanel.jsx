import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Search,
  Plus,
  PenLine,
  Trash2,
  ChevronLeft,
} from 'lucide-react';
import { clsx } from 'clsx';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import Spinner from '../ui/Spinner';
import SaveTemplateModal from './SaveTemplateModal';
import api from '../../lib/api';

/**
 * TemplatesPanel
 *
 * Slide-in drawer from the right that lists rabbi templates.
 *
 * Props:
 *   isOpen      {boolean}
 *   onClose     {Function}
 *   editor      {Editor}     — TipTap editor instance (for content insertion)
 *   editorHtml  {string}     — current editor HTML (prefill when creating template)
 */
export default function TemplatesPanel({
  isOpen,
  onClose,
  editor,
  editorHtml,
}) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [search, setSearch] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null); // template id
  const [deleting, setDeleting] = useState(false);

  // SaveTemplateModal state
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);

  const panelRef = useRef(null);
  const searchRef = useRef(null);

  // ── Fetch templates ───────────────────────────────────────────────────────
  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const { data } = await api.get('/rabbis/templates');
      setTemplates(data?.templates ?? data ?? []);
    } catch (err) {
      setFetchError(
        err?.response?.data?.message || 'שגיאה בטעינת התבניות. אנא נסה שוב.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchTemplates();
      // Focus search when drawer opens
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [isOpen, fetchTemplates]);

  // ── Close on Escape ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // ── Filtered list ────────────────────────────────────────────────────────
  const filtered = templates.filter((t) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      t.title?.toLowerCase().includes(q) ||
      t.category?.toLowerCase().includes(q)
    );
  });

  // ── Insert template into editor ───────────────────────────────────────────
  const handleInsert = useCallback(
    (template) => {
      if (!editor) return;
      // Insert at current cursor; if empty replace all
      editor
        .chain()
        .focus()
        .insertContent(template.content)
        .run();
      onClose?.();
    },
    [editor, onClose]
  );

  // ── Delete template ───────────────────────────────────────────────────────
  const handleDelete = useCallback(
    async (id) => {
      setDeleting(true);
      try {
        await api.delete(`/rabbis/templates/${id}`);
        setTemplates((prev) => prev.filter((t) => t._id !== id && t.id !== id));
        setDeleteConfirm(null);
      } catch {
        // non-critical — just reset
      } finally {
        setDeleting(false);
      }
    },
    []
  );

  // ── Open edit modal ───────────────────────────────────────────────────────
  const handleEdit = useCallback((template) => {
    setEditingTemplate(template);
    setSaveModalOpen(true);
  }, []);

  // ── After save / create success ───────────────────────────────────────────
  const handleSaveSuccess = useCallback(() => {
    setSaveModalOpen(false);
    setEditingTemplate(null);
    fetchTemplates();
  }, [fetchTemplates]);

  // ── Category badge variant ────────────────────────────────────────────────
  function categoryVariant(category) {
    const map = {
      'נישואין': 'info',
      'שבת': 'success',
      'כשרות': 'warning',
      'אבלות': 'default',
      'תפילה': 'info',
    };
    return map[category] || 'default';
  }

  const panel = (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="תבניות תשובה"
        dir="rtl"
        className={clsx(
          'fixed top-0 right-0 bottom-0 z-50',
          'w-full max-w-sm',
          'bg-[var(--bg-surface)] shadow-[var(--shadow-modal)]',
          'flex flex-col',
          'transition-transform duration-300 ease-in-out',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)] flex-shrink-0">
          <h2 className="text-base font-bold font-heebo text-[var(--text-primary)]">
            תבניות תשובה
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגור"
            className={clsx(
              'p-1.5 rounded-md',
              'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
              'hover:bg-[var(--bg-muted)] transition-colors duration-150'
            )}
          >
            <ChevronLeft size={18} strokeWidth={2} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-[var(--border-default)] flex-shrink-0">
          <div className="relative">
            <Search
              size={15}
              strokeWidth={2}
              className="absolute top-1/2 -translate-y-1/2 end-3 text-[var(--text-muted)] pointer-events-none"
            />
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש תבנית..."
              dir="rtl"
              className={clsx(
                'w-full pe-9 ps-3 py-2',
                'text-sm font-heebo text-[var(--text-primary)]',
                'bg-[var(--bg-surface-raised)]',
                'border border-[var(--border-default)] rounded-md',
                'placeholder:text-[var(--text-muted)]',
                'focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-transparent',
                'transition-colors duration-150'
              )}
            />
          </div>
        </div>

        {/* Template list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
          {loading && (
            <div className="flex justify-center py-8">
              <Spinner size="md" />
            </div>
          )}

          {!loading && fetchError && (
            <p className="text-sm text-red-600 dark:text-red-400 font-heebo py-4 text-center">
              {fetchError}
            </p>
          )}

          {!loading && !fetchError && filtered.length === 0 && (
            <p className="text-sm text-[var(--text-muted)] font-heebo py-8 text-center">
              {search ? 'לא נמצאו תבניות התואמות לחיפוש.' : 'אין תבניות שמורות עדיין.'}
            </p>
          )}

          {!loading &&
            filtered.map((template) => {
              const tid = template._id ?? template.id;
              return (
                <div
                  key={tid}
                  className={clsx(
                    'rounded-lg border border-[var(--border-default)]',
                    'bg-[var(--bg-surface-raised)]',
                    'px-3 py-3 flex flex-col gap-2',
                    'transition-shadow duration-150 hover:shadow-soft'
                  )}
                >
                  {/* Title row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="text-sm font-semibold font-heebo text-[var(--text-primary)] leading-snug truncate">
                        {template.title}
                      </span>
                      {template.category && (
                        <Badge
                          status={categoryVariant(template.category)}
                          label={template.category}
                          size="xs"
                        />
                      )}
                    </div>

                    {/* Edit / Delete icons */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handleEdit(template)}
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

                      {deleteConfirm === tid ? (
                        <button
                          type="button"
                          onClick={() => handleDelete(tid)}
                          disabled={deleting}
                          title="אשר מחיקה"
                          aria-label="אשר מחיקה"
                          className={clsx(
                            'p-1.5 rounded text-red-600',
                            'hover:bg-red-50 dark:hover:bg-red-900/30',
                            'transition-colors duration-150',
                            'text-xs font-heebo font-semibold'
                          )}
                        >
                          {deleting ? <Spinner size="xs" /> : 'מחק?'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDeleteConfirm(tid)}
                          title="מחק תבנית"
                          aria-label="מחק תבנית"
                          className={clsx(
                            'p-1.5 rounded text-[var(--text-muted)]',
                            'hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30',
                            'transition-colors duration-150'
                          )}
                        >
                          <Trash2 size={14} strokeWidth={2} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Insert button */}
                  <button
                    type="button"
                    onClick={() => handleInsert(template)}
                    className={clsx(
                      'self-start inline-flex items-center gap-1.5',
                      'px-3 py-1.5 rounded',
                      'text-xs font-medium font-heebo',
                      'bg-brand-navy text-white',
                      'hover:bg-[var(--color-navy-light)]',
                      'transition-colors duration-150'
                    )}
                  >
                    הכנס
                  </button>
                </div>
              );
            })}
        </div>

        {/* Footer: create new template */}
        <div className="px-4 py-3 border-t border-[var(--border-default)] flex-shrink-0">
          <Button
            variant="outline"
            size="md"
            className="w-full"
            leftIcon={<Plus size={15} strokeWidth={2} />}
            onClick={() => {
              setEditingTemplate(null);
              setSaveModalOpen(true);
            }}
          >
            צור תבנית חדשה
          </Button>
        </div>
      </div>

      {/* Save / Edit template modal */}
      <SaveTemplateModal
        isOpen={saveModalOpen}
        onClose={() => {
          setSaveModalOpen(false);
          setEditingTemplate(null);
        }}
        onSuccess={handleSaveSuccess}
        existingTemplate={editingTemplate}
        prefillContent={!editingTemplate ? editorHtml : undefined}
      />
    </>
  );

  return createPortal(panel, document.body);
}
