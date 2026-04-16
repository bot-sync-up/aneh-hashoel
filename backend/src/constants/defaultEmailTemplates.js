'use strict';

/**
 * Default Email Templates
 * ─────────────────────────────────────────────────────────────────────────────
 * This is the single source of truth for email subject+body strings used
 * by the system. Admin can override each key via the Email Settings UI,
 * which persists the entire object under system_config['email_templates'].
 *
 * The order of precedence when sending an email is:
 *   1. system_config['email_templates'][key]   (admin-edited in DB)
 *   2. DEFAULT_EMAIL_TEMPLATES[key]            (from this file)
 *
 * On backend startup we call seedDefaultEmailTemplates() which UPSERTS
 * any missing keys so the admin UI shows fully-populated editable fields
 * from the very first visit.
 *
 * Variables used inside templates are replaced at render time via
 * services/emailTemplates.js (see `fillVariables`). Supported placeholders:
 *   {name}              – recipient first name
 *   {email}             – recipient email
 *   {password}          – temp password (welcome only)
 *   {login_url}         – link to /login
 *   {title}             – question title
 *   {id}                – question short id
 *   {content}           – question content
 *   {category}          – category name
 *   {rabbi_name}        – rabbi name (for asker-facing mails)
 *   {system_name}       – "ענה את השואל" or "שאל את הרב"
 *   {answered_count}    – weekly digest stat
 *   {avg_response_time} – weekly digest stat
 *   {thank_count}       – weekly digest stat
 *   {timeout_hours}     – pending-reminder threshold
 *   {questions_list}    – HTML <li> list for the pending-reminder digest
 *   {follow_up_content} – body of a follow-up question
 *   {reset_url}         – password-reset link
 *   {device}/{ip}/{time}– new-device login alert
 *   {category_name}     – new category name (admin category notify)
 *   {suggester_name}    – rabbi who proposed a category
 * ─────────────────────────────────────────────────────────────────────────────
 */

/* eslint-disable max-len */
const DEFAULT_EMAIL_TEMPLATES = Object.freeze({
  // ── System names ──────────────────────────────────────────────────────────
  asker_system_name: 'שאל את הרב',
  rabbi_system_name: 'ענה את השואל',

  // ── Rabbi — welcome / onboarding ──────────────────────────────────────────
  welcome_subject: 'ברוכים הבאים למערכת ענה את השואל',
  welcome_body:
    '<p>שלום {name},</p>' +
    '<p>נוצר עבורך חשבון במערכת <strong>"ענה את השואל"</strong>.</p>' +
    '<p>פרטי כניסה זמניים:</p>' +
    '<div style="background:#f8f8fb;border-right:4px solid #B8973A;padding:16px 20px;margin:16px 0;border-radius:4px;font-family:monospace;font-size:15px;">' +
    '<p style="margin:0 0 6px;"><strong>אימייל:</strong> {email}</p>' +
    '<p style="margin:0;"><strong>סיסמה זמנית:</strong> {password}</p></div>' +
    '<p style="color:#cc4444;font-weight:bold;">יש לשנות את הסיסמה בכניסה הראשונה.</p>' +
    '<p style="font-size:14px;color:#888;">לשאלות פנה/י למנהל המערכת.</p>',

  // ── Rabbi — question lifecycle ────────────────────────────────────────────
  rabbi_new_question_subject: 'שאלה חדשה — {system_name}',
  rabbi_new_question_body:
    '<p>שלום {name},</p>' +
    '<p>התקבלה שאלה חדשה במערכת:</p>' +
    '<div style="background:#f8f8fb;border-right:4px solid #B8973A;padding:14px 18px;margin:14px 0;border-radius:4px;">' +
    '<p style="margin:0 0 6px;"><strong>כותרת:</strong> {title}</p>' +
    '<p style="margin:0 0 6px;"><strong>קטגוריה:</strong> {category}</p>' +
    '<p style="margin:0;color:#555;">{content}</p></div>' +
    '<p>ניתן לתפוס את השאלה עד {timeout_hours} שעות.</p>',

  rabbi_thank_subject: 'תודה מגולש — {system_name}',
  rabbi_thank_body:
    '<p>כבוד הרב {name},</p>' +
    '<p>גולש הודה לך על תשובתך לשאלה: <strong>"{title}"</strong>.</p>' +
    '<p>המשך במלאכת הקודש!</p>',

  rabbi_weekly_report_subject: 'דוח שבועי — {system_name}',
  rabbi_weekly_report_body:
    '<p>כבוד הרב {name},</p>' +
    '<p>להלן סיכום הפעילות שלך השבוע:</p>' +
    '<p><strong>שאלות שנענו:</strong> {answered_count}<br/>' +
    '<strong>זמן תגובה ממוצע:</strong> {avg_response_time}<br/>' +
    '<strong>תודות שהתקבלו:</strong> {thank_count}</p>' +
    '<p>יישר כח!</p>',

  rabbi_already_claimed_subject: 'שאלה כבר נתפסה — {system_name}',
  rabbi_already_claimed_body:
    '<p>כבוד הרב {name},</p>' +
    '<p>השאלה <strong>"{title}"</strong> (ID: {id}) כבר נתפסה על ידי רב אחר.</p>' +
    '<p>ניתן לבחור שאלה אחרת מהרשימה.</p>',

  rabbi_release_confirmation_body:
    '<p>כבוד הרב {name},</p>' +
    '<p>השאלה <strong>"{title}"</strong> (ID: {id}) שוחררה בהצלחה וזמינה כעת לרבנים אחרים.</p>',

  rabbi_answer_confirmation_body:
    '<p>כבוד הרב {name},</p>' +
    '<p>תשובתך לשאלה <strong>"{title}"</strong> (ID: {id}) התקבלה ונקלטה בהצלחה.</p>' +
    '<p>תודה על המענה!</p>',

  rabbi_follow_up_subject: '[ID:{id}] שאלת המשך: {title} — {system_name}',
  rabbi_follow_up_body:
    '<p>שלום רב,</p>' +
    '<p>השואל הוסיף שאלת המשך לשאלה שטיפלת בה:</p>' +
    '<div style="background:#f8f8fb;border-right:4px solid #B8973A;padding:16px 20px;margin:16px 0;border-radius:4px;">' +
    '<p style="margin:0 0 8px;font-weight:bold;font-size:15px;color:#1B2B5E;">{title}</p>' +
    '<p style="margin:0;color:#333;font-size:14px;line-height:1.7;">{follow_up_content}</p></div>' +
    '<p style="margin:12px 0;font-size:13px;color:#888;">ניתן להשיב ישירות למייל זה.</p>',

  rabbi_pending_reminder_subject:
    'תזכורת — שאלות ממתינות לתפיסה — {system_name}',
  rabbi_pending_reminder_body:
    '<p>שלום רב,</p>' +
    '<p>יש שאלות שממתינות לתפיסה מעל <strong>{hours} שעות</strong>. נא להיכנס למערכת ולענות.</p>' +
    '<ul style="padding-right:20px;">{questions_list}</ul>' +
    '<p style="margin-top:12px;font-size:13px;color:#888;">תזכורת זו נשלחת אוטומטית לפי הגדרות המערכת.</p>',

  // ── Asker emails ──────────────────────────────────────────────────────────
  asker_question_received_subject: 'שאלתך התקבלה — {system_name}',
  asker_question_received_body:
    '<p>שלום {name},</p>' +
    '<p>קיבלנו את שאלתך ונענה בהקדם האפשרי.</p>' +
    '<div style="background:#f8f9fa;border-right:4px solid #1B2B5E;padding:16px;margin:16px 0;border-radius:4px;">' +
    '<strong>נושא השאלה:</strong><br/><p style="margin:8px 0 0;">{title}</p></div>' +
    '<p style="font-size:13px;color:#888;">נשלח לך מייל נוסף כאשר תתקבל תשובה מהרב.</p>',

  asker_answer_ready_subject: 'התקבלה תשובה לשאלתך — {system_name}',
  asker_answer_ready_body:
    '<p>שלום {name},</p>' +
    '<p>שמחים לבשר שהרב <strong>{rabbi_name}</strong> ענה על שאלתך.</p>' +
    '<div style="background:#f8f9fa;border-right:4px solid #B8973A;padding:16px;margin:16px 0;border-radius:4px;">' +
    '<strong>נושא השאלה:</strong><br/><p style="margin:8px 0 0;">{title}</p></div>' +
    '<p style="font-size:13px;color:#888;">לצפייה בתשובה המלאה — לחץ על הכפתור למטה.</p>',

  asker_follow_up_subject: 'תשובת המשך לשאלתך — {system_name}',
  asker_follow_up_body:
    '<p>שלום {name},</p>' +
    '<p>הרב {rabbi_name} השיב לשאלת ההמשך שלך:</p>' +
    '<div style="background:#f8f6f0;border-right:3px solid #B8973A;padding:12px 16px;border-radius:4px;margin:12px 0;">' +
    '<p style="font-weight:bold;margin:0 0 6px;">{title}</p></div>',

  asker_private_answer_subject: 'תשובה אישית לשאלתך — {system_name}',
  asker_private_answer_body:
    '<p>שלום {name},</p>' +
    '<p>הרב <strong>{rabbi_name}</strong> ענה על שאלתך בתשובה אישית:</p>' +
    '<div style="background:#f8f9fa;border-right:4px solid #B8973A;padding:16px;margin:16px 0;border-radius:4px;">' +
    '<strong>שאלה:</strong> {title}</div>' +
    '<div style="background:#f0f7f0;border-radius:8px;padding:16px;margin:16px 0;">' +
    '<p style="margin:0 0 8px;"><strong>תשובה:</strong></p>' +
    '<div>{content}</div></div>' +
    '<p style="color:#666;font-size:12px;">תשובה זו נשלחה אליך באופן אישי ואינה מפורסמת באתר.</p>' +
    '<p>בברכה,<br><strong>הרב {rabbi_name}</strong></p>',

  // ── Onboarding drip (asker) ───────────────────────────────────────────────
  onboarding_1_subject: 'ברוך/ה הבא/ה למערכת "שאל את הרב" — המרכז למורשת מרן',
  onboarding_1_body:
    '<p>שלום {name},</p>' +
    '<p>תודה ששלחת את שאלתך למערכת <strong>"שאל את הרב"</strong> של המרכז למורשת מרן.</p>' +
    '<p>שאלתך נשלחה לצוות הרבנים שלנו ותיענה בהקדם האפשרי. ברגע שתתקבל תשובה, תקבל/י הודעה במייל.</p>' +
    '<p><strong>מה עוד אנחנו עושים?</strong></p>' +
    '<ul><li>מענה הלכתי מקצועי ומהיר</li><li>שיעורי תורה מגוונים</li>' +
    '<li>הנצחת יקירים</li><li>פעילות חסד וסיוע לנזקקים</li></ul>' +
    '<p>נשמח לראותך שוב!</p><p>בברכה,<br/>צוות המרכז למורשת מרן</p>',

  onboarding_2_subject: 'הכירו את הפעילות הרחבה של המרכז למורשת מרן',
  onboarding_2_body:
    '<p>שלום {name},</p>' +
    '<p>שמחנו שפנית אלינו! רצינו לספר לך קצת על <strong>הפעילות הרחבה</strong> של המרכז למורשת מרן:</p>' +
    '<p><strong>חלוקת מזון</strong> — מדי שבוע אנחנו מחלקים סלי מזון למשפחות נזקקות ברחבי הארץ.</p>' +
    '<p><strong>שיעורי תורה</strong> — עשרות שיעורים שבועיים בנושאים מגוונים, פתוחים לכולם.</p>' +
    '<p><strong>פרויקטים מיוחדים</strong> — הנצחת יקירים, חיזוק קהילות, וסיוע בשעת חירום.</p>' +
    '<p>כל זה מתאפשר בזכות תורמים נדיבים כמוך.</p>' +
    '<p>בברכה,<br/>צוות המרכז למורשת מרן</p>',

  onboarding_3_subject: 'הצטרפו למשפחת התורמים — המרכז למורשת מרן',
  onboarding_3_body:
    '<p>שלום {name},</p>' +
    '<p>מקווים שקיבלת מענה מלא לשאלתך!</p>' +
    '<p>הפעילות של מערכת "שאל את הרב" — כולל צוות הרבנים, התשתית הטכנולוגית, והתמיכה השוטפת — <strong>מתאפשרת בזכות תרומות</strong> של אנשים כמוך.</p>' +
    '<p>אם התשובה עזרה לך, נשמח אם תשקול/י לתרום סכום קטן להמשך הפעילות.</p>' +
    '<p>תודה רבה ובברכה,<br/>צוות המרכז למורשת מרן</p>',

  // ── System / auth ─────────────────────────────────────────────────────────
  password_reset_subject: 'איפוס סיסמה — {system_name}',
  password_reset_body:
    '<p>שלום {name},</p>' +
    '<p>התקבלה בקשה לאיפוס הסיסמה שלך.</p>' +
    '<p>לחץ/י על הכפתור למטה לאיפוס. הקישור יפוג בעוד שעה.</p>' +
    '<p style="font-size:12px;color:#888;">אם לא יזמת בקשה זו, ניתן להתעלם מהמייל.</p>',

  password_changed_subject: 'הסיסמה שלך שונתה — {system_name}',
  password_changed_body:
    '<p>שלום {name},</p>' +
    '<p>הסיסמה שלך במערכת <strong>"{system_name}"</strong> שונתה בהצלחה.</p>' +
    '<div style="background:#f8f9fa;border-right:4px solid #B8973A;padding:14px 18px;margin:14px 0;border-radius:4px;">' +
    '<p style="margin:0 0 6px;font-size:13px;color:#555;"><strong>זמן השינוי:</strong> {time}</p>' +
    '<p style="margin:0;font-size:13px;color:#555;"><strong>כתובת IP:</strong> {ip}</p></div>' +
    '<p style="color:#cc4444;font-weight:bold;">אם לא ביצעת את השינוי — פנה/י מיידית למנהל המערכת!</p>' +
    '<p style="font-size:12px;color:#888;">מייל זה נשלח לצרכי אבטחה ולא מכיל את הסיסמה עצמה.</p>',

  new_device_subject: 'כניסה ממכשיר חדש — {system_name}',
  new_device_body:
    '<p>שלום {name},</p>' +
    '<p>זוהתה כניסה למערכת ממכשיר חדש:</p>' +
    '<p><strong>מכשיר:</strong> {device}<br/>' +
    '<strong>כתובת IP:</strong> {ip}<br/>' +
    '<strong>זמן:</strong> {time}</p>' +
    '<p style="color:#cc4444;">אם זה לא אתה, שנה/י את הסיסמה מיידית.</p>',

  // ── Admin notifications ───────────────────────────────────────────────────
  admin_category_new_subject: 'קטגוריה חדשה להצעה: {category_name}',
  admin_category_new_body:
    '<p>שלום,</p>' +
    '<p>הרב <strong>{suggester_name}</strong> הציע קטגוריה חדשה:</p>' +
    '<div style="background:#f8f8fb;border-right:4px solid #B8973A;padding:14px 18px;margin:14px 0;border-radius:4px;">' +
    '<p style="margin:0;font-size:15px;"><strong>{category_name}</strong></p></div>' +
    '<p>הקטגוריה ממתינה לאישור במערכת הניהול.</p>',

  // ── Editable footer extras (shown inline in the navy footer) ──────────────
  footer_body: '', // empty => emailBase builds its own footer
});

module.exports = { DEFAULT_EMAIL_TEMPLATES };
