import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import { clsx } from 'clsx';
import { ArrowDown, ChevronRight, Pin } from 'lucide-react';
import api from '../../lib/api';
import { useSocket } from '../../contexts/SocketContext';
import { useAuth } from '../../contexts/AuthContext';
import { Spinner } from '../ui/Spinner';
import { stripHtml, truncate } from '../../lib/utils';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import DiscussionHeader from './DiscussionHeader';

const PAGE_SIZE = 40;

/**
 * Full chat panel for a single discussion.
 *
 * Props:
 *   discussionId   — string
 *   onBack()       — mobile back button
 *   onUnreadUpdate(id, delta) — bubble up unread change
 *   onMarkRead(id) — bubble up read event
 */
export default function DiscussionChat({
  discussionId,
  onBack,
  onUnreadUpdate,
  onMarkRead,
}) {
  const { rabbi } = useAuth();
  const { emit, on } = useSocket();

  const [discussion, setDiscussion] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);

  // Pinned message
  const [pinnedMessage, setPinnedMessage] = useState(null);

  // Typing indicator list of names
  const [typingNames, setTypingNames] = useState([]);

  // Floating "new messages" button
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  // Reply/quote state (lifted up so header & input share it)
  const [replyTo, setReplyTo] = useState(null);

  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const isScrolledUpRef = useRef(false);
  const typingTimersRef = useRef({});

  // ── Initial load ───────────────────────────────────────────────────────────

  const loadMessages = useCallback(async (pageNum = 1, prepend = false) => {
    try {
      const { data } = await api.get(`/discussions/${discussionId}/messages`, {
        params: { page: pageNum, limit: PAGE_SIZE },
      });

      const msgs = data.messages || data.data || data || [];
      const pagination = data.pagination || {};

      setHasOlder(pagination.page < pagination.totalPages || msgs.length === PAGE_SIZE);

      setMessages((prev) =>
        prepend ? [...msgs.reverse(), ...prev] : msgs.reverse()
      );

      // Find pinned message
      const pinned = msgs.find((m) => m.is_pinned);
      if (pinned) setPinnedMessage(pinned);
    } catch (err) {
      setError(err.response?.data?.message || 'שגיאה בטעינת ההודעות');
    }
  }, [discussionId]);

  const loadDiscussion = useCallback(async () => {
    try {
      const { data } = await api.get(`/discussions/${discussionId}`);
      setDiscussion(data.discussion || data);
    } catch {
      // non-fatal — header will show partial info
    }
  }, [discussionId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMessages([]);
    setPage(1);
    setNewMessageCount(0);
    setUserScrolledUp(false);
    setTypingNames([]);

    Promise.all([loadMessages(1, false), loadDiscussion()]).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [loadDiscussion, loadMessages]);

  // ── Socket room ────────────────────────────────────────────────────────────

  useEffect(() => {
    emit('discussion:join', { discussionId });

    const unsubMessage = on('discussion:message', (msg) => {
      if (msg.discussion_id !== discussionId) return;

      setMessages((prev) => {
        // Avoid duplicates
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });

      if (isScrolledUpRef.current) {
        setNewMessageCount((c) => c + 1);
        onUnreadUpdate?.(discussionId, 1);
      } else {
        // Auto-scroll and mark read
        markRead();
      }
    });

    const unsubTyping = on('discussion:typing', ({ rabbiId, rabbiName, isTyping }) => {
      if (rabbiId === rabbi?.id) return;

      // Clear existing timer for this rabbi
      if (typingTimersRef.current[rabbiId]) {
        clearTimeout(typingTimersRef.current[rabbiId]);
      }

      if (isTyping) {
        setTypingNames((prev) =>
          prev.includes(rabbiName) ? prev : [...prev, rabbiName]
        );
        // Auto-remove after 4s if no further event
        typingTimersRef.current[rabbiId] = setTimeout(() => {
          setTypingNames((prev) => prev.filter((n) => n !== rabbiName));
        }, 4000);
      } else {
        setTypingNames((prev) => prev.filter((n) => n !== rabbiName));
      }
    });

    const unsubPinned = on('discussion:messagePinned', ({ messageId, isPinned }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, is_pinned: isPinned } : { ...m, is_pinned: false }
        )
      );
      setMessages((prev) => {
        const pinned = prev.find((m) => m.id === messageId && isPinned);
        setPinnedMessage(pinned || null);
        return prev;
      });
    });

    const unsubReaction = on('discussion:reaction', ({ messageId, reactions }) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, reactions } : m))
      );
    });

    return () => {
      emit('discussion:leave', { discussionId });
      unsubMessage();
      unsubTyping();
      unsubPinned();
      unsubReaction();
      // Clear all typing timers
      Object.values(typingTimersRef.current).forEach(clearTimeout);
    };
  }, [discussionId, emit, on, rabbi?.id, onUnreadUpdate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll helpers ─────────────────────────────────────────────────────────

  const scrollToBottom = useCallback((behavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
  }, []);

  // Auto-scroll on new messages only if user is at bottom
  useEffect(() => {
    if (!isScrolledUpRef.current) {
      scrollToBottom('smooth');
    }
  }, [messages.length, scrollToBottom]);

  // Initial scroll to bottom (instant)
  useEffect(() => {
    if (!loading) {
      scrollToBottom('instant');
    }
  }, [loading, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const scrolledUp = distanceFromBottom > 120;

    isScrolledUpRef.current = scrolledUp;
    setUserScrolledUp(scrolledUp);

    // Load older messages when near top
    if (el.scrollTop < 80 && hasOlder && !loadingOlder) {
      const prevScrollHeight = el.scrollHeight;
      setLoadingOlder(true);
      const nextPage = page + 1;
      setPage(nextPage);

      loadMessages(nextPage, true).finally(() => {
        setLoadingOlder(false);
        // Restore scroll position after prepend
        requestAnimationFrame(() => {
          if (el) {
            el.scrollTop = el.scrollHeight - prevScrollHeight;
          }
        });
      });
    }
  }, [hasOlder, loadingOlder, page, loadMessages]);

  // ── Mark read ──────────────────────────────────────────────────────────────

  const markRead = useCallback(async () => {
    try {
      await api.put(`/discussions/${discussionId}/messages/read`);
      onMarkRead?.(discussionId);
      setNewMessageCount(0);
    } catch {
      // non-fatal
    }
  }, [discussionId, onMarkRead]);

  // Mark read on focus
  useEffect(() => {
    const handleFocus = () => {
      if (!isScrolledUpRef.current) markRead();
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
  }, [markRead]);

  // ── Message send callback ──────────────────────────────────────────────────

  const handleSend = useCallback(
    (newMsg) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === newMsg.id)) return prev;
        return [...prev, newMsg];
      });
      setReplyTo(null);
      setTimeout(() => scrollToBottom('smooth'), 50);
    },
    [scrollToBottom]
  );

  // ── Pin toggle ─────────────────────────────────────────────────────────────

  const handlePinToggle = useCallback(
    async (message) => {
      const newPinned = !message.is_pinned;
      try {
        await api.put(`/discussions/${discussionId}/messages/${message.id}/pin`, {
          isPinned: newPinned,
        });
        // Optimistic update; socket event will also arrive
        setMessages((prev) =>
          prev.map((m) =>
            m.id === message.id
              ? { ...m, is_pinned: newPinned }
              : newPinned
              ? { ...m, is_pinned: false }
              : m
          )
        );
        setPinnedMessage(newPinned ? message : null);
      } catch {
        // revert on error — socket will correct state
      }
    },
    [discussionId]
  );

  // ── Reaction toggle ────────────────────────────────────────────────────────

  const handleReact = useCallback(
    async (messageId, emoji) => {
      try {
        await api.post(`/discussions/${discussionId}/messages/${messageId}/reactions`, {
          emoji,
        });
        // Optimistic handled by socket event `discussion:reaction`
      } catch {
        // ignore
      }
    },
    [discussionId]
  );

  // ── Edit / Delete ──────────────────────────────────────────────────────────

  const handleEditMessage = useCallback(
    async (messageId, newContent) => {
      try {
        const { data } = await api.put(
          `/discussions/${discussionId}/messages/${messageId}`,
          { content: newContent }
        );
        const updated = data.message || data;
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, ...updated } : m))
        );
      } catch {
        // ignore
      }
    },
    [discussionId]
  );

  const handleDeleteMessage = useCallback(
    async (messageId) => {
      try {
        await api.delete(`/discussions/${discussionId}/messages/${messageId}`);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, is_deleted: true, content: '' } : m
          )
        );
      } catch {
        // ignore
      }
    },
    [discussionId]
  );

  // ── Typing label ───────────────────────────────────────────────────────────

  const typingLabel = useMemo(() => {
    if (typingNames.length === 0) return null;
    if (typingNames.length === 1) return `${typingNames[0]} כותב...`;
    if (typingNames.length === 2)
      return `${typingNames[0]} ו-${typingNames[1]} כותבים...`;
    return 'מספר משתתפים כותבים...';
  }, [typingNames]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center" dir="rtl">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center" dir="rtl">
        <p className="text-sm text-red-600 font-heebo">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" dir="rtl">
      {/* Header */}
      <DiscussionHeader
        discussion={discussion}
        onBack={onBack}
        discussionId={discussionId}
        onDiscussionUpdate={setDiscussion}
      />

      {/* Pinned message bar */}
      {pinnedMessage && (
        <div
          className="
            flex items-center gap-2 px-4 py-2
            bg-[#1B2B5E]/8 border-b border-[#1B2B5E]/20
            text-sm font-heebo flex-shrink-0
          "
        >
          <Pin size={14} className="text-[#B8973A] flex-shrink-0" />
          <span className="text-[#1B2B5E] font-medium flex-shrink-0">
            הודעה מוצמדת:
          </span>
          <span className="text-[var(--text-secondary)] truncate">
            {truncate(stripHtml(pinnedMessage.content || ''), 80)}
          </span>
        </div>
      )}

      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-1 relative"
        style={{ overscrollBehavior: 'contain' }}
      >
        {/* Load older indicator */}
        {loadingOlder && (
          <div className="flex justify-center py-2">
            <Spinner size="sm" />
          </div>
        )}
        {!hasOlder && messages.length > 0 && (
          <p className="text-center text-xs text-[var(--text-muted)] py-2 font-heebo">
            תחילת הדיון
          </p>
        )}

        {/* Messages */}
        {messages.map((msg, idx) => {
          const isOwn = msg.rabbi_id === rabbi?.id;
          const prevMsg = messages[idx - 1];
          const showRabbiName = !isOwn && msg.rabbi_id !== prevMsg?.rabbi_id;

          return (
            <MessageBubble
              key={msg.id}
              message={msg}
              isOwn={isOwn}
              showRabbiName={showRabbiName}
              onReply={() => setReplyTo(msg)}
              onPin={() => handlePinToggle(msg)}
              onReact={(emoji) => handleReact(msg.id, emoji)}
              onEdit={(newContent) => handleEditMessage(msg.id, newContent)}
              onDelete={() => handleDeleteMessage(msg.id)}
              currentRabbiId={rabbi?.id}
              discussionOwnerId={discussion?.created_by}
            />
          );
        })}

        {/* Typing indicator */}
        {typingLabel && (
          <div
            className="
              flex items-center gap-2 px-3 py-2 w-fit
              bg-white rounded-2xl shadow-sm
              text-sm text-[var(--text-muted)] font-heebo
              animate-fade-in
            "
          >
            <TypingDots />
            <span>{typingLabel}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Floating "new messages" button */}
      {userScrolledUp && newMessageCount > 0 && (
        <button
          onClick={() => {
            setNewMessageCount(0);
            setUserScrolledUp(false);
            scrollToBottom('smooth');
            markRead();
          }}
          className="
            absolute bottom-24 left-1/2 -translate-x-1/2
            flex items-center gap-2 px-4 py-2
            bg-[#1B2B5E] text-white text-sm font-heebo font-medium
            rounded-full shadow-lg
            hover:bg-[#152348] transition-colors duration-150
            animate-bounce-in
            z-10
          "
          style={{ position: 'absolute', bottom: '5rem', left: '50%', transform: 'translateX(-50%)' }}
        >
          <ArrowDown size={14} />
          <span>{newMessageCount} הודעות חדשות</span>
        </button>
      )}

      {/* Input area */}
      <MessageInput
        discussionId={discussionId}
        onSend={handleSend}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
      />
    </div>
  );
}

// Animated typing dots
function TypingDots() {
  return (
    <div className="flex items-center gap-0.5" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 bg-[var(--text-muted)] rounded-full animate-bounce"
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: '0.9s' }}
        />
      ))}
    </div>
  );
}
