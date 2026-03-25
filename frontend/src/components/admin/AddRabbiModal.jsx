import React, { useState } from 'react';
import { clsx } from 'clsx';
import { CheckCircle, UserPlus } from 'lucide-react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { post } from '../../lib/api';

const INITIAL = {
  name: '',
  email: '',
  phone: '',
  role: 'rabbi',
  signature: '',
};

export default function AddRabbiModal({ isOpen, onClose, onSuccess }) {
  const [form, setForm] = useState(INITIAL);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const set = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'שם הרב חובה';
    if (!form.email.trim()) e.email = 'כתובת מייל חובה';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'כתובת מייל אינה תקינה';
    if (form.phone && !/^[\d\-\+\s]{7,15}$/.test(form.phone)) e.phone = 'מספר טלפון אינו תקין';
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setLoading(true);
    try {
      await post('/admin/rabbis', form);
      setSuccess(true);
    } catch (err) {
      setErrors({ submit: err?.response?.data?.message || 'שגיאה בהוספת הרב' });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (success) onSuccess?.();
    else onClose?.();
    setTimeout(() => { setForm(INITIAL); setErrors({}); setSuccess(false); }, 300);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={success ? '' : 'הוספת רב חדש'}
      size="md"
    >
      {success ? (
        <div className="flex flex-col items-center gap-4 py-6 text-center font-heebo">
          <CheckCircle size={52} className="text-emerald-500" strokeWidth={1.5} />
          <h3 className="text-lg font-bold text-[var(--text-primary)]">הרב נוסף בהצלחה!</h3>
          <p className="text-sm text-[var(--text-secondary)]">
            נשלח מייל הגדרת סיסמא לרב לכתובת{' '}
            <strong className="text-[#1B2B5E]">{form.email}</strong>
          </p>
          <Button variant="primary" onClick={handleClose}>
            סגור
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 font-heebo" dir="rtl" noValidate>
          {errors.submit && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {errors.submit}
            </div>
          )}

          <Input
            label="שם הרב"
            required
            value={form.name}
            onChange={set('name')}
            error={errors.name}
            placeholder="הרב ישראל ישראלי"
          />

          <Input
            label="כתובת מייל"
            type="email"
            required
            value={form.email}
            onChange={set('email')}
            error={errors.email}
            placeholder="rabbi@merkaz.org"
          />

          <Input
            label="טלפון"
            type="tel"
            value={form.phone}
            onChange={set('phone')}
            error={errors.phone}
            placeholder="050-0000000"
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--text-primary)]">
              תפקיד <span className="text-red-500 mr-1">*</span>
            </label>
            <select
              value={form.role}
              onChange={set('role')}
              className="h-10 w-full px-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] focus:border-[#B8973A]"
            >
              <option value="rabbi">רב</option>
              <option value="admin">מנהל</option>
              <option value="customer_service">שירות לקוחות</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--text-primary)]">
              חתימה (תוצג בתשובות)
            </label>
            <textarea
              value={form.signature}
              onChange={set('signature')}
              rows={3}
              placeholder="הרב ישראל ישראלי, דיין בבית הדין..."
              className="w-full px-3 py-2.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] focus:border-[#B8973A] resize-none direction-rtl"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" type="button" onClick={onClose} disabled={loading}>
              ביטול
            </Button>
            <Button
              variant="primary"
              type="submit"
              loading={loading}
              leftIcon={<UserPlus size={16} />}
            >
              הוסף רב
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
