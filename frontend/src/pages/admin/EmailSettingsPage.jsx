import React, { useState, useEffect } from 'react';
import { Mail, Save, CheckCircle, Info, RotateCcw } from 'lucide-react';
import Button from '../../components/ui/Button';
import { get, put } from '../../lib/api';

const TEMPLATE_FIELDS = [
  {
    key: 'asker_system_name',
    label: 'שם מערכת לשואלים',
    description: 'השם שמופיע באימיילים לשואלים',
    type: 'input',
  },
  {
    key: 'rabbi_system_name',
    label: 'שם מערכת לרבנים',
    description: 'השם שמופיע באימיילים לרבנים',
    type: 'input',
  },
  { type: 'divider', label: 'תבניות לשואלים' },
  {
    key: 'asker_question_received_subject',
    label: 'נושא — שאלה התקבלה',
    type: 'input',
  },
  {
    key: 'asker_question_received_body',
    label: 'גוף — שאלה התקבלה',
    type: 'textarea',
  },
  {
    key: 'asker_answer_ready_subject',
    label: 'נושא — תשובה מוכנה',
    type: 'input',
  },
  {
    key: 'asker_answer_ready_body',
    label: 'גוף — תשובה מוכנה',
    type: 'textarea',
  },
  { type: 'divider', label: 'תבניות לרבנים' },
  {
    key: 'rabbi_new_question_subject',
    label: 'נושא — שאלה חדשה',
    type: 'input',
  },
  {
    key: 'rabbi_new_question_body',
    label: 'גוף — שאלה חדשה',
    type: 'textarea',
  },
  {
    key: 'rabbi_thank_subject',
    label: 'נושא — תודה מגולש',
    type: 'input',
  },
  {
    key: 'rabbi_thank_body',
    label: 'גוף — תודה מגולש',
    type: 'textarea',
  },
  {
    key: 'rabbi_full_question_subject',
    label: 'נושא — שאלה מלאה',
    type: 'input',
  },
  {
    key: 'rabbi_full_question_body',
    label: 'גוף — שאלה מלאה',
    type: 'textarea',
  },
  {
    key: 'rabbi_claim_subject',
    label: 'נושא — קבלת שאלה (CLAIM)',
    type: 'input',
  },
  {
    key: 'rabbi_release_subject',
    label: 'נושא — שחרור שאלה (RELEASE)',
    type: 'input',
  },
];

const DEFAULT_TEMPLATES = {
  asker_system_name: 'שאל את הרב',
  rabbi_system_name: 'ענה את השואל',
  asker_question_received_subject: 'שאלתך התקבלה — {system_name}',
  asker_question_received_body: 'שלום {name},\nשאלתך "{title}" התקבלה בהצלחה.\nנודיע לך כשתתקבל תשובה.',
  asker_answer_ready_subject: 'התקבלה תשובה לשאלתך — {system_name}',
  asker_answer_ready_body: 'שלום {name},\nהרב {rabbi_name} ענה על שאלתך "{title}".\nלצפייה בתשובה:',
  rabbi_new_question_subject: 'שאלה חדשה — {system_name}',
  rabbi_new_question_body: 'שאלה חדשה התקבלה במערכת.\nכותרת: {title}',
  rabbi_thank_subject: 'תודה מגולש — {system_name}',
  rabbi_thank_body: 'כבוד הרב,\nגולש הודה לך על תשובתך לשאלה: "{title}".\nהמשך במלאכת הקודש!',
  rabbi_full_question_subject: '[ID: {id}] {title} — {system_name}',
  rabbi_full_question_body: 'להלן השאלה המלאה.\nניתן להשיב ישירות למייל זה.',
  rabbi_claim_subject: '[CLAIM:{id}] קבלת שאלה — {system_name}',
  rabbi_release_subject: '[RELEASE:{id}] שחרור שאלה — {system_name}',
};

export default function EmailSettingsPage() {
  const [templates, setTemplates] = useState({ ...DEFAULT_TEMPLATES });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    get('/admin/email-settings')
      .then((data) => {
        if (data.templates) {
          setTemplates({ ...DEFAULT_TEMPLATES, ...data.templates });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (key) => (e) => {
    setTemplates((prev) => ({ ...prev, [key]: e.target.value }));
  };

  const handleReset = () => {
    setTemplates({ ...DEFAULT_TEMPLATES });
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await put('/admin/email-settings', { templates });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err?.response?.data?.error || 'שגיאה בשמירת הגדרות האימייל');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 max-w-3xl">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-6">
            <div className="skeleton h-4 w-40 rounded mb-4" />
            <div className="skeleton h-10 w-full rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl" dir="rtl">
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)] font-heebo">הגדרות תבניות אימייל</h2>
        <p className="text-sm text-[var(--text-muted)] font-heebo mt-0.5">
          עריכת תבניות האימיילים הנשלחים מהמערכת
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 font-heebo">
          {error}
        </div>
      )}

      {saved && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700 font-heebo animate-fade-in">
          <CheckCircle size={16} /> תבניות האימייל נשמרו בהצלחה
        </div>
      )}

      {/* Available variables info */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/50 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-3 border-b border-blue-200 bg-blue-50">
          <Info size={16} className="text-blue-600" />
          <span className="text-sm font-bold text-blue-800 font-heebo">משתנים זמינים</span>
        </div>
        <div className="px-6 py-3">
          <div className="flex flex-wrap gap-2">
            {['{name}', '{title}', '{id}', '{rabbi_name}', '{system_name}'].map((v) => (
              <code
                key={v}
                className="px-2 py-1 rounded bg-blue-100 text-blue-800 text-xs font-mono"
              >
                {v}
              </code>
            ))}
          </div>
          <p className="text-xs text-blue-600 font-heebo mt-2">
            השתמש במשתנים אלו בתוך הנושאים והגוף — הם יוחלפו אוטומטית בערכים בזמן השליחה
          </p>
        </div>
      </div>

      {/* Template fields */}
      {TEMPLATE_FIELDS.map((field, idx) => {
        if (field.type === 'divider') {
          return (
            <div key={idx} className="divider-text my-2">{field.label}</div>
          );
        }

        return (
          <div
            key={field.key}
            className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden shadow-[var(--shadow-soft)]"
          >
            <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--border-default)] bg-[var(--bg-surface-raised)]">
              <div className="w-7 h-7 rounded-lg bg-[#1B2B5E]/10 flex items-center justify-center">
                <Mail size={14} className="text-[#1B2B5E]" />
              </div>
              <div>
                <label className="font-bold text-[var(--text-primary)] font-heebo text-sm">
                  {field.label}
                </label>
                {field.description && (
                  <p className="text-xs text-[var(--text-muted)] font-heebo">{field.description}</p>
                )}
              </div>
            </div>
            <div className="px-6 py-4">
              {field.type === 'textarea' ? (
                <textarea
                  value={templates[field.key] || ''}
                  onChange={handleChange(field.key)}
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm font-heebo text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] resize-none"
                  dir="rtl"
                />
              ) : (
                <input
                  type="text"
                  value={templates[field.key] || ''}
                  onChange={handleChange(field.key)}
                  className="w-full h-10 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm font-heebo text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                  dir="rtl"
                />
              )}
            </div>
          </div>
        );
      })}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={handleReset}
          leftIcon={<RotateCcw size={15} />}
        >
          שחזר ברירות מחדל
        </Button>
        <Button
          variant="primary"
          loading={saving}
          onClick={handleSave}
          leftIcon={<Save size={16} />}
        >
          שמור תבניות
        </Button>
      </div>
    </div>
  );
}
