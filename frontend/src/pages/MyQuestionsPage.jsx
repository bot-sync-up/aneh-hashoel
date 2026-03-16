import React, { useState, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import { Inbox, ClipboardEdit, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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
];

export default function MyQuestionsPage() {
  const navigate = useNavigate();
  const { rabbi } = useAuth();
  const { on } = useSocket();

  const [activeTab, setActiveTab] = useState('in_process');
  const [questionsByTab, setQuestionsByTab] = useState({
    in_process: [],
    answered: [],
  });
  const [loading, setLoading] = useState({ in_process: true, answered: true });
  const [error, setError] = useState({ in_process: null, answered: null });
  const [counts, setCounts] = useState({ in_process: 0, answered: 0 });

  // Modals
  const [releaseTarget, setReleaseTarget] = useState(null);
  const [transferTarget, setTransferTarget] = useState(null);

  // ── Fetch ────────────────────────────────────────────────────────────────

  const fetchTab = useCallback(async (tab) => {
    setLoading((prev) => ({ ...prev, [tab]: true }));
    setError((prev) => ({ ...prev, [tab]: null }));
    try {
      const data = await get('/questions/my', { status: tab, limit: 100 });
      const items = data.questions || data.data || data || [];
      const total = data.total ?? items.length;
      setQuestionsByTab((prev) => ({ ...prev, [tab]: items }));
      setCounts((prev) => ({ ...prev, [tab]: total }));
    } catch (err) {
      setError((prev) => ({
        ...prev,
        [tab]: err.message || 'שגיאה בטעינת השאלות.',
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [tab]: false }));
    }
  }, []);

  useEffect(() => {
    fetchTab('in_process');
    fetchTab('answered');
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

function MyQuestionCard({ question, tab, onRelease, onTransfer }) {
  const navigate = useNavigate();
  const { id } = question;

  const handleContinue = (e) => {
    e.stopPropagation();
    navigate(`/questions/${id}`);
  };
  const handleEdit = (e) => {
    e.stopPropagation();
    navigate(`/questions/${id}`);
  };

  return (
    <div className="flex flex-col">
      {/* Render card with its own built-in actions suppressed */}
      <QuestionCard
        question={question}
        showActions={false}
        className="flex-1 rounded-b-none border-b-0"
      />
      {/* CTA footer strip */}
      <div className="flex items-center gap-2 flex-wrap px-5 py-3 bg-[var(--bg-surface)] border border-[var(--border-default)] border-t-0 rounded-b-card shadow-soft">
        {tab === 'in_process' && (
          <>
            <Button variant="primary" size="sm" onClick={handleContinue}>
              המשך לענות
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
          </>
        )}
        {tab === 'answered' && (
          <Button variant="outline" size="sm" onClick={handleEdit}>
            ערוך תשובה
          </Button>
        )}
      </div>
    </div>
  );
}
