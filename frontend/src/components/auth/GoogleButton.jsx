/**
 * GoogleButton
 *
 * Renders a white "כניסה עם Google" button following Google brand guidelines.
 *
 * Strategy: manual OAuth redirect flow.
 *   1. User clicks → redirect to /api/auth/google (backend initiates OAuth)
 *   2. Google returns to the backend callback URL
 *   3. Backend issues JWT and redirects to the frontend with token in URL or cookie
 *
 * Alternatively, if VITE_GOOGLE_CLIENT_ID is set, the button can POST the
 * credential returned by the Google Identity Services library to /auth/google.
 *
 * Props:
 *   disabled  — disables the button (e.g. while login form is submitting)
 *   className — additional Tailwind classes
 *   onSuccess — optional callback after a successful Google credential is obtained
 *               (only used in GSI token mode, not in redirect mode)
 */
import React, { useCallback } from 'react';
import { clsx } from 'clsx';

/* ── Google "G" logo SVG ── */
function GoogleLogo() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

export default function GoogleButton({ disabled = false, className, onSuccess }) {
  const handleClick = useCallback(() => {
    if (disabled) return;

    const apiBase = import.meta.env.VITE_API_URL || '/api';

    // Include a `redirect_uri` param so the backend knows where to send the user
    const redirectUri = encodeURIComponent(window.location.origin + '/auth/google/callback');
    window.location.href = `${apiBase}/auth/google?redirect_uri=${redirectUri}`;
  }, [disabled]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      aria-label="כניסה עם Google"
      className={clsx(
        // Base
        'inline-flex items-center justify-center gap-3',
        'w-full h-12 px-4 rounded-lg',
        'font-heebo text-sm font-medium',
        'select-none whitespace-nowrap',
        'transition-all duration-150',
        // Google-spec white button
        'bg-white text-[#3c4043]',
        'border border-[#dadce0]',
        'shadow-[0_1px_2px_0_rgba(60,64,67,.3),0_1px_3px_1px_rgba(60,64,67,.15)]',
        // Hover / active
        'hover:bg-[#f8f9fa] hover:shadow-[0_1px_3px_0_rgba(60,64,67,.3),0_4px_8px_3px_rgba(60,64,67,.15)]',
        'active:bg-[#f1f3f4] active:shadow-[0_1px_2px_0_rgba(60,64,67,.3)]',
        // Focus
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4285F4] focus-visible:ring-offset-2',
        // Disabled
        'disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none',
        // Dark mode — keep white background per Google spec, slight adjustment
        'dark:bg-white dark:hover:bg-[#f8f9fa]',
        className
      )}
    >
      <GoogleLogo />
      <span>כניסה עם Google</span>
    </button>
  );
}
