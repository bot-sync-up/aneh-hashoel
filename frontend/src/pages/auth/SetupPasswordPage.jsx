import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Eye, EyeOff, Sparkles, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Card from '../../components/ui/Card';

/* ────────────────────────────────────────
   Password strength engine (4 bars)
   Requirements: 8+ chars, uppercase, number, special char
──────────────────────────────────────── */
function analyzePassword(password) {
  if (!password) return { score: 0, checks: [] };

  const checks = [
    { key: 'length',  label: 'לפחות 8 תווים',       met: password.length >= 8 },
    { key: 'upper',   label: 'אות גדולה (A-Z)',       met: /[A-Z]/.test(password) },
    { key: 'digit',   label: 'ספרה (0-9)',            met: /[0-9]/.test(password) },
    { key: 'special', label: 'תו מיוחד (!@#$…)',      met: /[^A-Za-z0-9]/.test(password) },
  ];

  const score = checks.filter((c) => c.met).length;
  return { score, checks };
}

const barConfigs = [
  { color: 'bg-red-500',     label: 'חלשה מאוד' },
  { color: 'bg-orange-500',  label: 'חלשה' },
  { color: 'bg-yellow-500',  label: 'בינונית' },
  { color: 'bg-emerald-500', label: 'חזקה' },
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

      {/* Requirements checklist until all pass */}
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
              <span
                className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center flex-shrink-0 ${
                  c.met
                    ? 'bg-emerald-500 border-emerald-500'
                    : 'border-[var(--border-default)]'
                }`}
              >
                {c.met && (
                  <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                    <path
                      d="M1 3L3 5L7 1"
                      stroke="white"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
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
export default function SetupPasswordPage() {
  const navigate = useNavigate();
  const { updateRabbi, rabbi } = useAuth();

  const [form, setForm] = useState({ password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
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
      await api.post('/auth/setup-password', {
        password: form.password,
        confirmPassword: form.confirmPassword,
      });

      // Clear the must_change_password flag from auth state
      updateRabbi({ must_change_password: false, mustChangePassword: false });

      setSuccess(true);
      toast.success('הסיסמה הוגדרה בהצלחה!');
      setTimeout(() => navigate('/', { replace: true }), 2000);
    } catch (err) {
      const message =
        err.response?.data?.message || 'שגיאה בהגדרת הסיסמה. אנא נסה שוב.';
      setServerError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  // Success screen
  if (success) {
    return (
      <div
        dir="rtl"
        className="
          relative min-h-screen flex items-center justify-center p-4
          bg-gradient-to-br from-[#F8F6F1] via-[#f3f0e8] to-[#ede8da]
          dark:from-[var(--bg-page)] dark:via-[var(--bg-page)] dark:to-[var(--bg-surface)]
        "
      >
        <div className="relative z-10 w-full max-w-sm">
          <Card className="shadow-lg">
            <div className="text-center py-6 flex flex-col items-center gap-4 animate-fade-in">
              <div className="relative">
                <span className="absolute w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 animate-ping opacity-30" aria-hidden="true" />
                <div className="relative flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/40">
                  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                    <circle cx="16" cy="16" r="14" stroke="#059669" strokeWidth="2" fill="none" className="dark:stroke-emerald-400" />
                    <path d="M10 16.5L14 20.5L22 12" stroke="#059669" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="dark:stroke-emerald-400" />
                  </svg>
                </div>
              </div>
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)] font-heebo">
                  הסיסמה הוגדרה בהצלחה!
                </h2>
                <p className="text-sm text-[var(--text-muted)] font-heebo mt-1">
                  מעביר אותך ללוח הבקרה...
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  const firstNameDisplay = rabbi?.firstName || rabbi?.name?.split(' ')[0] || '';

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
        {/* Gold sparkles */}
        <div className="absolute top-1/4 left-1/4 w-2 h-2 rounded-full bg-[#B8973A]/25" />
        <div className="absolute top-1/3 right-1/3 w-1.5 h-1.5 rounded-full bg-[#B8973A]/20" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo / Warm welcome brand area */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#1B2B5E] shadow-lg mb-4 relative">
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
            {/* Gold sparkle badge */}
            <span className="absolute -top-1 -left-1 w-5 h-5 rounded-full bg-[#B8973A] flex items-center justify-center shadow">
              <Sparkles size={10} className="text-white" />
            </span>
          </div>

          {/* Warm welcome headline */}
          <h1 className="text-2xl font-bold text-[#1B2B5E] dark:text-[var(--text-primary)] font-heebo tracking-tight">
            {firstNameDisplay ? `ברוך הבא, ${firstNameDisplay}!` : 'ברוך הבא לפורטל הרבנים!'}
          </h1>
          <p className="text-sm text-[var(--text-muted)] font-heebo mt-1">
            כניסה ראשונה — הגדר סיסמה אישית כדי להמשיך
          </p>
        </div>

        <Card className="shadow-lg">
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            {/* First-login info banner */}
            <div className="flex items-start gap-2.5 bg-[#1B2B5E]/8 dark:bg-[#1B2B5E]/25 border border-[#1B2B5E]/20 dark:border-[#1B2B5E]/40 rounded-md px-3 py-3">
              <Sparkles
                size={16}
                className="text-[#B8973A] mt-0.5 flex-shrink-0"
              />
              <p className="text-sm text-[#1B2B5E] dark:text-[var(--text-secondary)] font-heebo leading-relaxed">
                ברוך הבא לפורטל הרבנים. הגדר סיסמה אישית חזקה לאבטחת חשבונך.
              </p>
            </div>

            {/* Server error */}
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

            {/* Submit — no back/skip */}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={loading}
              className="w-full mt-1"
            >
              הגדר סיסמה וכנס למערכת
            </Button>
          </form>
        </Card>

        <p className="text-center text-xs text-[var(--text-muted)] font-heebo mt-6">
          המרכז למורשת מרן
        </p>
      </div>
    </div>
  );
}
