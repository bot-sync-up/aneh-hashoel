import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Card from '../components/ui/Card';
import { Mail, Lock } from 'lucide-react';
import toast from 'react-hot-toast';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  const { login, loading } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');

  const validate = () => {
    const e = {};
    if (!form.email.trim()) {
      e.email = 'כתובת אימייל נדרשת';
    } else if (!EMAIL_REGEX.test(form.email.trim())) {
      e.email = 'כתובת אימייל אינה תקינה';
    }
    if (!form.password) {
      e.password = 'סיסמה נדרשת';
    } else if (form.password.length < 6) {
      e.password = 'סיסמה חייבת להכיל לפחות 6 תווים';
    }
    return e;
  };

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    // Clear field error on change
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

    const result = await login({
      email: form.email.trim(),
      password: form.password,
    });

    if (result.success) {
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

    // Show error
    const message = result.message || 'שגיאה בהתחברות. אנא נסה שוב.';
    setServerError(message);
    toast.error(message);
  };

  const handleGoogleLogin = () => {
    const apiUrl = import.meta.env.VITE_API_URL || '/api';
    window.location.href = `${apiUrl}/auth/google`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-page)] p-4">
      <div className="w-full max-w-sm animate-fade-in-up">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-brand-navy mb-4 shadow-lg">
            <span className="text-brand-gold font-bold text-2xl font-heebo">
              ע
            </span>
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] font-heebo">
            ענה את השואל
          </h1>
          <p className="text-[var(--text-muted)] text-sm font-heebo mt-1">
            פלטפורמת שאלות ותשובות לרבנים
          </p>
        </div>

        <Card>
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            {/* Server error banner */}
            {serverError && (
              <div
                className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md px-3 py-2 text-sm text-red-700 dark:text-red-400 font-heebo"
                role="alert"
              >
                {serverError}
              </div>
            )}

            <Input
              label="אימייל"
              type="email"
              name="email"
              autoComplete="email"
              value={form.email}
              onChange={handleChange('email')}
              error={errors.email}
              startIcon={<Mail size={16} />}
              placeholder="rabbi@example.com"
              required
            />

            <Input
              label="סיסמה"
              type="password"
              name="password"
              autoComplete="current-password"
              value={form.password}
              onChange={handleChange('password')}
              error={errors.password}
              startIcon={<Lock size={16} />}
              required
            />

            {/* Forgot password link */}
            <div className="flex justify-start">
              <Link
                to="/reset-password"
                className="text-sm text-brand-gold hover:text-brand-gold-dark font-heebo transition-colors"
              >
                שכחת סיסמה?
              </Link>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={loading}
              className="w-full"
            >
              כניסה למערכת
            </Button>

            {/* Divider */}
            <div className="divider-text font-heebo">או</div>

            {/* Google login */}
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full"
              onClick={handleGoogleLogin}
              leftIcon={
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
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
              }
            >
              כניסה עם Google
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
