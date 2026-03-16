import React, { useState } from 'react';
import { clsx } from 'clsx';
import { Flame, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { post } from '../../lib/api';
import { getCategoryLabel, colorFromCategory } from '../../lib/utils';

/**
 * ClaimConfirmModal — confirms that the rabbi wants to claim a question.
 *
 * Props:
 *   isOpen    — boolean
 *   onClose   — () => void
 *   question  — question object { id, title, category, is_urgent }
 *   onClaimed — (updatedQuestion) => void   optional callback after success
 */
function ClaimConfirmModal({ isOpen, onClose, question, onClaimed }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!question) return null;

  const { id, title, category, is_urgent } = question;

  const handleConfirm = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await post(`/questions/claim/${id}`);
      onClaimed?.(data.question || data);
      onClose();
      navigate(`/questions/${id}`);
    } catch (err) {
      const message =
        err.response?.data?.message ||
        err.message ||
        'אירעה שגיאה בתפיסת השאלה. אנא נסה שוב.';
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
      title="תפיסת שאלה"
      size="sm"
      closeOnBackdrop={!loading}
      footer={
        <div className="flex items-center gap-3 justify-end flex-row-reverse">
          <Button
            variant="secondary"
            onClick={handleConfirm}
            loading={loading}
            disabled={loading}
            leftIcon={<Flame size={15} />}
            className="bg-brand-gold hover:bg-brand-gold-dark text-white"
          >
            כן, אני רוצה לענות
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
        {/* Question */}
        <p className="text-[var(--text-primary)] text-base font-medium leading-relaxed">
          האם אתה רוצה לתפוס שאלה זו?
        </p>

        {/* Question preview card */}
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-muted)] p-4 space-y-2">
          {/* Category + urgent */}
          <div className="flex items-center gap-2 flex-wrap">
            {is_urgent && (
              <span className="flex items-center gap-1 text-xs font-bold text-red-600">
                <Flame size={13} className="fill-red-400" />
                דחוף
              </span>
            )}
            {category && (
              <span
                className={clsx(
                  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                  colorFromCategory(category)
                )}
              >
                {getCategoryLabel(category)}
              </span>
            )}
          </div>

          {/* Title */}
          <p className="text-sm font-semibold text-[var(--text-primary)] leading-snug">
            {title}
          </p>
        </div>

        <p className="text-sm text-[var(--text-muted)]">
          לאחר התפיסה, השאלה תועבר לטיפולך ותוכל להתחיל לענות.
        </p>

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

export default ClaimConfirmModal;
