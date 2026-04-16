import React, { useState, useEffect, useCallback } from 'react';
import { Mail, Save, CheckCircle, Info, RotateCcw, ChevronDown, ChevronUp, Eye, Lock, X } from 'lucide-react';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { get, put, post } from '../../lib/api';

// ── Email categories — each is an accordion card ──────────────────────────────

// ── Folder structure for email templates ──────────────────────────────────────

const EMAIL_FOLDERS = [
  {
    id: 'rabbi',
    title: 'מיילים לרבנים',
    icon: '🎓',
    audience: 'rabbi',
    templates: [
      {
        id: 'welcome',
        title: 'ברוך הבא',
        icon: '👋',
        description: 'מייל הצטרפות לרב חדש במערכת',
        fields: [
          { key: 'welcome_subject', label: 'נושא', type: 'input' },
          { key: 'welcome_body', label: 'תוכן (HTML)', type: 'html' },
        ],
        variables: ['{name}', '{email}', '{password}', '{login_url}'],
      },
      {
        id: 'new_question',
        title: 'שאלה חדשה',
        icon: '📩',
        description: 'מייל עם השאלה המלאה + הנחיות תפוס/שחרר/ענה',
        fields: [
          { key: 'rabbi_new_question_subject', label: 'נושא', type: 'input' },
          { key: 'rabbi_new_question_body', label: 'תוכן (HTML)', type: 'html' },
        ],
        variables: ['{name}', '{title}', '{id}', '{content}', '{category}', '{timeout_hours}', '{system_name}'],
      },
      {
        id: 'thank',
        title: 'תודה מגולש',
        icon: '❤️',
        description: 'הודעה לרב כשמישהו מודה לו על תשובה',
        fields: [
          { key: 'rabbi_thank_subject', label: 'נושא', type: 'input' },
          { key: 'rabbi_thank_body', label: 'תוכן (HTML)', type: 'html' },
        ],
        variables: ['{name}', '{title}', '{id}', '{system_name}'],
      },
      {
        id: 'weekly_report',
        title: 'דוח שבועי',
        icon: '📊',
        description: 'סיכום שבועי לרב על פעילותו',
        fields: [
          { key: 'rabbi_weekly_report_subject', label: 'נושא', type: 'input' },
          { key: 'rabbi_weekly_report_body', label: 'תוכן (HTML)', type: 'html' },
        ],
        variables: ['{name}', '{answered_count}', '{avg_response_time}', '{thank_count}', '{system_name}'],
      },
      {
        id: 'already_claimed',
        title: 'שאלה כבר נתפסה',
        icon: '🔒',
        description: 'הודעה לרב שהשאלה כבר נתפסה ע"י רב אחר',
        fields: [
          { key: 'rabbi_already_claimed_subject', label: 'נושא', type: 'input' },
          { key: 'rabbi_already_claimed_body', label: 'תוכן (HTML)', type: 'html' },
        ],
        variables: ['{name}', '{title}', '{id}', '{system_name}'],
      },
      {
        id: 'release_confirm',
        title: 'אישור שחרור שאלה',
        icon: '🔓',
        description: 'אישור לרב ששחרר שאלה בהצלחה',
        fields: [
          { key: 'rabbi_release_confirmation_body', label: 'תוכן (HTML)', type: 'html' },
        ],
        variables: ['{name}', '{title}', '{id}'],
      },
      {
        id: 'follow_up_to_rabbi',
        title: 'שאלת המשך מהשואל',
        icon: '🔄',
        description: 'התראה לרב ששואל הוסיף שאלת המשך',
        fields: [
          { key: 'rabbi_follow_up_subject', label: 'נושא', type: 'input' },
          { key: 'rabbi_follow_up_body', label: 'תוכן (HTML)', type: 'html' },
        ],
        variables: ['{name}', '{title}', '{id}', '{follow_up_content}', '{system_name}'],
      },
      {
        id: 'pending_reminder',
        title: 'תזכורת שאלות ממתינות',
        icon: '⏰',
        description: 'Digest לרבנים על שאלות שלא נענו מעל X שעות (cron)',
        fields: [
          { key: 'rabbi_pending_reminder_subject', label: 'נושא', type: 'input' },
          { key: 'rabbi_pending_reminder_body', label: 'תוכן (HTML)', type: 'html' },
        ],
        variables: ['{hours}', '{questions_list}', '{system_name}'],
      },
      {
        id: 'answer_confirm',
        title: 'אישור קליטת תשובה',
        icon: '📝',
        description: 'אישור לרב שתשובתו ממייל נקלטה בהצלחה',
        fields: [
          { key: 'rabbi_answer_confirmation_body', label: 'תוכן (HTML)', type: 'html' },
        ],
        variables: ['{name}', '{title}', '{id}'],
      },
    ],
  },
  {
    id: 'asker',
    title: 'מיילים לשואלים',
    icon: '👤',
    audience: 'asker',
    templates: [
      {
        id: 'question_received',
        title: 'אישור קבלת שאלה',
        icon: '✅',
        description: 'אישור לשואל שהשאלה התקבלה',
        fields: [
          { key: 'asker_question_received_subject', label: 'נושא', type: 'input' },
          { key: 'asker_question_received_body', label: 'תוכן (HTML)', type: 'html' },
        ],
        variables: ['{name}', '{title}', '{system_name}'],
      },
      {
        id: 'answer_ready',
        title: 'תשובה מוכנה',
        icon: '📬',
        description: 'הודעה לשואל שהתקבלה תשובה לשאלתו',
        fields: [
          { key: 'asker_answer_ready_subject', label: 'נושא', type: 'input' },
          { key: 'asker_answer_ready_body', label: 'תוכן (HTML)', type: 'html' },
        ],
        variables: ['{name}', '{title}', '{rabbi_name}', '{system_name}'],
      },
      {
        id: 'follow_up',
        title: 'שאלת המשך',
        icon: '🔄',
        description: 'הודעה לשואל על שאלת המשך',
        fields: [
          { key: 'asker_follow_up_subject', label: 'נושא', type: 'input' },
          { key: 'asker_follow_up_body', label: 'תוכן (HTML)', type: 'html' },
        ],
        variables: ['{name}', '{title}', '{system_name}'],
      },
    ],
  },
  {
    id: 'system',
    title: 'מיילים מערכתיים',
    icon: '⚙️',
    templates: [
      {
        id: 'password_reset',
        title: 'איפוס סיסמה',
        icon: '🔑',
        description: 'קישור לאיפוס סיסמה',
        fields: [
          { key: 'password_reset_subject', label: 'נושא', type: 'input' },
          { key: 'password_reset_body', label: 'תוכן (HTML)', type: 'html' },
        ],
        variables: ['{name}', '{reset_url}', '{system_name}'],
      },
      {
        id: 'new_device',
        title: 'התראת מכשיר חדש',
        icon: '🔔',
        description: 'התראת אבטחה בכניסה ממכשיר חדש',
        fields: [
          { key: 'new_device_subject', label: 'נושא', type: 'input' },
          { key: 'new_device_body', label: 'תוכן (HTML)', type: 'html' },
        ],
        variables: ['{name}', '{device}', '{ip}', '{time}', '{system_name}'],
      },
      {
        id: 'password_changed',
        title: 'הסיסמה שונתה',
        icon: '🔐',
        description: 'אישור לרב ששינה את הסיסמה שלו (בלי להכיל את הסיסמה עצמה!)',
        fields: [
          { key: 'password_changed_subject', label: 'נושא', type: 'input' },
          { key: 'password_changed_body', label: 'תוכן (HTML)', type: 'html' },
        ],
        variables: ['{name}', '{email}', '{ip}', '{time}', '{device}', '{system_name}'],
      },
      {
        id: 'admin_category_new',
        title: 'התראה על קטגוריה חדשה',
        icon: '📂',
        description: 'נשלח למנהלי המערכת כאשר רב מציע קטגוריה חדשה',
        fields: [
          { key: 'admin_category_new_subject', label: 'נושא', type: 'input' },
          { key: 'admin_category_new_body', label: 'תוכן (HTML)', type: 'html' },
        ],
        variables: ['{suggester_name}', '{category_name}', '{system_name}'],
      },
    ],
  },
  {
    id: 'onboarding',
    title: 'מיילים היכרות (אונבורדינג)',
    icon: '🤝',
    audience: 'asker',
    templates: [
      {
        id: 'onboarding_1',
        title: 'מייל היכרות #1 — ברוך הבא',
        icon: '1️⃣',
        description: 'נשלח מיד אחרי השאלה הראשונה — הכרת המערכת',
        fields: [
          { key: 'onboarding_1_subject', label: 'נושא', type: 'input' },
          { key: 'onboarding_1_body', label: 'תוכן (HTML)', type: 'html' },
        ],
        variables: ['{name}', '{system_name}'],
      },
      {
        id: 'onboarding_2',
        title: 'מייל היכרות #2 — עקוב אחרי שאלתך',
        icon: '2️⃣',
        description: 'נשלח יום אחרי השאלה — תזכורת לעקוב',
        fields: [
          { key: 'onboarding_2_subject', label: 'נושא', type: 'input' },
          { key: 'onboarding_2_body', label: 'תוכן (HTML)', type: 'html' },
        ],
        variables: ['{name}', '{title}', '{system_name}'],
      },
      {
        id: 'onboarding_3',
        title: 'מייל היכרות #3 — שאל עוד שאלות',
        icon: '3️⃣',
        description: 'נשלח 3 ימים אחרי — עידוד לשאול עוד',
        fields: [
          { key: 'onboarding_3_subject', label: 'נושא', type: 'input' },
          { key: 'onboarding_3_body', label: 'תוכן (HTML)', type: 'html' },
        ],
        variables: ['{name}', '{system_name}'],
      },
    ],
  },
];

const DEFAULT_TEMPLATES = {
  asker_system_name: 'שאל את הרב',
  rabbi_system_name: 'ענה את השואל',
  welcome_subject: 'ברוכים הבאים למערכת ענה את השואל',
  welcome_body: '<p>שלום {name},</p><p>נוצר עבורך חשבון במערכת <strong>"ענה את השואל"</strong>.</p><p>פרטי כניסה זמניים:</p><p><strong>אימייל:</strong> {email}<br/><strong>סיסמה זמנית:</strong> {password}</p><p style="color:#cc4444;font-weight:bold;">יש לשנות את הסיסמה בכניסה הראשונה.</p>',
  asker_question_received_subject: 'שאלתך התקבלה — {system_name}',
  asker_question_received_body: '<p>שלום {name},</p><p>שאלתך <strong>"{title}"</strong> התקבלה בהצלחה.</p><p>נודיע לך כשתתקבל תשובה.</p>',
  asker_answer_ready_subject: 'התקבלה תשובה לשאלתך — {system_name}',
  asker_answer_ready_body: '<p>שלום {name},</p><p>הרב {rabbi_name} ענה על שאלתך <strong>"{title}"</strong>.</p><p>לצפייה בתשובה:</p>',
  rabbi_new_question_subject: 'שאלה חדשה — {system_name}',
  rabbi_new_question_body: '<p>שאלה חדשה התקבלה במערכת.</p><p><strong>כותרת:</strong> {title}</p>',
  rabbi_thank_subject: 'תודה מגולש — {system_name}',
  rabbi_thank_body: '<p>כבוד הרב,</p><p>גולש הודה לך על תשובתך לשאלה: <strong>"{title}"</strong>.</p><p>המשך במלאכת הקודש!</p>',
  rabbi_full_question_subject: '[ID: {id}] {title} — {system_name}',
  rabbi_full_question_body: '<p>להלן השאלה המלאה.</p><p>ניתן להשיב ישירות למייל זה.</p>',
  rabbi_already_claimed_subject: 'שאלה כבר נתפסה — {system_name}',
  rabbi_already_claimed_body: '<p>כבוד הרב,</p><p>השאלה <strong>"{title}"</strong> (ID: {id}) כבר נתפסה על ידי רב אחר.</p><p>ניתן לבחור שאלה אחרת מהרשימה.</p>',
  rabbi_release_confirmation_body: '<p>כבוד הרב,</p><p>השאלה <strong>"{title}"</strong> (ID: {id}) שוחררה בהצלחה וזמינה כעת לרבנים אחרים.</p>',
  rabbi_answer_confirmation_body: '<p>כבוד הרב,</p><p>תשובתך לשאלה <strong>"{title}"</strong> (ID: {id}) התקבלה ונקלטה בהצלחה במערכת.</p><p>תודה על המענה!</p>',
  rabbi_weekly_report_subject: 'דוח שבועי — {system_name}',
  rabbi_weekly_report_body: '<p>כבוד הרב,</p><p>להלן סיכום הפעילות שלך השבוע:</p><p><strong>שאלות שנענו:</strong> {answered_count}<br/><strong>זמן תגובה ממוצע:</strong> {avg_response_time}<br/><strong>תודות שהתקבלו:</strong> {thank_count}</p>',
  asker_follow_up_subject: 'שאלת המשך — {system_name}',
  asker_follow_up_body: '<p>שלום {name},</p><p>נרשמה שאלת המשך לשאלתך <strong>"{title}"</strong>.</p><p>הרב יענה בהקדם.</p>',
  rabbi_follow_up_subject: '[ID:{id}] שאלת המשך: {title} — {system_name}',
  rabbi_follow_up_body: '<p>שלום רב,</p><p>השואל הוסיף שאלת המשך לשאלה שטיפלת בה:</p><div style="background:#f8f8fb;border-right:4px solid #B8973A;padding:16px 20px;margin:16px 0;border-radius:4px;"><p style="margin:0 0 8px;font-weight:bold;font-size:15px;color:#1B2B5E;">{title}</p><p style="margin:0;color:#333;font-size:14px;line-height:1.7;">{follow_up_content}</p></div><p style="margin:12px 0;font-size:13px;color:#888;">ניתן להשיב ישירות למייל זה.</p>',
  rabbi_pending_reminder_subject: 'תזכורת — שאלות ממתינות לתפיסה — {system_name}',
  rabbi_pending_reminder_body: '<p>שלום רב,</p><p>יש שאלות שממתינות לתפיסה מעל <strong>{hours} שעות</strong>. נא להיכנס למערכת ולענות.</p><ul style="padding-right:20px;">{questions_list}</ul><p style="margin-top:12px;font-size:13px;color:#888;">תזכורת זו נשלחת אוטומטית לפי הגדרות המערכת.</p>',
  password_reset_subject: 'איפוס סיסמה — {system_name}',
  password_reset_body: '<p>שלום {name},</p><p>התקבלה בקשה לאיפוס הסיסמה שלך.</p><p>לחץ על הכפתור למטה לאיפוס:</p>',
  new_device_subject: 'כניסה ממכשיר חדש — {system_name}',
  new_device_body: '<p>שלום {name},</p><p>זוהתה כניסה למערכת ממכשיר חדש:</p><p><strong>מכשיר:</strong> {device}<br/><strong>כתובת IP:</strong> {ip}<br/><strong>זמן:</strong> {time}</p><p>אם זה לא אתה, שנה את הסיסמה מיידית.</p>',
  password_changed_subject: 'הסיסמה שלך שונתה — {system_name}',
  password_changed_body: '<p>שלום {name},</p><p>הסיסמה שלך במערכת <strong>"{system_name}"</strong> שונתה בהצלחה.</p><div style="background:#f8f9fa;border-right:4px solid #B8973A;padding:14px 18px;margin:14px 0;border-radius:4px;"><p style="margin:0 0 6px;font-size:13px;color:#555;"><strong>זמן השינוי:</strong> {time}</p><p style="margin:0;font-size:13px;color:#555;"><strong>כתובת IP:</strong> {ip}</p></div><p style="color:#cc4444;font-weight:bold;">אם לא ביצעת את השינוי — פנה/י מיידית למנהל המערכת!</p><p style="font-size:12px;color:#888;">מייל זה נשלח לצרכי אבטחה ולא מכיל את הסיסמה עצמה.</p>',
  admin_category_new_subject: 'קטגוריה חדשה להצעה: {category_name}',
  admin_category_new_body: '<p>שלום,</p><p>הרב <strong>{suggester_name}</strong> הציע קטגוריה חדשה:</p><div style="background:#f8f8fb;border-right:4px solid #B8973A;padding:14px 18px;margin:14px 0;border-radius:4px;"><p style="margin:0;font-size:15px;"><strong>{category_name}</strong></p></div><p>הקטגוריה ממתינה לאישור במערכת הניהול.</p>',
  onboarding_1_subject: 'ברוך הבא למרכז למורשת מרן — {system_name}',
  onboarding_1_body: '<p>שלום {name},</p><p>תודה ששלחת שאלה דרך המרכז למורשת מרן!</p><p>השאלה שלך התקבלה ותועבר לרבנים המומחים שלנו. ברגע שתתקבל תשובה, תקבל/י על כך הודעה במייל.</p><p><strong>מי אנחנו?</strong></p><p>המרכז למורשת מרן מרכז צוות של רבנים תלמידי חכמים שעונים על שאלות הלכתיות בנושאים מגוונים.</p>',
  onboarding_2_subject: 'השאלה שלך בטיפול — {system_name}',
  onboarding_2_body: '<p>שלום {name},</p><p>רצינו לעדכן שהשאלה <strong>"{title}"</strong> שלך נמצאת בטיפול.</p><p>הרבנים שלנו עובדים על מענה מקצועי ומדויק. ברוב המקרים התשובה מגיעה תוך 24-48 שעות.</p><p>בינתיים, אתה מוזמן לעיין בתשובות נוספות באתר שלנו.</p>',
  onboarding_3_subject: 'יש לך עוד שאלה? אנחנו כאן — {system_name}',
  onboarding_3_body: '<p>שלום {name},</p><p>רצינו להזכיר שאנחנו תמיד כאן בשבילך!</p><p>אם יש לך שאלה נוספת בנושא הלכה, מנהגים, או כל נושא תורני — אל תהסס לשלוח אותה דרך האתר שלנו.</p><p>צוות הרבנים שלנו ישמח לעזור.</p>',
  footer_body: '<div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.15);"><a href="https://moreshet-maran.com" style="color:#B8973A;text-decoration:none;font-size:12px;margin:0 10px;">אתר המרכז למורשת מרן</a><span style="color:rgba(255,255,255,0.3);">|</span><a href="{login_url}" style="color:#B8973A;text-decoration:none;font-size:12px;margin:0 10px;">כניסה למערכת</a><span style="color:rgba(255,255,255,0.3);">|</span><a href="https://moreshet-maran.com/ask" style="color:#B8973A;text-decoration:none;font-size:12px;margin:0 10px;">שאל את הרב</a></div><p style="margin:0 0 4px;color:#a0a0b8;font-size:12px;line-height:1.5;">מייל זה נשלח ממערכת "{system_name}"</p><p style="margin:0;color:#a0a0b8;font-size:12px;line-height:1.5;">לשינוי העדפות התראות, ניתן לפנות למנהל המערכת</p>',
};

// ── Single accordion card ────────────────────────────────────────────────────

/** Replace template variables with sample data */
function fillSampleData(text, templates) {
  if (!text) return text;
  return text
    .replace(/\{name\}/g, 'הרב ישראל כהן')
    .replace(/\{title\}/g, 'האם מותר להדליק נר בשבת?')
    .replace(/\{id\}/g, 'abc12345')
    .replace(/\{rabbi_name\}/g, 'הרב ישראל כהן')
    .replace(/\{system_name\}/g, templates.rabbi_system_name || 'ענה את השואל')
    .replace(/\{email\}/g, 'rabbi@example.com')
    .replace(/\{password\}/g, 'Temp1234!')
    .replace(/\{login_url\}/g, 'https://ask.moreshet-maran.com/login')
    .replace(/\{answered_count\}/g, '12')
    .replace(/\{avg_response_time\}/g, '2.5 שעות')
    .replace(/\{thank_count\}/g, '8')
    .replace(/\{category\}/g, 'הלכה')
    .replace(/\{content\}/g, 'תוכן השאלה המלא כאן...')
    .replace(/\{timeout_hours\}/g, '4');
}

function TemplateCard({ category, templates, onChange, onSave, saving, savedId, audience }) {
  const [open, setOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const isSaved = savedId === category.id;

  const handlePreview = async () => {
    if (previewHtml) { setPreviewHtml(null); return; }

    setPreviewLoading(true);
    try {
      // Get the body field (first html-type field)
      const bodyField = category.fields.find(f => f.type === 'html');
      const subjectField = category.fields.find(f => f.type === 'input');
      const bodyContent = fillSampleData(templates[bodyField?.key] || '', templates);
      const title = fillSampleData(
        templates[subjectField?.key] || category.title,
        templates
      );

      // Asker-audience templates should NOT include the rabbi login button in preview
      const isAsker = audience === 'asker';
      const { html } = await post('/admin/email-preview', {
        title,
        body: bodyContent,
        ...(isAsker
          ? {} // no login button for asker
          : { buttonLabel: 'כניסה למערכת', buttonUrl: 'https://ask.moreshet-maran.com/login' }),
        audience: audience || 'rabbi',
      });
      setPreviewHtml(html);
    } catch (err) {
      setPreviewHtml('<p style="color:red;text-align:center;padding:20px;">שגיאה בטעינת תצוגה מקדימה</p>');
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden shadow-[var(--shadow-soft)]">
      {/* Header — click to toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-[var(--bg-muted)] transition-colors duration-150"
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{category.icon}</span>
          <div className="text-right">
            <p className="text-sm font-bold text-[var(--text-primary)] font-heebo">{category.title}</p>
            <p className="text-xs text-[var(--text-muted)] font-heebo">{category.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isSaved && (
            <span className="flex items-center gap-1 text-xs text-emerald-600 font-heebo animate-fade-in">
              <CheckCircle size={14} /> נשמר
            </span>
          )}
          {open ? <ChevronUp size={18} className="text-[var(--text-muted)]" /> : <ChevronDown size={18} className="text-[var(--text-muted)]" />}
        </div>
      </button>

      {/* Body — expanded */}
      {open && (
        <div className="border-t border-[var(--border-default)] px-5 py-4 space-y-4 animate-fade-in">
          {/* Variables */}
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs text-[var(--text-muted)] font-heebo ml-1">משתנים:</span>
            {category.variables.map((v) => (
              <code key={v} className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[11px] font-mono cursor-pointer hover:bg-blue-100"
                onClick={() => navigator.clipboard.writeText(v)}
                title="לחץ להעתקה"
              >
                {v}
              </code>
            ))}
          </div>

          {/* Fields */}
          {category.fields.map((field) => (
            <div key={field.key}>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] font-heebo mb-1.5">
                {field.label}
              </label>
              {field.type === 'html' ? (
                <textarea
                  value={templates[field.key] || ''}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  rows={6}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-brand-gold/40 resize-y leading-relaxed"
                  dir="rtl"
                  placeholder="<p>תוכן ה-HTML כאן...</p>"
                />
              ) : (
                <input
                  type="text"
                  value={templates[field.key] || ''}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm font-heebo text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-brand-gold/40"
                  dir="rtl"
                />
              )}
            </div>
          ))}

          {/* Preview + Save */}
          <div className="flex items-center justify-between pt-2 border-t border-[var(--border-default)]">
            <Button
              variant="ghost"
              size="sm"
              loading={previewLoading}
              onClick={handlePreview}
              leftIcon={<Eye size={14} />}
            >
              {previewHtml ? 'סגור תצוגה מקדימה' : 'תצוגה מקדימה'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={saving === category.id}
              onClick={() => onSave(category.id)}
              leftIcon={<Save size={14} />}
            >
              שמור תבנית
            </Button>
          </div>

          {/* Full preview modal */}
          {previewHtml && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
              onClick={() => setPreviewHtml(null)}
            >
              <div
                className="relative bg-[#f4f4f7] rounded-xl shadow-2xl w-[95vw] max-w-[650px] max-h-[90vh] overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Modal header */}
                <div className="flex items-center justify-between px-4 py-3 border-b bg-white">
                  <span className="text-sm font-bold font-heebo text-[var(--text-primary)]">
                    תצוגה מקדימה — {category.title}
                  </span>
                  <button
                    onClick={() => setPreviewHtml(null)}
                    className="p-1 rounded hover:bg-gray-100 transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>
                {/* Email render */}
                <div className="overflow-y-auto" style={{ maxHeight: 'calc(90vh - 52px)' }}>
                  <iframe
                    srcDoc={previewHtml}
                    title="Email Preview"
                    className="w-full border-0"
                    style={{ height: '700px', minHeight: '500px' }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function EmailSettingsPage() {
  const [templates, setTemplates] = useState({ ...DEFAULT_TEMPLATES });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null); // category id being saved
  const [savedId, setSavedId] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get('/admin/email-settings')
      .then((data) => {
        if (data.templates) {
          setTemplates((prev) => ({ ...prev, ...data.templates }));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleChange = useCallback((key, value) => {
    setTemplates((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(async (categoryId) => {
    setSaving(categoryId);
    setError('');
    try {
      await put('/admin/email-settings', { templates });
      setSavedId(categoryId);
      setTimeout(() => setSavedId(null), 3000);
    } catch (err) {
      setError(err?.response?.data?.error || 'שגיאה בשמירת התבנית');
    } finally {
      setSaving(null);
    }
  }, [templates]);

  const handleResetAll = useCallback(() => {
    if (window.confirm('האם לשחזר את כל התבניות לברירת מחדל?')) {
      setTemplates({ ...DEFAULT_TEMPLATES });
    }
  }, []);

  if (loading) {
    return (
      <div className="space-y-4 max-w-3xl mx-auto p-6">
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
    <div className="space-y-5 max-w-3xl mx-auto p-6" dir="rtl">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)] font-heebo flex items-center gap-2">
          <Mail size={22} className="text-brand-gold" />
          תבניות אימייל
        </h2>
        <p className="text-sm text-[var(--text-muted)] font-heebo mt-1">
          ערוך את תבניות האימיילים הנשלחים מהמערכת. לחץ על כל תבנית כדי לערוך את התוכן.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 font-heebo">
          {error}
        </div>
      )}

      {/* System names */}
      <Card className="!p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] font-heebo mb-1">
              שם מערכת לשואלים
            </label>
            <input
              type="text"
              value={templates.asker_system_name || ''}
              onChange={(e) => handleChange('asker_system_name', e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm font-heebo"
              dir="rtl"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] font-heebo mb-1">
              שם מערכת לרבנים
            </label>
            <input
              type="text"
              value={templates.rabbi_system_name || ''}
              onChange={(e) => handleChange('rabbi_system_name', e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm font-heebo"
              dir="rtl"
            />
          </div>
        </div>
      </Card>

      {/* Available variables */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/50 px-5 py-3">
        <div className="flex items-center gap-2 mb-2">
          <Info size={14} className="text-blue-600" />
          <span className="text-xs font-bold text-blue-800 font-heebo">משתנים זמינים בכל התבניות</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {['{name}', '{title}', '{id}', '{rabbi_name}', '{system_name}', '{email}', '{category}'].map((v) => (
            <code key={v} className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-[11px] font-mono">{v}</code>
          ))}
        </div>
      </div>

      {/* Template folders */}
      {EMAIL_FOLDERS.map((folder) => (
        <div key={folder.id} className="space-y-3">
          {/* Folder header */}
          <div className="flex items-center gap-2 pt-4">
            <span className="text-lg">{folder.icon}</span>
            <h3 className="text-base font-bold text-[var(--text-primary)] font-heebo">{folder.title}</h3>
            <span className="text-xs text-[var(--text-muted)] font-heebo">({folder.templates.length} תבניות)</span>
          </div>

          {/* Templates inside folder */}
          {folder.templates.map((cat) => (
            <TemplateCard
              key={cat.id}
              category={cat}
              templates={templates}
              onChange={handleChange}
              onSave={handleSave}
              saving={saving}
              savedId={savedId}
              audience={folder.audience || 'rabbi'}
            />
          ))}
        </div>
      ))}

      {/* Editable footer — as a TemplateCard like the others */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 pt-4">
          <span className="text-lg">📧</span>
          <h3 className="text-base font-bold text-[var(--text-primary)] font-heebo">פוטר מייל</h3>
        </div>
        <TemplateCard
          category={{
            id: 'footer',
            title: 'טקסט פוטר',
            icon: '📝',
            description: 'הטקסט שמופיע בתחתית כל מייל שנשלח מהמערכת',
            fields: [
              { key: 'footer_body', label: 'תוכן הפוטר (HTML)', type: 'html' },
            ],
            variables: ['{system_name}'],
          }}
          templates={templates}
          onChange={handleChange}
          onSave={handleSave}
          saving={saving}
          savedId={savedId}
        />
      </div>

      {/* Locked SyncUp branding */}
      <div className="rounded-xl border-2 border-dashed border-[var(--border-default)] bg-[var(--bg-muted)] overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--border-default)]">
          <Lock size={16} className="text-[var(--text-muted)]" />
          <div>
            <p className="text-sm font-bold text-[var(--text-secondary)] font-heebo">חתימת מפתח</p>
            <p className="text-xs text-[var(--text-muted)] font-heebo">חתימה זו נוספת אוטומטית ואינה ניתנת לעריכה</p>
          </div>
        </div>
        <div className="px-5 py-4 bg-[var(--bg-surface)]">
          <div className="rounded-lg bg-[#f0f0f0] px-4 py-3 text-center">
            <p className="text-[11px] text-[#999] font-heebo">
              פותח ע"י <strong style={{ color: '#1B2B5E' }}>SyncUp</strong> — טכנולוגיה שמניעה עסקים
            </p>
          </div>
        </div>
      </div>

      {/* Reset all */}
      <div className="flex justify-start">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleResetAll}
          leftIcon={<RotateCcw size={14} />}
        >
          שחזר הכל לברירות מחדל
        </Button>
      </div>
    </div>
  );
}
