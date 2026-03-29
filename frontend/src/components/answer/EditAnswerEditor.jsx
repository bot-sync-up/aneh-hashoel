import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Quote,
  Heading2,
  Heading3,
  Undo2,
  Redo2,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
} from 'lucide-react';
import { clsx } from 'clsx';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Spinner from '../ui/Spinner';
import api from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDateTime(isoString) {
  if (!isoString) return '';
  try {
    return new Date(isoString).toLocaleString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

// ── Toolbar button ────────────────────────────────────────────────────────

function ToolbarButton({ onClick, active, disabled, title, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        onClick?.();
      }}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={clsx(
        'inline-flex items-center justify-center w-8 h-8 rounded',
        'text-[var(--text-secondary)] transition-colors duration-150',
        'hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        active && 'bg-[var(--bg-muted)] text-brand-navy font-bold'
      )}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return (
    <span
      className="w-px h-5 bg-[var(--border-default)] mx-0.5 flex-shrink-0"
      aria-hidden="true"
    />
  );
}

/**
 * EditAnswerEditor
 *
 * Same rich-text editor as AnswerEditor, but for editing a published answer.
 * Sends PUT /api/questions/answer/:id and shows an "עודכן" badge + timestamp.
 *
 * Props:
 *   questionId      {string|number}
 *   existingAnswer  {string}         — current published HTML
 *   updatedAt       {string}         — ISO timestamp of last update (optional)
 *   onSave          {Function}       — called with ({ html }) after server save
 *   onOpenTemplates {Function}       — optional, opens TemplatesPanel
 */
export default function EditAnswerEditor({
  questionId,
  existingAnswer,
  updatedAt: initialUpdatedAt,
  onSave,
  onOpenTemplates,
}) {
  const { rabbi } = useAuth();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt || null);
  const [justSaved, setJustSaved] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);

  const justSavedTimerRef = useRef(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: false,
        code: false,
      }),
      Placeholder.configure({
        placeholder: 'ערוך את תשובתך כאן...',
        emptyEditorClass: 'is-editor-empty',
      }),
      CharacterCount,
    ],
    content: existingAnswer || '',
    editorProps: {
      attributes: {
        dir: 'rtl',
        lang: 'he',
        class: [
          'edit-editor-content',
          'min-h-[240px] max-h-[520px] overflow-y-auto',
          'px-4 py-3',
          'text-[var(--text-primary)] font-heebo text-base leading-relaxed',
          'focus:outline-none',
        ].join(' '),
      },
    },
  });

  // Cleanup justSaved timer
  useEffect(() => {
    return () => {
      if (justSavedTimerRef.current) clearTimeout(justSavedTimerRef.current);
    };
  }, []);

  const charCount = editor?.storage?.characterCount?.characters?.() ?? 0;
  const signature = rabbi?.signature || '';

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!editor || !questionId) return;
    const html = editor.getHTML();
    setSaving(true);
    setError(null);
    setJustSaved(false);
    try {
      const { data } = await api.put(`/questions/answer/${questionId}`, {
        content: html,
      });
      const newUpdatedAt =
        data?.updatedAt || data?.answer?.updatedAt || new Date().toISOString();
      setUpdatedAt(newUpdatedAt);
      setJustSaved(true);

      // Clear the "saved" highlight after 4 s
      justSavedTimerRef.current = setTimeout(() => {
        setJustSaved(false);
      }, 4000);

      onSave?.({ html });
    } catch (err) {
      setError(
        err?.response?.data?.error || err?.response?.data?.message || 'שגיאה בשמירת השינויים. אנא נסה שוב.'
      );
    } finally {
      setSaving(false);
    }
  }, [editor, questionId, onSave]);

  if (!editor) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" dir="rtl">
      {/* "Updated" badge row */}
      {updatedAt && (
        <div
          className={clsx(
            'flex items-center gap-2',
            'px-3 py-2 rounded-lg',
            justSaved
              ? 'bg-emerald-50 border border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700'
              : 'bg-[var(--bg-surface-raised)] border border-[var(--border-default)]'
          )}
        >
          <CheckCircle2
            size={15}
            strokeWidth={2}
            className={clsx(
              'flex-shrink-0',
              justSaved
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-[var(--text-muted)]'
            )}
            aria-hidden="true"
          />
          <span
            className={clsx(
              'text-sm font-heebo',
              justSaved
                ? 'text-emerald-700 dark:text-emerald-300 font-semibold'
                : 'text-[var(--text-muted)]'
            )}
          >
            {justSaved ? 'השינויים נשמרו בהצלחה —' : 'עודכן בתאריך'}
            {' '}
            {formatDateTime(updatedAt)}
          </span>
        </div>
      )}

      {/* Public-visibility warning */}
      <div
        role="note"
        className={clsx(
          'flex items-start gap-2',
          'px-3 py-2.5 rounded-lg',
          'bg-amber-50 border border-amber-200 text-amber-800',
          'dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-200',
          'text-xs font-heebo leading-relaxed'
        )}
      >
        <AlertTriangle
          size={14}
          strokeWidth={2}
          className="flex-shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <span>
          שינויים יופיעו לציבור עם הכיתוב "עודכן בתאריך..." מיד לאחר השמירה.
        </span>
      </div>

      {/* Editor Card */}
      <Card noPadding className="overflow-hidden">
        {/* Toolbar */}
        <div
          className={clsx(
            'flex items-center gap-0.5 flex-wrap',
            'px-3 py-2',
            'border-b border-[var(--border-default)]',
            'bg-[var(--bg-surface-raised)]'
          )}
          role="toolbar"
          aria-label="סרגל כלים לעריכה"
        >
          <ToolbarButton
            title="מודגש"
            active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold size={15} strokeWidth={2.2} />
          </ToolbarButton>

          <ToolbarButton
            title="נטוי"
            active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic size={15} strokeWidth={2.2} />
          </ToolbarButton>

          <ToolbarDivider />

          <ToolbarButton
            title="כותרת H2"
            active={editor.isActive('heading', { level: 2 })}
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 2 }).run()
            }
          >
            <Heading2 size={15} strokeWidth={2} />
          </ToolbarButton>

          <ToolbarButton
            title="כותרת H3"
            active={editor.isActive('heading', { level: 3 })}
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 3 }).run()
            }
          >
            <Heading3 size={15} strokeWidth={2} />
          </ToolbarButton>

          <ToolbarDivider />

          <ToolbarButton
            title="רשימה לא ממוספרת"
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List size={15} strokeWidth={2} />
          </ToolbarButton>

          <ToolbarButton
            title="רשימה ממוספרת"
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered size={15} strokeWidth={2} />
          </ToolbarButton>

          <ToolbarDivider />

          <ToolbarButton
            title="ציטוט"
            active={editor.isActive('blockquote')}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            <Quote size={15} strokeWidth={2} />
          </ToolbarButton>

          <ToolbarDivider />

          <ToolbarButton
            title="בטל (Ctrl+Z)"
            disabled={!editor.can().undo()}
            onClick={() => editor.chain().focus().undo().run()}
          >
            <Undo2 size={15} strokeWidth={2} />
          </ToolbarButton>

          <ToolbarButton
            title="בצע שוב (Ctrl+Y)"
            disabled={!editor.can().redo()}
            onClick={() => editor.chain().focus().redo().run()}
          >
            <Redo2 size={15} strokeWidth={2} />
          </ToolbarButton>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Templates shortcut */}
          {onOpenTemplates && (
            <button
              type="button"
              onClick={onOpenTemplates}
              title="תבניות"
              className={clsx(
                'inline-flex items-center gap-1.5 px-2.5 h-8 rounded',
                'text-xs font-medium font-heebo text-[var(--text-secondary)]',
                'border border-[var(--border-default)]',
                'hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]',
                'transition-colors duration-150'
              )}
            >
              <FileText size={13} strokeWidth={2} />
              תבניות
            </button>
          )}
        </div>

        {/* Editor content */}
        <EditorContent editor={editor} />

        {/* Character count bar */}
        <div
          className={clsx(
            'flex items-center justify-end',
            'px-4 py-1.5',
            'border-t border-[var(--border-default)]',
            'bg-[var(--bg-surface-raised)]'
          )}
        >
          <span className="text-xs text-[var(--text-muted)] font-heebo tabular-nums">
            {charCount.toLocaleString('he-IL')} תווים
          </span>
        </div>
      </Card>

      {/* Signature preview (collapsible) */}
      <div className="rounded-lg border border-[var(--border-default)] overflow-hidden">
        <button
          type="button"
          onClick={() => setSignatureOpen((v) => !v)}
          className={clsx(
            'w-full flex items-center justify-between',
            'px-4 py-3',
            'bg-[var(--bg-surface-raised)]',
            'text-sm font-medium font-heebo text-[var(--text-secondary)]',
            'hover:bg-[var(--bg-muted)] transition-colors duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-gold'
          )}
          aria-expanded={signatureOpen}
        >
          <span>חתימה — תצורף בסוף התשובה</span>
          {signatureOpen ? (
            <ChevronUp size={16} strokeWidth={2} />
          ) : (
            <ChevronDown size={16} strokeWidth={2} />
          )}
        </button>

        {signatureOpen && (
          <div className="px-4 py-3 bg-[var(--bg-surface)] border-t border-[var(--border-default)]">
            {signature ? (
              <p
                className="text-sm text-[var(--text-secondary)] font-heebo whitespace-pre-wrap leading-relaxed"
                dir="rtl"
              >
                {signature}
              </p>
            ) : (
              <p className="text-sm text-[var(--text-muted)] font-heebo italic">
                לא הוגדרה חתימה בפרופיל.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <p
          role="alert"
          className="text-sm text-red-600 dark:text-red-400 font-heebo px-1"
        >
          {error}
        </p>
      )}

      {/* Save button */}
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="md"
          loading={saving}
          disabled={charCount === 0}
          onClick={handleSave}
        >
          שמור שינויים
        </Button>
      </div>

      {/* Scoped prose styles matching AnswerEditor */}
      <style>{`
        .edit-editor-content.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: var(--text-muted);
          pointer-events: none;
          position: absolute;
          top: 0;
          right: 0;
          padding: 0.75rem 1rem;
          font-family: 'Heebo', sans-serif;
        }
        .edit-editor-content .ProseMirror {
          outline: none;
        }
        .edit-editor-content h2 {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--color-navy);
          margin-top: 1.25rem;
          margin-bottom: 0.5rem;
          font-family: 'Heebo', sans-serif;
        }
        .edit-editor-content h3 {
          font-size: 1.1rem;
          font-weight: 600;
          color: var(--color-navy);
          margin-top: 1rem;
          margin-bottom: 0.4rem;
          font-family: 'Heebo', sans-serif;
        }
        .edit-editor-content p {
          margin-bottom: 0.6rem;
          line-height: 1.8;
        }
        .edit-editor-content ul,
        .edit-editor-content ol {
          padding-inline-start: 1.5rem;
          margin-bottom: 0.75rem;
        }
        .edit-editor-content li {
          margin-bottom: 0.3rem;
          line-height: 1.7;
        }
        .edit-editor-content blockquote {
          border-inline-start: 3px solid var(--color-gold);
          padding-inline-start: 1rem;
          margin-inline-start: 0;
          color: var(--text-secondary);
          font-style: italic;
          margin-bottom: 0.75rem;
        }
        .edit-editor-content strong {
          font-weight: 700;
          color: var(--text-primary);
        }
      `}</style>
    </div>
  );
}
