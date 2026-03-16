import React, { useState, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import {
  MessageCirclePlus,
  UserCheck,
  CheckCircle2,
  Bell,
  Activity,
} from 'lucide-react';
import { formatRelative } from '../../lib/utils';
import { useSocket } from '../../contexts/SocketContext';
import Spinner from '../ui/Spinner';

const MAX_EVENTS = 10;

// Map event type → icon + colour + description builder
const EVENT_CONFIG = {
  'question:new': {
    Icon: MessageCirclePlus,
    color: 'text-blue-500',
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    describe: (e) => `שאלה חדשה התקבלה${e.category ? ` בנושא ${e.category}` : ''}`,
  },
  'question:claimed': {
    Icon: UserCheck,
    color: 'text-amber-500',
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    describe: (e) => `שאלה נלקחה לטיפול${e.rabbiName ? ` על ידי ${e.rabbiName}` : ''}`,
  },
  'question:answered': {
    Icon: CheckCircle2,
    color: 'text-emerald-500',
    bg: 'bg-emerald-100 dark:bg-emerald-900/30',
    describe: (e) => `שאלה נענתה${e.rabbiName ? ` על ידי ${e.rabbiName}` : ''}`,
  },
  'question:updated': {
    Icon: Activity,
    color: 'text-purple-500',
    bg: 'bg-purple-100 dark:bg-purple-900/30',
    describe: () => 'שאלה עודכנה',
  },
  default: {
    Icon: Bell,
    color: 'text-[var(--text-muted)]',
    bg: 'bg-[var(--bg-muted)]',
    describe: (e) => e.message || 'אירוע חדש',
  },
};

function getConfig(type) {
  return EVENT_CONFIG[type] || EVENT_CONFIG.default;
}

/**
 * Single activity row.
 */
function ActivityRow({ event, isNew }) {
  const config = getConfig(event.type);
  const { Icon } = config;

  return (
    <li
      className={clsx(
        'flex items-start gap-3 py-3',
        'border-b border-[var(--border-default)] last:border-0',
        'transition-all duration-300',
        isNew && 'bg-[var(--bg-muted)] rounded-lg px-2 -mx-2'
      )}
    >
      {/* Icon bubble */}
      <div
        className={clsx(
          'flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 mt-0.5',
          config.bg
        )}
        aria-hidden="true"
      >
        <Icon className={clsx('w-4 h-4', config.color)} />
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[var(--text-primary)] font-heebo leading-snug">
          {getConfig(event.type).describe(event)}
        </p>
        {event.questionTitle && (
          <p className="text-xs text-[var(--text-muted)] font-heebo mt-0.5 truncate">
            {event.questionTitle}
          </p>
        )}
      </div>

      {/* Relative time */}
      <time
        className="text-xs text-[var(--text-muted)] font-heebo flex-shrink-0 mt-0.5"
        dateTime={event.timestamp}
        title={event.timestamp}
      >
        {formatRelative(event.timestamp)}
      </time>
    </li>
  );
}

/**
 * RecentActivity — last 10 activity events with live socket updates.
 *
 * @param {Array}   initialEvents — prefetched events from API
 * @param {boolean} loading
 */
export default function RecentActivity({ initialEvents = [], loading = false }) {
  const { on } = useSocket();
  const [events, setEvents] = useState(initialEvents);
  const [newIds, setNewIds] = useState(new Set());

  // Sync with prop changes (initial load)
  useEffect(() => {
    if (initialEvents.length > 0) {
      setEvents(initialEvents.slice(0, MAX_EVENTS));
    }
  }, [initialEvents]);

  // Prepend a new event and pulse-highlight it briefly
  const addEvent = useCallback((type, payload) => {
    const event = {
      id: payload.id || `${type}-${Date.now()}`,
      type,
      timestamp: payload.timestamp || new Date().toISOString(),
      rabbiName: payload.rabbiName || payload.rabbi?.name,
      category: payload.category,
      questionTitle: payload.title || payload.questionTitle,
      message: payload.message,
    };

    setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));
    setNewIds((prev) => new Set([...prev, event.id]));

    // Remove highlight after 3 s
    setTimeout(() => {
      setNewIds((prev) => {
        const next = new Set(prev);
        next.delete(event.id);
        return next;
      });
    }, 3000);
  }, []);

  // Subscribe to socket events
  useEffect(() => {
    const unsubs = [
      on('question:new', (payload) => addEvent('question:new', payload)),
      on('question:claimed', (payload) => addEvent('question:claimed', payload)),
      on('question:answered', (payload) => addEvent('question:answered', payload)),
      on('question:updated', (payload) => addEvent('question:updated', payload)),
    ];
    return () => unsubs.forEach((fn) => fn && fn());
  }, [on, addEvent]);

  return (
    <div
      className={clsx(
        'rounded-xl border bg-[var(--bg-surface)] border-[var(--border-default)]',
        'shadow-soft dark:shadow-dark-soft p-5'
      )}
    >
      {/* Card header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-bold text-[var(--text-primary)] font-heebo">
            פעילות אחרונה
          </h3>
          <p className="text-xs text-[var(--text-muted)] font-heebo mt-0.5">
            עדכונים בזמן אמת
          </p>
        </div>
        {/* Live indicator */}
        <div className="flex items-center gap-1.5 text-xs font-heebo text-emerald-500">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
          <span>חי</span>
        </div>
      </div>

      {/* Events list */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <Spinner size="md" />
        </div>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-[var(--text-muted)] font-heebo text-sm gap-2">
          <Activity className="w-8 h-8 opacity-30" />
          <span>אין פעילות אחרונה</span>
        </div>
      ) : (
        <ul className="divide-y-0" role="list" aria-label="פעילות אחרונה">
          {events.map((event) => (
            <ActivityRow
              key={event.id}
              event={event}
              isNew={newIds.has(event.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
