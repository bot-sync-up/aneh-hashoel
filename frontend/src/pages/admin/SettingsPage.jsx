import React, { useState, useEffect } from 'react';
import { clsx } from 'clsx';
import {
  Clock,
  Calendar,
  Sun,
  MessageSquare,
  Save,
  Lock,
  CheckCircle,
} from 'lucide-react';
import Button from '../../components/ui/Button';
import { get, put } from '../../lib/api';

const DAYS_HE = [
  { value: 0, label: 'ראשון' },
  { value: 1, label: 'שני' },
  { value: 2, label: 'שלישי' },
  { value: 3, label: 'רביעי' },
  { value: 4, label: 'חמישי' },
  { value: 5, label: 'שישי' },
  { value: 6, label: 'שבת' },
];

// ─── Section wrapper ───────────────────────────────────────────────────────
function Section({ icon: Icon, title, description, children }) {
  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-surface-raised)]">
        <div className="w-8 h-8 rounded-lg bg-[#1B2B5E]/10 flex items-center justify-center">
          <Icon size={16} className="text-[#1B2B5E]" />
        </div>
        <div>
          <h3 className="font-bold text-[var(--text-primary)] font-heebo text-sm">{title}</h3>
          {description && <p className="text-xs text-[var(--text-muted)] font-heebo mt-0.5">{description}</p>}
        </div>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

// ─── Time picker ───────────────────────────────────────────────────────────
function TimePicker({ label, value, onChange }) {
  const [h, m] = (value || '09:00').split(':');
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-sm font-medium font-heebo text-[var(--text-primary)]">{label}</label>}
      <div className="flex items-center gap-2">
        <select
          value={h}
          onChange={(e) => onChange(`${e.target.value}:${m}`)}
          className="h-10 w-20 px-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm font-heebo text-[var(--text-primary)] text-center focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
        >
          {[...Array(24)].map((_, i) => (
            <option key={i} value={String(i).padStart(2, '0')}>
              {String(i).padStart(2, '0')}
            </option>
          ))}
        </select>
        <span className="text-[var(--text-muted)] font-bold">:</span>
        <select
          value={m}
          onChange={(e) => onChange(`${h}:${e.target.value}`)}
          className="h-10 w-20 px-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm font-heebo text-[var(--text-primary)] text-center focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
        >
          {['00', '15', '30', '45'].map((min) => (
            <option key={min} value={min}>{min}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

const DEFAULT_SETTINGS = {
  lockTimeoutHours: 4,
  weeklyReportDay: 0,
  weeklyReportTime: '08:00',
  dailySummaryTime: '20:00',
  maxFollowUps: 1,
};

// ─── Main page ─────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    get('/admin/system/settings')
      .then((data) => setSettings({ ...DEFAULT_SETTINGS, ...data }))
      .catch(() => setSettings(DEFAULT_SETTINGS))
      .finally(() => setLoading(false));
  }, []);

  const set = (field) => (val) => setSettings((s) => ({ ...s, [field]: val }));

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await put('/admin/system/settings', settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err?.response?.data?.message || 'שגיאה בשמירת ההגדרות');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 max-w-2xl">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-6">
            <div className="skeleton h-4 w-40 rounded mb-4" />
            <div className="skeleton h-10 w-full rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-2xl" dir="rtl">
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)] font-heebo">הגדרות מערכת</h2>
        <p className="text-sm text-[var(--text-muted)] font-heebo mt-0.5">שינויים ישמרו לכל הרבנים והמשתמשים</p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 font-heebo">
          {error}
        </div>
      )}

      {saved && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700 font-heebo animate-fade-in">
          <CheckCircle size={16} /> ההגדרות נשמרו בהצלחה
        </div>
      )}

      {/* Lock timeout */}
      <Section
        icon={Clock}
        title="זמן נעילה"
        description="כמה שעות עד שנעילת שאלה על-ידי רב פוקעת אוטומטית"
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-heebo text-[var(--text-primary)]">
              נעילה תפקע אחרי{' '}
              <strong className="text-[#1B2B5E] text-base">{settings.lockTimeoutHours}</strong>{' '}
              שעות
            </span>
            <span className="text-xs text-[var(--text-muted)] font-heebo">1 – 24 שעות</span>
          </div>
          <input
            type="range"
            min={1}
            max={24}
            value={settings.lockTimeoutHours}
            onChange={(e) => set('lockTimeoutHours')(Number(e.target.value))}
            className="w-full h-2 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to left, #1B2B5E ${((settings.lockTimeoutHours - 1) / 23) * 100}%, #D8D2C4 ${((settings.lockTimeoutHours - 1) / 23) * 100}%)`,
            }}
          />
          <div className="flex justify-between text-xs text-[var(--text-muted)] font-heebo">
            <span>שעה אחת</span><span>24 שעות</span>
          </div>
        </div>
      </Section>

      {/* Weekly report */}
      <Section
        icon={Calendar}
        title="דוח שבועי"
        description="מתי לשלוח את הדוח השבועי לרבנים"
      >
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium font-heebo text-[var(--text-primary)]">יום בשבוע</label>
            <select
              value={settings.weeklyReportDay}
              onChange={(e) => set('weeklyReportDay')(Number(e.target.value))}
              className="h-10 px-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm font-heebo text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
            >
              {DAYS_HE.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <TimePicker
            label="שעה"
            value={settings.weeklyReportTime}
            onChange={set('weeklyReportTime')}
          />
        </div>
      </Section>

      {/* Daily summary */}
      <Section
        icon={Sun}
        title="סיכום יומי"
        description="שעת שליחת הסיכום היומי לרבנים"
      >
        <TimePicker
          label="שעת שליחה"
          value={settings.dailySummaryTime}
          onChange={set('dailySummaryTime')}
        />
      </Section>

      {/* Follow-up limit */}
      <Section
        icon={MessageSquare}
        title="שאלת המשך"
        description="מספר שאלות המשך המותרות לכל שאלה"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 h-10 px-4 rounded-md border border-[var(--border-default)] bg-[var(--bg-muted)] text-sm font-heebo text-[var(--text-secondary)]">
            <Lock size={14} className="text-[var(--text-muted)]" />
            <span>מספר מקסימלי: <strong>1</strong></span>
          </div>
        </div>
      </Section>

      {/* Save button */}
      <div className="flex justify-end">
        <Button
          variant="primary"
          loading={saving}
          onClick={handleSave}
          leftIcon={<Save size={16} />}
        >
          שמור הגדרות
        </Button>
      </div>

      {/* Emergency broadcast moved to separate tab */}
    </div>
  );
}
