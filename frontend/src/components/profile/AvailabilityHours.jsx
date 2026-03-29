import React, { useState, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import { Clock, Save, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import Button from '../ui/Button';

// ── Constants ────────────────────────────────────────────────────────────────

const DAYS = [
  { key: 'sun', label: 'ראשון' },
  { key: 'mon', label: 'שני' },
  { key: 'tue', label: 'שלישי' },
  { key: 'wed', label: 'רביעי' },
  { key: 'thu', label: 'חמישי' },
  { key: 'fri', label: 'שישי' },
  { key: 'sat', label: 'שבת' },
];

const DEFAULT_START = '08:00';
const DEFAULT_END = '22:00';

function buildDefaultHours() {
  const hours = {};
  for (const { key } of DAYS) {
    hours[key] = { enabled: true, start: DEFAULT_START, end: DEFAULT_END };
  }
  return hours;
}

// ── Toggle switch (reused from VacationMode pattern) ─────────────────────────

function SmallToggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={clsx(
        'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full',
        'border-2 border-transparent transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2',
        checked ? 'bg-brand-navy dark:bg-brand-gold' : 'bg-gray-300 dark:bg-gray-600',
        disabled && 'opacity-60 cursor-not-allowed'
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          'pointer-events-none inline-block h-5 w-5 transform rounded-full',
          'bg-white shadow-sm ring-0 transition-transform duration-200',
          checked ? 'translate-x-0' : 'translate-x-5'
        )}
      />
    </button>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function AvailabilityHours() {
  const [hours, setHours] = useState(buildDefaultHours);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // 'success' | 'error'
  const [error, setError] = useState(null);

  // ── Load availability ──────────────────────────────────────────────────────

  const fetchAvailability = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/rabbis/profile/availability');
      const saved = data?.availability_hours;

      // If saved data has the new format (with enabled/start/end), use it
      if (saved && typeof saved === 'object') {
        const hasNewFormat = Object.values(saved).some(
          (v) => v !== null && typeof v === 'object' && v.enabled !== undefined
        );
        if (hasNewFormat) {
          // Merge with defaults so missing days still appear
          const merged = buildDefaultHours();
          for (const { key } of DAYS) {
            if (saved[key] && typeof saved[key] === 'object' && saved[key].enabled !== undefined) {
              merged[key] = {
                enabled: saved[key].enabled ?? true,
                start: saved[key].start || DEFAULT_START,
                end: saved[key].end || DEFAULT_END,
              };
            }
          }
          setHours(merged);
        }
        // else: old format (all nulls) — keep defaults
      }
    } catch {
      // Non-fatal — keep defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAvailability();
  }, [fetchAvailability]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleToggle = (dayKey, enabled) => {
    setHours((prev) => ({
      ...prev,
      [dayKey]: { ...prev[dayKey], enabled },
    }));
    setSaveStatus(null);
  };

  const handleTimeChange = (dayKey, field, value) => {
    setHours((prev) => ({
      ...prev,
      [dayKey]: { ...prev[dayKey], [field]: value },
    }));
    setSaveStatus(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus(null);
    setError(null);
    try {
      await api.put('/rabbis/profile/availability', {
        availability_hours: hours,
      });
      setSaveStatus('success');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'שגיאה בשמירה. נסה שוב.');
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin text-brand-navy dark:text-brand-gold" aria-label="טוען" />
      </div>
    );
  }

  const inputCls = clsx(
    'block w-24 px-2 py-1.5 rounded-lg border text-sm font-heebo text-center',
    'bg-[var(--bg-surface)] text-[var(--text-primary)]',
    'border-[var(--border-default)]',
    'focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-brand-gold',
    'transition-colors duration-150'
  );

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Clock className="w-5 h-5 text-brand-navy dark:text-brand-gold" aria-hidden="true" />
        <div>
          <h3 className="text-base font-semibold font-heebo text-[var(--text-primary)]">
            שעות זמינות
          </h3>
          <p className="text-sm text-[var(--text-muted)] font-heebo">
            הגדר באילו ימים ושעות תרצה לקבל התראות על שאלות חדשות
          </p>
        </div>
      </div>

      {/* Days grid */}
      <div className="space-y-2">
        {DAYS.map(({ key, label }) => {
          const day = hours[key];
          return (
            <div
              key={key}
              className={clsx(
                'flex items-center gap-4 p-3 rounded-xl border transition-colors duration-150',
                day.enabled
                  ? 'bg-[var(--bg-surface)] border-brand-navy/20 dark:border-brand-gold/20'
                  : 'bg-[var(--bg-muted)] border-[var(--border-default)] opacity-60'
              )}
            >
              {/* Toggle */}
              <SmallToggle
                checked={day.enabled}
                onChange={(val) => handleToggle(key, val)}
                disabled={saving}
              />

              {/* Day label */}
              <span
                className={clsx(
                  'text-sm font-medium font-heebo w-14',
                  day.enabled ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                )}
              >
                {label}
              </span>

              {/* Time inputs */}
              {day.enabled && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-[var(--text-muted)] font-heebo">מ-</label>
                  <input
                    type="time"
                    value={day.start}
                    onChange={(e) => handleTimeChange(key, 'start', e.target.value)}
                    className={inputCls}
                    dir="ltr"
                    aria-label={`שעת התחלה ליום ${label}`}
                  />
                  <label className="text-xs text-[var(--text-muted)] font-heebo">עד</label>
                  <input
                    type="time"
                    value={day.end}
                    onChange={(e) => handleTimeChange(key, 'end', e.target.value)}
                    className={inputCls}
                    dir="ltr"
                    aria-label={`שעת סיום ליום ${label}`}
                  />
                </div>
              )}

              {!day.enabled && (
                <span className="text-xs text-[var(--text-muted)] font-heebo">
                  לא זמין
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3 pt-1">
        <Button
          variant="primary"
          size="md"
          onClick={handleSave}
          loading={saving}
          leftIcon={<Save className="w-4 h-4" />}
        >
          שמור שעות זמינות
        </Button>

        {saveStatus === 'success' && (
          <span
            role="status"
            className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400 font-heebo"
          >
            <CheckCircle className="w-4 h-4" aria-hidden="true" />
            השינויים נשמרו
          </span>
        )}
        {error && (
          <span
            role="alert"
            className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400 font-heebo"
          >
            <AlertCircle className="w-4 h-4" aria-hidden="true" />
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
