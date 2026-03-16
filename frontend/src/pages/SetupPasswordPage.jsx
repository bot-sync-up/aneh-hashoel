import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Lock, Eye, EyeOff, CheckCircle2, AlertCircle, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Card from '../components/ui/Card';

// Password strength evaluator
function getPasswordStrength(password) {
  if (!password) return { score: 0, label: '', color: '' };
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  const levels = [
    { score: 0, label: '', color: '' },
    { score: 1, label: 'חלשה מאוד', color: 'bg-red-500' },
    { score: 2, label: 'חלשה', color: 'bg-orange-500' },
    { score: 3, label: 'בינונית', color: 'bg-amber-500' },
    { score: 4, label: 'חזקה', color: 'bg-lime-500' },
    { score: 5, label: 'חזקה מאוד', color: 'bg-emerald-500' },
  ];
  return levels[Math.min(score, 5)];
}

function PasswordStrengthBar({ password }) {
  const { score, label, color } = getPasswordStrength(password);
  if (!password) return null;

  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-200 ${
              i <= score ? color : 'bg-gray-200 dark:bg-gray-700'
            }`}
          />
        ))}
      </div>
      {label && (
        <p className="text-xs font-heebo text-[var(--text-muted)]">
          עוצמת סיסמה: <span className="font-medium text-[var(--text-secondary)]">{label}</span>
        </p>
      )}
    </div>
  );
}

// Requirement checklist item
function Requirement({ met, label }) {
  return (
    <li className="flex items-center gap-2 text-xs font-heebo">
      <span
        className={`flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center transition-colors ${
          met
            ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400'
            : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600'
        }`}
      >
        <CheckCircle2 size={10} strokeWidth={2.5} />
      </span>
      <span className={met ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}>
        {label}
      </span>
    </li>
  );
}

export default function SetupPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { rabbi } = useAuth();

  const token = searchParams.get('token');

  const [form, setForm] = useState({
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [tokenValid, setTokenValid] = useState(null); // null=checking, true=valid, false=invalid
  const [done, setDone] = useState(false);

  // Verify token on mount
  useEffect(() => {
    const verify = async () => {
      if (!token) {
        // If no token, user might be setting up from profile (authenticated flow)
        if (rabbi) {
          setTokenValid(true);
        } else {
          setTokenValid(false);
        }
        return;
      }

      try {
        await api.get('/auth/verify-setup-token', { params: { token } });
        setTokenValid(true);
      } catch {
        setTokenValid(false);
      }
    };

    verify();
  }, [token, rabbi]);

  const passwordRequirements = [
    { met: form.password.length >= 8, label: 'לפחות 8 תווים' },
    { met: /[A-Z]/.test(form.password), label: 'אות גדולה אחת לפחות' },
    { met: /[0-9]/.test(form.password), label: 'ספרה אחת לפחות' },
    { met: form.password === form.confirmPassword && form.confirmPassword.length > 0, label: 'הסיסמאות תואמות' },
  ];

  const allRequirementsMet = passwordRequirements.every((r) => r.met);

  const validate = () => {
    const newErrors = {};
    if (!form.password) {
      newErrors.password = 'נדרשת סיסמה';
    } else if (form.password.length < 8) {
      newErrors.password = 'הסיסמה חייבת להכיל לפחות 8 תווים';
    } else if (!/[A-Z]/.test(form.password)) {
      newErrors.password = 'הסיסמה חייבת להכיל לפחות אות גדולה אחת';
    } else if (!/[0-9]/.test(form.password)) {
      newErrors.password = 'הסיסמה חייבת להכיל לפחות ספרה אחת';
    }

    if (!form.confirmPassword) {
      newErrors.confirmPassword = 'אנא אשר את הסיסמה';
    } else if (form.password !== form.confirmPassword) {
      newErrors.confirmPassword = 'הסיסמאות אינן תואמות';
    }

    return newErrors;
  };

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setLoading(true);
    try {
      const payload = { password: form.password };
      if (token) payload.token = token;

      await api.post('/auth/setup-password', payload);

      setDone(true);
      toast.success('הסיסמה הוגדרה בהצלחה!');

      // Redirect after short delay
      setTimeout(() => {
        navigate(rabbi ? '/' : '/login', { replace: true });
      }, 2500);
    } catch (err) {
      const message = err.response?.data?.message || 'שגיאה בהגדרת הסיסמה. אנא נסה שוב.';
      toast.error(message);
      setErrors({ server: message });
    } finally {
      setLoading(false);
    }
  };

  // Loading — verifying token
  if (tokenValid === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-page)]" dir="rtl">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-4 border-navy/20 border-t-navy animate-spin" />
          <p className="text-sm font-heebo text-[var(--text-muted)]">מאמת קישור...</p>
        </div>
      </div>
    );
  }

  // Invalid token
  if (tokenValid === false) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-page)]" dir="rtl">
        <div className="w-full max-w-sm text-center space-y-5">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 text-red-500">
            <AlertCircle size={32} strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--text-primary)] font-heebo">
              הקישור אינו תקין
            </h1>
            <p className="text-sm text-[var(--text-muted)] font-heebo mt-2">
              קישור הגדרת הסיסמה פג תוקף או שכבר נעשה בו שימוש.
            </p>
          </div>
          <Link
            to="/forgot-password"
            className="inline-block text-sm font-medium text-brand-gold hover:text-brand-gold-dark font-heebo transition-colors"
          >
            שלח קישור חדש
          </Link>
        </div>
      </div>
    );
  }

  // Success state
  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-page)]" dir="rtl">
        <div className="w-full max-w-sm text-center space-y-5 animate-fade-in">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-500">
            <CheckCircle2 size={32} strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--text-primary)] font-heebo">
              הסיסמה הוגדרה בהצלחה
            </h1>
            <p className="text-sm text-[var(--text-muted)] font-heebo mt-2">
              מעביר אותך {rabbi ? 'לדשבורד' : 'לדף הכניסה'}...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Setup form
  return (
    <div
      dir="rtl"
      className="relative min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-[#F8F6F1] via-[#f3f0e8] to-[#ede8da] dark:from-[var(--bg-page)] dark:via-[var(--bg-page)] dark:to-[var(--bg-surface)]"
    >
      {/* Background accents */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-[#1B2B5E]/5 dark:bg-[#1B2B5E]/20" />
        <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-[#B8973A]/8 dark:bg-[#B8973A]/10" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#1B2B5E] shadow-lg mb-4">
            <ShieldCheck size={28} className="text-white" strokeWidth={1.75} />
          </div>
          <h1 className="text-2xl font-bold text-[#1B2B5E] dark:text-[var(--text-primary)] font-heebo tracking-tight">
            הגדרת סיסמה
          </h1>
          <p className="text-sm text-[var(--text-muted)] font-heebo mt-1">
            צור סיסמה חזקה לחשבונך
          </p>
        </div>

        <Card className="shadow-lg">
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
            {errors.server && (
              <div
                role="alert"
                className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md px-3 py-2.5 text-sm text-red-700 dark:text-red-400 font-heebo animate-fade-in"
              >
                <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                <span>{errors.server}</span>
              </div>
            )}

            <div className="space-y-2">
              <Input
                label="סיסמה חדשה"
                type="password"
                name="password"
                autoComplete="new-password"
                value={form.password}
                onChange={handleChange('password')}
                error={errors.password}
                startIcon={<Lock size={16} />}
                placeholder="לפחות 8 תווים"
                required
                disabled={loading}
              />
              <PasswordStrengthBar password={form.password} />
            </div>

            <Input
              label="אישור סיסמה"
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={handleChange('confirmPassword')}
              error={errors.confirmPassword}
              startIcon={<Lock size={16} />}
              placeholder="הזן שוב את הסיסמה"
              required
              disabled={loading}
            />

            {/* Requirements checklist */}
            {(form.password || form.confirmPassword) && (
              <div className="bg-[var(--bg-muted)] rounded-lg px-4 py-3 animate-fade-in">
                <p className="text-xs font-semibold font-heebo text-[var(--text-secondary)] mb-2">
                  דרישות סיסמה:
                </p>
                <ul className="space-y-1.5">
                  {passwordRequirements.map((req, i) => (
                    <Requirement key={i} met={req.met} label={req.label} />
                  ))}
                </ul>
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={loading}
              disabled={!allRequirementsMet && (form.password.length > 0 || form.confirmPassword.length > 0)}
              className="w-full mt-1"
            >
              הגדר סיסמה
            </Button>

            {!rabbi && (
              <Link
                to="/login"
                className="text-center text-sm text-[var(--text-muted)] hover:text-brand-gold font-heebo transition-colors"
              >
                חזרה לדף הכניסה
              </Link>
            )}
          </form>
        </Card>
      </div>
    </div>
  );
}
