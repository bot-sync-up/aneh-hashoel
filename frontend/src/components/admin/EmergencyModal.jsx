import React, { useState } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, Send, CheckCircle } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { post } from '../../lib/api';

/**
 * EmergencyModal
 *
 * Shows a confirmation dialog before broadcasting an emergency message
 * to all rabbis across all channels.
 *
 * Props:
 *   isOpen   {boolean}
 *   onClose  {() => void}
 *   message  {string}  — the composed message text
 */
export default function EmergencyModal({ isOpen, onClose, message }) {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSend = async () => {
    setError('');
    setLoading(true);
    try {
      await post('/admin/system/emergency', { message });
      setSent(true);
    } catch (err) {
      setError(err?.response?.data?.message || 'שגיאה בשליחת ההודעה. נסה שוב.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setSent(false);
    setError('');
    onClose?.();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={sent ? '' : 'שליחת הודעת חירום'}
      size="md"
      closeOnBackdrop={!loading}
    >
      {sent ? (
        /* ── Success state ── */
        <div className="flex flex-col items-center gap-4 py-6 text-center font-heebo">
          <CheckCircle size={52} className="text-emerald-500" strokeWidth={1.5} />
          <h3 className="text-lg font-bold text-[var(--text-primary)]">ההודעה נשלחה!</h3>
          <p className="text-sm text-[var(--text-secondary)]">
            ההודעה נשלחה לכל הרבנים בכל הערוצים הזמינים.
          </p>
          <Button variant="primary" onClick={handleClose}>
            סגור
          </Button>
        </div>
      ) : (
        /* ── Confirmation state ── */
        <div className="space-y-5 font-heebo" dir="rtl">
          {/* Warning banner */}
          <div className="flex items-start gap-3 rounded-xl border-2 border-red-300 bg-red-50 px-4 py-4">
            <AlertTriangle size={22} className="text-red-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold text-red-700 text-sm">אזהרה: פעולה בלתי הפיכה</p>
              <p className="text-xs text-red-600 leading-relaxed">
                הודעה זו תישלח מיידית לכל הרבנים בכל הערוצים: מייל, WhatsApp, ואפליקציה.
                לא ניתן לבטל את השליחה לאחר האישור.
              </p>
            </div>
          </div>

          {/* Message preview */}
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">תצוגה מקדימה של ההודעה:</p>
            <div
              className={clsx(
                'rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-raised)]',
                'px-4 py-4 text-sm text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap min-h-[80px]'
              )}
            >
              {message || (
                <span className="text-[var(--text-muted)] italic">אין תוכן להצגה</span>
              )}
            </div>
          </div>

          {/* Recipients info */}
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <Send size={13} />
            <span>ישלח לכל הרבנים הפעילים במערכת בו-זמנית</span>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-1">
            <Button variant="ghost" onClick={handleClose} disabled={loading}>
              ביטול
            </Button>
            <Button
              variant="danger"
              loading={loading}
              disabled={!message?.trim()}
              onClick={handleSend}
              leftIcon={<Send size={15} />}
            >
              שלח עכשיו
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
