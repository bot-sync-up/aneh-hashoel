import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowRight, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Card from '../../components/ui/Card';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ── Animated envelope SVG ── */
function EnvelopeSuccess() {
  return (
    <div className="relative inline-flex items-center justify-center">
      {/* Outer ring pulse */}
      <span
        className="absolute w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 animate-ping opacity-30"
        aria-hidden="true"
      />
      <div className="relative flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/40 shadow-inner">
        <svg
          width="32"
          height="32"
          viewBox="0 0 32 32"
          fill="none"
          aria-hidden="true"
        >
          {/* Envelope body */}
          <rect
            x="3"
            y="8"
            width="26"
            height="18"
            rx="2"
            stroke="#059669"
            strokeWidth="1.8"
            fill="none"
            className="dark:stroke-emerald-400"
          />
          {/* Envelope flap open */}
          <path
            d="M3 10 L16 19 L29 10"
            stroke="#059669"
            strokeWidth="1.8"
            strokeLinecap="round"
            fill="none"
            className="dark:stroke-emerald-400"
          />
          {/* Small check badge */}
          <circle cx="24" cy="10" r="6" fill="#059669" className="dark:fill-emerald-500" />
          <path
            d="M21.5 10 L23.3 11.8 L26.5 8.5"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [serverError, setServerError] = useState('');

  const validate = () => {
    if (!email.trim()) return 'כתובת אימייל נדרשת';
    if (!EMAIL_REGEX.test(email.trim())) return 'כתובת אימייל אינה תקינה';
    return '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      setEmailError(err);
      return;
    }
    setEmailError('');
    setServerError('');
    setLoading(true);

    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setSent(true);
      toast.success('קישור לאיפוס סיסמה נשלח לאימייל שלך');
    } catch (error) {
      const message =
        error.response?.data?.message || 'שגיאה בשליחת הבקשה. אנא נסה שוב.';
      setServerError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      dir="rtl"
      className="
        relative min-h-screen flex items-center justify-center p-4
        bg-gradient-to-br from-[#F8F6F1] via-[#f3f0e8] to-[#ede8da]
        dark:from-[var(--bg-page)] dark:via-[var(--bg-page)] dark:to-[var(--bg-surface)]
      "
    >
      {/* Background accents */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-[#1B2B5E]/5 dark:bg-[#1B2B5E]/20" />
        <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-[#B8973A]/8 dark:bg-[#B8973A]/10" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#1B2B5E] shadow-lg mb-4">
            <img
              src="/logo.png"
              alt="ענה את השואל"
              className="h-10 w-auto object-contain"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                e.currentTarget.parentElement.innerHTML =
                  '<span class="text-2xl text-white font-bold font-heebo">ע</span>';
              }}
            />
          </div>
          <h1 className="text-2xl font-bold text-[#1B2B5E] dark:text-[var(--text-primary)] font-heebo tracking-tight">
            שכחתי סיסמה
          </h1>
          <p className="text-sm text-[var(--text-muted)] font-heebo mt-1">
            הזן את כתובת האימייל שלך ונשלח לך קישור לאיפוס
          </p>
        </div>

        <Card className="shadow-lg">
          {sent ? (
            /* ── Success state ── */
            <div className="text-center py-4 flex flex-col items-center gap-5 animate-fade-in">
              <EnvelopeSuccess />

              <div className="space-y-1">
                <h2 className="text-base font-semibold text-[var(--text-primary)] font-heebo">
                  בדוק את תיבת המייל שלך
                </h2>
                <p className="text-sm text-[var(--text-secondary)] font-heebo">
                  שלחנו קישור לאיפוס הסיסמה לכתובת:
                </p>
                <p
                  className="text-sm font-medium text-[#1B2B5E] dark:text-[var(--text-primary)] font-heebo break-all"
                  dir="ltr"
                >
                  {email.trim()}
                </p>
                <p className="text-xs text-[var(--text-muted)] font-heebo mt-2 leading-relaxed">
                  לא קיבלת? בדוק את תיקיית הספאם או המתן מספר דקות.
                </p>
              </div>

              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[#B8973A] hover:text-[#9a7d30] font-heebo transition-colors mt-1"
              >
                <ArrowRight size={15} />
                חזרה לדף הכניסה
              </Link>
            </div>
          ) : (
            /* ── Form state ── */
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
              {serverError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md px-3 py-2.5 text-sm text-red-700 dark:text-red-400 font-heebo animate-fade-in"
                >
                  <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                  <span>{serverError}</span>
                </div>
              )}

              <Input
                label="כתובת אימייל"
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError('');
                  if (serverError) setServerError('');
                }}
                error={emailError}
                startIcon={<Mail size={16} />}
                placeholder="rabbi@example.com"
                required
                disabled={loading}
              />

              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={loading}
                className="w-full"
              >
                שלח קישור איפוס
              </Button>

              <Link
                to="/login"
                className="text-center text-sm text-[var(--text-muted)] hover:text-[#B8973A] font-heebo transition-colors"
              >
                חזרה לדף הכניסה
              </Link>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
