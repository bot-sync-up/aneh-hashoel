import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  CheckCircle2,
  Calendar,
  Eye,
  Heart,
  User,
  RefreshCw,
  Inbox,
  Clock,
  Pencil,
} from 'lucide-react';
import PageHeader from '../components/layout/PageHeader';
import { BlockSpinner } from '../components/ui/Spinner';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { get } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import {
  formatDate,
  formatRelative,
  getCategoryLabel,
  colorFromCategory,
  truncate,
} from '../lib/utils';

const PAGE_SIZE = 20;
const EDIT_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

function AnswerCard({ question, currentRabbiId }) {
  const navigate = useNavigate();
  const {
    id,
    title,
    category,
    answered_at,
    assigned_rabbi,
    assigned_rabbi_id,
    rabbi_name,
    answer,
    answer_is_private,
    answer_rabbi_id,
    view_count = 0,
    thank_count = 0,
  } = question;

  const isMyAnswer = currentRabbiId && answer_rabbi_id && String(answer_rabbi_id) === String(currentRabbiId);

  const resolvedRabbiId = assigned_rabbi?.id ?? assigned_rabbi_id;
  const isMe = currentRabbiId && resolvedRabbiId && String(resolvedRabbiId) === String(currentRabbiId);
  const rabbiName = assigned_rabbi?.display_name ?? assigned_rabbi?.name ?? rabbi_name;

  const canEdit = isMe && (() => {
    if (!answered_at) return false;
    return (Date.now() - new Date(answered_at).getTime()) < EDIT_WINDOW_MS;
  })();

  return (
    <Card
      hoverable
      onClick={() => navigate(`/questions/${id}`)}
      className="cursor-pointer hover:border-brand-gold/60 hover:shadow-lg transition-all duration-200"
    >
      {/* Meta */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" />
        {category && (
          <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium font-heebo', colorFromCategory(category))}>
            {getCategoryLabel(category)}
          </span>
        )}
        {answer_is_private && (
          <span className="inline-flex items-center gap-1 text-xs font-medium font-heebo px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200 dark:border-amber-700">
            🔒 פרטי
          </span>
        )}
        <span className="mr-auto text-xs text-[var(--text-muted)] font-heebo flex items-center gap-1">
          <Calendar size={11} />
          {formatDate(answered_at)}
        </span>
      </div>

      {/* Title */}
      <h3 className="text-base font-semibold text-[var(--text-primary)] font-heebo leading-snug mb-2 group-hover:text-brand-navy">
        {truncate(title || '', 80)}
      </h3>

      {/* Answer snippet */}
      {answer_is_private && !isMyAnswer ? (
        <p className="text-sm text-[var(--text-muted)] font-heebo italic mb-3">
          תשובה פרטית — גלויה לרב שענה בלבד.
        </p>
      ) : answer ? (
        <p className="text-sm text-[var(--text-secondary)] font-heebo leading-relaxed line-clamp-2 mb-3"
          dangerouslySetInnerHTML={{ __html: answer }}
        />
      ) : null}

      {/* Footer */}
      <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] font-heebo mt-3 pt-3 border-t border-[var(--border-default)] flex-wrap">
        {rabbiName && (
          <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
            <User size={11} />
            הרב {rabbiName}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Eye size={11} />
          {view_count} צפיות
        </span>
        <span className="flex items-center gap-1">
          <Heart size={11} />
          {thank_count} תודות
        </span>
        {answered_at && (
          <span className="flex items-center gap-1 mr-auto">
            <Clock size={11} />
            {formatRelative(answered_at)}
          </span>
        )}
        {canEdit && (
          <button
            className="flex items-center gap-1 text-brand-navy hover:underline font-medium"
            onClick={(e) => { e.stopPropagation(); navigate(`/questions/${id}`); }}
          >
            <Pencil size={11} />
            ערוך תשובה
          </button>
        )}
      </div>
    </Card>
  );
}

export default function AnswersPage() {
  const { rabbi } = useAuth();
  const { on } = useSocket();
  const [answers, setAnswers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const sentinelRef = useRef(null);
  const observerRef = useRef(null);

  const fetchPage = useCallback(async (pageNum = 1, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const data = await get('/questions', { status: 'answered', page: pageNum, limit: PAGE_SIZE, sort: 'answered_at_desc' });
      const items = data.questions || data.data || data || [];
      const totalCount = data.total ?? data.totalCount ?? items.length;

      setTotal(totalCount);
      setAnswers((prev) => (append ? [...prev, ...items] : items));
      setHasMore(items.length === PAGE_SIZE);
    } catch (err) {
      setError(err.message || 'שגיאה בטעינת התשובות.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchPage(1);
  }, [fetchPage]);

  // Infinite scroll
  useEffect(() => {
    if (!sentinelRef.current) return;
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          const nextPage = page + 1;
          setPage(nextPage);
          fetchPage(nextPage, true);
        }
      },
      { threshold: 0.1 }
    );
    observerRef.current.observe(sentinelRef.current);
    return () => observerRef.current?.disconnect();
  }, [hasMore, loadingMore, loading, page, fetchPage]);

  // Real-time: new answers
  useEffect(() => {
    const offAnswered = on('question:answered', (payload) => {
      if (payload.status === 'answered') {
        setAnswers((prev) => {
          if (prev.some((q) => q.id === payload.id)) return prev;
          return [payload, ...prev];
        });
        setTotal((t) => t + 1);
      }
    });

    return () => { offAnswered(); };
  }, [on]);

  const isEmpty = !loading && answers.length === 0;

  return (
    <div className="page-enter" dir="rtl">
      <PageHeader
        title="תשובות"
        subtitle={
          total > 0
            ? `${total.toLocaleString('he-IL')} תשובות פורסמו`
            : 'כל השאלות שנענו'
        }
        actions={
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RefreshCw size={14} />}
            onClick={() => { setPage(1); fetchPage(1); }}
            disabled={loading}
          >
            רענן
          </Button>
        }
      />

      <div className="p-6 space-y-5">
        {loading && <BlockSpinner label="טוען תשובות..." />}

        {!loading && error && (
          <div className="text-center py-12">
            <p className="text-red-600 dark:text-red-400 font-heebo mb-4">{error}</p>
            <Button variant="outline" onClick={() => fetchPage(1)}>נסה שוב</Button>
          </div>
        )}

        {isEmpty && !error && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-[var(--bg-muted)] flex items-center justify-center mb-4">
              <Inbox size={28} className="text-[var(--text-muted)]" />
            </div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)] font-heebo mb-2">
              אין תשובות עדיין
            </h3>
            <p className="text-sm text-[var(--text-muted)] font-heebo">
              תשובות לשאלות יופיעו כאן לאחר שיפורסמו
            </p>
          </div>
        )}

        {!loading && !error && answers.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {answers.map((question) => (
              <AnswerCard
                key={question.id}
                question={question}
                currentRabbiId={rabbi?.id}
              />
            ))}
          </div>
        )}

        <div ref={sentinelRef} className="h-4" aria-hidden="true" />

        {loadingMore && (
          <div className="flex justify-center py-4">
            <BlockSpinner label="טוען עוד תשובות..." />
          </div>
        )}

        {!hasMore && answers.length > 0 && !loadingMore && (
          <p className="text-center text-sm text-[var(--text-muted)] font-heebo py-4">
            הגעת לסוף הרשימה · {answers.length} תשובות
          </p>
        )}
      </div>
    </div>
  );
}
