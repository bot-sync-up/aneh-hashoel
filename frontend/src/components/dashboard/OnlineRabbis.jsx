import React, { useState, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import { Wifi } from 'lucide-react';
import Avatar from '../ui/Avatar';
import Tooltip from '../ui/Tooltip';
import { useSocket } from '../../contexts/SocketContext';
import Spinner from '../ui/Spinner';

/**
 * OnlineRabbis — shows small avatars of currently connected rabbis (admin only).
 *
 * @param {Array<{ id, name, photoUrl, role }>} initialRabbis — from API
 * @param {boolean} loading
 */
export default function OnlineRabbis({ initialRabbis = [], loading = false }) {
  const { on } = useSocket();
  const [rabbis, setRabbis] = useState(initialRabbis);

  // Sync with prop (initial load)
  useEffect(() => {
    setRabbis(initialRabbis);
  }, [initialRabbis]);

  // Handle rabbi:online / rabbi:offline socket events
  const handleOnline = useCallback((payload) => {
    setRabbis((prev) => {
      // Avoid duplicates
      if (prev.some((r) => r.id === payload.id)) return prev;
      return [...prev, payload];
    });
  }, []);

  const handleOffline = useCallback((payload) => {
    setRabbis((prev) => prev.filter((r) => r.id !== payload.id));
  }, []);

  useEffect(() => {
    const unsubOnline = on('rabbi:online', handleOnline);
    const unsubOffline = on('rabbi:offline', handleOffline);
    return () => {
      unsubOnline?.();
      unsubOffline?.();
    };
  }, [on, handleOnline, handleOffline]);

  const count = rabbis.length;
  const SHOW_MAX = 6;
  const visible = rabbis.slice(0, SHOW_MAX);
  const overflow = count - SHOW_MAX;

  return (
    <div
      className={clsx(
        'rounded-xl border bg-[var(--bg-surface)] border-[var(--border-default)]',
        'shadow-soft dark:shadow-dark-soft p-5'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-bold text-[var(--text-primary)] font-heebo">
            רבנים מחוברים
          </h3>
          <p className="text-xs text-[var(--text-muted)] font-heebo mt-0.5">
            {count > 0 ? `${count} רבנים פעילים כרגע` : 'אין רבנים מחוברים כרגע'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs font-heebo text-emerald-500">
          <Wifi className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="font-semibold">{count}</span>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-16">
          <Spinner size="sm" />
        </div>
      ) : count === 0 ? (
        <div className="flex flex-col items-center justify-center h-16 gap-1.5 text-[var(--text-muted)] font-heebo text-xs">
          <Wifi className="w-6 h-6 opacity-20" />
          <span>לא מחובר אף רב</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {visible.map((rabbi) => (
            <Tooltip
              key={rabbi.id}
              content={
                <span className="font-heebo">
                  {rabbi.name || 'רב'}
                  {rabbi.role && rabbi.role !== 'rabbi' && (
                    <span className="text-white/70 mr-1">
                      ({rabbi.role === 'admin' ? 'מנהל' : rabbi.role === 'senior' ? 'בכיר' : rabbi.role})
                    </span>
                  )}
                </span>
              }
              placement="top"
            >
              <div className="relative">
                <Avatar
                  src={rabbi.photoUrl || rabbi.avatar}
                  name={rabbi.name}
                  size="sm"
                  online={true}
                  showBorder
                  className="cursor-default"
                />
              </div>
            </Tooltip>
          ))}

          {/* Overflow badge */}
          {overflow > 0 && (
            <Tooltip
              content={<span className="font-heebo">ועוד {overflow} רבנים</span>}
              placement="top"
            >
              <div
                className={clsx(
                  'w-8 h-8 rounded-full flex items-center justify-center',
                  'bg-[var(--bg-muted)] border-2 border-white dark:border-dark-surface',
                  'text-xs font-bold font-heebo text-[var(--text-secondary)]',
                  'cursor-default'
                )}
                aria-label={`ועוד ${overflow} רבנים מחוברים`}
              >
                +{overflow}
              </div>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
