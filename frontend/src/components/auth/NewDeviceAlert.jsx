import React, { useState, useEffect, useCallback } from 'react';
import { ShieldAlert, Monitor, Smartphone, Globe, Clock, AlertTriangle, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { createPortal } from 'react-dom';
import api from '../../lib/api';
import { useSocket } from '../../contexts/SocketContext';
import { useAuth } from '../../contexts/AuthContext';
import Button from '../ui/Button';

/* ────────────────────────────────────────
   NewDeviceAlert
   Listens to socket event `notification:newDeviceAlert`.
   Shows a modal with device info, IP, time.
   Two actions:
     - "זה אני — בסדר" → dismiss
     - "לא הייתי זה — נתק את כל ההתקנים" → DELETE /api/auth/sessions
──────────────────────────────────────── */

function DeviceIcon({ deviceType }) {
  const cls = 'text-[var(--text-muted)]';
  if (!deviceType) return <Monitor size={18} className={cls} />;
  const lower = deviceType.toLowerCase();
  if (lower.includes('mobile') || lower.includes('phone') || lower.includes('android') || lower.includes('iphone')) {
    return <Smartphone size={18} className={cls} />;
  }
  return <Monitor size={18} className={cls} />;
}

function InfoRow({ icon, label, value }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-[var(--border-default)] last:border-0">
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <div className="flex flex-col min-w-0">
        <span className="text-xs text-[var(--text-muted)] font-heebo">{label}</span>
        <span className="text-sm font-medium text-[var(--text-primary)] font-heebo break-all" dir="auto">
          {value || '—'}
        </span>
      </div>
    </div>
  );
}

function formatDeviceTime(ts) {
  if (!ts) return '';
  try {
    return new Intl.DateTimeFormat('he-IL', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(ts));
  } catch {
    return String(ts);
  }
}

export default function NewDeviceAlert() {
  const { on } = useSocket();
  const { logout } = useAuth();

  const [alert, setAlert] = useState(null); // { deviceType, ip, userAgent, timestamp, sessionId }
  const [revoking, setRevoking] = useState(false);
  const [revoked, setRevoked] = useState(false);

  // Listen for the socket event
  useEffect(() => {
    const unsubscribe = on('notification:newDeviceAlert', (payload) => {
      setAlert(payload);
      setRevoked(false);
    });
    return unsubscribe;
  }, [on]);

  const dismiss = useCallback(() => {
    setAlert(null);
    toast.success('הישארת מחובר בהצלחה');
  }, []);

  const revokeAll = useCallback(async () => {
    setRevoking(true);
    try {
      await api.delete('/auth/sessions');
      setRevoked(true);
      toast.error('כל ההתקנים נותקו. מתנתק...');
      setTimeout(() => {
        logout();
      }, 2000);
    } catch (err) {
      const message = err.response?.data?.message || 'שגיאה בניתוק ההתקנים. אנא נסה שוב.';
      toast.error(message);
    } finally {
      setRevoking(false);
    }
  }, [logout]);

  // Keyboard: Escape to dismiss (only when it's safe — not while revoking)
  useEffect(() => {
    if (!alert || revoking || revoked) return;

    const handleKey = (e) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [alert, revoking, revoked, dismiss]);

  // Lock body scroll while open
  useEffect(() => {
    if (!alert) return;
    const scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';

    return () => {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      window.scrollTo(0, scrollY);
    };
  }, [alert]);

  if (!alert) return null;

  const deviceLabel = alert.deviceType || alert.device || 'מכשיר לא ידוע';
  const ip = alert.ip || alert.ipAddress || 'לא זמין';
  const userAgent = alert.userAgent || alert.browser || '';
  const timestamp = alert.timestamp || alert.createdAt || new Date().toISOString();

  return createPortal(
    <div
      dir="rtl"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-device-title"
    >
      <div
        className="
          w-full max-w-sm
          bg-[var(--bg-surface)] rounded-2xl shadow-2xl
          animate-scale-in
          overflow-hidden
        "
      >
        {/* Header — amber warning stripe */}
        <div className="bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800 px-5 py-4 flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center mt-0.5">
            <ShieldAlert size={20} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h2
              id="new-device-title"
              className="text-base font-bold text-amber-800 dark:text-amber-300 font-heebo"
            >
              כניסה ממכשיר חדש
            </h2>
            <p className="text-xs text-amber-700 dark:text-amber-400 font-heebo mt-0.5 leading-relaxed">
              זוהתה כניסה לחשבונך ממכשיר שלא זוהה בעבר.
            </p>
          </div>
        </div>

        {/* Device info */}
        <div className="px-5 py-1">
          {revoked ? (
            <div className="text-center py-6 flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <CheckCircle size={24} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <p className="text-sm font-semibold text-[var(--text-primary)] font-heebo">
                כל ההתקנים נותקו
              </p>
              <p className="text-xs text-[var(--text-muted)] font-heebo">
                מתנתק מהמערכת...
              </p>
            </div>
          ) : (
            <>
              <InfoRow
                icon={<DeviceIcon deviceType={deviceLabel} />}
                label="מכשיר"
                value={deviceLabel}
              />
              <InfoRow
                icon={<Globe size={18} className="text-[var(--text-muted)]" />}
                label="כתובת IP"
                value={ip}
              />
              {userAgent && (
                <InfoRow
                  icon={<Monitor size={18} className="text-[var(--text-muted)]" />}
                  label="דפדפן / מערכת"
                  value={userAgent.length > 60 ? userAgent.slice(0, 57) + '…' : userAgent}
                />
              )}
              <InfoRow
                icon={<Clock size={18} className="text-[var(--text-muted)]" />}
                label="זמן כניסה"
                value={formatDeviceTime(timestamp)}
              />
            </>
          )}
        </div>

        {/* Actions */}
        {!revoked && (
          <div className="px-5 pb-5 pt-3 flex flex-col gap-2.5">
            {/* "That was me" — safe action */}
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={dismiss}
              disabled={revoking}
            >
              זה אני — בסדר
            </Button>

            {/* "Revoke all" — danger action */}
            <Button
              variant="danger"
              size="lg"
              className="w-full"
              onClick={revokeAll}
              loading={revoking}
            >
              <AlertTriangle size={16} className="ms-0 me-1.5 flex-shrink-0" />
              לא הייתי זה — נתק את כל ההתקנים
            </Button>

            <p className="text-center text-xs text-[var(--text-muted)] font-heebo leading-relaxed">
              אם לא נכנסת, מומלץ לנתק את כל ההתקנים ולשנות את הסיסמה.
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
