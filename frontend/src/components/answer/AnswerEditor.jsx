import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
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
  ChevronDown,
  ChevronUp,
  FileText,
} from 'lucide-react';
import { clsx } from 'clsx';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Spinner from '../ui/Spinner';
import PublishConfirmModal from './PublishConfirmModal';
import api from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDraftTime(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

function draftKey(questionId) {
  return `answer_draft_${questionId}`;
}

// ── Toolbar button ─────────────────────────────────────────────────────────

function ToolbarButton({ onClick, active, disabled, title, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault(); // keep editor focus
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
        active && 'bg-[var(--bg-muted)] text-brand-navy font-bold',
      )}
    >
      {children}
    </button>
  );
}

// ── Divider ────────────────────────────────────────────────────────────────

function ToolbarDivider() {
  return (
    <span className="w-px h-5 bg-[var(--border-default)] mx-0.5 flex-shrink-0" aria-hidden="true" />
  );
}

// ── Main component ─────────────────────────────────────────────────────────

/**
 * AnswerEditor
 *
 * Props:
 *   questionId      {string|number}  — used for localStorage draft key + API calls
 *   existingAnswer  {string}         — HTML string of an existing draft answer (optional)
 *   onSave          {Function}       — called with ({ html, publishNow }) after server save
 *   onOpenTemplates {Function}       — called when the user wants to open TemplatesPanel
 */
export default function AnswerEditor({
  questionId,
  existingAnswer,
  onSave,
  onOpenTemplates,
}) {
  const { rabbi } = useAuth();

  // ── Draft restore state ──────────────────────────────────────────────────
  const [draftNotice, setDraftNotice] = useState(null); // { html, savedAt }
  const [draftRestored, setDraftRestored] = useState(false);

  // ── Signature collapse ───────────────────────────────────────────────────
  const [signatureOpen, setSignatureOpen] = useState(false);

  // ── Publish modal ────────────────────────────────────────────────────────
  const [publishModalOpen, setPublishModalOpen] = useState(false);

  // ── Loading / error ──────────────────────────────────────────────────────
  const [savingDraft, setSavingDraft] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // ── Auto-save timer ref ──────────────────────────────────────────────────
  const autoSaveTimerRef = useRef(null);

  // ── Initial content ──────────────────────────────────────────────────────
  // Prefer the existing server answer; draft restore happens after mount.
  const initialContent = existingAnswer || '';

  // ── TipTap editor ────────────────────────────────────────────────────────
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Only allow H2 and H3
        heading: { levels: [2, 3] },
        // Disable code block for clean Hebrew prose
        codeBlock: false,
        code: false,
      }),
      Placeholder.configure({
        placeholder: 'כתוב את תשובתך כאן...',
        emptyEditorClass: 'is-editor-empty',
      }),
      CharacterCount,
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        dir: 'rtl',
        lang: 'he',
        class: [
          'answer-editor-content',
          'min-h-[240px] max-h-[520px] overflow-y-auto',
          'px-4 py-3',
          'text-[var(--text-primary)] font-heebo text-base leading-relaxed',
          'focus:outline-none',
          'prose prose-answer',
        ].join(' '),
      },
    },
    onUpdate: ({ editor: ed }) => {
      scheduleAutoSave(ed.getHTML());
    },
  });

  // ── Check for local draft on mount ───────────────────────────────────────
  useEffect(() => {
    if (!questionId) return;
    try {
      const raw = localStorage.getItem(draftKey(questionId));
      if (raw) {
        const parsed = JSON.parse(raw);
        // Only show notice if the draft differs from the loaded content
        if (parsed.html && parsed.html !== initialContent) {
          setDraftNotice(parsed);
        }
      }
    } catch {
      // ignore
    }
  }, [questionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-save to localStorage ─────────────────────────────────────────────
  const scheduleAutoSave = useCallback(
    (html) => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => {
        if (!questionId) return;
        try {
          localStorage.setItem(
            draftKey(questionId),
            JSON.stringify({ html, savedAt: new Date().toISOString() })
          );
        } catch {
          // ignore quota errors
        }
      }, 30_000);
    },
    [questionId]
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  // ── Restore draft ────────────────────────────────────────────────────────
  const handleRestoreDraft = useCallback(() => {
    if (!editor || !draftNotice) return;
    editor.commands.setContent(draftNotice.html, true);
    setDraftRestored(true);
    setDraftNotice(null);
  }, [editor, draftNotice]);

  const handleDiscardDraft = useCallback(() => {
    if (questionId) {
      try {
        localStorage.removeItem(draftKey(questionId));
      } catch {
        // ignore
      }
    }
    setDraftNotice(null);
  }, [questionId]);

  // ── Save draft (server) ──────────────────────────────────────────────────
  const handleSaveDraft = useCallback(async () => {
    if (!editor || !questionId) return;
    const html = editor.getHTML();
    setSavingDraft(true);
    setSaveError(null);
    try {
      await api.post(`/questions/answer/${questionId}`, {
        content: html,
        publishNow: false,
      });
      // Also persist to localStorage immediately
      try {
        localStorage.setItem(
          draftKey(questionId),
          JSON.stringify({ html, savedAt: new Date().toISOString() })
        );
      } catch {
        // ignore
      }
      onSave?.({ html, publishNow: false });
    } catch (err) {
      setSaveError(
        err?.response?.data?.message || 'שגיאה בשמירת הטיוטה. אנא נסה שוב.'
      );
    } finally {
      setSavingDraft(false);
    }
  }, [editor, questionId, onSave]);

  // ── Publish (via modal confirm) ──────────────────────────────────────────
  const handlePublishConfirm = useCallback(
    async ({ html }) => {
      try {
        await api.post(`/questions/answer/${questionId}`, {
          content: html,
          publishNow: true,
        });
        // Clear draft from localStorage after successful publish
        try {
          localStorage.removeItem(draftKey(questionId));
        } catch {
          // ignore
        }
        onSave?.({ html, publishNow: true });
      } catch (err) {
        throw err; // let modal handle the error
      }
    },
    [questionId, onSave]
  );

  // ── Character count ──────────────────────────────────────────────────────
  const charCount = editor?.storage?.characterCount?.characters?.() ?? 0;

  // ── Signature ────────────────────────────────────────────────────────────
  const signature = rabbi?.signature || '';

  if (!editor) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" dir="rtl">
      {/* Draft restore notice */}
      {draftNotice && (
        <div
          role="alert"
          className={clsx(
            'flex items-center gap-3 flex-wrap',
            'px-4 py-3 rounded-lg',
            'bg-amber-50 border border-amber-200 text-amber-800',
            'dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-200',
            'text-sm font-heebo'
          )}
        >
          <span className="flex-1">
            נמצאה טיוטה מ-{formatDraftTime(draftNotice.savedAt)}, האם לשחזר?
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleRestoreDraft}
              className="font-semibold underline hover:no-underline"
            >
              שחזר
            </button>
            <button
              type="button"
              onClick={handleDiscardDraft}
              className="text-amber-600 dark:text-amber-400 hover:underline"
            >
              התעלם
            </button>
          </div>
        </div>
      )}

      {draftRestored && (
        <p className="text-sm text-emerald-600 dark:text-emerald-400 font-heebo px-1">
          הטיוטה שוחזרה בהצלחה.
        </p>
      )}

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
          {/* Text formatting */}
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

          {/* Headings */}
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

          {/* Lists */}
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

          {/* Blockquote */}
          <ToolbarButton
            title="ציטוט"
            active={editor.isActive('blockquote')}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            <Quote size={15} strokeWidth={2} />
          </ToolbarButton>

          <ToolbarDivider />

          {/* Undo / Redo */}
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

        {/* Bottom bar: character count */}
        <div
          className={clsx(
            'flex items-center justify-end',
            'px-4 py-1.5',
            'border-t border-[var(--border-default)]',
            'bg-[var(--bg-surface-raised)]',
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
      {saveError && (
        <p
          role="alert"
          className="text-sm text-red-600 dark:text-red-400 font-heebo px-1"
        >
          {saveError}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3 justify-start flex-wrap">
        <Button
          variant="ghost"
          size="md"
          loading={savingDraft}
          onClick={handleSaveDraft}
        >
          שמור טיוטה
        </Button>

        <Button
          variant="secondary"
          size="md"
          onClick={() => setPublishModalOpen(true)}
          disabled={savingDraft || !charCount}
        >
          פרסם תשובה
        </Button>
      </div>

      {/* Publish confirm modal */}
      <PublishConfirmModal
        isOpen={publishModalOpen}
        onClose={() => setPublishModalOpen(false)}
        editorHtml={editor.getHTML()}
        signature={signature}
        onConfirm={handlePublishConfirm}
      />

      {/* TipTap Hebrew prose styles */}
      <style>{`
        .answer-editor-content.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: var(--text-muted);
          pointer-events: none;
          position: absolute;
          top: 0;
          right: 0;
          padding: 0.75rem 1rem;
          font-family: 'Heebo', sans-serif;
        }

        .answer-editor-content .ProseMirror {
          outline: none;
        }

        /* Prose styles for RTL Hebrew */
        .answer-editor-content h2 {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--color-navy);
          margin-top: 1.25rem;
          margin-bottom: 0.5rem;
          font-family: 'Heebo', sans-serif;
        }

        .answer-editor-content h3 {
          font-size: 1.1rem;
          font-weight: 600;
          color: var(--color-navy);
          margin-top: 1rem;
          margin-bottom: 0.4rem;
          font-family: 'Heebo', sans-serif;
        }

        .answer-editor-content p {
          margin-bottom: 0.6rem;
          line-height: 1.8;
        }

        .answer-editor-content ul,
        .answer-editor-content ol {
          padding-inline-start: 1.5rem;
          margin-bottom: 0.75rem;
        }

        .answer-editor-content ul li,
        .answer-editor-content ol li {
          margin-bottom: 0.3rem;
          line-height: 1.7;
        }

        .answer-editor-content blockquote {
          border-inline-start: 3px solid var(--color-gold);
          padding-inline-start: 1rem;
          margin-inline-start: 0;
          color: var(--text-secondary);
          font-style: italic;
          margin-bottom: 0.75rem;
        }

        .answer-editor-content strong {
          font-weight: 700;
          color: var(--text-primary);
        }
      `}</style>
    </div>
  );
}
