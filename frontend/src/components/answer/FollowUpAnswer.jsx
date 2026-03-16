import React, { useState, useCallback } from 'react';
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
  Undo2,
  Redo2,
  MessageCircleReply,
} from 'lucide-react';
import { clsx } from 'clsx';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Spinner from '../ui/Spinner';
import api from '../../lib/api';

// ── Small toolbar button (reused locally) ─────────────────────────────────

function TB({ onClick, active, disabled, title, children }) {
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
        'inline-flex items-center justify-center w-7 h-7 rounded',
        'text-[var(--text-secondary)] transition-colors duration-150',
        'hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        active && 'bg-[var(--bg-muted)] text-brand-navy'
      )}
    >
      {children}
    </button>
  );
}

/**
 * FollowUpAnswer
 *
 * A smaller TipTap editor for responding to a follow-up question from the asker.
 * Submits via POST /api/questions/followup-answer/:id
 *
 * Props:
 *   questionId       {string|number}
 *   followUpText     {string}         — the asker's follow-up question text
 *   onSaveSuccess    {Function}       — called after successful post
 */
export default function FollowUpAnswer({
  questionId,
  followUpText,
  onSaveSuccess,
}) {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        code: false,
      }),
      Placeholder.configure({
        placeholder: 'כתוב תשובה לשאלת המשך...',
        emptyEditorClass: 'is-editor-empty',
      }),
      CharacterCount,
    ],
    content: '',
    editorProps: {
      attributes: {
        dir: 'rtl',
        lang: 'he',
        class: [
          'followup-editor-content',
          'min-h-[140px] max-h-[320px] overflow-y-auto',
          'px-3 py-2',
          'text-[var(--text-primary)] font-heebo text-sm leading-relaxed',
          'focus:outline-none',
        ].join(' '),
      },
    },
  });

  const charCount = editor?.storage?.characterCount?.characters?.() ?? 0;

  const handleSubmit = useCallback(async () => {
    if (!editor || !questionId || charCount === 0) return;
    const html = editor.getHTML();
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/questions/followup-answer/${questionId}`, {
        content: html,
      });
      setSubmitted(true);
      editor.commands.clearContent();
      onSaveSuccess?.();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          'שגיאה בשליחת התשובה. אנא נסה שוב.'
      );
    } finally {
      setSubmitting(false);
    }
  }, [editor, questionId, charCount, onSaveSuccess]);

  if (!editor) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="sm" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" dir="rtl">
      {/* Follow-up question display */}
      {followUpText && (
        <div
          className={clsx(
            'flex gap-2 items-start',
            'px-3 py-3 rounded-lg',
            'bg-[var(--bg-surface-raised)] border border-[var(--border-default)]'
          )}
        >
          <MessageCircleReply
            size={15}
            strokeWidth={2}
            className="text-brand-gold mt-0.5 flex-shrink-0"
            aria-hidden="true"
          />
          <p className="text-sm font-heebo text-[var(--text-secondary)] leading-relaxed">
            {followUpText}
          </p>
        </div>
      )}

      {/* Confirmation notice */}
      <p className="text-xs font-heebo text-[var(--text-muted)] flex items-center gap-1.5">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full bg-brand-gold flex-shrink-0"
          aria-hidden="true"
        />
        תשובה זו תצורף מתחת לתשובה המקורית
      </p>

      {/* Success state */}
      {submitted && (
        <div
          role="status"
          className={clsx(
            'px-4 py-3 rounded-lg',
            'bg-emerald-50 border border-emerald-200 text-emerald-700',
            'dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-300',
            'text-sm font-heebo font-medium'
          )}
        >
          התשובה לשאלת ההמשך נשלחה בהצלחה.
        </div>
      )}

      {!submitted && (
        <Card noPadding className="overflow-hidden">
          {/* Toolbar */}
          <div
            className={clsx(
              'flex items-center gap-0.5',
              'px-2 py-1.5',
              'border-b border-[var(--border-default)]',
              'bg-[var(--bg-surface-raised)]'
            )}
            role="toolbar"
            aria-label="סרגל כלים"
          >
            <TB
              title="מודגש"
              active={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <Bold size={13} strokeWidth={2.2} />
            </TB>
            <TB
              title="נטוי"
              active={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <Italic size={13} strokeWidth={2.2} />
            </TB>
            <span className="w-px h-4 bg-[var(--border-default)] mx-0.5" aria-hidden="true" />
            <TB
              title="רשימה"
              active={editor.isActive('bulletList')}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              <List size={13} strokeWidth={2} />
            </TB>
            <TB
              title="רשימה ממוספרת"
              active={editor.isActive('orderedList')}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
              <ListOrdered size={13} strokeWidth={2} />
            </TB>
            <TB
              title="ציטוט"
              active={editor.isActive('blockquote')}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
            >
              <Quote size={13} strokeWidth={2} />
            </TB>
            <span className="w-px h-4 bg-[var(--border-default)] mx-0.5" aria-hidden="true" />
            <TB
              title="בטל"
              disabled={!editor.can().undo()}
              onClick={() => editor.chain().focus().undo().run()}
            >
              <Undo2 size={13} strokeWidth={2} />
            </TB>
            <TB
              title="בצע שוב"
              disabled={!editor.can().redo()}
              onClick={() => editor.chain().focus().redo().run()}
            >
              <Redo2 size={13} strokeWidth={2} />
            </TB>
          </div>

          {/* Editor */}
          <EditorContent editor={editor} />

          {/* Char count */}
          <div
            className={clsx(
              'flex items-center justify-end',
              'px-3 py-1',
              'border-t border-[var(--border-default)]',
              'bg-[var(--bg-surface-raised)]'
            )}
          >
            <span className="text-xs text-[var(--text-muted)] font-heebo tabular-nums">
              {charCount.toLocaleString('he-IL')} תווים
            </span>
          </div>
        </Card>
      )}

      {/* Error */}
      {error && (
        <p
          role="alert"
          className="text-sm text-red-600 dark:text-red-400 font-heebo"
        >
          {error}
        </p>
      )}

      {/* Submit button */}
      {!submitted && (
        <div className="flex justify-start">
          <Button
            variant="secondary"
            size="sm"
            loading={submitting}
            disabled={charCount === 0}
            onClick={handleSubmit}
          >
            שלח תשובה להמשך
          </Button>
        </div>
      )}

      {/* TipTap placeholder style */}
      <style>{`
        .followup-editor-content.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: var(--text-muted);
          pointer-events: none;
          position: absolute;
          top: 0;
          right: 0;
          padding: 0.5rem 0.75rem;
          font-family: 'Heebo', sans-serif;
          font-size: 0.875rem;
        }
        .followup-editor-content .ProseMirror {
          outline: none;
        }
        .followup-editor-content p {
          margin-bottom: 0.4rem;
          line-height: 1.75;
        }
        .followup-editor-content ul,
        .followup-editor-content ol {
          padding-inline-start: 1.25rem;
          margin-bottom: 0.5rem;
        }
        .followup-editor-content blockquote {
          border-inline-start: 3px solid var(--color-gold);
          padding-inline-start: 0.75rem;
          color: var(--text-secondary);
          font-style: italic;
          margin-bottom: 0.5rem;
        }
      `}</style>
    </div>
  );
}
