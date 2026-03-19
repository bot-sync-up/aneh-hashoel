import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { RefreshCw, Inbox, Pencil } from 'lucide-react';
import PageHeader from '../components/layout/PageHeader';
import QuestionCard from '../components/questions/QuestionCard';
import QuestionFilters from '../components/questions/QuestionFilters';
import ClaimConfirmModal from '../components/questions/ClaimConfirmModal';
import ReleaseConfirmModal from '../components/questions/ReleaseConfirmModal';
import AnswerEditorAdvanced from '../components/answer/AnswerEditor';
import { BlockSpinner } from '../components/ui/Spinner';
import Button from '../components/ui/Button';
import { get, post } from '../lib/api';
import { useSocket } from '../contexts/SocketContext';
import { truncate } from '../lib/utils';

const DEFAULT_FILTERS = {
  status: '',
  category: '',
  search: '',
  is_urgent: '',
  sort: 'created_at_desc',
  date_from: '',
  date_to: '',
  page: 1,
};

const PAGE_SIZE = 20;

export default function QuestionsPage() {
  const { on } = useSocket();
  const navigate = useNavigate();

  const [questions, setQuestions] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);

  // Modals
  const [claimTarget, setClaimTarget] = useState(null);
  const [releaseTarget, setReleaseTarget] = useState(null);
  const [answerTarget, setAnswerTarget] = useState(null);
  const [discussionTarget, setDiscussionTarget] = useState(null);

  // New question IDs to flash
  const [newIds, setNewIds] = useState(new Set());

  // Sentinel for infinite scroll
  const sentinelRef = useRef(null);
  const observerRef = useRef(null);

  // ── Fetch questions ──────────────────────────────────────────────────────

  const buildParams = (f) => {
    const params = { page: f.page, limit: PAGE_SIZE };
    if (f.status) params.status = f.status;
    if (f.category) params.category = f.category;
    if (f.search) params.search = f.search;
    if (f.is_urgent) params.is_urgent = true;
    if (f.sort) params.sort = f.sort;
    if (f.date_from) params.date_from = f.date_from;
    if (f.date_to) params.date_to = f.date_to;
    return params;
  };

  const fetchPage = useCallback(async (filtersToUse, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);

    try {
      const data = await get('/questions', buildParams(filtersToUse));
      const items = data.questions || data.data || data || [];
      const totalCount = data.total ?? data.totalCount ?? items.length;

      setTotal(totalCount);
      setQuestions((prev) => (append ? [...prev, ...items] : items));
      setHasMore(items.length === PAGE_SIZE);
    } catch (err) {
      setError(err.message || 'שגיאה בטעינת השאלות.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // Initial + filter-change fetch (page resets to 1)
  const activeFiltersKey = [
    filters.status,
    filters.category,
    filters.search,
    filters.is_urgent,
    filters.sort,
    filters.date_from,
    filters.date_to,
  ].join('|');

  useEffect(() => {
    fetchPage({ ...filters, page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFiltersKey]);

  // Infinite scroll observer
  useEffect(() => {
    if (!sentinelRef.current) return;
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          hasMore &&
          !loadingMore &&
          !loading
        ) {
          const nextPage = filters.page + 1;
          setFilters((f) => ({ ...f, page: nextPage }));
          fetchPage({ ...filters, page: nextPage }, true);
        }
      },
      { threshold: 0.1 }
    );

    observerRef.current.observe(sentinelRef.current);
    return () => observerRef.current?.disconnect();
  }, [hasMore, loadingMore, loading, filters, fetchPage]);

  // ── Real-time socket events ──────────────────────────────────────────────

  useEffect(() => {
    const offNew = on('question:new', (newQuestion) => {
      setQuestions((prev) => {
        if (prev.some((q) => q.id === newQuestion.id)) return prev;
        return [newQuestion, ...prev];
      });
      setNewIds((prev) => new Set(prev).add(newQuestion.id));
      setTimeout(() => {
        setNewIds((prev) => {
          const next = new Set(prev);
          next.delete(newQuestion.id);
          return next;
        });
      }, 5000);
    });

    const offClaimed = on('question:claimed', ({ id, assigned_rabbi, status }) => {
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === id ? { ...q, status, assigned_rabbi } : q
        )
      );
    });

    const offReleased = on('question:released', ({ id }) => {
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === id ? { ...q, status: 'pending', assigned_rabbi: null } : q
        )
      );
    });

    const offAnswered = on(
      'question:answered',
      ({ id, status, assigned_rabbi, answered_at }) => {
        setQuestions((prev) =>
          prev.map((q) =>
            q.id === id ? { ...q, status, assigned_rabbi, answered_at } : q
          )
        );
      }
    );

    return () => {
      offNew();
      offClaimed();
      offReleased();
      offAnswered();
    };
  }, [on]);

  // ── Filter handlers ──────────────────────────────────────────────────────

  const handleFiltersChange = (newFilters) => {
    setFilters({ ...newFilters, page: 1 });
  };

  const handleClearFilters = () => {
    setFilters(DEFAULT_FILTERS);
  };

  // ── Claim / Release callbacks ────────────────────────────────────────────

  const handleClaimed = (updatedQuestion) => {
    setQuestions((prev) =>
      prev.map((q) => (q.id === updatedQuestion.id ? updatedQuestion : q))
    );
  };

  const handleReleased = (updatedQuestion) => {
    setQuestions((prev) =>
      prev.map((q) => (q.id === updatedQuestion.id ? updatedQuestion : q))
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const isEmpty = !loading && questions.length === 0;

  return (
    <div className="page-enter" dir="rtl">
      <PageHeader
        title="כל השאלות"
        subtitle={
          total > 0
            ? `${total.toLocaleString('he-IL')} שאלות בסך הכל`
            : 'צפייה וניהול כל השאלות במערכת'
        }
        actions={
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RefreshCw size={14} />}
            onClick={() => fetchPage({ ...filters, page: 1 })}
            disabled={loading}
          >
            רענן
          </Button>
        }
      />

      <div className="p-6 space-y-5">
        {/* Filters */}
        <QuestionFilters
          filters={filters}
          onChange={handleFiltersChange}
          onClear={handleClearFilters}
          defaultOpen
        />

        {/* Loading state */}
        {loading && <BlockSpinner label="טוען שאלות..." />}

        {/* Error state */}
        {!loading && error && (
          <div className="text-center py-12">
            <p className="text-red-600 dark:text-red-400 font-heebo mb-4">{error}</p>
            <Button
              variant="outline"
              onClick={() => fetchPage({ ...filters, page: 1 })}
            >
              נסה שוב
            </Button>
          </div>
        )}

        {/* Empty state */}
        {isEmpty && !error && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-[var(--bg-muted)] flex items-center justify-center mb-4">
              <Inbox size={28} className="text-[var(--text-muted)]" />
            </div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)] font-heebo mb-2">
              אין שאלות תואמות לסינון
            </h3>
            <p className="text-sm text-[var(--text-muted)] font-heebo mb-4">
              נסה לשנות את הסינון או לנקות את כל הפילטרים
            </p>
            <Button variant="outline" size="sm" onClick={handleClearFilters}>
              נקה סינון
            </Button>
          </div>
        )}

        {/* Question cards grid */}
        {!loading && !error && questions.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {questions.map((question) => (
              <QuestionCard
                key={question.id}
                question={question}
                showActions
                isNew={newIds.has(question.id)}
                onClaim={setClaimTarget}
                onRelease={setReleaseTarget}
                onAnswer={setAnswerTarget}
                onDiscussion={setDiscussionTarget}
              />
            ))}
          </div>
        )}

        {/* Infinite scroll sentinel */}
        <div ref={sentinelRef} className="h-4" aria-hidden="true" />

        {/* Load-more spinner */}
        {loadingMore && (
          <div className="flex justify-center py-4">
            <BlockSpinner label="טוען עוד שאלות..." />
          </div>
        )}

        {/* End of list indicator */}
        {!hasMore && questions.length > 0 && !loadingMore && (
          <p className="text-center text-sm text-[var(--text-muted)] font-heebo py-4">
            הגעת לסוף הרשימה · {questions.length} שאלות
          </p>
        )}
      </div>

      {/* Modals */}
      <ClaimConfirmModal
        isOpen={Boolean(claimTarget)}
        question={claimTarget}
        onClose={() => setClaimTarget(null)}
        onClaimed={handleClaimed}
      />

      <ReleaseConfirmModal
        isOpen={Boolean(releaseTarget)}
        question={releaseTarget}
        onClose={() => setReleaseTarget(null)}
        onReleased={handleReleased}
      />

      {/* Answer modal */}
      {answerTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setAnswerTarget(null); }}
        >
          <div className="bg-[var(--bg-surface)] rounded-card shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-[var(--border-default)]">
              <h2 className="font-semibold text-[var(--text-primary)] font-heebo flex items-center gap-2">
                <Pencil size={16} className="text-brand-navy" />
                כתיבת תשובה — {truncate(answerTarget.title || '', 40)}
              </h2>
              <button
                onClick={() => setAnswerTarget(null)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl leading-none px-2"
              >
                ✕
              </button>
            </div>
            <div className="p-4">
              <AnswerEditorAdvanced
                questionId={answerTarget.id}
                existingAnswer=""
                onSave={({ publishNow }) => {
                  if (publishNow) {
                    setQuestions((prev) =>
                      prev.map((q) =>
                        q.id === answerTarget.id ? { ...q, status: 'answered' } : q
                      )
                    );
                    setAnswerTarget(null);
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Discussion modal */}
      {discussionTarget && (
        <DiscussionModal
          question={discussionTarget}
          onClose={() => setDiscussionTarget(null)}
          onCreated={(discussionId) => {
            setDiscussionTarget(null);
            navigate(`/discussions/${discussionId}`);
          }}
        />
      )}
    </div>
  );
}

// ── DiscussionModal ────────────────────────────────────────────────────────
function DiscussionModal({ question, onClose, onCreated }) {
  const [title, setTitle] = useState(question?.title ? `דיון: ${truncate(question.title, 50)}` : '');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    if (!title.trim() || !body.trim()) { setError('יש למלא כותרת ותוכן.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const data = await post('/discussions', { title, body, question_id: question?.id });
      onCreated?.(data.discussion?.id || data.id);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'שגיאה ביצירת הדיון.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-[var(--bg-surface)] rounded-card shadow-xl p-6 space-y-4" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-[var(--text-primary)] font-heebo">פתח דיון חדש</h2>
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] font-heebo mb-1.5">כותרת הדיון</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm font-heebo px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-gold/40 focus:border-brand-gold hover:border-[var(--border-strong)] transition-colors" />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] font-heebo mb-1.5">תוכן הדיון</label>
          <textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="כתוב את תוכן הדיון כאן..."
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm font-heebo px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-brand-gold/40 focus:border-brand-gold hover:border-[var(--border-strong)] transition-colors placeholder:text-[var(--text-muted)]" />
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400 font-heebo">{error}</p>}
        <div className="flex items-center gap-3 justify-end flex-row-reverse pt-2">
          <Button variant="primary" onClick={handleSubmit} loading={submitting} disabled={submitting}>צור דיון</Button>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>ביטול</Button>
        </div>
      </div>
    </div>
  );
}
