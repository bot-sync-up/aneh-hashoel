import React, {
  useState,
  useEffect,
  useCallback,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  User,
  Star,
  Palmtree,
  Shield,
  Bell,
  Save,
  CheckCircle,
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
} from 'lucide-react';

// TipTap rich text editor
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import UnderlineMark from '@tiptap/extension-underline';

import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import NotificationPreferences from '../components/profile/NotificationPreferences';
import VacationMode from '../components/profile/VacationMode';
import AvailabilityHours from '../components/profile/AvailabilityHours';

// ── Categories (loaded from DB) ────────────────────────────────────────────

// ── Tabs ──────────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'personal',       label: 'פרטים אישיים',          icon: User },
  { key: 'categories',     label: 'קטגוריות מועדפות',       icon: Star },
  { key: 'vacation',       label: 'מצב זמינות',             icon: Palmtree },
  { key: 'security',       label: 'אבטחה',                  icon: Shield },
  { key: 'notifications',  label: 'התראות',                  icon: Bell },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function AutoSaveIndicator({ status }) {
  if (!status) return null;
  const configs = {
    saving: { text: 'שומר...', color: 'text-[var(--text-muted)]', icon: Loader2, animate: true },
    saved:  { text: 'נשמר אוטומטית', color: 'text-emerald-600 dark:text-emerald-400', icon: CheckCircle },
    error:  { text: 'שגיאה בשמירה', color: 'text-red-500', icon: AlertCircle },
  };
  const config = configs[status];
  if (!config) return null;
  const Icon = config.icon;
  return (
    <span className={clsx('flex items-center gap-1 text-xs font-heebo', config.color)} role="status">
      <Icon className={clsx('w-3.5 h-3.5', config.animate && 'animate-spin')} aria-hidden="true" />
      {config.text}
    </span>
  );
}

function SaveFeedback({ status }) {
  if (!status) return null;
  if (status === 'success') return (
    <span role="status" className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400 font-heebo">
      <CheckCircle className="w-4 h-4" aria-hidden="true" />
      השינויים נשמרו
    </span>
  );
  return (
    <span role="alert" className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400 font-heebo">
      <AlertCircle className="w-4 h-4" aria-hidden="true" />
      שגיאה בשמירה
    </span>
  );
}

// ── TipTap toolbar ────────────────────────────────────────────────────────────

function EditorToolbar({ editor }) {
  if (!editor) return null;
  const mkBtn = (action, isActive, title, Icon) => (
    <button
      key={title}
      type="button"
      onMouseDown={(e) => { e.preventDefault(); action(); }}
      title={title}
      aria-label={title}
      aria-pressed={isActive}
      className={clsx(
        'p-1.5 rounded transition-colors duration-100',
        isActive
          ? 'bg-brand-navy text-white dark:bg-brand-gold dark:text-brand-navy'
          : 'text-[var(--text-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]'
      )}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
    </button>
  );
  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-[var(--border-default)] bg-[var(--bg-muted)] rounded-t-lg">
      {mkBtn(() => editor.chain().focus().toggleBold().run(), editor.isActive('bold'), 'מודגש', Bold)}
      {mkBtn(() => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'), 'נטוי', Italic)}
      {mkBtn(() => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline'), 'קו תחתי', UnderlineIcon)}
      {mkBtn(() => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'), 'רשימה', List)}
    </div>
  );
}

// ── Personal Tab ──────────────────────────────────────────────────────────────

function PersonalTab({ rabbi }) {
  const { updateRabbi } = useAuth();
  const [form, setForm] = useState({
    name:  rabbi?.name  || rabbi?.fullName || '',
    phone: rabbi?.phone || '',
    email: rabbi?.email || '',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const validate = () => {
    const errs = {};
    if (!form.name.trim()) errs.name = 'שדה חובה';
    if (form.phone && !/^[\d\s\-+()]{7,15}$/.test(form.phone.trim())) {
      errs.phone = 'מספר טלפון לא תקין';
    }
    return errs;
  };

  const handleChange = (field, value) => {
    // Strip non-numeric characters for phone fields
    const sanitized = field === 'phone' ? value.replace(/[^0-9]/g, '') : value;
    setForm((prev) => ({ ...prev, [field]: sanitized }));
    setErrors((prev) => { const next = { ...prev }; delete next[field]; return next; });
    setSaveStatus(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    setSaveStatus(null);
    try {
      const { data } = await api.put('/rabbis/profile', {
        name:  form.name.trim(),
        phone: form.phone.trim(),
      });
      updateRabbi(data?.rabbi || { name: form.name.trim(), phone: form.phone.trim() });
      setSaveStatus('success');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      setErrors({ global: err.response?.data?.message || 'שגיאה בשמירה. נסה שוב.' });
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = (field) => clsx(
    'block w-full px-3 py-2 rounded-lg border text-sm font-heebo',
    'bg-[var(--bg-surface)] text-[var(--text-primary)]',
    'focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-brand-gold',
    'transition-colors duration-150',
    errors[field] ? 'border-red-400 dark:border-red-600' : 'border-[var(--border-default)]'
  );
  const labelCls = 'block text-sm font-semibold font-heebo text-[var(--text-primary)] mb-1';

  return (
    <form onSubmit={handleSave} noValidate className="space-y-5 max-w-lg" dir="rtl">
      {errors.global && (
        <div role="alert" className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400 font-heebo">
          {errors.global}
        </div>
      )}

      <div>
        <label htmlFor="rabbi-name" className={labelCls}>שם מלא *</label>
        <input id="rabbi-name" type="text" value={form.name} onChange={(e) => handleChange('name', e.target.value)}
          className={inputCls('name')} autoComplete="name" required />
        {errors.name && <p className="mt-1 text-xs text-red-500 font-heebo" role="alert">{errors.name}</p>}
      </div>

      <div>
        <label htmlFor="rabbi-email" className={labelCls}>
          כתובת מייל
        </label>
        <input id="rabbi-email" type="email" value={form.email} readOnly
          className={clsx(inputCls('email'), 'opacity-60 cursor-not-allowed bg-[var(--bg-muted)]')}
          tabIndex={-1} aria-readonly="true" />
        <p className="mt-1 text-xs text-[var(--text-muted)] font-heebo">
          כתובת האימייל ניתנת לשינוי רק על-ידי מנהל המערכת
        </p>
      </div>

      <div>
        <label htmlFor="rabbi-phone" className={labelCls}>טלפון</label>
        <input id="rabbi-phone" type="tel" inputMode="numeric" pattern="[0-9]*" value={form.phone} onChange={(e) => handleChange('phone', e.target.value)}
          onInput={(e) => e.target.value = e.target.value.replace(/[^0-9+\-\s]/g, '')}
          className={inputCls('phone')} autoComplete="tel" dir="ltr" placeholder="0500000000" />
        {errors.phone && <p className="mt-1 text-xs text-red-500 font-heebo" role="alert">{errors.phone}</p>}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" variant="primary" size="md" loading={saving} leftIcon={<Save className="w-4 h-4" />}>
          שמור פרטים
        </Button>
        <SaveFeedback status={saveStatus} />
      </div>
    </form>
  );
}

// ── Categories Tab ────────────────────────────────────────────────────────────

function CategoriesTab({ rabbi }) {
  const { updateRabbi } = useAuth();
  const [categories, setCategories] = useState([]);
  const [selected, setSelected] = useState(
    new Set((rabbi?.preferred_categories || rabbi?.preferredCategories || []).map(Number))
  );
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);

  useEffect(() => {
    api.get('/categories')
      .then(({ data }) => {
        // flatten tree to flat list
        const flatten = (items) => items.reduce((acc, c) => {
          acc.push(c);
          if (c.children?.length) acc.push(...flatten(c.children));
          return acc;
        }, []);
        const raw = data?.categories ?? (Array.isArray(data) ? data : []);
        setCategories(flatten(raw));
      })
      .catch(() => {});
  }, []);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setSaveStatus(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus(null);
    try {
      await api.put('/rabbis/profile/categories', { categories: [...selected] });
      updateRabbi({ preferred_categories: [...selected] });
      setSaveStatus('success');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch {
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      <p className="text-sm text-[var(--text-muted)] font-heebo">
        הקטגוריות שבהן תרצה לקבל שאלות בעדיפות
      </p>
      {categories.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] font-heebo">טוען קטגוריות...</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {categories.map(({ id, name }) => {
            const isOn = selected.has(Number(id));
            return (
              <label key={id} className={clsx(
                'flex items-center gap-2 p-3 rounded-xl border cursor-pointer select-none transition-all duration-150',
                isOn
                  ? 'bg-brand-navy/5 dark:bg-brand-gold/10 border-brand-navy/30 dark:border-brand-gold/30'
                  : 'bg-[var(--bg-surface)] border-[var(--border-default)] hover:bg-[var(--bg-muted)]'
              )}>
                <input type="checkbox" checked={isOn} onChange={() => toggle(Number(id))}
                  className="rounded border-[var(--border-default)] text-brand-navy focus:ring-brand-gold"
                  aria-label={name} />
                <span className={clsx('text-sm font-heebo', isOn ? 'text-brand-navy dark:text-brand-gold font-medium' : 'text-[var(--text-primary)]')}>
                  {name}
                </span>
              </label>
            );
          })}
        </div>
      )}
      <div className="flex items-center gap-3 pt-1">
        <Button variant="primary" size="md" onClick={handleSave} loading={saving} leftIcon={<Save className="w-4 h-4" />}>
          שמור קטגוריות
        </Button>
        <SaveFeedback status={saveStatus} />
        <span className="text-sm text-[var(--text-muted)] font-heebo">{selected.size} נבחרו</span>
      </div>
    </div>
  );
}

// ── PwField — defined OUTSIDE SecurityTab to prevent remount on every render ──

function PwField({ id, field, showKey, label, autoComplete, form, errors, showPw, onToggle, onChange }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold font-heebo text-[var(--text-primary)] mb-1">{label}</label>
      <div className="relative">
        <input id={id} type={showPw[showKey] ? 'text' : 'password'} value={form[field]}
          onChange={(e) => onChange(field, e.target.value)} autoComplete={autoComplete} dir="ltr"
          className={clsx(
            'block w-full px-3 py-2 pe-10 rounded-lg border text-sm font-heebo',
            'bg-[var(--bg-surface)] text-[var(--text-primary)]',
            'focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-brand-gold transition-colors duration-150',
            errors[field] ? 'border-red-400 dark:border-red-600' : 'border-[var(--border-default)]'
          )} />
        <button type="button" tabIndex={-1} onClick={() => onToggle(showKey)}
          aria-label={showPw[showKey] ? 'הסתר סיסמה' : 'הצג סיסמה'}
          className="absolute inset-y-0 left-0 px-3 flex items-center text-[var(--text-muted)] hover:text-[var(--text-primary)]">
          {showPw[showKey] ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
        </button>
      </div>
      {errors[field] && <p className="mt-1 text-xs text-red-500 font-heebo" role="alert">{errors[field]}</p>}
    </div>
  );
}

// ── Security Tab ──────────────────────────────────────────────────────────────

function SecurityTab() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [showPw, setShowPw] = useState({ current: false, newPw: false, confirm: false });

  const toggle = (field) => setShowPw((p) => ({ ...p, [field]: !p[field] }));

  const handleChange = (field, value) => {
    setForm((p) => ({ ...p, [field]: value }));
    setErrors((p) => { const n = { ...p }; delete n[field]; delete n.global; return n; });
    setSaveStatus(null);
  };

  const validate = () => {
    const e = {};
    if (!form.currentPassword) e.currentPassword = 'נדרשת הסיסמה הנוכחית';
    if (!form.newPassword) e.newPassword = 'נדרשת סיסמה חדשה';
    else if (form.newPassword.length < 8) e.newPassword = 'לפחות 8 תווים';
    if (form.newPassword !== form.confirmPassword) e.confirmPassword = 'הסיסמאות אינן תואמות';
    return e;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSaving(true);
    setSaveStatus(null);
    try {
      await api.post('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setSaveStatus('success');
      setTimeout(() => setSaveStatus(null), 4000);
    } catch (err) {
      setErrors({ global: err.response?.data?.message || 'שגיאה בשינוי הסיסמה. בדוק את הסיסמה הנוכחית.' });
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <Card header={<Card.Title>שינוי סיסמה</Card.Title>}>
        <form onSubmit={handleSave} noValidate className="space-y-4 max-w-md">
          {errors.global && (
            <div role="alert" className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400 font-heebo">
              {errors.global}
            </div>
          )}
          <PwField id="cpw" field="currentPassword" showKey="current" label="סיסמה נוכחית" autoComplete="current-password" form={form} errors={errors} showPw={showPw} onToggle={toggle} onChange={handleChange} />
          <PwField id="npw" field="newPassword" showKey="newPw" label="סיסמה חדשה" autoComplete="new-password" form={form} errors={errors} showPw={showPw} onToggle={toggle} onChange={handleChange} />
          <PwField id="cpw2" field="confirmPassword" showKey="confirm" label="אימות סיסמה" autoComplete="new-password" form={form} errors={errors} showPw={showPw} onToggle={toggle} onChange={handleChange} />
          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" variant="primary" size="md" loading={saving} leftIcon={<Save className="w-4 h-4" />}>
              עדכן סיסמה
            </Button>
            <SaveFeedback status={saveStatus} />
          </div>
        </form>
      </Card>

    </div>
  );
}

// ── Main ProfilePage ──────────────────────────────────────────────────────────

export default function ProfilePage() {
  const { rabbi } = useAuth();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') || 'personal');

  const tabContent = {
    personal:      <PersonalTab rabbi={rabbi} />,
    categories:    <CategoriesTab rabbi={rabbi} />,
    vacation:      (
      <div className="space-y-8">
        <VacationMode />
        <hr className="border-[var(--border-default)]" />
        <AvailabilityHours />
      </div>
    ),
    security:      <SecurityTab />,
    notifications: (
      <Card header={<Card.Title>העדפות התראות</Card.Title>}>
        <NotificationPreferences />
      </Card>
    ),
  };

  return (
    <div className="page-enter p-6 space-y-6 max-w-4xl mx-auto" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold font-heebo text-[var(--text-primary)]">הפרופיל שלי</h1>
        <p className="text-sm text-[var(--text-muted)] font-heebo mt-1">
          נהל את הפרטים האישיים, ההעדפות והאבטחה שלך
        </p>
      </div>

      {/* Tab bar */}
      <div role="tablist" aria-label="קטגוריות פרופיל"
        className="flex gap-1 overflow-x-auto pb-1 border-b border-[var(--border-default)]">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} role="tab" id={`tab-${key}`}
            aria-selected={activeTab === key} aria-controls={`panel-${key}`}
            onClick={() => setActiveTab(key)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-sm font-medium font-heebo whitespace-nowrap',
              'border-b-2 -mb-px transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold',
              activeTab === key
                ? 'border-brand-navy dark:border-brand-gold text-brand-navy dark:text-brand-gold'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)]'
            )}>
            <Icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {TABS.map(({ key }) => (
        <div key={key} role="tabpanel" id={`panel-${key}`} aria-labelledby={`tab-${key}`} hidden={activeTab !== key}>
          {activeTab === key && tabContent[key]}
        </div>
      ))}
    </div>
  );
}
