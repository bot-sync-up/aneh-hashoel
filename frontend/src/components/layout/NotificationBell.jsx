import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { Bell } from 'lucide-react';
import { useSocket } from '../../contexts/SocketContext';
import api from '../../lib/api';

// ── Notification type config (brief subset for preview) ──────────────────────

const TYPE_EMOJI = {
  new_question:      '📋',
  claim_approved:    '✅',
  answer_published:  '📢',
  user_thanks:       '💛',
  lock_reminder:     '⏰',
  followup_question: '💬',
  new_device_login:  '🔒',
};

function formatRelative(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'הרגע';
  if (mins < 60) return `${mins} דק'`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} שע'`;
  return `${Math.floor(hours / 24)} ימים`;
}

// ── Dropdown preview item ─────────────────────────────────────────────────────

function PreviewItem({ notification, onClose }) {
  const emoji = TYPE_EMOJI[notification.type] || '🔔';
  const isUnread = !notification.read && !notification.readAt;
  const text = notification.message || notification.text || notification.title || '';

  return (
    <Link
      to={notification.actionUrl || '/notifications'}
      onClick={onClose}
      className={clsx(
        'flex items-start gap-2.5 px-4 py-3 transition-colors duration-100',
        'hover:bg-[var(--bg-muted)]',
        isUnread && 'bg-brand-navy/[0.04] dark:bg-brand-gold/[0.06]'
      )}
    >
      <span className="text-lg flex-shrink-0 mt-0.5" aria-hidden="true">{emoji}</span>
      <div className="flex-1 min-w-0">
        <p className={clsx(
          'text-sm font-heebo leading-snug line-clamp-2',
          isUnread ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
        )}>
          {text}
        </p>
        <span className="text-xs text-[var(--text-muted)] font-heebo">
          {formatRelative(notification.createdAt)}
        </span>
      </div>
      {isUnread && (
        <span className="flex-shrink-0 w-2 h-2 rounded-full bg-brand-navy dark:bg-brand-gold mt-1.5" aria-hidden="true" />
      )}
    </Link>
  );
}

// ── Main NotificationBell ─────────────────────────────────────────────────────

export default function NotificationBell({ className }) {
  const { on } = useSocket();
  const [count, setCount] = useState(0);
  const [preview, setPreview] = useState([]);
  const [open, setOpen] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [shake, setShake] = useState(false);
  const wrapperRef = useRef(null);
  const shakeTimerRef = useRef(null);

  // ── Fetch unread count on mount ───────────────────────────────────────────

  const fetchCount = useCallback(async () => {
    try {
      const { data } = await api.get('/notifications/unread-count');
      setCount(data?.unread ?? data?.count ?? 0);
    } catch {
      // Non-fatal
    }
  }, []);

  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  // ── Socket: real-time badge update ────────────────────────────────────────

  useEffect(() => {
    const unsub = on('notification:badgeUpdate', (payload) => {
      const newCount = payload?.count ?? payload?.unread ?? 0;
      setCount(newCount);
      // Shake animation
      setShake(true);
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
      shakeTimerRef.current = setTimeout(() => setShake(false), 600);
    });
    return unsub;
  }, [on]);

  // ── Also receive new notifications directly ───────────────────────────────

  useEffect(() => {
    const unsub = on('notification:new', (notif) => {
      setCount((prev) => prev + 1);
      setPreview((prev) => [notif, ...prev].slice(0, 5));
      setShake(true);
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
      shakeTimerRef.current = setTimeout(() => setShake(false), 600);
    });
    return unsub;
  }, [on]);

  // ── Cleanup ───────────────────────────────────────────────────────────────

  useEffect(() => () => { if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current); }, []);

  // ── Fetch preview when opening ────────────────────────────────────────────

  const handleToggle = async () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen) {
      setLoadingPreview(true);
      try {
        const { data } = await api.get('/notifications', { params: { limit: 5 } });
        setPreview(data?.notifications || data?.items || data || []);
      } catch {
        // keep empty
      } finally {
        setLoadingPreview(false);
      }
    }
  };

  // ── Close on outside click ────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  // ── Close on Escape ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div ref={wrapperRef} className={clsx('relative', className)} dir="rtl">
      {/* Bell button */}
      <button
        type="button"
        onClick={handleToggle}
        aria-label={`התראות${count > 0 ? ` — ${count} לא נקראו` : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        className={clsx(
          'relative flex items-center justify-center w-9 h-9 rounded-lg',
          'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
          'hover:bg-[var(--bg-muted)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
          'transition-colors duration-150',
          open && 'bg-[var(--bg-muted)] text-[var(--text-primary)]'
        )}
      >
        <Bell
          className={clsx('w-5 h-5', shake && 'animate-[shake_0.5s_ease-in-out]')}
          aria-hidden="true"
        />
        {count > 0 && (
          <span
            aria-hidden="true"
            className={clsx(
              'absolute -top-0.5 -right-0.5',
              'flex items-center justify-center',
              'min-w-[18px] h-[18px] px-1 rounded-full',
              'bg-red-500 text-white text-[10px] font-bold font-heebo leading-none',
              shake && 'animate-bounce'
            )}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="dialog"
          aria-label="תצוגה מקדימה של התראות"
          className={clsx(
            'absolute top-full mt-2 z-50',
            'start-0', // RTL: appears to the left of the bell (visually right)
            'w-80 max-w-[calc(100vw-2rem)]',
            'rounded-xl border border-[var(--border-default)]',
            'bg-[var(--bg-surface)] shadow-lg dark:shadow-dark-soft',
            'overflow-hidden',
            'animate-fade-in'
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)]">
            <span className="text-sm font-bold font-heebo text-[var(--text-primary)]">
              התראות
            </span>
            {count > 0 && (
              <span className="text-xs font-heebo text-[var(--text-muted)]">
                {count} לא נקראו
              </span>
            )}
          </div>

          {/* Preview list */}
          {loadingPreview ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-[var(--border-default)] border-t-brand-navy dark:border-t-brand-gold rounded-full animate-spin" aria-label="טוען" />
            </div>
          ) : preview.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center px-4">
              <Bell className="w-8 h-8 text-[var(--text-muted)] mb-2" aria-hidden="true" />
              <p className="text-sm text-[var(--text-muted)] font-heebo">אין התראות חדשות</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-default)]">
              {preview.map((n) => (
                <PreviewItem key={n._id || n.id} notification={n} onClose={() => setOpen(false)} />
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-[var(--border-default)] px-4 py-2.5">
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className={clsx(
                'block w-full text-center text-sm font-medium font-heebo',
                'text-brand-navy dark:text-brand-gold',
                'hover:underline py-0.5'
              )}
            >
              ראה הכל
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
