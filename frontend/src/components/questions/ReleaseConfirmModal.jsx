import React, { useState } from 'react';
import { AlertTriangle, AlertCircle } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { post } from '../../lib/api';

/**
 * ReleaseConfirmModal — confirms releasing a claimed question back to the queue.
 *
 * Props:
 *   isOpen     — boolean
 *   onClose    — () => void
 *   question   — question object { id, title }
 *   onReleased — (updatedQuestion) => void   optional callback after success
 */
function ReleaseConfirmModal({ isOpen, onClose, question, onReleased }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!question) return null;

  const { id, title } = question;

  const handleRelease = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await post(`/questions/release/${id}`);
      onReleased?.(data.question || data);
      onClose();
    } catch (err) {
      const message =
        err.response?.data?.message ||
        err.message ||
        'אירעה שגיאה בשחרור השאלה. אנא נסה שוב.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (loading) return;
    setError(null);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="שחרור שאלה"
      size="sm"
      closeOnBackdrop={!loading}
      footer={
        <div className="flex items-center gap-3 justify-end flex-row-reverse">
          <Button
            variant="danger"
            onClick={handleRelease}
            loading={loading}
            disabled={loading}
          >
            שחרר
          </Button>
          <Button
            variant="ghost"
            onClick={handleClose}
            disabled={loading}
          >
            ביטול
          </Button>
        </div>
      }
    >
      <div className="space-y-4 font-heebo" dir="rtl">
        <p className="text-[var(--text-primary)] text-base font-medium">
          האם אתה בטוח שברצונך לשחרר שאלה זו?
        </p>

        {/* Question title preview */}
        {title && (
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-muted)] p-3">
            <p className="text-sm font-semibold text-[var(--text-primary)] leading-snug">
              {title}
            </p>
          </div>
        )}

        {/* Warning */}
        <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-700">
          <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              שים לב
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-400 mt-0.5 leading-relaxed">
              היא תחזור לתור הכללי וכל רב יוכל לתפוס אותה. כל הטיוטה שכתבת תישמר.
            </p>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-700">
            <AlertCircle size={15} className="text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default ReleaseConfirmModal;
