import React, { useState, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import { Save, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import Button from '../ui/Button';

// ── Event rows configuration ──────────────────────────────────────────────────

const EVENT_ROWS = [
  { key: 'new_question',      label: 'שאלה חדשה',           defaultEmail: true,  defaultWhatsapp: true,  defaultPush: false },
  { key: 'claim_approved',    label: 'אישור תפיסה',          defaultEmail: true,  defaultWhatsapp: false, defaultPush: false },
  { key: 'answer_published',  label: 'תשובה פורסמה',         defaultEmail: true,  defaultWhatsapp: false, defaultPush: false },
  { key: 'user_thanks',       label: 'תודה מגולש',           defaultEmail: false, defaultWhatsapp: false, defaultPush: false, alwaysOn: true, alwaysOnNote: 'התראות תודה נשלחות תמיד ולא ניתנות לביטול' },
  { key: 'lock_reminder',     label: 'תזכורת נעילה',         defaultEmail: true,  defaultWhatsapp: true,  defaultPush: false },
  { key: 'pending_reminder',  label: 'תזכורת שאלות ממתינות', defaultEmail: true,  defaultWhatsapp: false, defaultPush: false },
  { key: 'followup_question', label: 'שאלת המשך',            defaultEmail: true,  defaultWhatsapp: false, defaultPush: false },
  { key: 'weekly_report',     label: 'דוח שבועי',            defaultEmail: true,  defaultWhatsapp: false, defaultPush: false },
  { key: 'daily_summary',     label: 'סיכום יומי',           defaultEmail: false, defaultWhatsapp: false, defaultPush: false },
  { key: 'new_device_login',  label: 'כניסה ממכשיר חדש',    defaultEmail: true,  defaultWhatsapp: true,  defaultPush: false },
];

// ── Toggle switch sub-component ────────────────────────────────────────────────

function ToggleSwitch({ checked, onChange, disabled = false, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={clsx(
        'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full',
        'border-2 border-transparent transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2',
        checked && !disabled ? 'bg-brand-navy dark:bg-brand-gold' : 'bg-gray-200 dark:bg-gray-600',
        disabled && 'opacity-40 cursor-not-allowed'
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          'pointer-events-none inline-block h-4 w-4 transform rounded-full',
          'bg-white shadow ring-0 transition duration-200',
          checked ? 'translate-x-0' : 'translate-x-4'
        )}
      />
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function NotificationPreferences({ pushConfigured = false }) {
  const [prefs, setPrefs] = useState(() => {
    const initial = {};
    EVENT_ROWS.forEach((row) => {
      initial[row.key] = {
        email: row.defaultEmail,
        whatsapp: row.defaultWhatsapp,
        push: row.defaultPush,
      };
    });
    return initial;
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // 'success' | 'error' | null
  const [error, setError] = useState(null);

  // ── Load preferences ───────────────────────────────────────────────────────

  const fetchPrefs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/rabbis/profile/notifications');
      const loaded = data?.preferences || data || {};
      setPrefs((prev) => {
        const merged = { ...prev };
        EVENT_ROWS.forEach((row) => {
          if (loaded[row.key]) {
            merged[row.key] = { ...merged[row.key], ...loaded[row.key] };
          }
        });
        return merged;
      });
    } catch {
      // Non-fatal: keep defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrefs();
  }, [fetchPrefs]);

  // ── Toggle handler ─────────────────────────────────────────────────────────

  const handleToggle = (eventKey, channel, value) => {
    setPrefs((prev) => ({
      ...prev,
      [eventKey]: {
        ...prev[eventKey],
        [channel]: value,
      },
    }));
    setSaveStatus(null);
  };

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus(null);
    try {
      // Build a quick lookup of alwaysOn events so we never persist their
      // toggles as disabled (the UI won't let the user change them anyway).
      const alwaysOnSet = new Set(
        EVENT_ROWS.filter((r) => r.alwaysOn).map((r) => r.key)
      );

      // Flatten {event: {email, whatsapp, push}} → [{event_type, channel, enabled}]
      const flatPrefs = [];
      for (const [event_type, channels] of Object.entries(prefs)) {
        if (!channels || typeof channels !== 'object') continue;
        const lockOn = alwaysOnSet.has(event_type);
        for (const ch of ['email', 'whatsapp', 'push']) {
          if (typeof channels[ch] === 'boolean') {
            flatPrefs.push({
              event_type,
              channel: ch,
              enabled: lockOn ? true : channels[ch],
            });
          }
        }
      }
      if (flatPrefs.length === 0) {
        setSaveStatus('error');
        setSaving(false);
        return;
      }
      await api.put('/rabbis/profile/notifications', { preferences: flatPrefs });
      setSaveStatus('success');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch {
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-brand-navy dark:text-brand-gold" aria-label="טוען העדפות" />
      </div>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      <p className="text-sm text-[var(--text-muted)] font-heebo">
        בחר אילו התראות ברצונך לקבל ובאיזה ערוץ.
      </p>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--border-default)]">
        <table className="min-w-full font-heebo text-sm" aria-label="העדפות התראות">
          <thead>
            <tr className="bg-[var(--bg-muted)] border-b border-[var(--border-default)]">
              <th
                scope="col"
                className="px-4 py-3 text-right font-semibold text-[var(--text-primary)] min-w-[180px]"
              >
                אירוע
              </th>
              <th scope="col" className="px-4 py-3 text-center font-semibold text-[var(--text-primary)] w-24">
                מייל
              </th>
              <th scope="col" className="px-4 py-3 text-center font-semibold text-[var(--text-primary)] w-24">
                ווטסאפ
              </th>
              <th scope="col" className="px-4 py-3 text-center font-semibold w-28 relative">
                <span className={clsx(!pushConfigured && 'text-[var(--text-muted)]')}>Push</span>
                {!pushConfigured && (
                  <span className="mr-1.5 text-xs font-normal px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                    בקרוב
                  </span>
                )}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-default)]">
            {EVENT_ROWS.map((row) => (
              <tr
                key={row.key}
                className="bg-[var(--bg-surface)] hover:bg-[var(--bg-muted)] transition-colors duration-100"
              >
                <td className="px-4 py-3 text-right text-[var(--text-primary)] font-medium">
                  {row.label}
                  {row.alwaysOnNote && (
                    <p className="text-xs font-normal text-[var(--text-muted)] mt-0.5">{row.alwaysOnNote}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex justify-center">
                    <ToggleSwitch
                      checked={row.alwaysOn ? true : (prefs[row.key]?.email ?? row.defaultEmail)}
                      onChange={(val) => handleToggle(row.key, 'email', val)}
                      disabled={row.alwaysOn}
                      label={`${row.label} — מייל`}
                    />
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex justify-center">
                    <ToggleSwitch
                      checked={row.alwaysOn ? true : (prefs[row.key]?.whatsapp ?? row.defaultWhatsapp)}
                      onChange={(val) => handleToggle(row.key, 'whatsapp', val)}
                      disabled={row.alwaysOn}
                      label={`${row.label} — ווטסאפ`}
                    />
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex justify-center">
                    <ToggleSwitch
                      checked={row.alwaysOn ? true : (prefs[row.key]?.push ?? row.defaultPush)}
                      onChange={(val) => handleToggle(row.key, 'push', val)}
                      disabled={!pushConfigured || row.alwaysOn}
                      label={`${row.label} — Push`}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Push note */}
      {!pushConfigured && (
        <p className="text-xs text-[var(--text-muted)] font-heebo">
          * התראות Push יהיו זמינות בקרוב. כאשר יופעלו, תוכל לבחור אותן כאן.
        </p>
      )}

      {/* Save row */}
      <div className="flex items-center gap-3 pt-2">
        <Button
          variant="primary"
          size="md"
          onClick={handleSave}
          loading={saving}
          leftIcon={<Save className="w-4 h-4" />}
        >
          שמור העדפות
        </Button>

        {saveStatus === 'success' && (
          <span
            role="status"
            className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400 font-heebo"
          >
            <CheckCircle className="w-4 h-4" aria-hidden="true" />
            ההעדפות נשמרו
          </span>
        )}
        {saveStatus === 'error' && (
          <span
            role="alert"
            className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400 font-heebo"
          >
            <AlertCircle className="w-4 h-4" aria-hidden="true" />
            שגיאה בשמירה — נסה שוב
          </span>
        )}
      </div>
    </div>
  );
}
