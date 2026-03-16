import React, { useState, useMemo } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Card from '../components/ui/Card';
import { Mail, Lock, ArrowRight, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  // Determine which step to show based on token presence
  const hasToken = Boolean(token);

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
            {hasToken ? 'הגדרת סיסמה חדשה' : 'איפוס סיסמה'}
          </h1>
          <p className="text-[var(--text-muted)] text-sm font-heebo mt-1">
            {hasToken
              ? 'הזן את הסיסמה החדשה שלך'
              : 'הזן את כתובת האימייל שלך לקבלת קישור איפוס'}
          </p>
        </div>

        <Card>
          {hasToken ? (
            <NewPasswordForm token={token} navigate={navigate} />
          ) : (
            <RequestResetForm />
          )}
        </Card>
      </div>
    </div>
  );
}

/* ─── Step 1: Request password reset email ─── */
function RequestResetForm() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('כתובת אימייל נדרשת');
      return;
    }
    if (!EMAIL_REGEX.test(email.trim())) {
      setError('כתובת אימייל אינה תקינה');
      return;
    }
    setError('');
    setLoading(true);

    try {
      await api.post('/auth/reset-password', { email: email.trim() });
      setSent(true);
      toast.success('קישור לאיפוס סיסמה נשלח לאימייל שלך');
    } catch (err) {
      const message =
        err.response?.data?.message || 'שגיאה בשליחת הבקשה. אנא נסה שוב.';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="text-center py-4">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 mb-3">
          <Mail size={24} className="text-emerald-600 dark:text-emerald-400" />
        </div>
        <h3 className="text-base font-semibold text-[var(--text-primary)] font-heebo mb-2">
          הבקשה נשלחה בהצלחה
        </h3>
        <p className="text-sm text-[var(--text-secondary)] font-heebo">
          אם הכתובת קיימת במערכת, נשלח אליך קישור לאיפוס הסיסמה. בדוק את תיבת
          הדואר שלך.
        </p>
        <Link
          to="/login"
          className="inline-flex items-center gap-1 text-sm font-medium text-brand-gold hover:text-brand-gold-dark mt-5 font-heebo transition-colors"
        >
          <ArrowRight size={14} />
          חזרה לדף הכניסה
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <Input
        label="כתובת אימייל"
        type="email"
        name="email"
        autoComplete="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (error) setError('');
        }}
        error={error}
        startIcon={<Mail size={16} />}
        placeholder="rabbi@example.com"
        required
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
        className="text-center text-sm text-[var(--text-muted)] hover:text-brand-gold font-heebo transition-colors"
      >
        חזרה לדף הכניסה
      </Link>
    </form>
  );
}

/* ─── Step 2: Set new password (via token) ─── */
function NewPasswordForm({ token, navigate }) {
  const [form, setForm] = useState({ password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
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
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationErrors = validate();
    if (Object.keys(validationErrors).length) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    setLoading(true);

    try {
      await api.post('/auth/reset-password/confirm', {
        token,
        password: form.password,
      });
      setSuccess(true);
      toast.success('הסיסמה שונתה בהצלחה!');
      // Redirect to login after a short delay
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      const status = err.response?.status;
      if (status === 400 || status === 410) {
        // Token invalid or expired
        toast.error('הקישור פג תוקף או שאינו תקין');
        navigate('/link-expired');
        return;
      }
      const message =
        err.response?.data?.message || 'שגיאה בשינוי הסיסמה. אנא נסה שוב.';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="text-center py-4">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 mb-3">
          <CheckCircle
            size={24}
            className="text-emerald-600 dark:text-emerald-400"
          />
        </div>
        <h3 className="text-base font-semibold text-[var(--text-primary)] font-heebo mb-2">
          הסיסמה שונתה בהצלחה!
        </h3>
        <p className="text-sm text-[var(--text-muted)] font-heebo">
          מעביר אותך לדף הכניסה...
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <Input
        label="סיסמה חדשה"
        type="password"
        name="new-password"
        autoComplete="new-password"
        value={form.password}
        onChange={handleChange('password')}
        error={errors.password}
        startIcon={<Lock size={16} />}
        required
      />
      <Input
        label="אישור סיסמה"
        type="password"
        name="confirm-password"
        autoComplete="new-password"
        value={form.confirmPassword}
        onChange={handleChange('confirmPassword')}
        error={errors.confirmPassword}
        startIcon={<Lock size={16} />}
        required
      />
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
        className="text-center text-sm text-[var(--text-muted)] hover:text-brand-gold font-heebo transition-colors"
      >
        חזרה לדף הכניסה
      </Link>
    </form>
  );
}
