import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { clsx } from 'clsx';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  BellOff,
  CheckCheck,
  ClipboardList,
  CheckCircle,
  Volume2,
  Heart,
  Clock,
  MessageCircle,
  Lock,
  Loader2,
  Filter,
  RefreshCw,
} from 'lucide-react';
import api from '../lib/api';
import Button from '../components/ui/Button';

// ── Notification type configuration ──────────────────────────────────────────

const TYPE_CONFIG = {
  new_question: {
    label: 'שאלה חדשה',
    emoji: '📋',
    colorClass: 'text-blue-600 dark:text-blue-400',
    bgClass: 'bg-blue-50 dark:bg-blue-900/20',
  },
  claim_approved: {
    label: 'תפיסה אושרה',
    emoji: '✅',
    colorClass: 'text-emerald-600 dark:text-emerald-400',
    bgClass: 'bg-emerald-50 dark:bg-emerald-900/20',
  },
  answer_published: {
    label: 'תשובה פורסמה',
    emoji: '📢',
    colorClass: 'text-brand-gold dark:text-brand-gold',
    bgClass: 'bg-amber-50 dark:bg-amber-900/20',
  },
  user_thanks: {
    label: 'תודה',
    emoji: '💛',
    colorClass: 'text-yellow-500 dark:text-yellow-400',
    bgClass: 'bg-yellow-50 dark:bg-yellow-900/20',
  },
  lock_reminder: {
    label: 'תזכורת נעילה',
    emoji: '⏰',
    colorClass: 'text-amber-600 dark:text-amber-400',
    bgClass: 'bg-amber-50 dark:bg-amber-900/20',
  },
  followup_question: {
    label: 'שאלת המשך',
    emoji: '💬',
    colorClass: 'text-purple-600 dark:text-purple-400',
    bgClass: 'bg-purple-50 dark:bg-purple-900/20',
  },
  new_device_login: {
    label: 'כניסה חשודה',
    emoji: '🔒',
    colorClass: 'text-red-600 dark:text-red-400',
    bgClass: 'bg-red-50 dark:bg-red-900/20',
  },
};

const FILTER_OPTIONS = [
  { key: 'all',   label: 'הכל' },
  { key: 'unread', label: 'לא נקראו' },
  { key: 'new_question',     label: 'שאלות חדשות' },
  { key: 'claim_approved',   label: 'אישורי תפיסה' },
  { key: 'answer_published', label: 'תשובות' },
  { key: 'user_thanks',      label: 'תודות' },
  { key: 'lock_reminder',    label: 'תזכורות' },
  { key: 'followup_question', label: 'שאלות המשך' },
  { key: 'new_device_login', label: 'כניסות' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelative(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'הרגע';
  if (mins < 60) return `לפני ${mins} דק'`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `לפני ${hours} שע'`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'אתמול';
  if (days < 7) return `לפני ${days} ימים`;
  return new Date(dateStr).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ── Single notification row ───────────────────────────────────────────────────

function NotificationRow({ notification, onMarkRead }) {
  const navigate = useNavigate();
  const type = notification.type || 'new_question';
  const config = TYPE_CONFIG[type] || TYPE_CONFIG.new_question;
  const isUnread = !notification.read && !notification.readAt;

  const handleClick = () => {
    if (isUnread) onMarkRead(notification._id || notification.id);
    if (notification.actionUrl) {
      // Use SPA navigation for internal URLs, window.location for external
      const url = notification.actionUrl;
      if (url.startsWith('/') || url.startsWith(window.location.origin)) {
        navigate(url.replace(window.location.origin, ''));
      } else {
        window.open(url, '_blank', 'noopener');
      }
    }
  };

  return (
    <div
      onClick={handleClick}
      role={notification.actionUrl ? 'button' : undefined}
      tabIndex={notification.actionUrl ? 0 : undefined}
      onKeyDown={notification.actionUrl ? (e) => { if (e.key === 'Enter') handleClick(); } : undefined}
      className={clsx(
        'flex items-start gap-3 p-4 transition-colors duration-150',
        'border-b border-[var(--border-default)] last:border-0',
        notification.actionUrl && 'cursor-pointer hover:bg-[var(--bg-muted)]',
        isUnread && 'bg-[var(--bg-surface)]'
      )}
    >
      {/* Icon */}
      <div className={clsx(
        'flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0 text-lg',
        config.bgClass
      )} aria-hidden="true">
        {config.emoji}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={clsx(
            'text-sm font-heebo leading-snug',
            isUnread ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
          )}>
            {notification.message || notification.text || notification.title || config.label}
          </p>
          {/* Unread dot */}
          {isUnread && (
            <span
              className="flex-shrink-0 w-2 h-2 rounded-full bg-brand-navy dark:bg-brand-gold mt-1"
              aria-label="לא נקרא"
            />
          )}
        </div>

        <div className="flex items-center gap-2 mt-1">
          <span className={clsx('text-xs font-heebo', config.colorClass)}>
            {config.label}
          </span>
          <span className="text-xs text-[var(--text-muted)] font-heebo">
            · {formatRelative(notification.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyNotifications({ filter }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-6">
      <div className="w-16 h-16 rounded-full bg-[var(--bg-muted)] flex items-center justify-center mb-4">
        <BellOff className="w-8 h-8 text-[var(--text-muted)]" aria-hidden="true" />
      </div>
      <p className="text-base font-semibold font-heebo text-[var(--text-primary)] mb-1">
        {filter === 'unread' ? 'אין התראות שלא נקראו' : 'אין התראות חדשות'}
      </p>
      <p className="text-sm text-[var(--text-muted)] font-heebo">
        כאשר יהיו התראות חדשות הן יופיעו כאן
      </p>
    </div>
  );
}

// ── Main NotificationsPage ────────────────────────────────────────────────────

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [markingAll, setMarkingAll] = useState(false);
  const [error, setError] = useState(null);
  const PAGE_SIZE = 20;

  const sentinelRef = useRef(null);
  const observerRef = useRef(null);

  // ── Fetch ────────────────────────────────────────────────────────────────

  const fetchNotifications = useCallback(async (pageNum = 1, append = false) => {
    if (pageNum === 1) setLoading(true); else setLoadingMore(true);
    setError(null);
    try {
      const params = { page: pageNum, limit: PAGE_SIZE };
      if (filter === 'unread') params.unread = true;
      else if (filter !== 'all') params.type = filter;

      const { data } = await api.get('/notifications', { params });
      const items = data?.notifications || data?.items || data || [];
      const total = data?.total ?? items.length;

      if (append) {
        setNotifications((prev) => [...prev, ...items]);
      } else {
        setNotifications(items);
      }
      setHasMore(pageNum * PAGE_SIZE < total);
    } catch {
      setError('לא ניתן לטעון התראות. נסה שוב.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [filter]);

  useEffect(() => {
    setPage(1);
    setNotifications([]);
    fetchNotifications(1, false);
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Infinite scroll observer ──────────────────────────────────────────────

  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();
    if (!sentinelRef.current || !hasMore) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore) {
          const nextPage = page + 1;
          setPage(nextPage);
          fetchNotifications(nextPage, true);
        }
      },
      { rootMargin: '200px' }
    );
    observerRef.current.observe(sentinelRef.current);
    return () => observerRef.current?.disconnect();
  }, [hasMore, loadingMore, page, fetchNotifications]);

  // ── Mark single as read ───────────────────────────────────────────────────

  const handleMarkRead = useCallback(async (id) => {
    setNotifications((prev) =>
      prev.map((n) => (n._id || n.id) === id ? { ...n, read: true } : n)
    );
    try {
      await api.patch(`/notifications/${id}/read`);
    } catch {
      // Revert on error
      setNotifications((prev) =>
        prev.map((n) => (n._id || n.id) === id ? { ...n, read: false } : n)
      );
    }
  }, []);

  // ── Mark all as read ──────────────────────────────────────────────────────

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    try {
      await api.post('/notifications/mark-all-read');
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      setError('לא ניתן לסמן את כל ההתראות כנקראות.');
    } finally {
      setMarkingAll(false);
    }
  };

  const unreadCount = notifications.filter((n) => !n.read && !n.readAt).length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="page-enter p-6 space-y-5 max-w-3xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Bell className="w-6 h-6 text-[var(--text-primary)]" aria-hidden="true" />
          <h1 className="text-2xl font-bold font-heebo text-[var(--text-primary)]">התראות</h1>
          {unreadCount > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-navy dark:bg-brand-gold text-white dark:text-brand-navy text-xs font-bold font-heebo">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => fetchNotifications(1)}
            leftIcon={<RefreshCw className="w-4 h-4" />} aria-label="רענן">
            רענן
          </Button>
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={handleMarkAllRead} loading={markingAll}
              leftIcon={<CheckCheck className="w-4 h-4" />}>
              סמן הכל כנקרא
            </Button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div role="alert" className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400 font-heebo">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="סנן התראות">
        {FILTER_OPTIONS.map(({ key, label }) => (
          <button key={key} onClick={() => setFilter(key)} aria-pressed={filter === key}
            className={clsx(
              'flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium font-heebo transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
              filter === key
                ? 'bg-brand-navy dark:bg-brand-gold text-white dark:text-brand-navy'
                : 'bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]'
            )}>
            {label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden shadow-soft dark:shadow-dark-soft">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-brand-navy dark:text-brand-gold" aria-label="טוען התראות" />
          </div>
        ) : notifications.length === 0 ? (
          <EmptyNotifications filter={filter} />
        ) : (
          <div role="list" aria-label="רשימת התראות">
            {notifications.map((n) => (
              <div key={n._id || n.id} role="listitem">
                <NotificationRow
                  notification={n}
                  onMarkRead={handleMarkRead}
                />
              </div>
            ))}
          </div>
        )}

        {/* Infinite scroll sentinel */}
        {!loading && hasMore && (
          <div ref={sentinelRef} className="flex items-center justify-center py-4">
            {loadingMore && (
              <Loader2 className="w-5 h-5 animate-spin text-[var(--text-muted)]" aria-label="טוען עוד" />
            )}
          </div>
        )}

        {/* End of list */}
        {!loading && !hasMore && notifications.length > 0 && (
          <p className="text-center text-xs text-[var(--text-muted)] font-heebo py-4">
            הגעת לסוף הרשימה
          </p>
        )}
      </div>
    </div>
  );
}
