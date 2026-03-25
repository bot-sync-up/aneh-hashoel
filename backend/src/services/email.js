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
    const mailOptions = {
      from:    fromAddress(),
      to,
      subject,
      html:    htmlContent,
    };

    if (options.replyTo) {
      mailOptions.replyTo = options.replyTo;
    }

    const result = await getTransporter().sendMail(mailOptions);

    console.info(`[email] נשלח אימייל אל ${to} — נושא: ${subject}`);
    return result;
  } catch (err) {
    console.error(`[email] שגיאה בשליחת אימייל אל ${to}:`, err.message);
    throw err;
  }
}

// ─── sendQuestionNotification ────────────────────────────────────────────────

/**
 * שליחת התראה על שאלה חדשה לרב — כותרת + כפתור "קבל שאלה" כ-mailto.
 * לחיצה על "קבל שאלה" פותחת לקוח מייל עם subject=[CLAIM:ID] מוכן לשליחה.
 *
 * @param {string} rabbiEmail  אימייל הרב
 * @param {object} question    אובייקט השאלה
 */
async function sendQuestionNotification(rabbiEmail, question) {
  const categoryLabel = question.category_name || question.category || 'כללי';
  const isUrgent      = question.urgency === 'urgent' || question.urgency === 'critical';

  const claimUrl = mailtoLink(
    `[CLAIM:${question.id}] ${question.title || 'שאלה חדשה'}`,
    'שלח מייל זה כדי לקבל את השאלה לטיפולך'
  );

  const bodyContent = `
    <p style="margin: 0 0 12px; font-size: 15px;">שלום רב,</p>
    <p style="margin: 0 0 12px; font-size: 15px;">שאלה חדשה ממתינה לתשובה:</p>

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

    <p style="margin: 0 0 4px; font-size: 13px; color: #555;">
      לחץ על "קבל שאלה" — ייפתח לקוח המייל שלך עם הנושא מוכן, פשוט לחץ שלח.
    </p>
    <p style="margin: 0 0 16px; font-size: 13px; color: #888;">
      השאלה תוקצה לרב הראשון ששולח.
    </p>
  `;

  const html = createEmailHTML('שאלה חדשה ממתינה', bodyContent, [
    { label: 'קבל שאלה', url: claimUrl, color: BRAND_GOLD },
  ]);

  const subject = `${isUrgent ? '[דחוף] ' : ''}שאלה חדשה — ${question.title || 'ענה את השואל'}`;

  return sendEmail(rabbiEmail, subject, html);
}

// ─── sendFullQuestion ────────────────────────────────────────────────────────

/**
 * שליחת תוכן שאלה מלא לרב — לאחר שהשאלה נתפסה.
 *
 * כל הכפתורים הם mailto: links — ללא תלות באתר.
 *   "ענה"       → reply-to כבר מוגדר, כפתור פותח compose עם [ID:X] בנושא
 *   "שחרר"      → compose עם [RELEASE:X] בנושא
 *
 * @param {string} rabbiEmail  אימייל הרב
 * @param {object} question    אובייקט השאלה
 */
async function sendFullQuestion(rabbiEmail, question) {
  const subject    = `[ID: ${question.id}] ${question.title || 'שאלה לטיפולך'} — ענה את השואל`;
  const answerUrl  = mailtoLink(subject, '');   // reply keeps same subject → [ID:X] parsed
  const releaseUrl = mailtoLink(`[RELEASE:${question.id}] שחרור שאלה`, '');

  const bodyContent = `
    <p style="margin: 0 0 12px; font-size: 15px;">שלום רב,</p>
    <p style="margin: 0 0 12px; font-size: 15px;">להלן השאלה שקיבלת לטיפולך:</p>

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

    <p style="margin: 0 0 16px; font-size: 14px; color: #444; font-weight: 500;">
      <strong>להשיב:</strong> לחץ על "ענה על השאלה" — ייפתח מייל עם הנושא הנכון, כתוב את תשובתך ושלח.
    </p>
  `;

  const html = createEmailHTML('שאלה לטיפולך', bodyContent, [
    { label: 'ענה על השאלה', url: answerUrl,  color: BRAND_GOLD },
    { label: 'שחרר שאלה',   url: releaseUrl, color: '#cc4444'  },
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
  return sendEmail(rabbiEmail, 'השאלה כבר נתפסה — ענה את השואל', html);
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
  const bodyContent = `
    <p style="margin: 0 0 12px; font-size: 15px;">שלום ${rabbiName || 'רב'},</p>
    <p style="margin: 0; font-size: 15px;">
      השאלה #${questionId} שוחררה בהצלחה וחזרה לתור הממתינות.
    </p>
  `;

  const html = createEmailHTML('שאלה שוחררה', bodyContent);
  return sendEmail(rabbiEmail, 'אישור שחרור שאלה — ענה את השואל', html);
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
  return sendEmail(rabbiEmail, `תשובתך לשאלה #${questionId} התקבלה — ענה את השואל`, html);
}

// ─── sendThankNotification ───────────────────────────────────────────────────

/**
 * שליחת הודעת תודה לרב — גולש הודה על התשובה.
 *
 * @param {string} rabbiEmail  אימייל הרב
 * @param {object} question    אובייקט השאלה
 */
async function sendThankNotification(rabbiEmail, question) {
  const viewUrl = `${appUrl()}/questions/${question.id}`;

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

  return sendEmail(rabbiEmail, 'גולש הודה לך על תשובתך — ענה את השואל', html);
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

  return sendEmail(rabbiEmail, `דו"ח שבועי — ${stats.weekStart} עד ${stats.weekEnd} — ענה את השואל`, html);
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

  return sendEmail(email, 'איפוס סיסמה — ענה את השואל', html);
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

  return sendEmail(email, 'התחברות ממכשיר חדש — ענה את השואל', html);
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
  sendWeeklyReport,
  sendPasswordReset,
  sendNewDeviceAlert,
};
