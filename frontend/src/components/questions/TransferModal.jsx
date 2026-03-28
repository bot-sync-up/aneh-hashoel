import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { AlertCircle, Wifi, WifiOff } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Select from '../ui/Select';
import { get, post } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

/**
 * TransferModal — transfer a question to another online rabbi.
 *
 * Props:
 *   isOpen       — boolean
 *   onClose      — () => void
 *   question     — question object { id, title }
 *   onTransferred — (updatedQuestion) => void   optional callback after success
 */
function TransferModal({ isOpen, onClose, question, onTransferred }) {
  const { rabbi: currentRabbi } = useAuth();
  const [rabbis, setRabbis] = useState([]);
  const [loadingRabbis, setLoadingRabbis] = useState(false);
  const [selectedRabbi, setSelectedRabbi] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [fetchError, setFetchError] = useState(null);

  // Fetch online rabbis when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setSelectedRabbi('');
    setNote('');
    setError(null);
    setFetchError(null);

    const fetchRabbis = async () => {
      setLoadingRabbis(true);
      try {
        const myId = currentRabbi?.id;
        const filterSelf = (list) => list.filter((r) => String(r.id) !== String(myId));

        // Load all active rabbis + mark who is online
        const [allData, onlineData] = await Promise.all([
          get('/rabbis'),
          get('/rabbis/online').catch(() => ({ online: [] })),
        ]);
        const onlineIds = new Set((onlineData.online || []).map(String));
        const allRabbis = allData.rabbis || allData || [];
        const list = filterSelf(Array.isArray(allRabbis) ? allRabbis : []);
        setRabbis(list.map((r) => ({ ...r, is_online: onlineIds.has(String(r.id)) })));
      } catch (err) {
        setFetchError('לא ניתן לטעון את רשימת הרבנים המחוברים.');
      } finally {
        setLoadingRabbis(false);
      }
    };

    fetchRabbis();
  }, [isOpen]);

  if (!question) return null;

  const { id, title } = question;

  const rabbiOptions = [
    { value: '', label: loadingRabbis ? 'טוען...' : 'בחר רב...' },
    ...rabbis.map((r) => ({
      value: r.id,
      label: `הרב ${r.display_name || r.name}${r.is_online ? ' 🟢' : ''}`,
    })),
  ];

  const handleTransfer = async () => {
    if (!selectedRabbi) {
      setError('יש לבחור רב לפני העברה.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const data = await post(`/questions/transfer/${id}`, {
        targetRabbiId: selectedRabbi,
        note: note.trim() || undefined,
      });
      const targetName = rabbis.find((r) => String(r.id) === String(selectedRabbi))?.name || 'הרב';
      onTransferred?.(data.question || data);
      onClose();
      toast.success(`השאלה הועברה בהצלחה להרב ${targetName}`);
    } catch (err) {
      const message =
        err.response?.data?.message ||
        err.message ||
        'אירעה שגיאה בהעברת השאלה. אנא נסה שוב.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return;
    setError(null);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="העברת שאלה לרב אחר"
      size="md"
      closeOnBackdrop={!submitting}
      footer={
        <div className="flex items-center gap-3 justify-end flex-row-reverse">
          <Button
            variant="primary"
            onClick={handleTransfer}
            loading={submitting}
            disabled={submitting || !selectedRabbi || loadingRabbis}
          >
            העבר שאלה
          </Button>
          <Button
            variant="ghost"
            onClick={handleClose}
            disabled={submitting}
          >
            ביטול
          </Button>
        </div>
      }
    >
      <div className="space-y-5 font-heebo" dir="rtl">
        {/* Question title */}
        {title && (
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-muted)] p-3">
            <p className="text-xs text-[var(--text-muted)] mb-1">שאלה להעברה:</p>
            <p className="text-sm font-semibold text-[var(--text-primary)] leading-snug">
              {title}
            </p>
          </div>
        )}

        {/* Fetch error */}
        {fetchError && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-700">
            <WifiOff size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-700 dark:text-amber-300">{fetchError}</p>
          </div>
        )}

        {/* Online rabbi count indicator */}
        {!loadingRabbis && !fetchError && (
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <Wifi size={13} className="text-emerald-500" />
            <span>
              {rabbis.length > 0
                ? `${rabbis.length} רבנים מחוברים כעת`
                : 'אין רבנים מחוברים כעת'}
            </span>
          </div>
        )}

        {/* Rabbi selector */}
        <Select
          label="בחר רב לקבלת השאלה"
          options={rabbiOptions}
          value={selectedRabbi}
          onChange={(e) => {
            setSelectedRabbi(e.target.value);
            setError(null);
          }}
          disabled={loadingRabbis || rabbis.length === 0}
          required
        />

        {/* Optional note */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
            הערה לרב המקבל{' '}
            <span className="text-[var(--text-muted)] font-normal">(אופציונלי)</span>
          </label>
          <textarea
            rows={3}
            placeholder="הוסף הערה או הסבר לרב המקבל..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm font-heebo px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-brand-gold/40 focus:border-brand-gold hover:border-[var(--border-strong)] transition-colors duration-150 placeholder:text-[var(--text-muted)]"
            dir="rtl"
          />
          <p className="text-xs text-[var(--text-muted)] mt-1 text-left">
            {note.length}/500
          </p>
        </div>

        {/* Transfer error */}
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

export default TransferModal;
