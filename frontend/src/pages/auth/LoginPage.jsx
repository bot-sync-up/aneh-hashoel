import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../lib/api';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Card from '../../components/ui/Card';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ── Subtle geometric background pattern ── */
function AuthBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {/* Warm radial gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#F8F6F1] via-[#f3f0e8] to-[#ede8da] dark:from-[var(--bg-page)] dark:via-[var(--bg-page)] dark:to-[var(--bg-surface)]" />
      {/* Navy circle top-right */}
      <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-[#1B2B5E]/5 dark:bg-[#1B2B5E]/20" />
      {/* Gold circle bottom-left */}
      <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-[#B8973A]/8 dark:bg-[#B8973A]/10" />
      {/* Small accent dots */}
      <div className="absolute top-1/4 left-1/3 w-2 h-2 rounded-full bg-[#B8973A]/20" />
      <div className="absolute top-2/3 right-1/4 w-3 h-3 rounded-full bg-[#1B2B5E]/10" />
    </div>
  );
}

/* ── Google sign-in button ── */
function GoogleSignInButton({ disabled }) {
  const handleGoogleLogin = () => {
    window.location.href = '/api/auth/google';
  };

  return (
    <button
      type="button"
      onClick={handleGoogleLogin}
      disabled={disabled}
      className="
        w-full h-11 flex items-center justify-center gap-3
        border border-[var(--border-default)] rounded-lg
        bg-white dark:bg-[var(--bg-surface-raised)]
        text-sm font-medium font-heebo text-[var(--text-primary)]
        hover:bg-gray-50 dark:hover:bg-[var(--bg-muted)]
        active:bg-gray-100
        transition-colors duration-150
        disabled:opacity-50 disabled:cursor-not-allowed
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8973A] focus-visible:ring-offset-2
      "
    >
      {/* Google SVG logo */}
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        />
        <path
          fill="#34A853"
          d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"
        />
        <path
          fill="#FBBC05"
          d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z"
        />
        <path
          fill="#EA4335"
          d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"
        />
      </svg>
      כניסה עם Google
    </button>
  );
}

export default function LoginPage() {
  const { login, loading } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const validate = () => {
    const e = {};
    if (!form.email.trim()) {
      e.email = 'כתובת אימייל נדרשת';
    } else if (!EMAIL_REGEX.test(form.email.trim())) {
      e.email = 'כתובת אימייל אינה תקינה';
    }
    if (!form.password) {
      e.password = 'סיסמה נדרשת';
    }
    return e;
  };

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
    if (serverError) setServerError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationErrors = validate();
    if (Object.keys(validationErrors).length) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    setServerError('');
    setSubmitting(true);

    try {
      const result = await login({
        email: form.email.trim(),
        password: form.password,
      });

      if (result.success) {
        if (result.must_change_password || result.mustChangePassword) {
          navigate('/setup-password', { replace: true });
          return;
        }
        navigate('/dashboard', { replace: true });
        return;
      }

      // Handle 2FA requirement
      if (result.requires2FA || result.twoFactorRequired) {
        navigate('/2fa', {
          state: {
            tempToken: result.tempToken || result.token,
            email: form.email.trim(),
          },
        });
        return;
      }

      // Handle must_change_password returned alongside non-success
      if (result.must_change_password || result.mustChangePassword) {
        navigate('/setup-password', { replace: true });
        return;
      }

      const message = result.message || 'שגיאה בהתחברות. אנא נסה שוב.';
      setServerError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const isLoading = loading || submitting;

  return (
    <div
      dir="rtl"
      className="relative min-h-screen flex items-center justify-center p-4"
    >
      <AuthBackground />

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
            ענה את השואל
          </h1>
          <p className="text-sm text-[var(--text-muted)] font-heebo mt-1">
            פורטל הרבנים
          </p>
        </div>

        <Card className="shadow-lg">
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            {/* Server error banner */}
            {serverError && (
              <div
                role="alert"
                className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md px-3 py-2.5 text-sm text-red-700 dark:text-red-400 font-heebo animate-fade-in"
              >
                <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                <span>{serverError}</span>
              </div>
            )}

            {/* Email */}
            <Input
              label="אימייל"
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              value={form.email}
              onChange={handleChange('email')}
              error={errors.email}
              startIcon={<Mail size={16} />}
              placeholder="rabbi@example.com"
              required
              disabled={isLoading}
            />

            {/* Password with show/hide toggle */}
            <div className="relative">
              <Input
                label="סיסמה"
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                value={form.password}
                onChange={handleChange('password')}
                error={errors.password}
                startIcon={<Lock size={16} />}
                placeholder="הזן סיסמה"
                required
                disabled={isLoading}
              />
              {/* Toggle button — positioned inside the input area */}
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'הסתר סיסמה' : 'הצג סיסמה'}
                className="
                  absolute top-1/2 left-3 -translate-y-1/2
                  text-[var(--text-muted)] hover:text-[var(--text-secondary)]
                  transition-colors duration-150
                  focus-visible:outline-none
                "
                style={{ marginTop: errors.password ? '-10px' : '0' }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {/* Forgot password */}
            <div className="flex justify-start -mt-1">
              <Link
                to="/forgot-password"
                className="text-sm text-[#B8973A] hover:text-[#9a7d30] dark:hover:text-[#d4a94a] font-heebo transition-colors"
                tabIndex={isLoading ? -1 : undefined}
              >
                שכחתי סיסמה
              </Link>
            </div>

            {/* Submit */}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={isLoading}
              className="w-full"
            >
              כניסה
            </Button>

            {/* Divider */}
            <div className="relative flex items-center gap-3">
              <div className="flex-1 h-px bg-[var(--border-default)]" />
              <span className="text-xs text-[var(--text-muted)] font-heebo">או</span>
              <div className="flex-1 h-px bg-[var(--border-default)]" />
            </div>

            {/* Google sign-in */}
            <GoogleSignInButton disabled={isLoading} />
          </form>
        </Card>

        {/* Footer credit */}
        <p className="text-center text-xs text-[var(--text-muted)] font-heebo mt-6">
          המרכז למורשת מרן
        </p>
      </div>
    </div>
  );
}
