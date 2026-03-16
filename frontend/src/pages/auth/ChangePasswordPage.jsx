import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Info, CheckCircle, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Card from '../../components/ui/Card';

/* ── Password strength ── */
function getPasswordStrength(password) {
  if (!password) return null;
  const length = password.length;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const varietyScore = [hasUpper, hasLower, hasDigit, hasSpecial].filter(Boolean).length;

  if (length >= 12 && varietyScore >= 3) return 'strong';
  if (length >= 8 && varietyScore >= 2) return 'medium';
  return 'weak';
}

const strengthConfig = {
  weak:   { label: 'חלשה',    color: 'bg-red-500',    textColor: 'text-red-600 dark:text-red-400',       bars: 1 },
  medium: { label: 'בינונית', color: 'bg-yellow-500', textColor: 'text-yellow-600 dark:text-yellow-400', bars: 2 },
  strong: { label: 'חזקה',    color: 'bg-emerald-500',textColor: 'text-emerald-600 dark:text-emerald-400', bars: 3 },
};

function PasswordStrengthBar({ password }) {
  const strength = getPasswordStrength(password);
  if (!strength) return null;
  const cfg = strengthConfig[strength];

  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      <div className="flex gap-1">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
              i <= cfg.bars ? cfg.color : 'bg-[var(--border-default)]'
            }`}
          />
        ))}
      </div>
      <p className={`text-xs font-heebo ${cfg.textColor}`}>
        עוצמת סיסמה: {cfg.label}
      </p>
    </div>
  );
}

/* ── Main page ── */
export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const { updateRabbi } = useAuth();

  const [form, setForm] = useState({ password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const validate = () => {
    const e = {};
    if (!form.password) {
      e.password = 'סיסמה חדשה נדרשת';
    } else if (form.password.length < 8) {
      e.password = 'סיסמה חייבת להכיל לפחות 8 תווים';
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
      await api.post('/auth/change-password', {
        password: form.password,
        confirmPassword: form.confirmPassword,
      });

      // Clear the must_change_password flag from auth state
      updateRabbi({ must_change_password: false, mustChangePassword: false });

      setSuccess(true);
      toast.success('הסיסמה הוגדרה בהצלחה!');
      setTimeout(() => navigate('/dashboard', { replace: true }), 2000);
    } catch (err) {
      const message =
        err.response?.data?.message || 'שגיאה בהגדרת הסיסמה. אנא נסה שוב.';
      setServerError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div
        dir="rtl"
        className="min-h-screen flex items-center justify-center bg-[#F8F6F1] dark:bg-[var(--bg-page)] p-4"
      >
        <div className="w-full max-w-sm">
          <Card>
            <div className="text-center py-6 flex flex-col items-center gap-4">
              <div className="flex items-center justify-center w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                <CheckCircle size={28} className="text-emerald-600 dark:text-emerald-400" />
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

  return (
    <div
      dir="rtl"
      className="min-h-screen flex items-center justify-center bg-[#F8F6F1] dark:bg-[var(--bg-page)] p-4"
    >
      <div className="w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <img
            src="/logo.png"
            alt="ענה את השואל"
            className="h-16 w-auto mx-auto mb-4 object-contain"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          <h1 className="text-2xl font-bold text-[#1B2B5E] dark:text-[var(--text-primary)] font-heebo">
            הגדרת סיסמה אישית
          </h1>
        </div>

        <Card>
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            {/* Info banner — mandatory, no skip */}
            <div className="flex items-start gap-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md px-3 py-3">
              <Info
                size={17}
                className="text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0"
              />
              <p className="text-sm text-blue-700 dark:text-blue-300 font-heebo leading-relaxed">
                כניסה ראשונה — נדרש להגדיר סיסמה אישית לפני המשך השימוש במערכת.
              </p>
            </div>

            {/* Server error */}
            {serverError && (
              <div
                role="alert"
                className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md px-3 py-2.5 text-sm text-red-700 dark:text-red-400 font-heebo"
              >
                <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                <span>{serverError}</span>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Input
                label="סיסמה חדשה"
                type="password"
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
              <PasswordStrengthBar password={form.password} />
            </div>

            <Input
              label="אישור סיסמה"
              type="password"
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

            {/* Password requirements hint */}
            <ul className="text-xs text-[var(--text-muted)] font-heebo list-disc list-inside space-y-0.5 pe-1">
              <li>לפחות 8 תווים</li>
              <li>מומלץ: אותיות גדולות, ספרות וסימנים</li>
            </ul>

            {/* Submit — no back/skip button */}
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
      </div>
    </div>
  );
}
