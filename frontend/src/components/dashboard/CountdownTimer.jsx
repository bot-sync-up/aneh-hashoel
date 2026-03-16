import React, { useState, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import { Clock } from 'lucide-react';

/**
 * CountdownTimer — real-time countdown to auto-release deadline.
 *
 * @param {string|Date} lockTimestamp  — when the question was locked (ISO or Date)
 * @param {number}      timeoutHours   — hours until auto-release (default 24)
 * @param {function}    onExpired      — called when the timer reaches zero
 */
export default function CountdownTimer({ lockTimestamp, timeoutHours = 24, onExpired }) {
  const computeRemaining = useCallback(() => {
    if (!lockTimestamp) return null;
    const lockedAt = typeof lockTimestamp === 'string'
      ? new Date(lockTimestamp)
      : lockTimestamp;
    const deadline = new Date(lockedAt.getTime() + timeoutHours * 60 * 60 * 1000);
    const diff = deadline - Date.now();
    return diff;
  }, [lockTimestamp, timeoutHours]);

  const [remaining, setRemaining] = useState(computeRemaining);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    setRemaining(computeRemaining());
    setExpired(false);
  }, [computeRemaining]);

  useEffect(() => {
    if (expired) return;

    const tick = () => {
      const ms = computeRemaining();
      if (ms !== null && ms <= 0) {
        setRemaining(0);
        setExpired(true);
        onExpired?.();
      } else {
        setRemaining(ms);
      }
    };

    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [computeRemaining, expired, onExpired]);

  if (remaining === null) return null;

  if (expired) {
    return (
      <span
        className={clsx(
          'inline-flex items-center gap-1 text-xs font-semibold font-heebo',
          'text-red-600 dark:text-red-400',
        )}
        role="status"
        aria-live="polite"
      >
        <Clock className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
        פג תוקף
      </span>
    );
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  // Color thresholds
  const colorClasses = clsx(
    'inline-flex items-center gap-1 text-xs font-semibold font-heebo',
    {
      'text-green-600 dark:text-green-400':  hours >= 2,
      'text-yellow-600 dark:text-yellow-400': hours >= 1 && hours < 2,
      'text-orange-500 dark:text-orange-400': hours < 1 && minutes >= 30,
      'text-red-600 dark:text-red-400':      minutes < 30,
    }
  );

  const pad = (n) => String(n).padStart(2, '0');

  let label;
  if (hours > 0) {
    label = `${hours} שעות ${pad(minutes)} דקות נותרו`;
  } else if (minutes > 0) {
    label = `${minutes} דקות ${pad(seconds)} שניות נותרו`;
  } else {
    label = `${seconds} שניות נותרו`;
  }

  return (
    <span className={colorClasses} role="timer" aria-live="off" aria-label={label}>
      <Clock className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
      <span className="hebrew-counter tabular-nums">{label}</span>
    </span>
  );
}
