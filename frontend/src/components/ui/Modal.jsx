import React, { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { X } from 'lucide-react';

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[95vw]',
};

/**
 * Accessible modal dialog.
 *
 * @param {boolean} isOpen
 * @param {() => void} onClose
 * @param {string} title
 * @param {'sm'|'md'|'lg'|'xl'|'full'} size
 * @param {boolean} closeOnBackdrop  — default true
 * @param {boolean} showCloseButton  — default true
 */
function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  showCloseButton = true,
  className,
  titleClassName,
  bodyClassName,
  footerClassName,
}) {
  const overlayRef = useRef(null);
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);

  // Save and restore focus
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement;
      // Small delay to allow the modal to render
      const timer = setTimeout(() => {
        dialogRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    } else {
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  // Lock body scroll
  useEffect(() => {
    if (isOpen) {
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
    }
  }, [isOpen]);

  // Keyboard: Escape to close, trap focus inside
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        onClose?.();
        return;
      }

      if (e.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable || focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onClose]
  );

  const handleBackdropClick = useCallback(
    (e) => {
      if (closeOnBackdrop && e.target === overlayRef.current) {
        onClose?.();
      }
    },
    [closeOnBackdrop, onClose]
  );

  if (!isOpen) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className={clsx(
        'fixed inset-0 z-50 flex items-center justify-center',
        'bg-black/50 modal-backdrop',
        'animate-fade-in',
        'p-4'
      )}
      onClick={handleBackdropClick}
      aria-modal="true"
      role="dialog"
      aria-labelledby={title ? 'modal-title' : undefined}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={clsx(
          'relative w-full bg-[var(--bg-surface)]',
          'rounded-card shadow-[var(--shadow-modal)]',
          'animate-scale-in',
          'flex flex-col max-h-[90vh]',
          'focus:outline-none',
          sizeClasses[size] || sizeClasses.md,
          className
        )}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div
            className={clsx(
              'flex items-center justify-between',
              'px-6 py-4',
              'border-b border-[var(--border-default)]',
              'flex-shrink-0'
            )}
          >
            {title && (
              <h2
                id="modal-title"
                className={clsx(
                  'text-lg font-bold text-[var(--text-primary)] font-heebo',
                  titleClassName
                )}
              >
                {title}
              </h2>
            )}

            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                aria-label="סגור"
                className={clsx(
                  'p-1.5 rounded-md',
                  'text-[var(--text-muted)]',
                  'hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]',
                  'transition-colors duration-150',
                  'focus-visible:ring-2 focus-visible:ring-brand-gold',
                  'mr-auto'
                )}
              >
                <X size={18} strokeWidth={2} />
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div
          className={clsx(
            'px-6 py-5 overflow-y-auto flex-1',
            bodyClassName
          )}
        >
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            className={clsx(
              'px-6 py-4',
              'border-t border-[var(--border-default)]',
              'flex-shrink-0',
              footerClassName
            )}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export default Modal;
