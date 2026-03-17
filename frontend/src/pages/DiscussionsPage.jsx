import React, { useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import useApi from '../hooks/useApi';
import { Spinner } from '../components/ui/Spinner';
import DiscussionList from '../components/discussions/DiscussionList';
import DiscussionChat from '../components/discussions/DiscussionChat';
import CreateDiscussionModal from '../components/discussions/CreateDiscussionModal';

/**
 * /discussions — Two-panel layout: discussion list (right) + active chat (left).
 * On mobile only one panel is shown at a time.
 */
export default function DiscussionsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // The active discussion id comes from ?d=<id> query param so deep-links work
  const activeId = searchParams.get('d') || null;

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [questionId, setQuestionId] = useState(null);

  const {
    data: discussions,
    loading,
    error,
    execute: refetch,
    setData: setDiscussions,
  } = useApi('/discussions', {
    immediate: false,
    transform: (d) => (Array.isArray(d) ? d : d?.discussions ?? []),
  });

  // Fetch on mount
  React.useEffect(() => {
    refetch();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectDiscussion = useCallback(
    (id) => {
      setSearchParams({ d: id });
    },
    [setSearchParams]
  );

  const handleBackToList = useCallback(() => {
    setSearchParams({});
  }, [setSearchParams]);

  const handleCreateSuccess = useCallback(
    (newDiscussion) => {
      setDiscussions((prev) => [newDiscussion, ...(prev || [])]);
      setShowCreateModal(false);
      setSearchParams({ d: newDiscussion.id });
    },
    [setDiscussions, setSearchParams]
  );

  // Update unread count when a message is received
  const handleUnreadUpdate = useCallback(
    (discussionId, delta) => {
      setDiscussions((prev) =>
        (prev || []).map((d) =>
          d.id === discussionId
            ? { ...d, unread_count: Math.max(0, (d.unread_count || 0) + delta) }
            : d
        )
      );
    },
    [setDiscussions]
  );

  // Mark discussion read in the list
  const handleMarkRead = useCallback(
    (discussionId) => {
      setDiscussions((prev) =>
        (prev || []).map((d) =>
          d.id === discussionId ? { ...d, unread_count: 0 } : d
        )
      );
    },
    [setDiscussions]
  );

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  // On mobile: show list OR chat, never both
  const showList = !isMobile || !activeId;
  const showChat = !isMobile || !!activeId;

  return (
    <div
      className="flex h-[calc(100vh-4rem)] overflow-hidden font-heebo"
      dir="rtl"
    >
      {/* ── Discussion list panel ─────────────────────────── */}
      {showList && (
        <div
          className="
            w-full md:w-80 lg:w-96 flex-shrink-0
            border-l border-[var(--border-default)]
            flex flex-col
            bg-[var(--bg-surface)]
          "
        >
          {/* List header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)] flex-shrink-0">
            <h1 className="text-lg font-bold text-[var(--text-primary)]">דיונים</h1>
            <button
              onClick={() => setShowCreateModal(true)}
              className="
                flex items-center gap-1.5 px-3 py-1.5 rounded-md
                bg-[#1B2B5E] text-white text-sm font-medium
                hover:bg-[#152348] transition-colors duration-150
                focus-visible:ring-2 focus-visible:ring-[#B8973A]
              "
              aria-label="פתח דיון חדש"
            >
              <Plus size={15} strokeWidth={2.5} />
              <span>דיון חדש</span>
            </button>
          </div>

          {/* List body */}
          {loading && (
            <div className="flex-1 flex items-center justify-center">
              <Spinner size="md" />
            </div>
          )}
          {error && (
            <div className="flex-1 flex items-center justify-center px-6 text-center">
              <p className="text-sm text-red-600">
                שגיאה בטעינת הדיונים.{' '}
                <button
                  className="underline"
                  onClick={() => refetch()}
                >
                  נסה שוב
                </button>
              </p>
            </div>
          )}
          {!loading && !error && (
            <DiscussionList
              discussions={discussions || []}
              activeId={activeId}
              onSelect={handleSelectDiscussion}
            />
          )}
        </div>
      )}

      {/* ── Chat panel ───────────────────────────────────── */}
      {showChat && (
        <div className="flex-1 flex flex-col min-w-0 bg-[#F8F6F1]">
          {activeId ? (
            <DiscussionChat
              key={activeId}
              discussionId={activeId}
              onBack={handleBackToList}
              onUnreadUpdate={handleUnreadUpdate}
              onMarkRead={handleMarkRead}
            />
          ) : (
            /* Empty state when no discussion selected */
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
              <svg
                width="64"
                height="64"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="opacity-40"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <p className="text-base font-medium">בחר דיון מהרשימה</p>
              <p className="text-sm">או פתח דיון חדש</p>
            </div>
          )}
        </div>
      )}

      {/* ── Create discussion modal ───────────────────────── */}
      <CreateDiscussionModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        questionId={questionId}
        onSuccess={handleCreateSuccess}
      />
    </div>
  );
}
