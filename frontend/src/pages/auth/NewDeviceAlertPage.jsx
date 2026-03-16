/**
 * NewDeviceAlertPage / NewDeviceAlertModal
 *
 * Can be used two ways:
 *   1. As a standalone page — import and render at a route (e.g. /new-device)
 *   2. As a modal overlay — import { NewDeviceAlertModal } and render on the dashboard
 *
 * Device info is read from location.state (page) or from props (modal).
 * Falls back gracefully when device info is not available.
 */
import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ShieldAlert,
  Monitor,
  Smartphone,
  Globe,
  Clock,
  CheckCircle,
  LogOut,
  AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Modal from '../../components/ui/Modal';

/* ── Helpers ── */
function formatDateTime(isoString) {
  if (!isoString) return 'לא ידוע';
  try {
    return new Intl.DateTimeFormat('he-IL', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

function DeviceIcon({ os }) {
  const isMobile = /android|ios|iphone|ipad|mobile/i.test(os || '');
  return isMobile ? (
    <Smartphone size={20} className="text-[var(--text-muted)]" />
  ) : (
    <Monitor size={20} className="text-[var(--text-muted)]" />
  );
}

/* ── Shared inner content ── */
function NewDeviceAlertContent({ deviceInfo, onConfirm, onDeny, confirming, denying }) {
  const {
    browser = 'לא ידוע',
    os = 'לא ידוע',
    ip = 'לא ידוע',
    time,
  } = deviceInfo || {};

  return (
    <div dir="rtl" className="flex flex-col gap-5">
      {/* Warning header */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-full bg-amber-100 dark:bg-amber-900/30">
          <ShieldAlert size={22} className="text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h2 className="text-base font-bold text-[var(--text-primary)] font-heebo">
            זוהתה כניסה ממכשיר חדש
          </h2>
          <p className="text-sm text-[var(--text-muted)] font-heebo mt-0.5">
            כניסה לחשבונך זוהתה ממכשיר חדש או כתובת IP חדשה. אם זה אתה, אשר את הכניסה.
          </p>
        </div>
      </div>

      {/* Device details */}
      <div className="bg-[var(--bg-muted)] dark:bg-[var(--bg-surface-raised)] rounded-lg p-4 flex flex-col gap-3">
        <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider font-heebo">
          פרטי המכשיר
        </h3>

        <div className="flex items-center gap-3">
          <DeviceIcon os={os} />
          <div>
            <p className="text-xs text-[var(--text-muted)] font-heebo">דפדפן / מערכת הפעלה</p>
            <p className="text-sm font-medium text-[var(--text-primary)] font-heebo">
              {browser}{os && os !== 'לא ידוע' ? ` · ${os}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Globe size={20} className="text-[var(--text-muted)]" />
          <div>
            <p className="text-xs text-[var(--text-muted)] font-heebo">כתובת IP</p>
            <p className="text-sm font-medium text-[var(--text-primary)] font-heebo" dir="ltr">
              {ip}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Clock size={20} className="text-[var(--text-muted)]" />
          <div>
            <p className="text-xs text-[var(--text-muted)] font-heebo">זמן כניסה</p>
            <p className="text-sm font-medium text-[var(--text-primary)] font-heebo">
              {formatDateTime(time)}
            </p>
          </div>
        </div>
      </div>

      {/* Info note */}
      <div className="flex items-start gap-2 text-xs text-[var(--text-muted)] font-heebo">
        <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-[#B8973A]" />
        <span>
          אם לא ביצעת כניסה זו, לחץ על "לא אני" — חשבונך ייחסם ותועבר לדף הכניסה.
        </span>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row-reverse gap-3">
        <Button
          variant="primary"
          size="lg"
          loading={confirming}
          disabled={denying}
          onClick={onConfirm}
          leftIcon={<CheckCircle size={16} />}
          className="flex-1"
        >
          זה אני
        </Button>
        <Button
          variant="danger"
          size="lg"
          loading={denying}
          disabled={confirming}
          onClick={onDeny}
          leftIcon={<LogOut size={16} />}
          className="flex-1"
        >
          לא אני — נעל חשבון
        </Button>
      </div>
    </div>
  );
}

/* ── Standalone page ── */
export default function NewDeviceAlertPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const deviceInfo = location.state?.deviceInfo || null;
  const alertId = location.state?.alertId || null;

  const [confirming, setConfirming] = useState(false);
  const [denying, setDenying] = useState(false);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      if (alertId) {
        await api.post('/auth/device-alert/confirm', { alertId });
      }
      toast.success('הכניסה אושרה');
      navigate('/dashboard', { replace: true });
    } catch {
      toast.error('שגיאה באישור הכניסה. אנא נסה שוב.');
    } finally {
      setConfirming(false);
    }
  };

  const handleDeny = async () => {
    setDenying(true);
    try {
      await api.post('/auth/logout-all');
      toast.error('החשבון ננעל. פנה למנהל המערכת.');
    } catch {
      // Proceed to login regardless
    } finally {
      setDenying(false);
      navigate('/login', { replace: true, state: { accountLocked: true } });
    }
  };

  return (
    <div
      dir="rtl"
      className="min-h-screen flex items-center justify-center bg-[#F8F6F1] dark:bg-[var(--bg-page)] p-4"
    >
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <img
            src="/logo.png"
            alt="ענה את השואל"
            className="h-14 w-auto mx-auto object-contain"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>

        <Card>
          <NewDeviceAlertContent
            deviceInfo={deviceInfo}
            onConfirm={handleConfirm}
            onDeny={handleDeny}
            confirming={confirming}
            denying={denying}
          />
        </Card>
      </div>
    </div>
  );
}

/* ── Modal variant (for use on dashboard) ── */
export function NewDeviceAlertModal({ isOpen, onClose, deviceInfo, alertId }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [denying, setDenying] = useState(false);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      if (alertId) {
        await api.post('/auth/device-alert/confirm', { alertId });
      }
      toast.success('הכניסה אושרה');
      onClose?.();
    } catch {
      toast.error('שגיאה באישור הכניסה. אנא נסה שוב.');
    } finally {
      setConfirming(false);
    }
  };

  const handleDeny = async () => {
    setDenying(true);
    try {
      await api.post('/auth/logout-all');
      toast.error('החשבון ננעל. פנה למנהל המערכת.');
    } catch {
      // Proceed to login regardless
    } finally {
      setDenying(false);
      navigate('/login', { replace: true, state: { accountLocked: true } });
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={undefined} /* No close — user must choose an action */
      showCloseButton={false}
      closeOnBackdrop={false}
      size="sm"
      title=""
    >
      <NewDeviceAlertContent
        deviceInfo={deviceInfo}
        onConfirm={handleConfirm}
        onDeny={handleDeny}
        confirming={confirming}
        denying={denying}
      />
    </Modal>
  );
}
