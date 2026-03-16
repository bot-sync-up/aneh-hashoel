import React from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, AlertCircle, HelpCircle } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';

/**
 * Variant configuration: icon, icon color, confirm button variant.
 */
const VARIANT_CONFIG = {
  danger: {
    Icon: AlertTriangle,
    iconBg: 'rgba(239,68,68,0.10)',
    iconColor: '#DC2626',
    confirmVariant: 'danger',
  },
  warning: {
    Icon: AlertCircle,
    iconBg: 'rgba(245,158,11,0.12)',
    iconColor: '#D97706',
    confirmVariant: 'secondary',
  },
  default: {
    Icon: HelpCircle,
    iconBg: 'rgba(27,43,94,0.08)',
    iconColor: '#1B2B5E',
    confirmVariant: 'primary',
  },
};

/**
 * ConfirmDialog — a reusable modal confirmation dialog.
 *
 * @param {boolean}   isOpen        — controls visibility
 * @param {string}    title         — dialog heading
 * @param {string}    message       — body text (can be a ReactNode)
 * @param {string}    [confirmLabel='אשר']  — confirm button label
 * @param {string}    [cancelLabel='ביטול'] — cancel button label
 * @param {() => void} onConfirm    — called when confirm is clicked
 * @param {() => void} onCancel     — called when cancel is clicked or modal closes
 * @param {'danger'|'warning'|'default'} [variant='default'] — visual style
 * @param {boolean}   [loading]     — shows spinner on confirm button while true
 */
export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'אשר',
  cancelLabel = 'ביטול',
  onConfirm,
  onCancel,
  variant = 'default',
  loading = false,
}) {
  const config = VARIANT_CONFIG[variant] ?? VARIANT_CONFIG.default;
  const { Icon, iconBg, iconColor, confirmVariant } = config;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={null}
      size="sm"
      showCloseButton={false}
      closeOnBackdrop={!loading}
      bodyClassName="pt-6 pb-2"
    >
      <div className="flex flex-col items-center text-center" dir="rtl">
        {/* Icon */}
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center mb-4 flex-shrink-0"
          style={{ backgroundColor: iconBg }}
          aria-hidden="true"
        >
          <Icon size={26} strokeWidth={1.75} style={{ color: iconColor }} />
        </div>

        {/* Title */}
        {title && (
          <h2
            className="text-lg font-bold font-heebo mb-2 leading-snug"
            style={{ color: 'var(--text-primary)' }}
          >
            {title}
          </h2>
        )}

        {/* Message */}
        {message && (
          <p
            className={clsx(
              'text-sm font-heebo leading-relaxed',
              title ? 'mb-6' : 'mb-4 mt-1'
            )}
            style={{ color: 'var(--text-muted)' }}
          >
            {message}
          </p>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 w-full justify-center flex-row-reverse">
          <Button
            variant={confirmVariant}
            size="md"
            onClick={onConfirm}
            loading={loading}
            disabled={loading}
            className="flex-1"
          >
            {confirmLabel}
          </Button>
          <Button
            variant="outline"
            size="md"
            onClick={onCancel}
            disabled={loading}
            className="flex-1"
          >
            {cancelLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
