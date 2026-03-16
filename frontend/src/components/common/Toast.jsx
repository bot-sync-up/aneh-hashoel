import React from 'react';
import toast from 'react-hot-toast';
import { CheckCircle, XCircle, Info, Loader2 } from 'lucide-react';

/**
 * Shared toast options: RTL direction, consistent font and duration.
 */
const BASE_OPTIONS = {
  duration: 4000,
  style: {
    direction: 'rtl',
    fontFamily: "'Heebo', 'Assistant', Arial, sans-serif",
    fontSize: '14px',
    fontWeight: '500',
    borderRadius: '10px',
    padding: '12px 16px',
    boxShadow: '0 4px 16px rgba(27,43,94,0.15)',
    maxWidth: '380px',
  },
};

/**
 * Icon wrapper to give every toast a consistent icon size & alignment.
 */
function ToastIcon({ children }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        marginLeft: '8px', // RTL: icon is on the left (visual end)
      }}
    >
      {children}
    </span>
  );
}

/**
 * showToast — typed toast helpers wrapping react-hot-toast.
 *
 * Each variant pre-configures styling and a matching icon.
 *
 * Usage:
 *   import { showToast } from '@/components/common/Toast';
 *
 *   showToast.success('הפעולה הושלמה בהצלחה');
 *   showToast.error('אירעה שגיאה. אנא נסה שוב.');
 *   showToast.info('שינויים נשמרו');
 *   const id = showToast.loading('שולח...');
 *   showToast.dismiss(id);
 */
export const showToast = {
  /**
   * Green success toast with a check-circle icon.
   * @param {string} [message]
   * @param {import('react-hot-toast').ToastOptions} [options]
   */
  success(message = 'הפעולה הושלמה בהצלחה', options = {}) {
    return toast(
      (t) => (
        <span style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ flex: 1 }}>{message}</span>
          <ToastIcon>
            <CheckCircle size={18} strokeWidth={2} color="#16A34A" aria-hidden="true" />
          </ToastIcon>
        </span>
      ),
      {
        ...BASE_OPTIONS,
        ...options,
        style: {
          ...BASE_OPTIONS.style,
          background: '#F0FDF4',
          color: '#14532D',
          border: '1px solid #86EFAC',
          ...(options.style || {}),
        },
      }
    );
  },

  /**
   * Red error toast with an X-circle icon.
   * @param {string} [message]
   * @param {import('react-hot-toast').ToastOptions} [options]
   */
  error(message = 'אירעה שגיאה. אנא נסה שוב.', options = {}) {
    return toast(
      (t) => (
        <span style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ flex: 1 }}>{message}</span>
          <ToastIcon>
            <XCircle size={18} strokeWidth={2} color="#DC2626" aria-hidden="true" />
          </ToastIcon>
        </span>
      ),
      {
        ...BASE_OPTIONS,
        duration: 5000,
        ...options,
        style: {
          ...BASE_OPTIONS.style,
          background: '#FEF2F2',
          color: '#7F1D1D',
          border: '1px solid #FCA5A5',
          ...(options.style || {}),
        },
      }
    );
  },

  /**
   * Blue info toast with an info-circle icon.
   * @param {string} [message]
   * @param {import('react-hot-toast').ToastOptions} [options]
   */
  info(message = 'לידיעתך', options = {}) {
    return toast(
      (t) => (
        <span style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ flex: 1 }}>{message}</span>
          <ToastIcon>
            <Info size={18} strokeWidth={2} color="#1D4ED8" aria-hidden="true" />
          </ToastIcon>
        </span>
      ),
      {
        ...BASE_OPTIONS,
        ...options,
        style: {
          ...BASE_OPTIONS.style,
          background: '#EFF6FF',
          color: '#1E3A5F',
          border: '1px solid #93C5FD',
          ...(options.style || {}),
        },
      }
    );
  },

  /**
   * Loading toast with a spinning icon. Returns the toast ID.
   * Call showToast.dismiss(id) or showToast.success(msg, { id }) to replace it.
   * @param {string} [message]
   * @param {import('react-hot-toast').ToastOptions} [options]
   * @returns {string} toast ID
   */
  loading(message = 'טוען...', options = {}) {
    return toast(
      (t) => (
        <span style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ flex: 1 }}>{message}</span>
          <ToastIcon>
            <Loader2
              size={18}
              strokeWidth={2}
              color="#1B2B5E"
              aria-hidden="true"
              style={{ animation: 'spin 1s linear infinite' }}
            />
          </ToastIcon>
        </span>
      ),
      {
        ...BASE_OPTIONS,
        duration: Infinity,
        ...options,
        style: {
          ...BASE_OPTIONS.style,
          background: '#FFFFFF',
          color: 'var(--text-primary, #1B2B5E)',
          border: '1px solid #D8D2C4',
          ...(options.style || {}),
        },
      }
    );
  },

  /**
   * Dismiss a specific toast (or all if no id provided).
   * @param {string} [id]
   */
  dismiss(id) {
    if (id) {
      toast.dismiss(id);
    } else {
      toast.dismiss();
    }
  },
};

/**
 * Re-export the raw react-hot-toast instance for advanced usage.
 */
export { toast as rawToast };

export default showToast;
