import React from 'react';
import Spinner from '../components/ui/Spinner';

/**
 * Full-page loading screen.
 * Displayed while AuthContext checks the user's session on app startup.
 * Matches the brand colors and RTL layout of the rest of the app.
 *
 * @param {string} [label] - optional override for the loading text
 */
export default function LoadingPage({ label = 'טוען...' }) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 animate-fade-in"
      style={{ backgroundColor: 'var(--bg-page)' }}
      role="status"
      aria-label={label}
      dir="rtl"
    >
      {/* Brand logo mark — navy square with gold dot */}
      <div className="relative mb-2" aria-hidden="true">
        <div
          className="w-14 h-14 rounded-xl flex items-center justify-center"
          style={{
            backgroundColor: '#1B2B5E',
            boxShadow: '0 4px 16px rgba(27,43,94,0.25)',
          }}
        >
          <span
            className="text-2xl font-bold font-heebo select-none"
            style={{ color: '#B8973A', lineHeight: 1 }}
          >
            ענ
          </span>
        </div>
        {/* Pulsing gold dot in corner */}
        <span
          className="absolute -bottom-1 -left-1 w-3.5 h-3.5 rounded-full border-2"
          style={{
            backgroundColor: '#B8973A',
            borderColor: 'var(--bg-page)',
            animation: 'pulse-dot 1.8s ease-in-out infinite',
          }}
        />
      </div>

      {/* Large navy spinner */}
      <Spinner size="xl" color="brand" label={label} />

      {/* Loading text */}
      <p
        className="text-sm font-medium font-heebo tracking-wide"
        style={{ color: 'var(--text-muted)' }}
        aria-hidden="true"
      >
        {label}
      </p>
    </div>
  );
}
