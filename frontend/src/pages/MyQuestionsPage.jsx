import React, { useState, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import { Inbox, ClipboardEdit, CheckCircle2, Pencil, Clock, Eye, Lock, ExternalLink, MessageCircleQuestion } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatRelative } from '../lib/utils';
import PageHeader from '../components/layout/PageHeader';
import QuestionCard from '../components/questions/QuestionCard';
import ReleaseConfirmModal from '../components/questions/ReleaseConfirmModal';
import TransferModal from '../components/questions/TransferModal';
import { BlockSpinner } from '../components/ui/Spinner';
import Button from '../components/ui/Button';
import { get } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';

const TABS = [
  {
    key: 'in_process',
    label: 'בטיפולי',
    icon: ClipboardEdit,
    emptyTitle: 'אין שאלות בטיפולך כעת',
    emptyDesc: 'תפוס שאלות מהתור הכללי כדי שיופיעו כאן.',
  },
  {
    key: 'answered',
    label: 'עניתי',
    icon: CheckCircle2,
    emptyTitle: 'עדיין לא ענית על שאלות',
    emptyDesc: 'שאלות שענית עליהן יופיעו כאן.',
  },
  {
    key: 'follow_up',
    label: 'שאלות המשך',
    icon: MessageCircleQuestion,
    emptyTitle: 'אין שאלות המשך ממתינות',
    emptyDesc: 'כשהשואל ישלח שאלת המשך, היא תופיע כאן.',
  },
];

export default function MyQuestionsPage() {
  const navigate = useNavigate();
  const { rabbi } = useAuth();
  const { on } = useSocket();

  const [activeTab, setActiveTab] = useState('in_process');
  const [questionsByTab, setQuestionsByTab] = useState({
    in_process: [],
    answered: [],
    follow_up: [],
  });
  const [loading, setLoading] = useState({ in_process: true, answered: true, follow_up: true });
  const [error, setError] = useState({ in_process: null, answered: null, follow_up: null });
  const [counts, setCounts] = useState({ in_process: 0, answered: 0, follow_up: 0 });

  // Modals
  const [releaseTarget, setReleaseTarget] = useState(null);
  const [transferTarget, setTransferTarget] = useState(null);

  // ── Fetch ────────────────────────────────────────────────────────────────

  const fetchTab = useCallback(async (tab) => {
    setLoading((prev) => ({ ...prev, [tab]: true }));
    setError((prev) => ({ ...prev, [tab]: null }));
    try {
      let items, total;
      if (tab === 'follow_up') {
        // Fetch answered questions and filter to those with pending follow-ups
        const data = await get('/questions/my', { status: 'answered', limit: 100 });
        const allItems = data.questions || data.data || data || [];
        items = allItems.filter((q) => q.pending_follow_up > 0);
        total = items.length;
      } else {
        const data = await get('/questions/my', { status: tab, limit: 100 });
        items = data.questions || data.data || data || [];
        total = data.total ?? items.length;
      }
      setQuestionsByTab((prev) => ({ ...prev, [tab]: items }));
      setCounts((prev) => ({ ...prev, [tab]: total }));
    } catch (err) {
      setError((prev) => ({
        ...prev,
        [tab]: 'שגיאה בטעינת השאלות. נסה לרענן את הדף.',
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [tab]: false }));
    }
  }, []);

  useEffect(() => {
    fetchTab('in_process');
    fetchTab('answered');
    fetchTab('follow_up');
  }, [fetchTab]);

  // ── Socket events ────────────────────────────────────────────────────────

  useEffect(() => {
    const offClaimed = on('question:claimed', ({ id, assigned_rabbi, status }) => {
      if (assigned_rabbi?.id !== rabbi?.id) return;
      // Move to in_process if newly claimed by me
      setQuestionsByTab((prev) => {
        const alreadyHere = prev.in_process.some((q) => q.id === id);
        if (alreadyHere) return prev;
        return {
          ...prev,
          in_process: [
            { id, assigned_rabbi, status, title: '(שאלה חדשה)' },
            ...prev.in_process,
          ],
        };
      });
      fetchTab('in_process');
    });

    const offReleased = on('question:released', ({ id }) => {
      setQuestionsByTab((prev) => ({
        ...prev,
        in_process: prev.in_process.filter((q) => q.id !== id),
      }));
    });

    const offAnswered = on('question:answered', ({ id, status, answered_at }) => {
      if (status !== 'answered') return;
      setQuestionsByTab((prev) => {
        const q = prev.in_process.find((q) => q.id === id);
        if (!q) return prev;
        return {
          in_process: prev.in_process.filter((q) => q.id !== id),
          answered: [{ ...q, status, answered_at }, ...prev.answered],
        };
      });
    });

    return () => {
      offClaimed();
      offReleased();
      offAnswered();
    };
  }, [on, rabbi, fetchTab]);

  // ── Callbacks ────────────────────────────────────────────────────────────

  const handleReleased = (updatedQuestion) => {
    setQuestionsByTab((prev) => ({
      ...prev,
      in_process: prev.in_process.filter((q) => q.id !== updatedQuestion.id),
    }));
    setCounts((prev) => ({
      ...prev,
      in_process: Math.max(0, prev.in_process - 1),
    }));
  };

  const handleTransferred = (updatedQuestion) => {
    setQuestionsByTab((prev) => ({
      ...prev,
      in_process: prev.in_process.filter((q) => q.id !== updatedQuestion.id),
    }));
    setCounts((prev) => ({
      ...prev,
      in_process: Math.max(0, prev.in_process - 1),
    }));
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const currentTab = TABS.find((t) => t.key === activeTab);
  const questions = questionsByTab[activeTab];
  const isLoading = loading[activeTab];
  const tabError = error[activeTab];
  const isEmpty = !isLoading && questions.length === 0;

  return (
    <div className="page-enter" dir="rtl">
      <PageHeader
        title="השאלות שלי"
        subtitle={`הרב ${rabbi?.display_name || rabbi?.name || ''}`}
      />

      {/* Tabs */}
      <div className="border-b border-[var(--border-default)] bg-[var(--bg-surface)] px-6">
        <nav className="flex gap-0" role="tablist" aria-label="סטטוס שאלות">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.key)}
                className={clsx(
                  'flex items-center gap-2 px-5 py-3.5 text-sm font-medium font-heebo',
                  'border-b-2 transition-all duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-inset',
                  isActive
                    ? 'border-brand-navy text-brand-navy dark:border-dark-accent dark:text-dark-accent'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)]'
                )}
              >
                <Icon size={15} />
                {tab.label}
                {counts[tab.key] > 0 && (
                  <span
                    className={clsx(
                      'inline-flex items-center justify-center min-w-[1.25rem] h-5 rounded-full text-xs font-bold px-1.5',
                      isActive
                        ? 'bg-brand-navy text-white dark:bg-dark-accent dark:text-dark-bg'
                        : 'bg-[var(--bg-muted)] text-[var(--text-muted)]'
                    )}
                  >
                    {counts[tab.key]}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Content */}
      <div className="p-6">
        {isLoading && <BlockSpinner label="טוען שאלות..." />}

        {!isLoading && tabError && (
          <div className="text-center py-12">
            <p className="text-red-600 dark:text-red-400 font-heebo mb-4">{tabError}</p>
            <Button variant="outline" onClick={() => fetchTab(activeTab)}>
              נסה שוב
            </Button>
          </div>
        )}

        {isEmpty && !tabError && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-[var(--bg-muted)] flex items-center justify-center mb-4">
              <Inbox size={28} className="text-[var(--text-muted)]" />
            </div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)] font-heebo mb-2">
              {currentTab?.emptyTitle}
            </h3>
            <p className="text-sm text-[var(--text-muted)] font-heebo mb-4">
              {currentTab?.emptyDesc}
            </p>
            {activeTab === 'in_process' && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => navigate('/questions')}
              >
                עבור לשאלות פתוחות
              </Button>
            )}
          </div>
        )}

        {!isLoading && !tabError && questions.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {questions.map((question) => (
              <MyQuestionCard
                key={question.id}
                question={question}
                tab={activeTab}
                onRelease={setReleaseTarget}
                onTransfer={setTransferTarget}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      <ReleaseConfirmModal
        isOpen={Boolean(releaseTarget)}
        question={releaseTarget}
        onClose={() => setReleaseTarget(null)}
        onReleased={handleReleased}
      />

      <TransferModal
        isOpen={Boolean(transferTarget)}
        question={transferTarget}
        onClose={() => setTransferTarget(null)}
        onTransferred={handleTransferred}
      />
    </div>
  );
}

// ── Inner card with tab-specific CTAs ─────────────────────────────────────

const EDIT_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

function MyQuestionCard({ question, tab, onRelease, onTransfer }) {
  const navigate = useNavigate();
  const { id, title, category_name, answered_at, answer_content, created_at, wp_post_id, pending_follow_up, follow_up_question } = question;
  const wpUrl = wp_post_id ? `https://moreshet-maran.com/ask-rabai/${wp_post_id}` : null;
  const hasFollowUp = (pending_follow_up > 0) || (!!follow_up_question && !question.follow_up_answer);

  const canEditAnswer = tab === 'answered' && !!answered_at &&
    (Date.now() - new Date(answered_at).getTime()) < EDIT_WINDOW_MS;

  const minutesLeft = answered_at
    ? Math.max(0, Math.ceil((EDIT_WINDOW_MS - (Date.now() - new Date(answered_at).getTime())) / 60000))
    : 0;

  if (tab === 'answered') {
    // ── "עניתי" — תצוגת תשובה ─────────────────────────────────────────────
    return (
      <div
        className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-card shadow-soft overflow-hidden cursor-pointer hover:border-brand-gold/60 hover:shadow-lg transition-all"
        onClick={() => navigate(`/questions/${id}`)}
      >
        {hasFollowUp && (
          <div className="flex items-center gap-2 px-5 py-2.5 bg-amber-50 border-b border-amber-200">
            <span className="text-amber-600 text-lg">🔄</span>
            <span className="text-sm font-bold font-heebo text-amber-700">יש שאלת המשך ממתינה!</span>
          </div>
        )}
        {/* Header */}
        <div className="px-5 pt-4 pb-2">
          {category_name && (
            <span className="text-xs font-medium text-brand-navy/70 font-heebo bg-brand-navy/5 px-2 py-0.5 rounded-full mb-2 inline-block">
              {category_name}
            </span>
          )}
          <h3 className="text-sm font-semibold text-[var(--text-primary)] font-heebo leading-snug line-clamp-2">
            {title}
          </h3>
          <p className="text-xs text-[var(--text-muted)] font-heebo mt-1 flex items-center gap-1">
            <Clock size={10} />
            נענה {answered_at ? formatRelative(answered_at) : formatRelative(created_at)}
          </p>
        </div>

        {/* Answer preview */}
        {answer_content && (
          <div className="mx-5 mb-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-md">
            <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 font-heebo mb-1 flex items-center gap-1">
              <CheckCircle2 size={11} />
              תשובתי
            </p>
            <div
              className="text-xs text-[var(--text-secondary)] font-heebo leading-relaxed line-clamp-3"
              dangerouslySetInnerHTML={{ __html: answer_content }}
            />
          </div>
        )}

        {/* Footer */}
        <div
          className="flex items-center gap-2 px-5 py-2.5 border-t border-[var(--border-default)] bg-[var(--bg-muted)]"
          onClick={(e) => e.stopPropagation()}
        >
          {canEditAnswer ? (
            <>
              <Button
                variant="outline"
                size="sm"
                leftIcon={<Pencil size={12} />}
                onClick={() => navigate(`/questions/${id}?answer=1`)}
              >
                ערוך תשובה
              </Button>
              <span className="text-xs text-amber-600 font-heebo flex items-center gap-1">
                <Clock size={10} />
                {minutesLeft} דק' נותרו
              </span>
            </>
          ) : (
            <span className="text-xs text-[var(--text-muted)] font-heebo flex items-center gap-1">
              <Lock size={10} />
              נעול לעריכה
            </span>
          )}
          {wpUrl ? (
            <a
              href={wpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mr-auto inline-flex items-center gap-1 text-xs font-medium font-heebo text-[var(--accent)] hover:underline px-2 py-1"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink size={12} />
              צפה באתר
            </a>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Eye size={12} />}
              className="mr-auto"
              onClick={() => navigate(`/questions/${id}`)}
            >
              צפה
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ── "בטיפולי" — כרטיס שאלה רגיל ────────────────────────────────────────
  return (
    <div className="flex flex-col">
      {hasFollowUp && (
        <div
          className="flex items-center gap-2 px-5 py-2.5 bg-amber-50 border border-amber-200 border-b-0 rounded-t-card cursor-pointer hover:bg-amber-100 transition-colors"
          onClick={() => navigate(`/questions/${id}`)}
        >
          <span className="text-amber-600 text-lg">🔄</span>
          <span className="text-sm font-bold font-heebo text-amber-700">שאלת המשך ממתינה לתשובתך!</span>
          <span className="mr-auto text-xs font-heebo text-amber-600 underline">לחץ לענות</span>
        </div>
      )}
      <QuestionCard
        question={question}
        showActions={false}
        className={clsx('flex-1 border-b-0', hasFollowUp ? 'rounded-t-none rounded-b-none' : 'rounded-b-none')}
      />
      <div className="flex items-center gap-2 flex-wrap px-5 py-3 bg-[var(--bg-surface)] border border-[var(--border-default)] border-t-0 rounded-b-card shadow-soft">
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Pencil size={13} />}
          onClick={(e) => { e.stopPropagation(); navigate(`/questions/${id}?answer=1`); }}
        >
          ענה
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => { e.stopPropagation(); onTransfer?.(question); }}
          className="text-[var(--text-muted)]"
        >
          העבר
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => { e.stopPropagation(); onRelease?.(question); }}
          className="text-red-600 hover:bg-red-50 hover:text-red-700"
        >
          שחרר
        </Button>
      </div>
    </div>
  );
}
