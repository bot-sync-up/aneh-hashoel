import React, { useState, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, X } from 'lucide-react';
import { useSocket } from '../../contexts/SocketContext';

const DISMISS_KEY = 'emergency_banner_dismissed';

/**
 * EmergencyBanner — full-width red alert banner for admin emergency broadcasts.
 *
 * Listens to socket event `notification:emergency` and shows the message.
 * The rabbi can dismiss it per-session (stored in sessionStorage).
 *
 * @param {string|null} [initialMessage]  — message pre-loaded from API (if any)
 * @param {string|null} [messageId]       — server-side ID to dedupe dismissals
 */
export default function EmergencyBanner({ initialMessage = null, messageId = null }) {
  const { on } = useSocket();

  const [message, setMessage]     = useState(initialMessage);
  const [currentId, setCurrentId] = useState(messageId);
  const [visible, setVisible]     = useState(false);
  const [isNew, setIsNew]         = useState(false);

  // Check if the current message was already dismissed this session
  const isDismissed = useCallback((id) => {
    try {
      const stored = sessionStorage.getItem(DISMISS_KEY);
      if (!stored) return false;
      const dismissed = JSON.parse(stored);
      return Array.isArray(dismissed) && dismissed.includes(id || 'default');
    } catch {
      return false;
    }
  }, []);

  const markDismissed = useCallback((id) => {
    try {
      const stored = sessionStorage.getItem(DISMISS_KEY);
      const dismissed = stored ? JSON.parse(stored) : [];
      const key = id || 'default';
      if (!dismissed.includes(key)) {
        sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissed, key]));
      }
    } catch {
      // ignore
    }
  }, []);

  // Show banner for initial message (from API / SSR props)
  useEffect(() => {
    if (initialMessage && !isDismissed(messageId)) {
      setMessage(initialMessage);
      setCurrentId(messageId);
      setVisible(true);
    }
  }, [initialMessage, messageId, isDismissed]);

  // Real-time emergency socket handler
  useEffect(() => {
    const unsub = on('notification:emergency', (payload) => {
      const msg = payload?.message || payload;
      const id  = payload?.id || payload?._id || null;

      if (!msg || isDismissed(id)) return;

      setMessage(msg);
      setCurrentId(id);
      setVisible(true);
      setIsNew(true);

      // Remove the "pulse" animation class after it plays once
      setTimeout(() => setIsNew(false), 1500);
    });

    return () => unsub?.();
  }, [on, isDismissed]);

  const handleDismiss = () => {
    markDismissed(currentId);
    setVisible(false);
  };

  if (!visible || !message) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className={clsx(
        'relative flex items-start gap-3 w-full',
        'bg-red-600 dark:bg-red-700',
        'text-white',
        'px-4 py-3 rounded-xl',
        'shadow-lg',
        'animate-fade-in-up',
        isNew && 'animate-pulse',
      )}
    >
      {/* Icon */}
      <div
        className="flex items-center justify-center w-8 h-8 rounded-full bg-white/20 flex-shrink-0 mt-0.5"
        aria-hidden="true"
      >
        <AlertTriangle className="w-4 h-4 text-white" />
      </div>

      {/* Message */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold font-heebo leading-snug">
          הודעת חירום מהמנהל
        </p>
        <p className="text-sm font-heebo leading-snug mt-0.5 text-white/90">
          {message}
        </p>
      </div>

      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        className={clsx(
          'flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0',
          'bg-white/15 hover:bg-white/30 transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1',
        )}
        aria-label="סגור הודעת חירום"
      >
        <X className="w-4 h-4 text-white" aria-hidden="true" />
      </button>
    </div>
  );
}
