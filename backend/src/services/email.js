'use strict';

/**
 * Email Service
 *
 * שליחת אימיילים דרך Mailgun או Nodemailer (SMTP fallback).
 * כל האימיילים משתמשים בתבנית RTL עם צבעי מותג.
 *
 * משתני סביבה:
 *   EMAIL_PROVIDER       – 'mailgun' | 'smtp' (ברירת מחדל: 'smtp')
 *   MAILGUN_API_KEY      – מפתח API של Mailgun
 *   MAILGUN_DOMAIN       – דומיין Mailgun
 *   MAILGUN_EU           – 'true' אם משתמשים בשרת EU
 *   SMTP_HOST            – כתובת שרת SMTP
 *   SMTP_PORT            – פורט SMTP (ברירת מחדל: 587)
 *   SMTP_USER            – שם משתמש SMTP
 *   SMTP_PASS            – סיסמת SMTP
 *   EMAIL_FROM_NAME      – שם השולח (ברירת מחדל: 'ענה את השואל')
 *   EMAIL_FROM_ADDRESS   – כתובת השולח
 *   APP_URL              – כתובת האתר הראשית
 */

const nodemailer = require('nodemailer');
const { createEmailHTML, BRAND_NAVY, BRAND_GOLD } = require('../templates/emailBase');
const { logger } = require('../utils/logger');

const log = logger.child({ module: 'email' });

// ─── Email Template Defaults & Resolution ────────────────────────────────────

const EMAIL_TEMPLATE_DEFAULTS = {
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
  // Already-claimed notification
  rabbi_already_claimed_subject: 'שאלה כבר נתפסה — {system_name}',
  rabbi_already_claimed_body: 'כבוד הרב,\nהשאלה "{title}" (ID: {id}) כבר נתפסה על ידי רב אחר.\nניתן לבחור שאלה אחרת מהרשימה.',
  // Release confirmation
  rabbi_release_confirmation_body: 'כבוד הרב,\nהשאלה "{title}" (ID: {id}) שוחררה בהצלחה וזמינה כעת לרבנים אחרים.',
  // Answer confirmation from email
  rabbi_answer_confirmation_body: 'כבוד הרב,\nתשובתך לשאלה "{title}" (ID: {id}) התקבלה ונקלטה בהצלחה במערכת.\nתודה על המענה!',
  // Weekly report
  rabbi_weekly_report_subject: 'דוח שבועי — {system_name}',
  rabbi_weekly_report_body: 'כבוד הרב,\nלהלן סיכום הפעילות שלך השבוע.\nשאלות שנענו: {answered_count}\nזמן תגובה ממוצע: {avg_response_time}\nתודות שהתקבלו: {thank_count}',
  // Asker follow-up
  asker_follow_up_subject: 'שאלת המשך — {system_name}',
  asker_follow_up_body: 'שלום {name},\nנרשמה שאלת המשך לשאלתך "{title}".\nהרב יענה בהקדם.',
};

/** Cache for loaded templates (refreshed every 5 minutes) */
let _templateCache = null;
let _templateCacheTime = 0;
const TEMPLATE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Reads email templates from system_config with fallback to defaults.
 * Caches the result for 5 minutes.
 *
 * @returns {Promise<object>}
 */
async function getEmailTemplates() {
  const now = Date.now();
  if (_templateCache && (now - _templateCacheTime) < TEMPLATE_CACHE_TTL) {
    return _templateCache;
  }

  try {
    const { query } = require('../db/pool');
    const { rows } = await query(
      "SELECT value FROM system_config WHERE key = 'email_templates'"
    );

    if (rows.length > 0 && rows[0].value) {
      _templateCache = { ...EMAIL_TEMPLATE_DEFAULTS, ...rows[0].value };
    } else {
      _templateCache = { ...EMAIL_TEMPLATE_DEFAULTS };
    }
  } catch (err) {
    log.error({ err }, 'Failed to load email templates from DB');
    _templateCache = { ...EMAIL_TEMPLATE_DEFAULTS };
  }

  _templateCacheTime = now;
  return _templateCache;
}

/**
 * Replaces {variable} placeholders in a template string.
 *
 * @param {string} template  - Template string with {var} placeholders
 * @param {object} vars      - Key-value pairs for replacement
 * @returns {string}
 */
function resolveTemplate(template, vars = {}) {
  if (!template) return '';
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return vars[key] !== undefined ? String(vars[key]) : match;
  });
}

// ─── Transporter (lazy singleton) ─────────────────────────────────────────────

let _transporter = null;

/**
 * יוצר או מחזיר transporter קיים.
 * @returns {import('nodemailer').Transporter}
 */
function getTransporter() {
  if (_transporter) return _transporter;

  const provider = (process.env.EMAIL_PROVIDER || 'smtp').toLowerCase();

  if (provider === 'mailgun') {
    // Mailgun via nodemailer-mailgun-transport
    const mg = require('nodemailer-mailgun-transport');
    _transporter = nodemailer.createTransport(mg({
      auth: {
        api_key: process.env.MAILGUN_API_KEY,
        domain:  process.env.MAILGUN_DOMAIN,
      },
      host: process.env.MAILGUN_EU === 'true'
        ? 'api.eu.mailgun.net'
        : undefined,
    }));
  } else {
    // SMTP fallback
    _transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST || 'localhost',
      port:   parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }

  return _transporter;
}

/**
 * כתובת השולח המלאה.
 * @returns {string}
 */
function fromAddress() {
  const name    = process.env.EMAIL_FROM_NAME    || 'ענה את השואל';
  const address = process.env.EMAIL_FROM_ADDRESS || 'noreply@aneh-hashoel.co.il';
  return `"${name}" <${address}>`;
}

/**
 * כתובת בסיס האתר (ללא / סופי).
 * @returns {string}
 */
function appUrl() {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

/**
 * כתובת המייל הנכנס (inbound) אליה רבנים שולחים claim/release/answer.
 * @returns {string}
 */
function inboundEmail() {
  return process.env.EMAIL_INBOUND_ADDRESS || process.env.EMAIL_FROM_ADDRESS || '';
}

/**
 * בונה mailto: link לכפתור פעולה באימייל.
 * הכפתור פותח את לקוח המייל עם subject מוכן — הרב פשוט לוחץ שלח.
 *
 * @param {string} subject   נושא האימייל המוכן מראש
 * @param {string} [body]    גוף אופציונלי
 * @returns {string}  href למשמש
 */
function mailtoLink(subject, body = '') {
  const to  = inboundEmail();
  const enc = (s) => encodeURIComponent(s);
  return `mailto:${to}?subject=${enc(subject)}${body ? `&body=${enc(body)}` : ''}`;
}

// ─── sendEmail ───────────────────────────────────────────────────────────────

/**
 * שליחת אימייל בודד.
 *
 * @param {string} to          כתובת הנמען
 * @param {string} subject     נושא האימייל
 * @param {string} htmlContent תוכן HTML
 * @returns {Promise<object>}  תוצאת השליחה
 */
async function sendEmail(to, subject, htmlContent, options = {}) {
  try {
    // Support custom sender name via options.fromName
    const from = options.fromName
      ? `"${options.fromName}" <${process.env.EMAIL_FROM_ADDRESS || 'noreply@aneh-hashoel.co.il'}>`
      : fromAddress();

    const mailOptions = {
      from,
      to,
      subject,
      html:    htmlContent,
    };

    if (options.replyTo) {
      mailOptions.replyTo = options.replyTo;
    }

    if (options.headers) {
      mailOptions.headers = options.headers;
    }

    const result = await getTransporter().sendMail(mailOptions);

    log.info({ to, subject }, 'Email sent');
    return result;
  } catch (err) {
    log.error({ err, to, subject }, 'Error sending email');
    throw err;
  }
}

// ─── sendQuestionNotification ────────────────────────────────────────────────

/**
 * שליחת התראה על שאלה חדשה לרב — כותרת + כפתור מעבר למערכת.
 * לתפיסת השאלה — הרב משיב למייל עם המילה "תפוס" בלבד.
 *
 * @param {string} rabbiEmail  אימייל הרב
 * @param {object} question    אובייקט השאלה
 */
async function sendQuestionNotification(rabbiEmail, question) {
  const templates     = await getEmailTemplates();
  const systemName    = templates.rabbi_system_name;
  const categoryLabel = question.category_name || question.category || 'כללי';
  const isUrgent      = question.urgency === 'urgent' || question.urgency === 'critical';

  const vars = {
    system_name: systemName,
    title:       question.title || 'שאלה חדשה',
    id:          question.id,
  };

  const questionUrl = `${appUrl()}/questions/${question.id}`;
  const questionNumber = question.question_number || question.wp_post_id || question.id;
  const questionContent = question.content || '';
  // Strip HTML tags for plain text preview
  const contentPreview = questionContent.replace(/<[^>]*>/g, '').trim();

  const bodyText = resolveTemplate(templates.rabbi_new_question_body, vars);
  const bodyContent = `
    <p style="margin: 0 0 12px; font-size: 15px;">שלום רב,</p>
    <p style="margin: 0 0 12px; font-size: 15px;">${bodyText.replace(/\n/g, '<br/>')}</p>

    <div style="
      background-color: #f8f8fb;
      border-right: 4px solid ${BRAND_GOLD};
      padding: 16px 20px;
      margin: 16px 0;
      border-radius: 4px;
    ">
      <p style="margin: 0 0 8px; font-weight: bold; font-size: 16px; color: ${BRAND_NAVY};">
        ${question.title || 'שאלה ללא כותרת'}
        ${isUrgent ? `<span style="color:#cc0000; margin-right:8px;">⚠ דחוף</span>` : ''}
      </p>
      <p style="margin: 0; color: #666; font-size: 13px;">קטגוריה: ${categoryLabel}</p>
    </div>

    ${contentPreview ? `
    <div style="
      background-color: #ffffff;
      border: 1px solid #e5e5e5;
      border-right: 4px solid ${BRAND_NAVY};
      padding: 16px 20px;
      margin: 12px 0 16px;
      border-radius: 4px;
      font-size: 14px;
      color: #333;
      line-height: 1.7;
    ">
      <p style="margin: 0 0 6px; font-weight: bold; font-size: 12px; color: #999;">תוכן השאלה:</p>
      <p style="margin: 0;">${contentPreview.replace(/\n/g, '<br/>')}</p>
    </div>
    ` : ''}

    <p style="margin: 0 0 16px; font-size: 13px; color: #888;">
      השאלה תוקצה לרב הראשון שיתפוס אותה.
    </p>

    <div style="
      background-color: #fffbf0;
      border: 1px solid #e8d88a;
      border-right: 4px solid ${BRAND_GOLD};
      padding: 14px 18px;
      margin: 20px 0 0;
      border-radius: 4px;
      font-size: 13px;
      color: #444;
      line-height: 1.8;
    ">
      <p style="margin: 0 0 8px; font-weight: bold; color: ${BRAND_NAVY};">הנחיות לתגובה מהמייל:</p>
      <p style="margin: 0 0 4px;">• לתפיסת השאלה — השב למייל זה עם המילה: <strong>תפוס</strong></p>
      <p style="margin: 0 0 4px;">• לשחרור שאלה שתפסת — השב עם המילה: <strong>שחרר</strong></p>
      <p style="margin: 0; color: #cc4444; font-size: 12px;">
        ⚠ כל תוכן אחר חוץ מ"תפוס" או "שחרר" ייחשב כתשובה לשאלה ויפורסם מיידית.
      </p>
    </div>
  `;

  const html = createEmailHTML('שאלה חדשה ממתינה', bodyContent, [
    { label: 'צפה בשאלה', url: questionUrl, color: BRAND_GOLD },
  ]);

  const subject = `${isUrgent ? '[דחוף] ' : ''}[ID:${questionNumber}] ${resolveTemplate(templates.rabbi_new_question_subject, vars)}`;

  return sendEmail(rabbiEmail, subject, html, { replyTo: inboundEmail() });
}

// ─── sendFollowUpNotification ─────────────────────────────────────────────────

/**
 * שליחת התראה לרב על שאלת המשך מהשואל.
 * אם השאלה המקורית נשמרה עם email_message_id, האימייל נשלח עם כותרות
 * In-Reply-To ו-References כדי לקשר אותו לשרשור הקיים בתוכנת המייל.
 *
 * @param {string} rabbiEmail  אימייל הרב
 * @param {object} question    אובייקט השאלה (כולל id, title, email_message_id)
 * @param {string} followUpContent  תוכן שאלת ההמשך
 */
async function sendFollowUpNotification(rabbiEmail, question, followUpContent) {
  const questionUrl = `${appUrl()}/questions/${question.id}`;
  const subject     = `[ID: ${question.id}] שאלת המשך — ${question.title || 'שאלה'}`;

  const bodyContent = `
    <p style="margin: 0 0 12px; font-size: 15px;">שלום רב,</p>
    <p style="margin: 0 0 12px; font-size: 15px;">השואל הוסיף שאלת המשך לשאלה שטיפלת בה:</p>

    <div style="
      background-color: #f8f8fb;
      border-right: 4px solid ${BRAND_GOLD};
      padding: 16px 20px;
      margin: 16px 0;
      border-radius: 4px;
    ">
      <p style="margin: 0 0 8px; font-weight: bold; font-size: 15px; color: ${BRAND_NAVY};">
        ${question.title || 'שאלה'}
        <span style="font-weight: normal; color: #888; font-size: 13px; margin-right: 8px;">[ID: ${question.id}]</span>
      </p>
      <p style="margin: 0; color: #333; font-size: 14px; line-height: 1.7;">${followUpContent || ''}</p>
    </div>

    <p style="margin: 12px 0 4px; font-size: 13px; color: #888;">
      ניתן להשיב ישירות למייל זה — הכותרת כבר מכילה את [ID: ${question.id}].
    </p>
  `;

  const html = createEmailHTML('שאלת המשך מהשואל', bodyContent, [
    { label: 'צפה בשאלה', url: questionUrl, color: BRAND_GOLD },
  ]);

  const options = { replyTo: inboundEmail() };

  // Thread this email under the original broadcast if we have its Message-ID
  if (question.email_message_id) {
    options.headers = {
      'In-Reply-To': question.email_message_id,
      'References':  question.email_message_id,
    };
  }

  return sendEmail(rabbiEmail, subject, html, options);
}

// ─── sendFullQuestion ────────────────────────────────────────────────────────

/**
 * שליחת תוכן שאלה מלא לרב — לאחר שהשאלה נתפסה.
 *
 * כפתור "ענה על השאלה" מפנה למערכת.
 * לשחרור — הרב משיב למייל עם המילה "שחרר" בלבד.
 *
 * @param {string} rabbiEmail  אימייל הרב
 * @param {object} question    אובייקט השאלה
 */
async function sendFullQuestion(rabbiEmail, question) {
  const { query } = require('../db/pool');
  const templates  = await getEmailTemplates();
  const systemName = templates.rabbi_system_name;
  const vars = {
    system_name: systemName,
    title:       question.title || 'שאלה לטיפולך',
    id:          question.id,
    name:        question.asker_name || '',
  };

  // Fetch auto-release timeout from sla_config
  let timeoutHours = 4;
  try {
    const slaRes = await query('SELECT hours_to_timeout FROM sla_config WHERE id = 1');
    if (slaRes.rows[0]) timeoutHours = slaRes.rows[0].hours_to_timeout;
  } catch (_) { /* use default */ }

  const subject     = resolveTemplate(templates.rabbi_full_question_subject, vars);
  const questionUrl = `${appUrl()}/questions/${question.id}`;

  const bodyText = resolveTemplate(templates.rabbi_full_question_body, vars);
  const bodyContent = `
    <p style="margin: 0 0 12px; font-size: 15px;">${bodyText.replace(/\n/g, '<br/>')}</p>

    <div style="
      background-color: #f8f8fb;
      border-right: 4px solid ${BRAND_GOLD};
      padding: 20px 24px;
      margin: 16px 0;
      border-radius: 4px;
    ">
      <p style="margin: 0 0 12px; font-weight: bold; font-size: 17px; color: ${BRAND_NAVY};">
        ${question.title || 'שאלה ללא כותרת'}
      </p>
      <div style="margin: 0; color: #333; font-size: 15px; line-height: 1.8;">
        ${question.content || ''}
      </div>
      ${question.asker_name ? `<p style="margin: 12px 0 0; color: #888; font-size: 13px;">שואל/ת: ${question.asker_name}</p>` : ''}
    </div>

    <div style="
      background-color: #fffbf0;
      border: 1px solid #e8d88a;
      border-right: 4px solid ${BRAND_GOLD};
      padding: 14px 18px;
      margin: 20px 0 0;
      border-radius: 4px;
      font-size: 13px;
      color: #444;
      line-height: 1.9;
    ">
      <p style="margin: 0 0 8px; font-weight: bold; color: ${BRAND_NAVY};">הנחיות לתגובה מהמייל:</p>
      <p style="margin: 0 0 4px;">• לענות — כתוב את תשובתך בגוף המייל החוזר ושלח</p>
      <p style="margin: 0 0 4px;">• לשחרר את השאלה — השב עם המילה: <strong>שחרר</strong></p>
      <p style="margin: 0 0 4px; color: #888;">• השאלה תשתחרר אוטומטית לאחר <strong>${timeoutHours} שעות</strong> אם לא תענה</p>
      <p style="margin: 8px 0 0; color: #cc4444; font-size: 12px;">
        ⚠ כל תוכן אחר חוץ מ"שחרר" ייחשב כתשובה ויפורסם מיידית.
      </p>
    </div>
  `;

  const html = createEmailHTML('שאלה לטיפולך', bodyContent, [
    { label: 'ענה על השאלה', url: questionUrl, color: BRAND_GOLD },
  ]);

  // Reply-To → inbound parser catches replies automatically
  return sendEmail(rabbiEmail, subject, html, { replyTo: inboundEmail() });
}

// ─── sendAlreadyClaimed ──────────────────────────────────────────────────────

/**
 * מידע לרב שניסה לתפוס שאלה שכבר נתפסה.
 *
 * @param {string} rabbiEmail
 * @param {string} rabbiName
 * @param {number} questionId
 */
async function sendAlreadyClaimed(rabbiEmail, rabbiName, questionId) {
  const templates  = await getEmailTemplates();
  const systemName = templates.rabbi_system_name;

  const bodyContent = `
    <p style="margin: 0 0 12px; font-size: 15px;">שלום ${rabbiName || 'רב'},</p>
    <p style="margin: 0 0 12px; font-size: 15px;">
      השאלה #${questionId} כבר נתפסה על ידי רב אחר לפני הודעתך.
    </p>
    <p style="margin: 0; font-size: 14px; color: #888;">
      שאלות חדשות ישלחו אליך בהמשך.
    </p>
  `;

  const html = createEmailHTML('השאלה כבר נתפסה', bodyContent);
  return sendEmail(rabbiEmail, `השאלה כבר נתפסה — ${systemName}`, html);
}

// ─── sendReleaseConfirmation ──────────────────────────────────────────────────

/**
 * אישור שחרור שאלה לרב.
 *
 * @param {string} rabbiEmail
 * @param {string} rabbiName
 * @param {number} questionId
 */
async function sendReleaseConfirmation(rabbiEmail, rabbiName, questionId) {
  const templates  = await getEmailTemplates();
  const systemName = templates.rabbi_system_name;

  const bodyContent = `
    <p style="margin: 0 0 12px; font-size: 15px;">שלום ${rabbiName || 'רב'},</p>
    <p style="margin: 0; font-size: 15px;">
      השאלה #${questionId} שוחררה בהצלחה וחזרה לתור הממתינות.
    </p>
  `;

  const html = createEmailHTML('שאלה שוחררה', bodyContent);
  return sendEmail(rabbiEmail, `אישור שחרור שאלה — ${systemName}`, html);
}

// ─── sendAnswerConfirmation ───────────────────────────────────────────────────

/**
 * אישור לרב שתשובתו התקבלה ונשמרה.
 *
 * @param {string} rabbiEmail
 * @param {string} rabbiName
 * @param {number} questionId
 */
async function sendAnswerConfirmation(rabbiEmail, rabbiName, questionId) {
  const templates  = await getEmailTemplates();
  const systemName = templates.rabbi_system_name;

  const bodyContent = `
    <p style="margin: 0 0 12px; font-size: 15px;">שלום ${rabbiName || 'רב'},</p>
    <p style="margin: 0 0 12px; font-size: 15px;">
      תשובתך לשאלה #${questionId} התקבלה ונשמרה בהצלחה.
    </p>
    <p style="margin: 0; font-size: 14px; color: #888;">
      השואל יקבל הודעה בהקדם.
    </p>
  `;

  const html = createEmailHTML('תשובתך התקבלה', bodyContent);
  return sendEmail(rabbiEmail, `תשובתך לשאלה #${questionId} התקבלה — ${systemName}`, html);
}

// ─── sendThankNotification ───────────────────────────────────────────────────

/**
 * שליחת הודעת תודה לרב — גולש הודה על התשובה.
 *
 * @param {string} rabbiEmail  אימייל הרב
 * @param {object} question    אובייקט השאלה
 */
async function sendThankNotification(rabbiEmail, question) {
  const templates  = await getEmailTemplates();
  const systemName = templates.rabbi_system_name;
  const vars = {
    system_name: systemName,
    title:       question.title || 'שאלה',
    id:          question.id,
  };
  const viewUrl = `${appUrl()}/questions/${question.id}`;

  const thankSubject = resolveTemplate(templates.rabbi_thank_subject, vars);

  const bodyContent = `
    <p style="margin: 0 0 12px; font-size: 15px;">שלום רב,</p>
    <p style="margin: 0 0 16px; font-size: 15px;">
      גולש הודה לך על תשובתך לשאלה:
    </p>

    <div style="
      background-color: #fdf8ed;
      border-right: 4px solid ${BRAND_GOLD};
      padding: 16px 20px;
      margin: 16px 0;
      border-radius: 4px;
      text-align: center;
    ">
      <p style="margin: 0 0 8px; font-size: 28px;">🙏</p>
      <p style="margin: 0 0 8px; font-weight: bold; font-size: 16px; color: ${BRAND_NAVY};">
        "${question.title || 'שאלה'}"
      </p>
      <p style="margin: 0; color: ${BRAND_GOLD}; font-weight: bold; font-size: 15px;">
        תודה רבה על עזרתך!
      </p>
    </div>

    <p style="margin: 16px 0 0; color: #888; font-size: 13px;">
      כל תשובה שאתה נותן עוזרת לאנשים — ישר כוח!
    </p>
  `;

  const html = createEmailHTML('גולש הודה לך על תשובתך', bodyContent, [
    { label: 'צפה בשאלה', url: viewUrl, color: BRAND_GOLD },
  ]);

  return sendEmail(rabbiEmail, thankSubject, html);
}

// ─── sendThankNotificationEmail ──────────────────────────────────────────────

/**
 * שליחת הודעת תודה לרב כאשר גולש לוחץ "תודה" על תשובתו.
 * משתמש בתבנית המותג עם הנוסח המבוקש.
 *
 * @param {string} rabbiEmail  אימייל הרב
 * @param {object} question    אובייקט עם id ו-title
 */
async function sendThankNotificationEmail(rabbiEmail, question) {
  const templates  = await getEmailTemplates();
  const systemName = templates.rabbi_system_name;
  const vars = {
    system_name: systemName,
    title:       question.title || 'שאלה',
    id:          question.id,
  };

  const thankBody = resolveTemplate(templates.rabbi_thank_body, vars);
  const thankSubject = resolveTemplate(templates.rabbi_thank_subject, vars);

  const bodyContent = `
    <p style="margin: 0 0 12px; font-size: 15px;">${thankBody.replace(/\n/g, '<br/>')}</p>
  `;

  const html = createEmailHTML('תודה מגולש', bodyContent);

  return sendEmail(rabbiEmail, thankSubject, html);
}

// ─── sendWeeklyReport ────────────────────────────────────────────────────────

/**
 * שליחת דו"ח שבועי לרב.
 *
 * @param {string} rabbiEmail  אימייל הרב
 * @param {object} stats       נתוני סטטיסטיקה
 * @param {string} stats.weekStart
 * @param {string} stats.weekEnd
 * @param {number} stats.answersCount
 * @param {string|null} stats.avgResponseHours
 * @param {number} stats.totalThanks
 * @param {number} stats.urgentAnswered
 * @param {object} stats.global
 */
async function sendWeeklyReport(rabbiEmail, stats) {
  const dashboardUrl = `${appUrl()}/dashboard`;

  const bodyContent = `
    <p style="margin: 0 0 12px; font-size: 15px;">שלום רב,</p>
    <p style="margin: 0 0 16px; font-size: 15px;">
      להלן סיכום הפעילות שלך בשבוע ${stats.weekStart} — ${stats.weekEnd}:
    </p>

    <!-- סטטיסטיקות אישיות -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="margin: 16px 0; border-collapse: collapse;">
      <tr>
        <td style="
          background-color: ${BRAND_NAVY};
          color: ${BRAND_GOLD};
          padding: 16px;
          text-align: center;
          border-radius: 6px 6px 0 0;
          font-size: 14px;
          font-weight: bold;
        " colspan="4">
          הביצועים שלך השבוע
        </td>
      </tr>
      <tr>
        <td style="background:#f8f8fb; padding:14px; text-align:center; border:1px solid #eee;">
          <div style="font-size:24px; font-weight:bold; color:${BRAND_NAVY};">${stats.answersCount || 0}</div>
          <div style="font-size:12px; color:#888; margin-top:4px;">תשובות</div>
        </td>
        <td style="background:#f8f8fb; padding:14px; text-align:center; border:1px solid #eee;">
          <div style="font-size:24px; font-weight:bold; color:${BRAND_NAVY};">${stats.avgResponseHours || '—'}</div>
          <div style="font-size:12px; color:#888; margin-top:4px;">שעות (ממוצע)</div>
        </td>
        <td style="background:#f8f8fb; padding:14px; text-align:center; border:1px solid #eee;">
          <div style="font-size:24px; font-weight:bold; color:${BRAND_NAVY};">${stats.totalThanks || 0}</div>
          <div style="font-size:12px; color:#888; margin-top:4px;">תודות</div>
        </td>
        <td style="background:#f8f8fb; padding:14px; text-align:center; border:1px solid #eee;">
          <div style="font-size:24px; font-weight:bold; color:${BRAND_NAVY};">${stats.urgentAnswered || 0}</div>
          <div style="font-size:12px; color:#888; margin-top:4px;">דחופות</div>
        </td>
      </tr>
    </table>

    ${stats.global ? `
    <!-- סטטיסטיקות כלליות -->
    <p style="margin: 20px 0 8px; font-size: 14px; color: #888;">נתונים כלליים של המערכת:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="margin: 0 0 16px; border-collapse: collapse;">
      <tr>
        <td style="background:#f0f0f5; padding:10px 16px; border:1px solid #eee; font-size:14px;">
          שאלות חדשות: <strong>${stats.global.newQuestions}</strong>
        </td>
        <td style="background:#f0f0f5; padding:10px 16px; border:1px solid #eee; font-size:14px;">
          נענו: <strong>${stats.global.answeredQuestions}</strong>
        </td>
        <td style="background:#f0f0f5; padding:10px 16px; border:1px solid #eee; font-size:14px;">
          ממתינות: <strong>${stats.global.currentlyPending}</strong>
        </td>
      </tr>
    </table>
    ` : ''}

    <p style="margin: 12px 0 0; color: #888; font-size: 13px;">
      ישר כוח על הפעילות! כל תשובה עושה הבדל.
    </p>
  `;

  const html = createEmailHTML('דו"ח שבועי', bodyContent, [
    { label: 'לוח בקרה', url: dashboardUrl, color: BRAND_GOLD },
  ]);

  const templates  = await getEmailTemplates();
  const systemName = templates.rabbi_system_name;

  return sendEmail(rabbiEmail, `דו"ח שבועי — ${stats.weekStart} עד ${stats.weekEnd} — ${systemName}`, html);
}

// ─── sendPasswordReset ───────────────────────────────────────────────────────

/**
 * שליחת אימייל איפוס סיסמה.
 *
 * @param {string} email      כתובת הנמען
 * @param {string} resetLink  קישור לאיפוס הסיסמה
 */
async function sendPasswordReset(email, resetLink) {
  const bodyContent = `
    <p style="margin: 0 0 12px; font-size: 15px;">שלום,</p>
    <p style="margin: 0 0 12px; font-size: 15px;">
      קיבלנו בקשה לאיפוס הסיסמה שלך במערכת "ענה את השואל".
    </p>
    <p style="margin: 0 0 12px; font-size: 15px;">
      לחץ/י על הכפתור למטה כדי לבחור סיסמה חדשה:
    </p>
    <p style="margin: 20px 0 8px; color: #cc4444; font-size: 13px;">
      הקישור תקף ל-30 דקות בלבד. אם לא ביקשת איפוס סיסמה, ניתן להתעלם ממייל זה.
    </p>
  `;

  const html = createEmailHTML('איפוס סיסמה', bodyContent, [
    { label: 'איפוס סיסמה', url: resetLink, color: BRAND_GOLD },
  ]);

  const templates  = await getEmailTemplates();
  const systemName = templates.rabbi_system_name;

  return sendEmail(email, `איפוס סיסמה — ${systemName}`, html);
}

// ─── sendNewDeviceAlert ──────────────────────────────────────────────────────

/**
 * שליחת התראה על התחברות ממכשיר חדש.
 *
 * @param {string} email       כתובת הנמען
 * @param {object} deviceInfo  מידע על המכשיר
 * @param {string} deviceInfo.userAgent
 * @param {string} deviceInfo.ip
 * @param {string} deviceInfo.timestamp
 */
async function sendNewDeviceAlert(email, deviceInfo) {
  const bodyContent = `
    <p style="margin: 0 0 12px; font-size: 15px;">שלום,</p>
    <p style="margin: 0 0 16px; font-size: 15px;">
      זוהתה התחברות חדשה לחשבונך ממכשיר שלא היה מוכר עד כה:
    </p>

    <div style="
      background-color: #fff8f0;
      border-right: 4px solid #e67e22;
      padding: 16px 20px;
      margin: 16px 0;
      border-radius: 4px;
    ">
      <table role="presentation" cellpadding="4" cellspacing="0" style="width:100%; font-size:14px;">
        <tr>
          <td style="color:#888; white-space:nowrap; padding-left:12px;">זמן:</td>
          <td style="color:#333; font-weight:500;">${deviceInfo.timestamp || 'לא ידוע'}</td>
        </tr>
        <tr>
          <td style="color:#888; white-space:nowrap; padding-left:12px;">כתובת IP:</td>
          <td style="color:#333; font-weight:500;">${deviceInfo.ip || 'לא ידוע'}</td>
        </tr>
        <tr>
          <td style="color:#888; white-space:nowrap; padding-left:12px;">דפדפן:</td>
          <td style="color:#333; font-weight:500;">${deviceInfo.userAgent || 'לא ידוע'}</td>
        </tr>
      </table>
    </div>

    <p style="margin: 16px 0 0; color: #cc4444; font-size: 14px; font-weight: bold;">
      אם לא אתה התחברת — מומלץ לשנות את הסיסמה מיד.
    </p>
  `;

  const html = createEmailHTML('התחברות ממכשיר חדש', bodyContent, [
    { label: 'שנה סיסמה', url: `${appUrl()}/profile?tab=security`, color: '#cc4444' },
  ]);

  const templates  = await getEmailTemplates();
  const systemName = templates.rabbi_system_name;

  return sendEmail(email, `התחברות ממכשיר חדש — ${systemName}`, html);
}

// ─── sendSupportReply ─────────────────────────────────────────────────────────

/**
 * שליחת אימייל לרב כאשר ההנהלה מגיבה לפנייתו.
 *
 * @param {string} rabbiEmail   אימייל הרב
 * @param {string} rabbiName    שם הרב
 * @param {string} replyContent תוכן תשובת ההנהלה
 */
async function sendSupportReply(rabbiEmail, rabbiName, replyContent) {
  const templates  = await getEmailTemplates();
  const systemName = templates.rabbi_system_name;

  const bodyContent = `
    <p style="margin: 0 0 12px; font-size: 15px;">כבוד הרב ${rabbiName},</p>
    <p style="margin: 0 0 16px; font-size: 15px;">
      ההנהלה השיבה לפנייתך במערכת.
    </p>

    <div style="
      background-color: #f7f5f0;
      border-right: 4px solid #C9A84C;
      padding: 16px 20px;
      margin: 16px 0;
      border-radius: 4px;
      font-size: 15px;
      line-height: 1.7;
      color: #333;
      white-space: pre-wrap;
    ">${replyContent.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>

    <p style="margin: 16px 0 0; font-size: 14px; color: #666;">
      להצגת השיחה המלאה היכנס למערכת ועבור לדף "פנייה לניהול".
    </p>
  `;

  const html = createEmailHTML(
    `תשובה מההנהלה`,
    bodyContent,
    [{ label: 'צפה בפנייה', url: `${appUrl()}/support` }]
  );

  return sendEmail(rabbiEmail, `תשובה מההנהלה — ${systemName}`, html);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  sendEmail,
  sendQuestionNotification,
  sendFullQuestion,
  sendAlreadyClaimed,
  sendReleaseConfirmation,
  sendAnswerConfirmation,
  sendThankNotification,
  sendThankNotificationEmail,
  sendWeeklyReport,
  sendPasswordReset,
  sendNewDeviceAlert,
  sendSupportReply,
  sendFollowUpNotification,
  // Template utilities
  getEmailTemplates,
  resolveTemplate,
  EMAIL_TEMPLATE_DEFAULTS,
};
