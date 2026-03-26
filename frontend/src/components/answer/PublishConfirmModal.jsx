import React, { useState } from 'react';
import { clsx } from 'clsx';
import Modal from '../ui/Modal';
import Button from '../ui/Button';

/**
 * PublishConfirmModal
 *
 * Shows a rendered preview of the answer + rabbi signature before publishing.
 *
 * Props:
 *   isOpen       {boolean}
 *   onClose      {Function}
 *   editorHtml   {string}    — raw HTML from TipTap editor
 *   signature    {string}    — rabbi's plain-text signature
 *   onConfirm    {Function}  — async ({ html }) => void  — called on publish
 */
export default function PublishConfirmModal({
  isOpen,
  onClose,
  editorHtml,
  signature,
  onConfirm,
}) {
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState(null);

  const handleConfirm = async () => {
    setError(null);
    setPublishing(true);
    try {
      await onConfirm?.({ html: editorHtml });
      onClose?.();
    } catch (err) {
      setError(
        err?.response?.data?.message || 'שגיאה בפרסום התשובה. אנא נסה שוב.'
      );
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="אישור פרסום תשובה"
      size="lg"
      closeOnBackdrop={!publishing}
      footer={
        <div className="flex items-center justify-start gap-3 flex-wrap" dir="rtl">
          <Button
            variant="secondary"
            size="md"
            loading={publishing}
            onClick={handleConfirm}
          >
            פרסם
          </Button>
          <Button
            variant="ghost"
            size="md"
            disabled={publishing}
            onClick={onClose}
          >
            חזור לעריכה
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5" dir="rtl">
        {/* Sub-heading */}
        <p className="text-sm text-[var(--text-muted)] font-heebo">
          כך תיראה התשובה בפני הציבור:
        </p>

        {/* Preview box */}
        <div
          className={clsx(
            'rounded-lg border border-[var(--border-default)]',
            'bg-[var(--bg-surface-raised)]',
            'overflow-y-auto max-h-[50vh]',
            'px-5 py-4',
          )}
        >
          {/* Answer HTML */}
          <div
            className="answer-preview-content font-heebo text-[var(--text-primary)] leading-relaxed text-base"
            dir="rtl"
            dangerouslySetInnerHTML={{ __html: editorHtml }}
          />

          {/* Signature removed — handled by WordPress via rabbi taxonomy */}
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

        {/* Warning note */}
        <p className="text-xs text-[var(--text-muted)] font-heebo leading-relaxed">
          לאחר הפרסום התשובה תהיה גלויה לשואל. ניתן לערוך את התשובה לאחר
          הפרסום והיא תסומן כ"עודכן".
        </p>
      </div>

      {/* Scoped prose styles for preview */}
      <style>{`
        .answer-preview-content h2 {
          font-size: 1.2rem;
          font-weight: 700;
          color: var(--color-navy);
          margin-top: 1rem;
          margin-bottom: 0.4rem;
        }
        .answer-preview-content h3 {
          font-size: 1.05rem;
          font-weight: 600;
          color: var(--color-navy);
          margin-top: 0.8rem;
          margin-bottom: 0.35rem;
        }
        .answer-preview-content p {
          margin-bottom: 0.55rem;
          line-height: 1.8;
        }
        .answer-preview-content ul,
        .answer-preview-content ol {
          padding-inline-start: 1.5rem;
          margin-bottom: 0.65rem;
        }
        .answer-preview-content li {
          margin-bottom: 0.25rem;
          line-height: 1.7;
        }
        .answer-preview-content blockquote {
          border-inline-start: 3px solid var(--color-gold);
          padding-inline-start: 0.85rem;
          color: var(--text-secondary);
          font-style: italic;
          margin-bottom: 0.65rem;
        }
        .answer-preview-content strong {
          font-weight: 700;
        }
      `}</style>
    </Modal>
  );
}
