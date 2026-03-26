import React, { useState, useEffect, useId } from 'react';
import { clsx } from 'clsx';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import api from '../../lib/api';

// Categories are fetched from the DB on first render

/**
 * SaveTemplateModal
 *
 * Creates or edits a rabbi template.
 *
 * Props:
 *   isOpen            {boolean}
 *   onClose           {Function}
 *   onSuccess         {Function}  — called after successful save; triggers list refresh
 *   existingTemplate  {Object}    — if provided, modal is in edit mode
 *   prefillContent    {string}    — HTML to pre-fill content when creating new
 */
export default function SaveTemplateModal({
  isOpen,
  onClose,
  onSuccess,
  existingTemplate,
  prefillContent,
}) {
  const isEdit = Boolean(existingTemplate);

  const titleId = useId();
  const categoryId = useId();
  const contentId = useId();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(false);

  // ── Load categories from DB ────────────────────────────────────────────────
  const [categories, setCategories] = useState([]);
  useEffect(() => {
    api.get('/categories')
      .then(({ data }) => {
        // Flatten tree: take all nodes (parents + children)
        const flat = [];
        const walk = (nodes) => nodes?.forEach((n) => {
          flat.push(n);
          if (n.children?.length) walk(n.children);
        });
        walk(data?.categories ?? data ?? []);
        setCategories(flat.map((c) => ({ id: c.id, name: c.name })));
      })
      .catch(() => {});
  }, []);

  // ── Populate fields ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    if (isEdit && existingTemplate) {
      setTitle(existingTemplate.title ?? '');
      setCategory(existingTemplate.category ?? '');
      // Strip HTML tags for plain textarea display
      const plain = existingTemplate.content
        ? existingTemplate.content.replace(/<[^>]*>/g, '').trim()
        : '';
      setContent(plain);
    } else {
      setTitle('');
      setCategory('');
      // Pre-fill from editor content, stripping HTML
      const plain = prefillContent
        ? prefillContent.replace(/<[^>]*>/g, '').trim()
        : '';
      setContent(plain);
    }
    setError(null);
    setToast(false);
  }, [isOpen, isEdit, existingTemplate, prefillContent]);

  // ── Submit ─────────────────────────────────────────────────────────────────
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
      category_id: category || undefined,
      content: content.trim(),
    };

    try {
      if (isEdit) {
        const tid = existingTemplate._id ?? existingTemplate.id;
        await api.put(`/rabbis/templates/${tid}`, payload);
      } else {
        await api.post('/rabbis/templates', payload);
      }

      setToast(true);
      setTimeout(() => {
        setToast(false);
        onSuccess?.();
      }, 1200);
    } catch (err) {
      setError(
        err?.response?.data?.message || 'שגיאה בשמירת התבנית. אנא נסה שוב.'
      );
    } finally {
      setSaving(false);
    }
  };

  const charCount = content.length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'עריכת תבנית' : 'שמירת תבנית חדשה'}
      size="md"
      closeOnBackdrop={!saving}
      footer={
        <div className="flex items-center justify-start gap-3 flex-wrap" dir="rtl">
          <Button
            variant="secondary"
            size="md"
            loading={saving}
            onClick={handleSubmit}
            type="submit"
          >
            {isEdit ? 'עדכן תבנית' : 'שמור תבנית'}
          </Button>
          <Button
            variant="ghost"
            size="md"
            disabled={saving}
            onClick={onClose}
          >
            ביטול
          </Button>
        </div>
      }
    >
      {/* Success toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={clsx(
            'mb-4 px-4 py-2.5 rounded-lg',
            'bg-emerald-50 border border-emerald-200 text-emerald-700',
            'dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-300',
            'text-sm font-heebo font-medium'
          )}
        >
          התבנית נשמרה בהצלחה!
        </div>
      )}

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
            כותרת התבנית <span className="text-red-500">*</span>
          </label>
          <input
            id={titleId}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="למשל: תשובה לשאלה בענין שבת..."
            dir="rtl"
            maxLength={120}
            className={clsx(
              'w-full px-3 py-2',
              'text-sm font-heebo text-[var(--text-primary)]',
              'bg-[var(--bg-surface-raised)]',
              'border border-[var(--border-default)] rounded-md',
              'placeholder:text-[var(--text-muted)]',
              'focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-transparent',
              'transition-colors duration-150'
            )}
          />
        </div>

        {/* Category */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={categoryId}
            className="text-sm font-medium font-heebo text-[var(--text-primary)]"
          >
            קטגוריה
          </label>
          <select
            id={categoryId}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            dir="rtl"
            className={clsx(
              'w-full px-3 py-2',
              'text-sm font-heebo text-[var(--text-primary)]',
              'bg-[var(--bg-surface-raised)]',
              'border border-[var(--border-default)] rounded-md',
              'focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-transparent',
              'transition-colors duration-150',
              'appearance-none cursor-pointer'
            )}
          >
            <option value="">ללא קטגוריה</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.name}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>

        {/* Content textarea */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor={contentId}
              className="text-sm font-medium font-heebo text-[var(--text-primary)]"
            >
              תוכן התבנית <span className="text-red-500">*</span>
            </label>
            <span className="text-xs text-[var(--text-muted)] font-heebo tabular-nums">
              {charCount.toLocaleString('he-IL')} תווים
            </span>
          </div>
          <textarea
            id={contentId}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="הקלד את תוכן התבנית כאן..."
            dir="rtl"
            rows={8}
            className={clsx(
              'w-full px-3 py-2 resize-y',
              'text-sm font-heebo text-[var(--text-primary)] leading-relaxed',
              'bg-[var(--bg-surface-raised)]',
              'border border-[var(--border-default)] rounded-md',
              'placeholder:text-[var(--text-muted)]',
              'focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-transparent',
              'transition-colors duration-150'
            )}
          />
        </div>

        {/* Error */}
        {error && (
          <p
            role="alert"
            className="text-sm text-red-600 dark:text-red-400 font-heebo"
          >
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
