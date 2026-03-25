import React, { useState } from 'react';
import { Headphones, Send, CheckCircle } from 'lucide-react';
import PageHeader from '../components/layout/PageHeader';
import Button from '../components/ui/Button';
import { post } from '../lib/api';

export default function SupportPage() {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;

    setSending(true);
    setError(null);
    try {
      await post('/support/contact', {
        subject: subject.trim(),
        message: message.trim(),
      });
      setSent(true);
      setSubject('');
      setMessage('');
    } catch (err) {
      setError(err?.response?.data?.error || 'שגיאה בשליחת הפנייה');
    } finally {
      setSending(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2.5 text-sm font-heebo rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-transparent transition-colors duration-150';

  return (
    <div className="page-enter" dir="rtl">
      <PageHeader
        title="פניה לניהול"
        subtitle="שלח הודעה למנהלי המערכת"
      />

      <div className="p-6 max-w-lg">
        {sent ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
              <CheckCircle size={28} className="text-emerald-600" />
            </div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)] font-heebo mb-2">
              הפנייה נשלחה בהצלחה
            </h3>
            <p className="text-sm text-[var(--text-muted)] font-heebo mb-4">
              מנהלי המערכת יחזרו אליך בהקדם
            </p>
            <Button variant="outline" onClick={() => setSent(false)}>
              שלח פנייה נוספת
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 font-heebo">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold font-heebo text-[var(--text-primary)]">
                נושא <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="נושא הפנייה..."
                maxLength={200}
                required
                dir="rtl"
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold font-heebo text-[var(--text-primary)]">
                הודעה <span className="text-red-500">*</span>
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="תאר את הנושא בפירוט..."
                rows={6}
                required
                dir="rtl"
                className={`${inputClass} resize-y`}
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              loading={sending}
              disabled={!subject.trim() || !message.trim()}
              leftIcon={<Send size={15} />}
            >
              שלח פנייה
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
