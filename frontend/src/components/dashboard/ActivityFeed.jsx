import React, { useState, useEffect, useCallback, useRef } from 'react';
import { clsx } from 'clsx';
import { HandHeart, BookOpen, CheckCircle2, RotateCcw, AlertTriangle } from 'lucide-react';
import { useSocket } from '../../contexts/SocketContext';
import { formatRelative, decodeHTML } from '../../lib/utils';

// ── Activity type configuration ────────────────────────────────────────────

const ACTIVITY_CONFIG = {
  new_thank: {
    Icon: HandHeart,
    iconClasses: 'text-[#B8973A] dark:text-[#D4AF57]',
    bgClasses: 'bg-amber-50 dark:bg-amber-900/20',
    label: 'תודה חדשה',
  },
  new_question_in_category: {
    Icon: BookOpen,
    iconClasses: 'text-blue-600 dark:text-blue-400',
    bgClasses: 'bg-blue-50 dark:bg-blue-900/20',
    label: 'שאלה חדשה בקטגוריה',
  },
  answer_published: {
    Icon: CheckCircle2,
    iconClasses: 'text-emerald-600 dark:text-emerald-400',
    bgClasses: 'bg-emerald-50 dark:bg-emerald-900/20',
    label: 'תשובה פורסמה',
  },
  question_released: {
    Icon: RotateCcw,
    iconClasses: 'text-gray-500 dark:text-gray-400',
    bgClasses: 'bg-gray-100 dark:bg-gray-800/50',
    label: 'שאלה שוחררה',
  },
  new_device_alert: {
    Icon: AlertTriangle,
    iconClasses: 'text-red-600 dark:text-red-400',
    bgClasses: 'bg-red-50 dark:bg-red-900/20',
    label: 'כניסה ממכשיר חדש',
  },
};

// ── Single activity item ────────────────────────────────────────────────────

function ActivityItem({ activity, isNew = false }) {
  const { type, message, timestamp } = activity;
  const config = ACTIVITY_CONFIG[type] || ACTIVITY_CONFIG.question_released;
  const { Icon, iconClasses, bgClasses } = config;
  const timeAgo = formatRelative(timestamp || activity.createdAt || new Date());

  return (
    <li
      className={clsx(
        'flex items-start gap-3 py-3 px-1 rounded-lg transition-colors duration-500',
        isNew && 'bg-[var(--bg-surface-raised)] animate-fade-in',
      )}
      aria-label={`${config.label}: ${message}`}
    >
      {/* Icon container */}
      <div
        className={clsx(
          'flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 mt-0.5',
          bgClasses
        )}
        aria-hidden="true"
      >
        <Icon className={clsx('w-4 h-4', iconClasses)} />
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium font-heebo text-[var(--text-primary)] leading-snug">
          {decodeHTML(message)}
        </p>
        {timeAgo && (
          <p className="text-xs text-[var(--text-muted)] font-heebo mt-0.5">
            {timeAgo}
          </p>
        )}
      </div>
    </li>
  );
}

// ── ActivityFeed ────────────────────────────────────────────────────────────

const MAX_ITEMS = 20;

/**
 * ActivityFeed — real-time list of recent activity events for the dashboard.
 *
 * @param {Array}   initialItems   — pre-fetched activities from API
 * @param {number}  [maxItems=20]  — cap on items shown
 */
export default function ActivityFeed({ initialItems = [], maxItems = MAX_ITEMS }) {
  const { on } = useSocket();
  const [items, setItems]     = useState(() => initialItems.slice(0, maxItems));
  const [newIds, setNewIds]   = useState(new Set());
  const idCounter             = useRef(0);

  // Keep in sync when initialItems prop changes (e.g. after API refetch)
  useEffect(() => {
    setItems(initialItems.slice(0, maxItems));
  }, [initialItems, maxItems]);

  const prependActivity = useCallback((activityData) => {
    const id = `rt-${Date.now()}-${++idCounter.current}`;
    const newItem = { ...activityData, _localId: id, timestamp: activityData.timestamp || new Date().toISOString() };

    setItems((prev) => [newItem, ...prev].slice(0, maxItems));
    setNewIds((prev) => new Set([...prev, id]));

    // Remove "new" highlight after 4 seconds
    setTimeout(() => {
      setNewIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 4000);
  }, [maxItems]);

  // Subscribe to real-time activity socket events
  useEffect(() => {
    const unsubs = [
      on('activity:new_thank',               prependActivity),
      on('activity:new_question_in_category', prependActivity),
      on('activity:answer_published',         prependActivity),
      on('activity:question_released',        prependActivity),
      on('activity:new_device_alert',         prependActivity),
      // Generic catch-all for any activity event
      on('activity:update',                   prependActivity),
    ];
    return () => unsubs.forEach((u) => u?.());
  }, [on, prependActivity]);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <BookOpen className="w-10 h-10 text-[var(--text-muted)] mb-3" aria-hidden="true" />
        <p className="text-sm text-[var(--text-muted)] font-heebo">אין עדכונים אחרונים להצגה</p>
      </div>
    );
  }

  return (
    <ul
      className="divide-y divide-[var(--border-default)] -mx-1"
      role="feed"
      aria-label="עדכונים אחרונים"
      aria-live="polite"
      aria-relevant="additions"
    >
      {items.map((item) => {
        const key = item._localId || item._id || item.id || `${item.type}-${item.timestamp}`;
        return (
          <ActivityItem
            key={key}
            activity={item}
            isNew={newIds.has(item._localId)}
          />
        );
      })}
    </ul>
  );
}
