import React, { useState } from 'react';
import { clsx } from 'clsx';
import { Menu, X } from 'lucide-react';
import Sidebar from './Sidebar';
import { useSocket } from '../../contexts/SocketContext';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * Main application layout.
 * - Desktop: fixed sidebar (left in RTL = visually right) + scrollable content
 * - Mobile: full-width content + slide-in sidebar overlay
 *
 * @param {number} notificationCount — passed down to Sidebar badge
 */
function Layout({ children, notificationCount = 0 }) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { connected, connectionError } = useSocket();
  const { isDark } = useTheme();

  return (
    <div
      className={clsx(
        'min-h-screen flex',
        'bg-[var(--bg-page)]',
        'font-heebo'
      )}
      dir="rtl"
    >
      {/* ── Desktop Sidebar ── */}
      <div
        className={clsx(
          'hidden md:flex flex-col',
          'fixed inset-y-0 right-0 z-30',
          'h-screen'
        )}
        aria-label="סרגל ניווט"
      >
        <Sidebar notificationCount={notificationCount} />
      </div>

      {/* ── Mobile Sidebar Overlay ── */}
      {mobileSidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-40"
          aria-modal="true"
          role="dialog"
          aria-label="תפריט ניווט"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 modal-backdrop animate-fade-in"
            onClick={() => setMobileSidebarOpen(false)}
            aria-hidden="true"
          />

          {/* Sidebar panel — slides in from right in RTL */}
          <div
            className={clsx(
              'absolute inset-y-0 right-0 z-10',
              'animate-slide-in-right'
            )}
          >
            <Sidebar notificationCount={notificationCount} />
          </div>
        </div>
      )}

      {/* ── Main Content ── */}
      <div
        className={clsx(
          'flex flex-col flex-1 min-w-0',
          'transition-all duration-300',
          // Offset for the fixed sidebar on desktop
          // Sidebar width changes based on collapsed state — we use CSS variables via padding
          'md:pr-64' // default sidebar width; collapsed uses 72px
        )}
        id="main-content"
      >
        {/* Mobile top bar */}
        <header
          className={clsx(
            'md:hidden flex items-center justify-between',
            'h-14 px-4 flex-shrink-0',
            'bg-[var(--bg-surface)] border-b border-[var(--border-default)]',
            'sticky top-0 z-20'
          )}
        >
          <button
            onClick={() => setMobileSidebarOpen(true)}
            aria-label="פתח תפריט"
            aria-expanded={mobileSidebarOpen}
            aria-controls="mobile-sidebar"
            className={clsx(
              'p-2 rounded-md',
              'text-[var(--text-secondary)]',
              'hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]',
              'transition-colors duration-150'
            )}
          >
            {mobileSidebarOpen ? (
              <X size={20} strokeWidth={2} />
            ) : (
              <Menu size={20} strokeWidth={2} />
            )}
          </button>

          <span className="text-brand-navy dark:text-brand-gold font-bold text-base font-heebo">
            ענה את השואל
          </span>

          {/* Spacer to center title */}
          <div className="w-9" aria-hidden="true" />
        </header>

        {/* Offline / connection error banner */}
        {connectionError && (
          <div
            className={clsx(
              'flex items-center justify-center gap-2 py-2 px-4',
              'bg-red-50 dark:bg-red-900/20',
              'border-b border-red-200 dark:border-red-800',
              'text-red-700 dark:text-red-400',
              'text-sm font-heebo'
            )}
            role="alert"
          >
            <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
            {connectionError}
          </div>
        )}

        {/* Page content */}
        <main
          className="flex-1 overflow-y-auto"
          tabIndex={-1}
          id="page-main"
        >
          <div className="min-h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export default Layout;
