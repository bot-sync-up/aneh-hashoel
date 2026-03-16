import React, { useState, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import {
  Monitor,
  Smartphone,
  MapPin,
  Clock,
  LogOut,
  AlertTriangle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import api from '../../lib/api';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatRelative(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'הרגע';
  if (mins < 60) return `לפני ${mins} דקות`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `לפני ${hours} שעות`;
  const days = Math.floor(hours / 24);
  return `לפני ${days} ימים`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function DeviceIcon({ deviceType, className }) {
  const isMobile = /mobile|tablet|ios|android/i.test(deviceType || '');
  const Icon = isMobile ? Smartphone : Monitor;
  return <Icon className={clsx('flex-shrink-0', className)} aria-hidden="true" />;
}

// ── Session row ────────────────────────────────────────────────────────────────

function SessionRow({ session, isCurrent, onRevoke, revoking }) {
  const device = session.deviceName || session.userAgent || 'מכשיר לא ידוע';
  const location = session.city || session.location || session.ip || '—';
  const created = formatDate(session.createdAt);
  const lastActive = formatRelative(session.lastActiveAt || session.updatedAt);

  return (
    <div
      className={clsx(
        'flex items-start gap-3 p-4 rounded-xl border transition-colors duration-150',
        isCurrent
          ? 'bg-brand-navy/5 dark:bg-brand-gold/10 border-brand-navy/20 dark:border-brand-gold/20'
          : 'bg-[var(--bg-surface)] border-[var(--border-default)] hover:bg-[var(--bg-muted)]'
      )}
    >
      {/* Device icon */}
      <div
        className={clsx(
          'flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0',
          isCurrent
            ? 'bg-brand-navy/10 dark:bg-brand-gold/20 text-brand-navy dark:text-brand-gold'
            : 'bg-[var(--bg-muted)] text-[var(--text-muted)]'
        )}
      >
        <DeviceIcon deviceType={session.deviceType || device} className="w-5 h-5" />
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold font-heebo text-[var(--text-primary)] truncate">
            {device}
          </span>
          {isCurrent && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-heebo">
              זה אתה
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-muted)] font-heebo">
          <span className="flex items-center gap-1">
            <MapPin className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
            {location}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
            פעיל {lastActive}
          </span>
          <span>נוצר: {created}</span>
        </div>
      </div>

      {/* Revoke button */}
      {!isCurrent && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onRevoke(session._id || session.id)}
          loading={revoking}
          leftIcon={<LogOut className="w-3.5 h-3.5" />}
          className="flex-shrink-0 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
          aria-label={`נתק סשן: ${device}`}
        >
          נתק
        </Button>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ActiveSessions() {
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [revokingId, setRevokingId] = useState(null);
  const [revokingAll, setRevokingAll] = useState(false);
  const [showConfirmAll, setShowConfirmAll] = useState(false);

  // ── Fetch sessions ─────────────────────────────────────────────────────────

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/auth/sessions');
      setSessions(data?.sessions || data || []);
      setCurrentSessionId(data?.currentSessionId || data?.current || null);
    } catch {
      setError('לא ניתן לטעון את הסשנים הפעילים.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // ── Revoke single ──────────────────────────────────────────────────────────

  const handleRevoke = async (sessionId) => {
    setRevokingId(sessionId);
    try {
      await api.delete(`/auth/sessions/${sessionId}`);
      setSessions((prev) => prev.filter((s) => (s._id || s.id) !== sessionId));
    } catch {
      setError('לא ניתן לנתק את הסשן. נסה שוב.');
    } finally {
      setRevokingId(null);
    }
  };

  // ── Revoke all ─────────────────────────────────────────────────────────────

  const handleRevokeAll = async () => {
    setShowConfirmAll(false);
    setRevokingAll(true);
    try {
      await api.delete('/auth/sessions');
      // Keep only current session in list
      setSessions((prev) =>
        prev.filter((s) => (s._id || s.id) === currentSessionId)
      );
    } catch {
      setError('לא ניתן לנתק את כל הסשנים. נסה שוב.');
    } finally {
      setRevokingAll(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin text-brand-navy dark:text-brand-gold" aria-label="טוען סשנים" />
      </div>
    );
  }

  const otherSessions = sessions.filter((s) => (s._id || s.id) !== currentSessionId);
  const currentSession = sessions.find((s) => (s._id || s.id) === currentSessionId);

  return (
    <div className="space-y-4" dir="rtl">
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400 font-heebo"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-muted)] font-heebo">
          {sessions.length} {sessions.length === 1 ? 'סשן פעיל' : 'סשנים פעילים'}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchSessions}
          leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          aria-label="רענן רשימת סשנים"
        >
          רענן
        </Button>
      </div>

      {/* Sessions list */}
      <div className="space-y-2" aria-label="סשנים פעילים">
        {/* Current session first */}
        {currentSession && (
          <SessionRow
            session={currentSession}
            isCurrent={true}
            onRevoke={handleRevoke}
            revoking={false}
          />
        )}
        {/* Other sessions */}
        {otherSessions.map((session) => (
          <SessionRow
            key={session._id || session.id}
            session={session}
            isCurrent={false}
            onRevoke={handleRevoke}
            revoking={revokingId === (session._id || session.id)}
          />
        ))}
        {sessions.length === 0 && (
          <p className="text-center text-sm text-[var(--text-muted)] font-heebo py-6">
            אין סשנים פעילים אחרים
          </p>
        )}
      </div>

      {/* Revoke all button — only if there are other sessions */}
      {otherSessions.length > 0 && (
        <div className="pt-2">
          <Button
            variant="danger"
            size="sm"
            onClick={() => setShowConfirmAll(true)}
            loading={revokingAll}
            leftIcon={<LogOut className="w-4 h-4" />}
          >
            נתק מכל המכשירים
          </Button>
        </div>
      )}

      {/* Confirm modal */}
      <Modal
        isOpen={showConfirmAll}
        onClose={() => setShowConfirmAll(false)}
        title="ניתוק מכל המכשירים"
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowConfirmAll(false)}>
              ביטול
            </Button>
            <Button variant="danger" onClick={handleRevokeAll} loading={revokingAll}>
              נתק מכולם
            </Button>
          </div>
        }
      >
        <p className="text-sm text-[var(--text-secondary)] font-heebo">
          פעולה זו תנתק את כל הסשנים הפעילים מלבד הסשן הנוכחי שלך.
          <br />
          כל המכשירים האחרים יצטרכו להתחבר מחדש.
        </p>
      </Modal>
    </div>
  );
}
