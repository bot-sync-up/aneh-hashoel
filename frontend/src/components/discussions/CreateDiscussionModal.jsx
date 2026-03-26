import React, { useState, useEffect, useCallback, useRef } from 'react';
import { clsx } from 'clsx';
import { X, Search, Check, Link2 } from 'lucide-react';
import api from '../../lib/api';
import Modal from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { useDebounce } from '../../hooks/useDebounce';

/**
 * Modal to create a new internal discussion.
 *
 * Props:
 *   isOpen            — bool
 *   onClose()         — close handler
 *   questionId?       — pre-link a question
 *   onSuccess(disc)   — called after successful POST /api/discussions
 */
export default function CreateDiscussionModal({
  isOpen,
  onClose,
  questionId,
  onSuccess,
}) {
  const [title, setTitle] = useState('');
  const [membersMode, setMembersMode] = useState('all'); // 'all' | 'selected'
  const [selectedRabbis, setSelectedRabbis] = useState([]);
  const [rabbiSearch, setRabbiSearch] = useState('');
  const [rabbiResults, setRabbiResults] = useState([]);
  const [searchingRabbis, setSearchingRabbis] = useState(false);
  const [linkedQuestion, setLinkedQuestion] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const titleRef = useRef(null);

  const debouncedRabbiSearch = useDebounce(rabbiSearch, 350);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setMembersMode('all');
      setSelectedRabbis([]);
      setRabbiSearch('');
      setRabbiResults([]);
      setError(null);
      setLinkedQuestion(null);

      // Focus title after render
      setTimeout(() => titleRef.current?.focus(), 80);

      // Pre-fetch question if provided
      if (questionId) {
        api
          .get(`/questions/${questionId}`)
          .then(({ data }) => setLinkedQuestion(data.question || data))
          .catch(() => {});
      }
    }
  }, [isOpen, questionId]);

  // Load ALL active rabbis when "selected" mode is chosen
  const [allRabbis, setAllRabbis] = useState([]);
  const [loadingAllRabbis, setLoadingAllRabbis] = useState(false);

  useEffect(() => {
    if (membersMode !== 'selected') return;
    if (allRabbis.length > 0) return; // already loaded

    setLoadingAllRabbis(true);
    api
      .get('/rabbis', { params: { limit: 200 } })
      .then(({ data }) => {
        const list = data.rabbis || data.data || data || [];
        setAllRabbis(list.filter(r => r.is_active !== false));
      })
      .catch(() => setAllRabbis([]))
      .finally(() => setLoadingAllRabbis(false));
  }, [membersMode, allRabbis.length]);

  // Filter rabbis by search
  const filteredRabbis = allRabbis.filter((r) => {
    if (!rabbiSearch.trim()) return true;
    const q = rabbiSearch.trim().toLowerCase();
    return (r.name || r.full_name || '').toLowerCase().includes(q);
  });

  const toggleRabbi = useCallback((rabbi) => {
    setSelectedRabbis((prev) => {
      const exists = prev.some((r) => r.id === rabbi.id);
      return exists ? prev.filter((r) => r.id !== rabbi.id) : [...prev, rabbi];
    });
  }, []);

  const handleSubmit = useCallback(
    async (e) => {
      e?.preventDefault();
      setError(null);

      if (!title.trim()) {
        setError('יש להזין כותרת לדיון');
        titleRef.current?.focus();
        return;
      }

      if (membersMode === 'selected' && selectedRabbis.length === 0) {
        setError('יש לבחור לפחות רב אחד');
        return;
      }

      setSubmitting(true);
      try {
        const payload = {
          title: title.trim(),
          memberIds: membersMode === 'all' ? 'all' : selectedRabbis.map((r) => r.id),
          ...(linkedQuestion ? { questionId: linkedQuestion.id } : {}),
        };

        const { data } = await api.post('/discussions', payload);
        const discussion = data.discussion || data;
        onSuccess?.(discussion);
      } catch (err) {
        setError(err.response?.data?.message || 'שגיאה ביצירת הדיון');
      } finally {
        setSubmitting(false);
      }
    },
    [title, membersMode, selectedRabbis, linkedQuestion, onSuccess]
  );

  const footer = (
    <div className="flex items-center justify-between gap-3" dir="rtl">
      <button
        type="button"
        onClick={onClose}
        disabled={submitting}
        className="
          px-4 py-2 text-sm font-heebo rounded-md
          text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]
          transition-colors duration-150
          disabled:opacity-50
        "
      >
        ביטול
      </button>
      <button
        type="submit"
        form="create-discussion-form"
        disabled={submitting || !title.trim()}
        className={clsx(
          'flex items-center gap-2 px-5 py-2 rounded-md text-sm font-heebo font-medium',
          'transition-colors duration-150',
          'focus-visible:ring-2 focus-visible:ring-[#B8973A]',
          submitting || !title.trim()
            ? 'bg-[var(--bg-muted)] text-[var(--text-muted)] cursor-not-allowed'
            : 'bg-[#1B2B5E] text-white hover:bg-[#152348]'
        )}
      >
        {submitting && (
          <span
            className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"
            aria-hidden="true"
          />
        )}
        פתח דיון
      </button>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="דיון חדש"
      size="md"
      footer={footer}
    >
      <form
        id="create-discussion-form"
        onSubmit={handleSubmit}
        dir="rtl"
        className="flex flex-col gap-5"
      >
        {/* Error */}
        {error && (
          <div className="px-3 py-2.5 bg-red-50 border border-red-200 rounded-md text-sm text-red-700 font-heebo">
            {error}
          </div>
        )}

        {/* Title */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--text-primary)] font-heebo">
            כותרת הדיון <span className="text-red-500">*</span>
          </label>
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="לדוג': דיון בשאלת שבת - עירוב"
            maxLength={120}
            required
            dir="rtl"
            className="
              w-full px-3 py-2.5 text-sm font-heebo rounded-md
              bg-[var(--bg-surface)] border border-[var(--border-default)]
              text-[var(--text-primary)] placeholder:text-[var(--text-muted)]
              focus:outline-none focus:ring-2 focus:ring-[#1B2B5E]/20 focus:border-[#1B2B5E]
              transition-colors duration-150
              text-right direction-rtl
            "
          />
        </div>

        {/* Members mode */}
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-[var(--text-primary)] font-heebo">
            משתתפים
          </p>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="radio"
                name="members_mode"
                value="all"
                checked={membersMode === 'all'}
                onChange={() => setMembersMode('all')}
                className="accent-[#1B2B5E] w-4 h-4"
              />
              <span className="text-sm font-heebo text-[var(--text-primary)]">
                כל הרבנים
              </span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="radio"
                name="members_mode"
                value="selected"
                checked={membersMode === 'selected'}
                onChange={() => setMembersMode('selected')}
                className="accent-[#1B2B5E] w-4 h-4"
              />
              <span className="text-sm font-heebo text-[var(--text-primary)]">
                רבנים נבחרים
              </span>
            </label>
          </div>
        </div>

        {/* Rabbi multi-select (only for 'selected' mode) */}
        {membersMode === 'selected' && (
          <div className="flex flex-col gap-2">
            {/* Selected chips */}
            {selectedRabbis.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedRabbis.map((r) => (
                  <span
                    key={r.id}
                    className="
                      flex items-center gap-1.5 px-2.5 py-1
                      bg-[#1B2B5E]/10 text-[#1B2B5E] text-xs font-heebo rounded-full
                    "
                  >
                    {r.name || r.full_name}
                    <button
                      type="button"
                      onClick={() => toggleRabbi(r)}
                      className="hover:text-red-500 transition-colors"
                      aria-label={`הסר ${r.name || r.full_name}`}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Search input */}
            <div className="relative">
              <Search
                size={14}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
              />
              <input
                type="search"
                value={rabbiSearch}
                onChange={(e) => setRabbiSearch(e.target.value)}
                placeholder="חיפוש רב..."
                dir="rtl"
                className="
                  w-full pr-9 pl-3 py-2 text-sm font-heebo rounded-md
                  bg-[var(--bg-muted)] border border-transparent
                  text-[var(--text-primary)] placeholder:text-[var(--text-muted)]
                  focus:outline-none focus:border-[#1B2B5E] focus:ring-1 focus:ring-[#1B2B5E]/20
                  text-right direction-rtl
                  transition-colors duration-150
                "
              />
            </div>

            {/* Rabbi list with checkboxes */}
            <div className="border border-[var(--border-default)] rounded-md overflow-hidden bg-[var(--bg-surface)] shadow-sm max-h-52 overflow-y-auto">
              {loadingAllRabbis && (
                <div className="flex justify-center py-3">
                  <Spinner size="sm" />
                </div>
              )}
              {!loadingAllRabbis && filteredRabbis.length === 0 && (
                <div className="px-3 py-3 text-sm text-[var(--text-muted)] font-heebo text-center">
                  {rabbiSearch.trim() ? 'לא נמצאו רבנים' : 'אין רבנים זמינים'}
                </div>
              )}
              {!loadingAllRabbis &&
                filteredRabbis.map((rabbi) => {
                  const isSelected = selectedRabbis.some((r) => r.id === rabbi.id);
                  return (
                    <label
                      key={rabbi.id}
                      className={clsx(
                        'w-full flex items-center gap-2.5 px-3 py-2 cursor-pointer',
                        'text-sm font-heebo text-right',
                        'hover:bg-[var(--bg-muted)] transition-colors duration-100',
                        isSelected && 'bg-[#1B2B5E]/5'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRabbi(rabbi)}
                        className="rounded border-[var(--border-default)] text-[#1B2B5E] focus:ring-[#1B2B5E]/20 w-4 h-4"
                      />
                      <span className="text-[var(--text-primary)] flex-1">
                        {rabbi.name || rabbi.full_name}
                        {rabbi.role && (
                          <span className="text-xs text-[var(--text-muted)] mr-1">
                            ({rabbi.role === 'admin' ? 'מנהל' : rabbi.role === 'customer_service' ? 'שירות לקוחות' : 'רב'})
                          </span>
                        )}
                      </span>
                      {isSelected && (
                        <Check size={14} className="text-[#1B2B5E] flex-shrink-0" />
                      )}
                    </label>
                  );
                })}
            </div>
          </div>
        )}

        {/* Question link */}
        {linkedQuestion ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-[var(--text-primary)] font-heebo">
              שאלה מקושרת
            </p>
            <div
              className="
                flex items-center justify-between gap-2
                px-3 py-2.5 rounded-md
                bg-[#B8973A]/10 border border-[#B8973A]/30
              "
            >
              <div className="flex items-center gap-2 min-w-0">
                <Link2 size={14} className="text-[#B8973A] flex-shrink-0" />
                <span className="text-sm font-heebo text-[var(--text-primary)] truncate">
                  {linkedQuestion.title || linkedQuestion.subject || 'שאלה'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setLinkedQuestion(null)}
                className="p-1 rounded hover:bg-[var(--bg-muted)] text-[var(--text-muted)] flex-shrink-0 transition-colors"
                aria-label="הסר קישור שאלה"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
