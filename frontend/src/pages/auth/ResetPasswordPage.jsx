import React, { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Lock, Eye, EyeOff, CheckCircle, AlertTriangle, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Card from '../../components/ui/Card';

/* ────────────────────────────────────────
   Password strength engine
   4 bars: empty → red → orange → yellow → green
   Requirements: 8+ chars, uppercase, number, special char
──────────────────────────────────────── */
function analyzePassword(password) {
  if (!password) return { score: 0, checks: [] };

  const checks = [
    { key: 'length',  label: 'לפחות 8 תווים',          met: password.length >= 8 },
    { key: 'upper',   label: 'אות גדולה (A-Z)',          met: /[A-Z]/.test(password) },
    { key: 'digit',   label: 'ספרה (0-9)',               met: /[0-9]/.test(password) },
    { key: 'special', label: 'תו מיוחד (!@#$…)',         met: /[^A-Za-z0-9]/.test(password) },
  ];

  const score = checks.filter((c) => c.met).length; // 0-4
  return { score, checks };
}

const barConfigs = [
  { minScore: 1, color: 'bg-red-500',    label: 'חלשה מאוד' },
  { minScore: 2, color: 'bg-orange-500', label: 'חלשה' },
  { minScore: 3, color: 'bg-yellow-500', label: 'בינונית' },
  { minScore: 4, color: 'bg-emerald-500', label: 'חזקה' },
];

function PasswordStrengthIndicator({ password }) {
  const { score, checks } = analyzePassword(password);
  if (!password) return null;

  const currentBar = barConfigs[score - 1] || null;

  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      {/* 4 colored bars */}
      <div className="flex gap-1">
        {barConfigs.map((bar, i) => (
          <div
            key={bar.label}
            className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
              score >= i + 1 ? bar.color : 'bg-[var(--border-default)]'
            }`}
          />
        ))}
      </div>

      {/* Strength label */}
      {currentBar && (
        <p
          className={`text-xs font-heebo ${
            score === 4
              ? 'text-emerald-600 dark:text-emerald-400'
              : score === 3
              ? 'text-yellow-600 dark:text-yellow-400'
              : score === 2
              ? 'text-orange-600 dark:text-orange-400'
              : 'text-red-600 dark:text-red-400'
          }`}
        >
          עוצמת סיסמה: {currentBar.label}
        </p>
      )}

      {/* Requirement checklist — shown until all pass */}
      {score < 4 && (
        <ul className="space-y-0.5">
          {checks.map((c) => (
            <li
              key={c.key}
              className={`flex items-center gap-1.5 text-xs font-heebo transition-colors ${
                c.met
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-[var(--text-muted)]'
              }`}
            >
              <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center flex-shrink-0 ${
                c.met
                  ? 'bg-emerald-500 border-emerald-500'
                  : 'border-[var(--border-default)]'
              }`}>
                {c.met && (
                  <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                    <path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              {c.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Main page ── */
export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

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
            הגדרת סיסמה חדשה
          </h1>
          <p className="text-sm text-[var(--text-muted)] font-heebo mt-1">
            הזן את הסיסמה החדשה שלך
          </p>
        </div>

        <Card className="shadow-lg">
          {token ? (
            <NewPasswordForm token={token} navigate={navigate} />
          ) : (
            <InvalidTokenView />
          )}
        </Card>
      </div>
    </div>
  );
}

/* ── No token in URL ── */
function InvalidTokenView() {
  return (
    <div className="text-center py-4 flex flex-col items-center gap-4 animate-fade-in">
      <div className="flex items-center justify-center w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/30">
        <AlertTriangle size={28} className="text-red-600 dark:text-red-400" />
      </div>
      <div>
        <h2 className="text-base font-semibold text-[var(--text-primary)] font-heebo">
          קישור לא תקין
        </h2>
        <p className="text-sm text-[var(--text-muted)] font-heebo mt-1">
          הקישור חסר או פג תוקף.
        </p>
      </div>
      <Link
        to="/forgot-password"
        className="inline-flex items-center justify-center w-full h-12 px-6 rounded-lg bg-[#1B2B5E] text-white text-base font-medium font-heebo hover:bg-[#243a7d] transition-colors"
      >
        בקש קישור חדש
      </Link>
      <Link
        to="/login"
        className="text-sm text-[var(--text-muted)] hover:text-[#B8973A] font-heebo transition-colors"
      >
        חזרה לדף הכניסה
      </Link>
    </div>
  );
}

/* ── Token expired after submit attempt ── */
function ExpiredTokenView() {
  return (
    <div className="text-center py-4 flex flex-col items-center gap-4 animate-fade-in">
      <div className="flex items-center justify-center w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/30">
        <AlertTriangle size={28} className="text-amber-600 dark:text-amber-400" />
      </div>
      <div>
        <h2 className="text-base font-semibold text-[var(--text-primary)] font-heebo">
          הקישור פג תוקף
        </h2>
        <p className="text-sm text-[var(--text-muted)] font-heebo mt-1 leading-relaxed">
          קישור האיפוס אינו תקין או שפג תוקפו.
          <br />
          בקש קישור חדש וחזור תוך 30 דקות.
        </p>
      </div>
      <Link
        to="/forgot-password"
        className="inline-flex items-center justify-center w-full h-12 px-6 rounded-lg bg-[#1B2B5E] text-white text-base font-medium font-heebo hover:bg-[#243a7d] transition-colors"
      >
        בקש קישור חדש
      </Link>
      <Link
        to="/login"
        className="text-sm text-[var(--text-muted)] hover:text-[#B8973A] font-heebo transition-colors"
      >
        חזרה לדף הכניסה
      </Link>
    </div>
  );
}

/* ── Set new password form ── */
function NewPasswordForm({ token, navigate }) {
  const [form, setForm] = useState({ password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const validate = () => {
    const e = {};
    const { score } = analyzePassword(form.password);

    if (!form.password) {
      e.password = 'סיסמה חדשה נדרשת';
    } else if (form.password.length < 8) {
      e.password = 'סיסמה חייבת להכיל לפחות 8 תווים';
    } else if (score < 3) {
      e.password = 'הסיסמה חלשה מדי. הוסף אות גדולה, ספרה וסימן מיוחד';
    }
    if (!form.confirmPassword) {
      e.confirmPassword = 'אישור סיסמה נדרש';
    } else if (form.password !== form.confirmPassword) {
      e.confirmPassword = 'הסיסמאות אינן תואמות';
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
    setLoading(true);

    try {
      await api.post('/auth/reset-password', {
        token,
        newPassword: form.password,
      });
      setSuccess(true);
      toast.success('הסיסמה שונתה בהצלחה!');
      setTimeout(() => navigate('/login', { state: { passwordReset: true } }), 2500);
    } catch (err) {
      const status = err.response?.status;
      if (status === 400 || status === 410 || status === 404) {
        setTokenInvalid(true);
        return;
      }
      const message =
        err.response?.data?.message || 'שגיאה בשינוי הסיסמה. אנא נסה שוב.';
      setServerError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  if (tokenInvalid) return <ExpiredTokenView />;

  if (success) {
    return (
      <div className="text-center py-4 flex flex-col items-center gap-4 animate-fade-in">
        <div className="flex items-center justify-center w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/30">
          <CheckCircle size={28} className="text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)] font-heebo">
            הסיסמה שונתה בהצלחה!
          </h2>
          <p className="text-sm text-[var(--text-muted)] font-heebo mt-1">
            מעביר אותך לדף הכניסה...
          </p>
        </div>
      </div>
    );
  }

  return (
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

      {/* New password + show/hide */}
      <div className="flex flex-col gap-1.5">
        <div className="relative">
          <Input
            label="סיסמה חדשה"
            type={showPassword ? 'text' : 'password'}
            name="new-password"
            autoComplete="new-password"
            value={form.password}
            onChange={handleChange('password')}
            error={errors.password}
            startIcon={<Lock size={16} />}
            placeholder="לפחות 8 תווים"
            required
            disabled={loading}
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'הסתר סיסמה' : 'הצג סיסמה'}
            className="
              absolute top-1/2 left-3 -translate-y-1/2
              text-[var(--text-muted)] hover:text-[var(--text-secondary)]
              transition-colors duration-150 focus-visible:outline-none
            "
            style={{ marginTop: errors.password ? '-10px' : '0' }}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        <PasswordStrengthIndicator password={form.password} />
      </div>

      {/* Confirm password + show/hide */}
      <div className="relative">
        <Input
          label="אישור סיסמה"
          type={showConfirm ? 'text' : 'password'}
          name="confirm-password"
          autoComplete="new-password"
          value={form.confirmPassword}
          onChange={handleChange('confirmPassword')}
          error={errors.confirmPassword}
          startIcon={<Lock size={16} />}
          placeholder="חזור על הסיסמה"
          required
          disabled={loading}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShowConfirm((v) => !v)}
          aria-label={showConfirm ? 'הסתר סיסמה' : 'הצג סיסמה'}
          className="
            absolute top-1/2 left-3 -translate-y-1/2
            text-[var(--text-muted)] hover:text-[var(--text-secondary)]
            transition-colors duration-150 focus-visible:outline-none
          "
          style={{ marginTop: errors.confirmPassword ? '-10px' : '0' }}
        >
          {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        loading={loading}
        className="w-full"
      >
        שמור סיסמה חדשה
      </Button>

      <Link
        to="/login"
        className="text-center text-sm text-[var(--text-muted)] hover:text-[#B8973A] font-heebo transition-colors"
      >
        חזרה לדף הכניסה
      </Link>
    </form>
  );
}
