'use strict';

/**
 * Email Service — SendGrid
 *
 * Outbound email for the "ענה את השואל" platform.
 * All transactional email is sent via @sendgrid/mail.
 * HTML bodies are rendered from file-based Handlebars-style templates
 * (templates/emails/*.html) using a lightweight token-replacement helper.
 *
 * Environment variables:
 *   SENDGRID_API_KEY      – SendGrid API key (required)
 *   EMAIL_FROM_ADDRESS    – sender address  (default: noreply@aneh-hashoel.co.il)
 *   EMAIL_FROM_NAME       – sender name     (default: ענה את השואל)
 *   APP_URL               – rabbi app base URL (no trailing slash)
 *   WP_SITE_URL           – WordPress site base URL (asker-facing)
 *
 * Action tokens:
 *   All rabbi-facing action buttons embed a signed JWT produced by
 *   ../utils/actionTokens.  The token is passed as ?token= on the
 *   /api/questions/claim/:id endpoint (or /api/action/* endpoints) so
 *   the rabbi can perform the action from email without logging in.
 */

const sgMail = require('@sendgrid/mail');
const path   = require('path');
const fs     = require('fs');

const {
  createClaimToken,
  createReleaseToken,
  createAnswerToken,
  createFollowUpToken,
} = require('../utils/actionTokens');

// ─── SendGrid initialization ─────────────────────────────────────────────────

sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

// ─── Template engine ─────────────────────────────────────────────────────────

const TEMPLATE_DIR = path.join(__dirname, '..', 'templates', 'emails');

/** Cache rendered template source in memory (process restart clears it). */
const _templateCache = new Map();

/**
 * Load an HTML template file and return its source string.
 * Results are cached to avoid disk I/O on every send.
 *
 * @param {string} name  Template filename without extension (e.g. 'new-question-broadcast')
 * @returns {string}
 */
function loadTemplate(name) {
  if (_templateCache.has(name)) {
    return _templateCache.get(name);
  }
  const filePath = path.join(TEMPLATE_DIR, `${name}.html`);
  const src = fs.readFileSync(filePath, 'utf8');
  _templateCache.set(name, src);
  return src;
}

/**
 * Render a template by replacing all {{key}} placeholders with values.
 * Unknown keys are left as empty strings.
 *
 * @param {string} templateName   Name of the template (without .html)
 * @param {Record<string, string|number>} vars  Substitution map
 * @returns {string}  Rendered HTML
 */
function renderTemplate(templateName, vars) {
  let html = loadTemplate(templateName);
  return html.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = vars[key];
    return val !== undefined && val !== null ? String(val) : '';
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Full "Name <address>" sender string. */
function fromField() {
  return {
    name:  process.env.EMAIL_FROM_NAME    || 'ענה את השואל',
    email: process.env.EMAIL_FROM_ADDRESS || 'noreply@aneh-hashoel.co.il',
  };
}

/** Rabbi-facing app base URL (no trailing slash). */
function appUrl() {
  return (process.env.APP_URL || 'https://app.aneh-hashoel.co.il').replace(/\/$/, '');
}

/** WordPress (asker-facing) site base URL. */
function wpUrl() {
  return (process.env.WP_SITE_URL || '').replace(/\/$/, '');
}

/**
 * Low-level send wrapper.
 *
 * @param {object} msg   SendGrid message object
 * @returns {Promise<void>}
 */
async function _send(msg) {
  try {
    await sgMail.send({ ...msg, from: fromField() });
    console.info(`[emailService] sent "${msg.subject}" → ${Array.isArray(msg.to) ? msg.to.join(', ') : msg.to}`);
  } catch (err) {
    const detail = err.response ? JSON.stringify(err.response.body) : err.message;
    console.error(`[emailService] SendGrid error sending "${msg.subject}": ${detail}`);
    throw err;
  }
}

/**
 * Build a signed action token URL for /api/questions/claim/:id.
 *
 * @param {string|number} questionId
 * @returns {string}  Full URL with ?token=
 */
function claimUrl(questionId) {
  const token = createClaimToken(questionId);
  return `${appUrl()}/api/questions/claim/${questionId}?token=${token}`;
}

/**
 * Build a signed release-claim URL.
 *
 * @param {string|number} questionId
 * @param {string|number} rabbiId
 * @returns {string}
 */
function releaseUrl(questionId, rabbiId) {
  const token = createReleaseToken(questionId, rabbiId);
  return `${appUrl()}/api/action/release?token=${token}`;
}

/**
 * Build a signed answer-editor deep-link URL.
 *
 * @param {string|number} questionId
 * @param {string|number} rabbiId
 * @returns {string}
 */
function answerEditorUrl(questionId, rabbiId) {
  const token = createAnswerToken(questionId, rabbiId);
  return `${appUrl()}/api/action/answer?token=${token}`;
}

/**
 * Build a signed follow-up reply URL.
 *
 * @param {string|number} questionId
 * @param {string|number} rabbiId
 * @returns {string}
 */
function followUpUrl(questionId, rabbiId) {
  const token = createFollowUpToken(questionId, rabbiId);
  return `${appUrl()}/api/action/followup?token=${token}`;
}

/** Format a JS Date (or ISO string) as Hebrew-locale date+time. */
function formatDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString('he-IL', {
      day:    '2-digit',
      month:  '2-digit',
      year:   'numeric',
      hour:   '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(d);
  }
}

/** Truncate a string to maxLen characters, appending '...' if truncated. */
function truncate(str, maxLen = 80) {
  if (!str) return '';
  return str.length > maxLen ? `${str.slice(0, maxLen)}...` : str;
}

// ─── sendNewQuestionBroadcast ─────────────────────────────────────────────────

/**
 * Broadcast a new question summary to all (or a subset of) rabbis.
 * Each rabbi receives a personalised email with a signed "אני רוצה לענות"
 * button that fires POST /api/questions/claim/:id?token=ACTION_TOKEN.
 *
 * The claim token expires in 24 h and is tied to the question ID only
 * (not a specific rabbi) so that any rabbi who opens the email can claim it
 * first-come, first-served.
 *
 * @param {Array<{ id: string|number, email: string, name?: string }>} rabbis
 * @param {{
 *   id: string|number,
 *   title?: string,
 *   content?: string,
 *   category_name?: string,
 *   urgency?: string,
 *   created_at?: string|Date,
 * }} question
 * @returns {Promise<void>}
 */
async function sendNewQuestionBroadcast(rabbis, question) {
  if (!rabbis || rabbis.length === 0) return;

  const isUrgent        = question.urgency === 'urgent';
  const urgencyBadge    = isUrgent ? '<span style="background:#cc0000;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;margin-right:8px;">דחוף</span>' : '';
  const categoryLabel   = question.category_name || 'כללי';
  const titleTruncated  = truncate(question.title || 'שאלה חדשה', 80);
  const preview         = truncate(question.content || '', 200);
  const submitTime      = formatDate(question.created_at);

  const subjectPrefix   = isUrgent ? '[דחוף] ' : '';
  const subject         = `${subjectPrefix}שאלה חדשה ממתינה לתשובה — ${titleTruncated}`;

  // Send individually so each token is scoped (future: per-rabbi claim token)
  const promises = rabbis.map((rabbi) => {
    const actionUrl = claimUrl(question.id);

    const html = renderTemplate('new-question-broadcast', {
      rabbiName:     rabbi.name || 'הרב',
      questionTitle: titleTruncated,
      questionId:    question.id,
      category:      categoryLabel,
      urgencyBadge,
      preview,
      submitTime,
      claimUrl:      actionUrl,
    });

    return _send({ to: rabbi.email, subject, html });
  });

  await Promise.allSettled(promises);
}

// ─── sendQuestionAssigned ─────────────────────────────────────────────────────

/**
 * Personal notification to the rabbi who just claimed the question.
 * Contains the full question content, attachment links, and a
 * "ביטול תפיסה" action button (signed release token).
 *
 * Subject MUST contain [ID: {questionId}] so inbound email replies are
 * matched back to the correct question by emailParser.
 *
 * @param {{ id: string|number, email: string, name?: string }} rabbi
 * @param {{
 *   id: string|number,
 *   title?: string,
 *   content?: string,
 *   category_name?: string,
 *   urgency?: string,
 *   asker_name?: string,
 *   created_at?: string|Date,
 *   attachments?: Array<{ url: string, filename?: string }>,
 * }} question
 * @returns {Promise<void>}
 */
async function sendQuestionAssigned(rabbi, question) {
  const subject = `[ID: ${question.id}] ${question.title || 'שאלה לטיפולך'} — ענה את השואל`;

  // Build attachment links HTML
  const attachmentsHtml = (question.attachments || []).length > 0
    ? `<div style="margin-top:16px;">
        <p style="font-weight:bold;margin:0 0 8px;">קבצים מצורפים:</p>
        <ul style="margin:0;padding-right:20px;">
          ${question.attachments.map((a) =>
            `<li><a href="${a.url}" target="_blank" rel="noopener noreferrer" style="color:#1B2B5E;">${a.filename || a.url}</a></li>`
          ).join('\n')}
        </ul>
      </div>`
    : '';

  const urgencyBadge  = question.urgency === 'urgent'
    ? '<span style="background:#cc0000;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;margin-right:8px;">דחוף</span>'
    : '';

  const html = renderTemplate('question-assigned', {
    rabbiName:      rabbi.name || 'הרב',
    questionId:     question.id,
    questionTitle:  question.title || 'שאלה ללא כותרת',
    category:       question.category_name || 'כללי',
    urgencyBadge,
    questionContent: question.content || '',
    askerName:      question.asker_name || '',
    submitTime:     formatDate(question.created_at),
    attachmentsHtml,
    releaseUrl:     releaseUrl(question.id, rabbi.id),
    answerUrl:      answerEditorUrl(question.id, rabbi.id),
  });

  return _send({ to: rabbi.email, subject, html });
}

// ─── sendAnswerToAsker ────────────────────────────────────────────────────────

/**
 * Notify the original asker that their question has been answered.
 * Includes a link to the full answer on the WordPress site.
 *
 * @param {string} askerEmail
 * @param {{ id: string|number, title?: string }} question
 * @param {{ content?: string }} answer
 * @param {string} answerUrl  Full URL on the WordPress site
 * @returns {Promise<void>}
 */
async function sendAnswerToAsker(askerEmail, question, answer, answerUrl) {
  const subject = `יש תשובה לשאלתך — ענה את השואל`;

  const html = renderTemplate('answer-notification', {
    questionTitle: question.title || 'שאלתך',
    questionId:    question.id,
    answerPreview: truncate(answer.content || '', 300),
    answerUrl:     answerUrl || `${wpUrl()}/question/${question.id}`,
  });

  return _send({ to: askerEmail, subject, html });
}

// ─── sendFollowUpToRabbi ──────────────────────────────────────────────────────

/**
 * Alert the assigned rabbi that the asker sent a follow-up question.
 *
 * @param {{ id: string|number, email: string, name?: string }} rabbi
 * @param {{ id: string|number, title?: string, content?: string }} question
 * @param {string} followUpContent  The asker's follow-up text
 * @returns {Promise<void>}
 */
async function sendFollowUpToRabbi(rabbi, question, followUpContent) {
  const subject = `[ID: ${question.id}] שאלת המשך מהשואל — ${truncate(question.title || '', 60)}`;

  const actionUrl = followUpUrl(question.id, rabbi.id);

  const { createEmailHTML, BRAND_NAVY, BRAND_GOLD } = require('../templates/emailBase');

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:15px;">שלום ${rabbi.name || 'הרב'},</p>
    <p style="margin:0 0 12px;font-size:15px;">השואל הוסיף שאלת המשך לשאלה שטיפלת בה:</p>

    <div style="background:#f8f8fb;border-right:4px solid ${BRAND_GOLD};padding:16px 20px;margin:16px 0;border-radius:4px;">
      <p style="margin:0 0 8px;font-weight:bold;font-size:15px;color:${BRAND_NAVY};">
        ${question.title || 'שאלה'}
        <span style="font-weight:normal;color:#888;font-size:13px;margin-right:8px;">[ID: ${question.id}]</span>
      </p>
      <p style="margin:0;color:#333;font-size:14px;white-space:pre-wrap;line-height:1.7;">${followUpContent || ''}</p>
    </div>

    <p style="margin:12px 0 4px;color:#888;font-size:13px;">
      ניתן להשיב ישירות למייל זה — הכותרת כבר מכילה את [ID: ${question.id}].
    </p>
  `;

  const html = createEmailHTML('שאלת המשך מהשואל', bodyHtml, [
    { label: 'מענה על שאלת ההמשך', url: actionUrl, color: BRAND_GOLD },
  ]);

  return _send({ to: rabbi.email, subject, html });
}

// ─── sendFollowUpAnswerToAsker ────────────────────────────────────────────────

/**
 * Notify the asker that a follow-up answer is ready.
 *
 * @param {string} askerEmail
 * @param {{ id: string|number, title?: string }} question
 * @param {string} followUpAnswer  The rabbi's follow-up answer text
 * @param {string} url             Link to the full thread on WordPress
 * @returns {Promise<void>}
 */
async function sendFollowUpAnswerToAsker(askerEmail, question, followUpAnswer, url) {
  const { createEmailHTML, BRAND_NAVY, BRAND_GOLD } = require('../templates/emailBase');

  const subject = `תשובת המשך לשאלתך — ענה את השואל`;

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:15px;">שלום,</p>
    <p style="margin:0 0 12px;font-size:15px;">הרב הוסיף תשובת המשך לשאלתך:</p>

    <div style="background:#f8f8fb;border-right:4px solid ${BRAND_GOLD};padding:16px 20px;margin:16px 0;border-radius:4px;">
      <p style="margin:0 0 8px;font-weight:bold;font-size:15px;color:${BRAND_NAVY};">${question.title || 'שאלתך'}</p>
      <p style="margin:0;color:#333;font-size:14px;white-space:pre-wrap;line-height:1.7;">${truncate(followUpAnswer || '', 400)}</p>
    </div>
  `;

  const html = createEmailHTML('תשובת המשך לשאלתך', bodyHtml, [
    { label: 'לצפייה בתשובה המלאה', url: url || `${wpUrl()}/question/${question.id}`, color: BRAND_GOLD },
  ]);

  return _send({ to: askerEmail, subject, html });
}

// ─── sendThankNotification ────────────────────────────────────────────────────

/**
 * Tell a rabbi that the asker thanked them for their answer.
 *
 * @param {{ id: string|number, email: string, name?: string }} rabbi
 * @param {{ id: string|number, title?: string }} question
 * @returns {Promise<void>}
 */
async function sendThankNotification(rabbi, question) {
  const { createEmailHTML, BRAND_NAVY, BRAND_GOLD } = require('../templates/emailBase');

  const viewUrl = `${appUrl()}/questions/${question.id}`;
  const subject = 'גולש הודה לך על תשובתך — ענה את השואל';

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:15px;">שלום ${rabbi.name || 'הרב'},</p>
    <p style="margin:0 0 16px;font-size:15px;">גולש הודה לך על תשובתך לשאלה:</p>

    <div style="background:#fdf8ed;border-right:4px solid ${BRAND_GOLD};padding:20px;margin:16px 0;border-radius:4px;text-align:center;">
      <p style="margin:0 0 8px;font-size:32px;">🙏</p>
      <p style="margin:0 0 8px;font-weight:bold;font-size:16px;color:${BRAND_NAVY};">"${question.title || 'שאלה'}"</p>
      <p style="margin:0;color:${BRAND_GOLD};font-weight:bold;font-size:15px;">תודה רבה על עזרתך!</p>
    </div>

    <p style="margin:16px 0 0;color:#888;font-size:13px;">כל תשובה שאתה נותן עוזרת לאנשים — ישר כוח!</p>
  `;

  const html = createEmailHTML('גולש הודה לך על תשובתך', bodyHtml, [
    { label: 'צפה בשאלה', url: viewUrl, color: BRAND_GOLD },
  ]);

  return _send({ to: rabbi.email, subject, html });
}

// ─── sendWeeklyReport ─────────────────────────────────────────────────────────

/**
 * Send a weekly personal-stats digest to a rabbi.
 *
 * @param {{ id: string|number, email: string, name?: string }} rabbi
 * @param {{
 *   weekStart: string,
 *   weekEnd: string,
 *   answersCount: number,
 *   viewsCount?: number,
 *   thanksCount?: number,
 *   avgResponseHours?: string|number,
 *   urgentAnswered?: number,
 *   rank?: number,
 *   global?: { newQuestions: number, answeredQuestions: number, currentlyPending: number },
 * }} stats
 * @returns {Promise<void>}
 */
async function sendWeeklyReport(rabbi, stats) {
  const { createEmailHTML, BRAND_NAVY, BRAND_GOLD } = require('../templates/emailBase');

  const subject     = `דו"ח שבועי — ${stats.weekStart} עד ${stats.weekEnd} — ענה את השואל`;
  const dashUrl     = `${appUrl()}/dashboard`;

  const rankBadge = stats.rank && stats.rank <= 3
    ? `<p style="text-align:center;margin:12px 0 0;font-size:14px;color:${BRAND_GOLD};font-weight:bold;">🏆 דירוג שבועי: #${stats.rank}</p>`
    : '';

  const globalSection = stats.global ? `
    <p style="margin:24px 0 8px;font-size:14px;color:#888;">נתוני מערכת כלליים:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr>
        <td style="background:#f0f0f5;padding:10px 16px;border:1px solid #e0e0e8;font-size:14px;">
          שאלות חדשות: <strong>${stats.global.newQuestions}</strong>
        </td>
        <td style="background:#f0f0f5;padding:10px 16px;border:1px solid #e0e0e8;font-size:14px;">
          נענו: <strong>${stats.global.answeredQuestions}</strong>
        </td>
        <td style="background:#f0f0f5;padding:10px 16px;border:1px solid #e0e0e8;font-size:14px;">
          ממתינות: <strong>${stats.global.currentlyPending}</strong>
        </td>
      </tr>
    </table>` : '';

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:15px;">שלום ${rabbi.name || 'הרב'},</p>
    <p style="margin:0 0 16px;font-size:15px;">להלן סיכום פעילותך בשבוע <strong>${stats.weekStart} — ${stats.weekEnd}</strong>:</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;">
      <tr>
        <td colspan="4" style="background:${BRAND_NAVY};color:${BRAND_GOLD};padding:14px;text-align:center;border-radius:6px 6px 0 0;font-size:14px;font-weight:bold;">
          הביצועים שלך השבוע
        </td>
      </tr>
      <tr>
        <td style="background:#f8f8fb;padding:18px 12px;text-align:center;border:1px solid #eee;">
          <div style="font-size:28px;font-weight:bold;color:${BRAND_NAVY};">${stats.answersCount || 0}</div>
          <div style="font-size:12px;color:#888;margin-top:4px;">תשובות</div>
        </td>
        <td style="background:#f8f8fb;padding:18px 12px;text-align:center;border:1px solid #eee;">
          <div style="font-size:28px;font-weight:bold;color:${BRAND_NAVY};">${stats.viewsCount || 0}</div>
          <div style="font-size:12px;color:#888;margin-top:4px;">צפיות</div>
        </td>
        <td style="background:#f8f8fb;padding:18px 12px;text-align:center;border:1px solid #eee;">
          <div style="font-size:28px;font-weight:bold;color:${BRAND_NAVY};">${stats.thanksCount || 0}</div>
          <div style="font-size:12px;color:#888;margin-top:4px;">תודות</div>
        </td>
        <td style="background:#f8f8fb;padding:18px 12px;text-align:center;border:1px solid #eee;">
          <div style="font-size:28px;font-weight:bold;color:${BRAND_NAVY};">${stats.avgResponseHours || '—'}</div>
          <div style="font-size:12px;color:#888;margin-top:4px;">שעות (ממוצע)</div>
        </td>
      </tr>
    </table>

    ${rankBadge}
    ${globalSection}

    <p style="margin:20px 0 0;color:#888;font-size:13px;">ישר כוח על הפעילות! כל תשובה עושה הבדל.</p>
  `;

  const html = createEmailHTML('דו"ח שבועי', bodyHtml, [
    { label: 'לוח בקרה', url: dashUrl, color: BRAND_GOLD },
  ]);

  return _send({ to: rabbi.email, subject, html });
}

// ─── sendNewDeviceAlert ───────────────────────────────────────────────────────

/**
 * Security alert — new (unrecognised) device login detected.
 *
 * @param {{ id: string|number, email: string, name?: string }} rabbi
 * @param {{ userAgent?: string, ip?: string, timestamp?: string|Date, location?: string }} deviceInfo
 * @returns {Promise<void>}
 */
async function sendNewDeviceAlert(rabbi, deviceInfo) {
  const { createEmailHTML, BRAND_NAVY } = require('../templates/emailBase');

  const subject     = 'התחברות ממכשיר חדש — ענה את השואל';
  const securityUrl = `${appUrl()}/settings/security`;

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:15px;">שלום ${rabbi.name || 'הרב'},</p>
    <p style="margin:0 0 16px;font-size:15px;">זוהתה התחברות לחשבונך ממכשיר שלא זוהה בעבר:</p>

    <div style="background:#fff8f0;border-right:4px solid #e67e22;padding:16px 20px;margin:16px 0;border-radius:4px;">
      <table role="presentation" cellpadding="6" cellspacing="0" style="width:100%;font-size:14px;">
        <tr>
          <td style="color:#888;white-space:nowrap;padding-left:16px;font-weight:bold;">זמן:</td>
          <td style="color:#333;">${formatDate(deviceInfo.timestamp) || 'לא ידוע'}</td>
        </tr>
        <tr>
          <td style="color:#888;white-space:nowrap;padding-left:16px;font-weight:bold;">כתובת IP:</td>
          <td style="color:#333;">${deviceInfo.ip || 'לא ידוע'}</td>
        </tr>
        ${deviceInfo.location ? `<tr>
          <td style="color:#888;white-space:nowrap;padding-left:16px;font-weight:bold;">מיקום:</td>
          <td style="color:#333;">${deviceInfo.location}</td>
        </tr>` : ''}
        <tr>
          <td style="color:#888;white-space:nowrap;padding-left:16px;font-weight:bold;">דפדפן/מכשיר:</td>
          <td style="color:#333;">${deviceInfo.userAgent || 'לא ידוע'}</td>
        </tr>
      </table>
    </div>

    <p style="margin:16px 0 0;color:#cc4444;font-size:14px;font-weight:bold;">
      אם לא אתה ביצעת פעולה זו — שנה את סיסמתך מיד.
    </p>
  `;

  const html = createEmailHTML('התחברות ממכשיר חדש', bodyHtml, [
    { label: 'שנה סיסמה', url: securityUrl, color: '#cc4444' },
  ]);

  return _send({ to: rabbi.email, subject, html });
}

// ─── sendPasswordResetEmail ───────────────────────────────────────────────────

/**
 * Send a password-reset link to a rabbi.
 *
 * @param {{ id: string|number, email: string, name?: string }} rabbi
 * @param {string} resetUrl  Signed reset URL (generated by auth service)
 * @returns {Promise<void>}
 */
async function sendPasswordResetEmail(rabbi, resetUrl) {
  const { createEmailHTML, BRAND_GOLD } = require('../templates/emailBase');

  const subject = 'איפוס סיסמה — ענה את השואל';

  const bodyHtml = `
    <p style="margin:0 0 12px;font-size:15px;">שלום ${rabbi.name || 'הרב'},</p>
    <p style="margin:0 0 12px;font-size:15px;">קיבלנו בקשה לאיפוס הסיסמה שלך במערכת "ענה את השואל".</p>
    <p style="margin:0 0 12px;font-size:15px;">לחץ/י על הכפתור למטה כדי לבחור סיסמה חדשה:</p>
    <p style="margin:20px 0 8px;color:#cc4444;font-size:13px;">
      ⏱ הקישור תקף ל-30 דקות בלבד.
    </p>
    <p style="margin:0 0 0;color:#888;font-size:13px;">
      אם לא ביקשת איפוס סיסמה, ניתן להתעלם ממייל זה.
    </p>
  `;

  const html = createEmailHTML('איפוס סיסמה', bodyHtml, [
    { label: 'איפוס סיסמה', url: resetUrl, color: BRAND_GOLD },
  ]);

  return _send({ to: rabbi.email, subject, html });
}

// ─── sendEmergencyBroadcast ───────────────────────────────────────────────────

/**
 * Admin emergency broadcast to all (or a subset of) rabbis.
 * Sent as a single SendGrid call with multiple recipients via BCC-style
 * personalizations to avoid exposing rabbi emails to each other.
 *
 * @param {Array<{ email: string, name?: string }>} rabbis
 * @param {{ subject?: string, body: string }} message
 * @returns {Promise<void>}
 */
async function sendEmergencyBroadcast(rabbis, message) {
  if (!rabbis || rabbis.length === 0) return;

  const { createEmailHTML, BRAND_NAVY, BRAND_GOLD } = require('../templates/emailBase');

  const subject = message.subject || 'הודעה דחופה מהמנהל — ענה את השואל';

  const bodyHtml = `
    <div style="background:#fff3cd;border-right:4px solid #e0a800;padding:16px 20px;margin:0 0 20px;border-radius:4px;">
      <p style="margin:0;font-weight:bold;color:#856404;font-size:14px;">⚠ הודעה דחופה מהמנהל</p>
    </div>
    <div style="font-size:15px;line-height:1.8;white-space:pre-wrap;">${message.body || ''}</div>
    <p style="margin:20px 0 0;color:#888;font-size:12px;">הודעה זו נשלחה לכל הרבנים הרשומים במערכת.</p>
  `;

  const html = createEmailHTML('הודעה דחופה', bodyHtml);

  // Use SendGrid personalizations to send individually without exposing addresses
  const personalizations = rabbis.map((r) => ({ to: [{ email: r.email, name: r.name || '' }] }));

  try {
    await sgMail.send({
      from:             fromField(),
      subject,
      html,
      personalizations,
    });
    console.info(`[emailService] emergency broadcast sent to ${rabbis.length} rabbis`);
  } catch (err) {
    const detail = err.response ? JSON.stringify(err.response.body) : err.message;
    console.error(`[emailService] emergency broadcast error: ${detail}`);
    throw err;
  }
}

// ─── sendUrgentQuestionAlert ──────────────────────────────────────────────────

/**
 * Alert rabbis that an urgent question requires immediate attention.
 * Similar to sendNewQuestionBroadcast but with a prominent urgency banner.
 *
 * @param {Array<{ id: string|number, email: string, name?: string }>} rabbis
 * @param {{
 *   id: string|number,
 *   title?: string,
 *   content?: string,
 *   category_name?: string,
 *   created_at?: string|Date,
 * }} question
 * @returns {Promise<void>}
 */
async function sendUrgentQuestionAlert(rabbis, question) {
  if (!rabbis || rabbis.length === 0) return;

  const { createEmailHTML, BRAND_NAVY, BRAND_GOLD } = require('../templates/emailBase');

  const subject       = `[דחוף] שאלה דחופה ממתינה לתשובה מיידית — ${truncate(question.title || '', 60)}`;
  const categoryLabel = question.category_name || 'כללי';
  const preview       = truncate(question.content || '', 250);
  const submitTime    = formatDate(question.created_at);

  const promises = rabbis.map((rabbi) => {
    const actionUrl = claimUrl(question.id);

    const bodyHtml = `
      <div style="background:#ffeef0;border-right:4px solid #cc0000;padding:14px 20px;margin:0 0 20px;border-radius:4px;">
        <p style="margin:0;font-weight:bold;color:#cc0000;font-size:15px;">🔴 שאלה דחופה — נדרשת תשובה מיידית</p>
      </div>

      <p style="margin:0 0 12px;font-size:15px;">שלום ${rabbi.name || 'הרב'},</p>
      <p style="margin:0 0 12px;font-size:15px;">שאלה דחופה ממתינה לתשובתך:</p>

      <div style="background:#f8f8fb;border-right:4px solid ${BRAND_GOLD};padding:16px 20px;margin:16px 0;border-radius:4px;">
        <p style="margin:0 0 6px;font-weight:bold;font-size:16px;color:${BRAND_NAVY};">${question.title || 'שאלה ללא כותרת'}</p>
        <p style="margin:0 0 8px;color:#888;font-size:13px;">קטגוריה: ${categoryLabel} | הוגשה: ${submitTime}</p>
        ${preview ? `<p style="margin:0;color:#555;font-size:14px;line-height:1.7;">${preview}</p>` : ''}
      </div>
    `;

    const html = createEmailHTML('שאלה דחופה', bodyHtml, [
      { label: 'אני רוצה לענות', url: actionUrl, color: '#cc0000' },
    ]);

    return _send({ to: rabbi.email, subject, html });
  });

  await Promise.allSettled(promises);
}

// ─── sendRabbiOfWeekNotification ─────────────────────────────────────────────

/**
 * Congratulate the top rabbi of the week.
 *
 * @param {{ id: string|number, email: string, name?: string }} rabbi
 * @param {{
 *   weekStart: string,
 *   weekEnd: string,
 *   answersCount: number,
 *   thanksCount?: number,
 *   viewsCount?: number,
 * }} stats
 * @returns {Promise<void>}
 */
async function sendRabbiOfWeekNotification(rabbi, stats) {
  const { createEmailHTML, BRAND_NAVY, BRAND_GOLD } = require('../templates/emailBase');

  const subject  = `🏆 רב השבוע — מזל טוב! — ענה את השואל`;
  const dashUrl  = `${appUrl()}/dashboard`;

  const bodyHtml = `
    <div style="text-align:center;padding:20px 0;">
      <p style="font-size:48px;margin:0 0 8px;">🏆</p>
      <h2 style="margin:0 0 8px;color:${BRAND_NAVY};font-size:22px;">מזל טוב, ${rabbi.name || 'הרב'}!</h2>
      <p style="margin:0;color:${BRAND_GOLD};font-weight:bold;font-size:16px;">אתה רב השבוע במערכת "ענה את השואל"</p>
      <p style="margin:8px 0 0;color:#888;font-size:14px;">${stats.weekStart} — ${stats.weekEnd}</p>
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="border-collapse:collapse;margin:20px 0;">
      <tr>
        <td style="background:${BRAND_NAVY};color:${BRAND_GOLD};padding:12px;text-align:center;border-radius:6px 6px 0 0;font-size:13px;font-weight:bold;" colspan="3">
          הישגי השבוע
        </td>
      </tr>
      <tr>
        <td style="background:#f8f8fb;padding:16px 12px;text-align:center;border:1px solid #eee;">
          <div style="font-size:26px;font-weight:bold;color:${BRAND_NAVY};">${stats.answersCount || 0}</div>
          <div style="font-size:12px;color:#888;margin-top:4px;">תשובות</div>
        </td>
        <td style="background:#f8f8fb;padding:16px 12px;text-align:center;border:1px solid #eee;">
          <div style="font-size:26px;font-weight:bold;color:${BRAND_NAVY};">${stats.viewsCount || 0}</div>
          <div style="font-size:12px;color:#888;margin-top:4px;">צפיות</div>
        </td>
        <td style="background:#f8f8fb;padding:16px 12px;text-align:center;border:1px solid #eee;">
          <div style="font-size:26px;font-weight:bold;color:${BRAND_NAVY};">${stats.thanksCount || 0}</div>
          <div style="font-size:12px;color:#888;margin-top:4px;">תודות</div>
        </td>
      </tr>
    </table>

    <p style="margin:12px 0 0;font-size:14px;text-align:center;color:#555;">
      תודה על תרומתך לקהילה — המשך כך!
    </p>
  `;

  const html = createEmailHTML('רב השבוע', bodyHtml, [
    { label: 'לוח בקרה', url: dashUrl, color: BRAND_GOLD },
  ]);

  return _send({ to: rabbi.email, subject, html });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Task-spec API — canonical function names required by callers
// ═══════════════════════════════════════════════════════════════════════════════

// ─── helpers (private) ────────────────────────────────────────────────────────

const URGENCY_STYLES = {
  critical: { label: 'דחוף מאוד', bg: '#fdecea', fg: '#c62828', border: '#ef5350' },
  urgent:   { label: 'דחוף',      bg: '#fff3e0', fg: '#e65100', border: '#ff9800' },
  high:     { label: 'גבוה',      bg: '#fff9ee', fg: '#7B5800', border: '#B8973A' },
  normal:   { label: 'רגיל',      bg: '#e8eaf6', fg: '#1B2B5E', border: '#1B2B5E' },
  low:      { label: 'נמוך',      bg: '#f1f8e9', fg: '#33691e', border: '#7cb342' },
};

function _urgency(q) {
  return URGENCY_STYLES[q && q.urgency] || URGENCY_STYLES.normal;
}

function _replyTo(questionId) {
  const domain = process.env.SENDGRID_REPLY_DOMAIN || process.env.MAILGUN_REPLY_DOMAIN;
  return domain ? { email: `question-${questionId}@${domain}`, name: 'ענה את השואל' } : undefined;
}

function _frontendUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function _heDate(d) {
  try {
    return new Date(d || Date.now()).toLocaleString('he-IL', {
      timeZone: 'Asia/Jerusalem',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}

// ─── sendQuestionBroadcast ────────────────────────────────────────────────────

/**
 * Broadcast a new question to an array of active rabbis.
 * Each gets a personalised one-time claim link.
 *
 * @param {object}   question  DB question row
 * @param {object[]} rabbis    Active rabbi rows
 */
async function sendQuestionBroadcast(question, rabbis) {
  if (!rabbis || rabbis.length === 0) return;
  const { createEmailHTML: makeHtml, BRAND_NAVY: NAVY, BRAND_GOLD: GOLD } = require('../templates/emailBase');
  const urg      = _urgency(question);
  const isUrgent = ['critical', 'urgent'].includes(question.urgency);
  const preview  = truncate(question.content || '', 220);
  const subj     = `${isUrgent ? '[דחוף] ' : ''}שאלה חדשה: ${truncate(question.title || '', 80)}`;

  const promises = rabbis.map((rabbi) => {
    const token   = createClaimToken(question.id);
    const claimHref = `${appUrl()}/api/action/claim?token=${token}`;

    const body = `
      <p style="margin:0 0 20px;font-size:16px;color:${NAVY};font-weight:600;">שלום לכם הרבנים הנכבדים,</p>
      <p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.7;">הגיעה שאלה חדשה הממתינה למענה. הרב הראשון שיתפוס את השאלה יוכל לענות עליה.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="background-color:#f8f8fc;border-radius:8px;border-right:4px solid ${urg.border};margin-bottom:24px;">
        <tr>
          <td style="padding:20px 24px;">
            <p style="margin:0 0 10px;">
              <span style="display:inline-block;background-color:#e8eaf6;color:${NAVY};font-size:12px;font-weight:600;padding:3px 10px;border-radius:20px;margin-left:8px;">${question.category_name || 'כללי'}</span>
              <span style="display:inline-block;background-color:${urg.bg};color:${urg.fg};font-size:12px;font-weight:600;padding:3px 10px;border-radius:20px;">${urg.label}</span>
            </p>
            <h3 style="margin:0 0 10px;font-size:17px;font-weight:700;color:${NAVY};line-height:1.4;">${question.title || 'שאלה'}</h3>
            <p style="margin:0;font-size:14px;color:#555;line-height:1.7;">${preview}</p>
            <p style="margin:12px 0 0;font-size:12px;color:#999;">נשלח: ${_heDate(question.created_at)}</p>
          </td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
        <tr>
          <td align="center" style="padding:4px 0;">
            <a href="${claimHref}" target="_blank"
               style="display:inline-block;background-color:${GOLD};color:${NAVY};text-decoration:none;
                      padding:14px 40px;border-radius:8px;font-size:17px;font-weight:700;
                      font-family:'Heebo',Arial,sans-serif;line-height:1.4;">
              אני רוצה לענות על שאלה זו
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:12px;color:#aaa;text-align:center;">
        אם הכפתור אינו פועל: <span style="color:${NAVY};word-break:break-all;">${claimHref}</span>
      </p>`;

    return _send({
      to:      rabbi.email,
      subject: subj,
      html:    makeHtml(subj, body),
      replyTo: _replyTo(question.id),
      text:    `שאלה חדשה: ${question.title}\n\n${preview}\n\nלתפיסה: ${claimHref}`,
    });
  });

  await Promise.allSettled(promises);
}

// ─── sendUrgentQuestion ───────────────────────────────────────────────────────

/**
 * Urgent broadcast with red styling.
 *
 * @param {object}   question
 * @param {object[]} rabbis
 */
async function sendUrgentQuestion(question, rabbis) {
  return sendQuestionBroadcast({ ...question, urgency: 'critical' }, rabbis);
}

// ─── sendClaimConfirmation ────────────────────────────────────────────────────

/**
 * Personal email to the claiming rabbi with the full question + action buttons.
 * Subject includes [ID: {questionId}] for inbound-reply routing.
 *
 * @param {object} question   DB question row
 * @param {object} rabbi      DB rabbi row
 */
async function sendClaimConfirmation(question, rabbi) {
  const { createEmailHTML: makeHtml, BRAND_NAVY: NAVY, BRAND_GOLD: GOLD } = require('../templates/emailBase');
  const urg        = _urgency(question);
  const answerHref = answerEditorUrl(question.id, rabbi.id);
  const releaseHref = releaseUrl(question.id, rabbi.id);
  const fullText   = (question.content || '').replace(/<[^>]*>/g, '').trim();
  const title      = `אישור תפיסת שאלה [ID: ${question.id}]`;

  const body = `
    <p style="margin:0 0 6px;font-size:16px;color:${NAVY};font-weight:700;">${rabbi.title || 'הרב'} ${rabbi.name} שליט"א,</p>
    <p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.7;">תפסתם את השאלה בהצלחה. השאלה שמורה לטיפולכם. אנא ענו בהקדם האפשרי.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background-color:#f8f8fc;border-radius:8px;border-right:4px solid ${NAVY};margin-bottom:28px;">
      <tr>
        <td style="padding:22px 26px;">
          <p style="margin:0 0 10px;">
            <span style="display:inline-block;background-color:${NAVY};color:${GOLD};font-size:11px;font-weight:700;padding:3px 10px;border-radius:4px;letter-spacing:0.5px;">מזהה שאלה: ${question.id}</span>
            <span style="display:inline-block;background-color:${urg.bg};color:${urg.fg};font-size:12px;font-weight:600;padding:3px 10px;border-radius:20px;margin-right:8px;">${urg.label}</span>
          </p>
          <h3 style="margin:0 0 12px;font-size:17px;font-weight:700;color:${NAVY};line-height:1.4;">${question.title || 'שאלה'}</h3>
          <p style="margin:0 0 14px;font-size:13px;color:#777;">קטגוריה: <strong style="color:${NAVY};">${question.category_name || 'כללי'}</strong></p>
          <hr style="border:none;border-top:1px solid #e0e0e8;margin:0 0 16px;" />
          <div style="font-size:15px;color:#333;line-height:1.8;white-space:pre-wrap;">${fullText}</div>
          ${question.asker_name ? `<p style="margin:16px 0 0;font-size:13px;color:#999;">שאל: ${question.asker_name}</p>` : ''}
          <p style="margin:6px 0 0;font-size:12px;color:#bbb;">נשלחה ב: ${_heDate(question.created_at)}</p>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.7;background-color:#fffbf0;border:1px solid #e8d98a;padding:14px 18px;border-radius:6px;">
      <strong style="color:${NAVY};">ניתן לענות בשתי דרכים:</strong><br/>
      1. לחצו על כפתור "כתוב תשובה" למטה.<br/>
      2. השיבו ישירות על מייל זה — תשובתכם תישמר אוטומטית.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr>
        <td align="center" style="padding:4px 0 8px;">
          <a href="${answerHref}" target="_blank"
             style="display:inline-block;background-color:${NAVY};color:${GOLD};text-decoration:none;
                    padding:14px 36px;border-radius:8px;font-size:16px;font-weight:700;margin-left:10px;">
            כתוב תשובה
          </a>
          <a href="${releaseHref}" target="_blank"
             style="display:inline-block;background-color:#fff;color:#888;text-decoration:none;
                    padding:13px 24px;border-radius:8px;font-size:14px;font-weight:600;border:1px solid #ccc;">
            ביטול תפיסה
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:11px;color:#bbb;text-align:center;line-height:1.7;">
      כתיבת תשובה: <span style="color:${NAVY};word-break:break-all;">${answerHref}</span><br/>
      ביטול תפיסה: <span style="word-break:break-all;">${releaseHref}</span>
    </p>`;

  await _send({
    to:      rabbi.email,
    subject: title,
    html:    makeHtml(title, body),
    replyTo: _replyTo(question.id),
    text:    `תפסתם: ${question.title} [ID: ${question.id}]\n\n${fullText}\n\nלמענה: ${answerHref}\nלביטול: ${releaseHref}`,
  });
}

// ─── sendAlreadyClaimed ───────────────────────────────────────────────────────

/**
 * Tell a rabbi the question was already claimed by someone else.
 *
 * @param {object} rabbi  DB rabbi row
 */
async function sendAlreadyClaimed(rabbi) {
  const { createEmailHTML: makeHtml, BRAND_NAVY: NAVY, BRAND_GOLD: GOLD } = require('../templates/emailBase');
  const title     = 'השאלה כבר נתפסה';
  const browseUrl = `${_frontendUrl()}/questions`;

  const body = `
    <p style="margin:0 0 6px;font-size:16px;color:${NAVY};font-weight:700;">${rabbi.title || 'הרב'} ${rabbi.name} שליט"א,</p>
    <p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.7;">מצטערים, הרב כבר תפס את השאלה לפניכם.</p>
    <p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.7;">שאלות חדשות נוספות ישלחו אליכם כשיגיעו. תודה על נכונותכם לענות!</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding:8px 0;">
          <a href="${browseUrl}" target="_blank"
             style="display:inline-block;background-color:${GOLD};color:${NAVY};text-decoration:none;
                    padding:13px 32px;border-radius:8px;font-size:15px;font-weight:700;">
            לצפייה בשאלות פתוחות
          </a>
        </td>
      </tr>
    </table>`;

  await _send({
    to:      rabbi.email,
    subject: title,
    html:    makeHtml(title, body),
    text:    'מצטערים, הרב כבר תפס את השאלה לפניכם. שאלות חדשות ישלחו אליכם כשיגיעו.',
  });
}

// ─── sendAnswerPublished ──────────────────────────────────────────────────────

/**
 * Notify a rabbi that their answer was published on the site.
 *
 * @param {object} rabbi     DB rabbi row
 * @param {object} question  DB question row
 */
async function sendAnswerPublished(rabbi, question) {
  const { createEmailHTML: makeHtml, BRAND_NAVY: NAVY, BRAND_GOLD: GOLD } = require('../templates/emailBase');
  const title   = 'תשובתך פורסמה';
  const viewHref = question.wp_post_url || `${_frontendUrl()}/questions/${question.id}`;

  const body = `
    <p style="margin:0 0 6px;font-size:16px;color:${NAVY};font-weight:700;">${rabbi.title || 'הרב'} ${rabbi.name} שליט"א,</p>
    <p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.7;">תשובתך לשאלה שלהלן פורסמה בהצלחה באתר ותהיה נגישה לציבור.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background-color:#f8f8fc;border-radius:8px;border-right:4px solid ${GOLD};margin-bottom:28px;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 6px;font-size:12px;color:${GOLD};font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">שאלה שנענתה</p>
          <h3 style="margin:0 0 8px;font-size:17px;font-weight:700;color:${NAVY};line-height:1.4;">${question.title || 'שאלה'}</h3>
          <p style="margin:0;font-size:13px;color:#777;">קטגוריה: ${question.category_name || 'כללי'} · פורסם: ${_heDate(new Date())}</p>
        </td>
      </tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
      <tr>
        <td align="center" style="padding:4px 0;">
          <a href="${viewHref}" target="_blank"
             style="display:inline-block;background-color:${NAVY};color:${GOLD};text-decoration:none;
                    padding:13px 32px;border-radius:8px;font-size:16px;font-weight:700;">
            צפה בתשובה המפורסמת
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:16px 0 0;font-size:14px;color:#888;line-height:1.7;text-align:center;font-style:italic;">
      תודה על תרומתכם להפצת תורת מרן זצ"ל
    </p>`;

  await _send({
    to:      rabbi.email,
    subject: `${title}: ${question.title}`,
    html:    makeHtml(title, body),
    text:    `תשובתך לשאלה "${question.title}" פורסמה.\nלצפייה: ${viewHref}`,
  });
}

// ─── sendThankYou ─────────────────────────────────────────────────────────────

/**
 * Notify a rabbi that a user thanked them.
 *
 * @param {object} rabbi       DB rabbi row
 * @param {object} question    DB question row
 * @param {number} thankCount  Current total thank count
 */
async function sendThankYou(rabbi, question, thankCount) {
  const { createEmailHTML: makeHtml, BRAND_NAVY: NAVY, BRAND_GOLD: GOLD } = require('../templates/emailBase');
  const title = 'כבוד הרב, גולש הודה לך על תשובתך';

  const body = `
    <p style="margin:0 0 20px;font-size:52px;text-align:center;line-height:1;">🙏</p>
    <p style="margin:0 0 16px;font-size:16px;color:${NAVY};font-weight:700;text-align:center;">כבוד ${rabbi.title || 'הרב'} ${rabbi.name} שליט"א,</p>
    <p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.8;text-align:center;">גולש הודה לך על תשובתך לשאלה זו.<br/>מעשה זה מחזק ומעודד המשך מלאכת הקודש.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td align="center">
          <div style="display:inline-block;background-color:#fff9ee;border:2px solid ${GOLD};border-radius:12px;padding:16px 32px;text-align:center;">
            <p style="margin:0 0 4px;font-size:13px;color:${GOLD};font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">סך הכל תודות לשאלה זו</p>
            <p style="margin:0;font-size:42px;font-weight:700;color:${NAVY};line-height:1.2;">${thankCount}</p>
          </div>
        </td>
      </tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background-color:#f8f8fc;border-radius:8px;border-right:4px solid ${GOLD};margin-bottom:24px;">
      <tr>
        <td style="padding:18px 22px;">
          <p style="margin:0 0 6px;font-size:12px;color:#999;">השאלה שעליה הודו:</p>
          <p style="margin:0;font-size:15px;font-weight:700;color:${NAVY};line-height:1.4;">${question.title || 'שאלה'}</p>
          <p style="margin:8px 0 0;font-size:13px;color:#777;">קטגוריה: ${question.category_name || 'כללי'}</p>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:14px;color:#888;line-height:1.7;text-align:center;font-style:italic;">
      "וְהָאֲנָשִׁים הַמְלָאכָה דַּיָּם לְכָל הַמְּלָאכָה לַעֲשׂוֹת אֹתָהּ וְהוֹתֵר"
    </p>`;

  await _send({
    to:      rabbi.email,
    subject: title,
    html:    makeHtml(title, body),
    text:    `גולש הודה לך על תשובתך לשאלה "${question.title}" (${thankCount} תודות סה"כ).`,
  });
}

// ─── sendPasswordReset ────────────────────────────────────────────────────────

/**
 * Send a secure password-reset link to a rabbi.
 *
 * @param {object} rabbi      DB rabbi row
 * @param {string} resetLink  Signed reset URL
 */
async function sendPasswordReset(rabbi, resetLink) {
  const { createEmailHTML: makeHtml, BRAND_NAVY: NAVY, BRAND_GOLD: GOLD } = require('../templates/emailBase');
  const title = 'איפוס סיסמה';

  const body = `
    <p style="margin:0 0 6px;font-size:16px;color:${NAVY};font-weight:700;">${rabbi.title || 'הרב'} ${rabbi.name} שליט"א,</p>
    <p style="margin:0 0 20px;font-size:15px;color:#444;line-height:1.7;">קיבלנו בקשה לאיפוס הסיסמה שלכם. לחצו על הכפתור למטה להגדרת סיסמה חדשה.</p>
    <p style="margin:0 0 24px;font-size:14px;color:#888;line-height:1.6;background-color:#fff3cd;border:1px solid #ffc107;padding:12px 16px;border-radius:6px;">
      <strong>לתשומת לבכם:</strong> קישור זה תקף ל-60 דקות בלבד.<br/>
      אם לא ביקשתם איפוס סיסמה, התעלמו ממייל זה.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr>
        <td align="center" style="padding:4px 0;">
          <a href="${resetLink}" target="_blank"
             style="display:inline-block;background-color:${NAVY};color:${GOLD};text-decoration:none;
                    padding:14px 40px;border-radius:8px;font-size:16px;font-weight:700;">
            איפוס סיסמה
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:11px;color:#bbb;text-align:center;">
      או העתיקו: <span style="color:${NAVY};word-break:break-all;">${resetLink}</span>
    </p>`;

  await _send({
    to:      rabbi.email,
    subject: `${title} — ענה את השואל`,
    html:    makeHtml(title, body),
    text:    `איפוס סיסמה:\n${resetLink}\n\nקישור זה תקף ל-60 דקות.`,
  });
}

// ─── sendTimeoutWarning ───────────────────────────────────────────────────────

/**
 * Warn a rabbi that their question lock is about to expire.
 *
 * @param {object} rabbi        DB rabbi row
 * @param {object} question     DB question row
 * @param {number} minutesLeft  Minutes remaining before lock expires
 */
async function sendTimeoutWarning(rabbi, question, minutesLeft) {
  const { createEmailHTML: makeHtml, BRAND_NAVY: NAVY, BRAND_GOLD: GOLD } = require('../templates/emailBase');
  const title      = `תזכורת: נותרו ${minutesLeft} דקות לתפיסת השאלה`;
  const answerHref = answerEditorUrl(question.id, rabbi.id);
  const releaseHref = releaseUrl(question.id, rabbi.id);

  const body = `
    <p style="margin:0 0 6px;font-size:16px;color:${NAVY};font-weight:700;">${rabbi.title || 'הרב'} ${rabbi.name} שליט"א,</p>
    <p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.7;">
      זוהי תזכורת כי תפיסתכם על השאלה שלהלן תפקע בעוד
      <strong style="color:#e65100;">${minutesLeft} דקות</strong>. אנא ענו בהקדם או שחררו את השאלה.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background-color:#fff8f0;border-radius:8px;border-right:4px solid #ff9800;margin-bottom:28px;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 4px;font-size:12px;color:#e65100;font-weight:700;">נותרו ${minutesLeft} דקות</p>
          <h3 style="margin:0 0 8px;font-size:17px;font-weight:700;color:${NAVY};line-height:1.4;">${question.title || 'שאלה'}</h3>
          <p style="margin:0;font-size:13px;color:#777;">מזהה: ${question.id} · ${question.category_name || 'כללי'}</p>
        </td>
      </tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr>
        <td align="center" style="padding:4px 0 8px;">
          <a href="${answerHref}" target="_blank"
             style="display:inline-block;background-color:${NAVY};color:${GOLD};text-decoration:none;
                    padding:14px 36px;border-radius:8px;font-size:16px;font-weight:700;margin-left:10px;">
            כתוב תשובה עכשיו
          </a>
          <a href="${releaseHref}" target="_blank"
             style="display:inline-block;background-color:#fff;color:#888;text-decoration:none;
                    padding:13px 24px;border-radius:8px;font-size:14px;font-weight:600;border:1px solid #ccc;">
            שחרר את השאלה
          </a>
        </td>
      </tr>
    </table>`;

  await _send({
    to:      rabbi.email,
    subject: title,
    html:    makeHtml(title, body),
    text:    `תזכורת: נותרו ${minutesLeft} דקות לתפיסת השאלה "${question.title}".\nלמענה: ${answerHref}\nלשחרור: ${releaseHref}`,
  });
}

// ─── sendDailyDigest ──────────────────────────────────────────────────────────

/**
 * Morning digest to all active rabbis.
 *
 * @param {object[]} rabbis        Active rabbi rows
 * @param {number}   pendingCount  Number of pending questions
 * @param {object[]} questions     Sample of pending questions (up to 5)
 */
async function sendDailyDigest(rabbis, pendingCount, questions) {
  if (!rabbis || rabbis.length === 0) return;
  const { createEmailHTML: makeHtml, BRAND_NAVY: NAVY, BRAND_GOLD: GOLD } = require('../templates/emailBase');
  const date      = new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });
  const title     = `סיכום יומי — ${date}`;
  const browseUrl = `${_frontendUrl()}/questions`;

  const sample = (questions || []).slice(0, 5);
  const rowsHtml = sample.length > 0
    ? sample.map((q) => {
        const u = _urgency(q);
        return `<tr>
          <td style="padding:12px 0;border-bottom:1px solid #eee;">
            <p style="margin:0 0 4px;">
              <span style="display:inline-block;background-color:${u.bg};color:${u.fg};font-size:11px;font-weight:600;padding:2px 8px;border-radius:12px;margin-left:6px;">${u.label}</span>
              <strong style="font-size:14px;color:${NAVY};">${q.title || 'שאלה'}</strong>
            </p>
            <p style="margin:0;font-size:12px;color:#999;">${q.category_name || 'כללי'} · ${_heDate(q.created_at)}</p>
          </td>
        </tr>`;
      }).join('')
    : `<tr><td style="padding:12px 0;color:#aaa;font-size:14px;">אין שאלות ממתינות</td></tr>`;

  const body = `
    <p style="margin:0 0 6px;font-size:16px;color:${NAVY};font-weight:700;">בוקר טוב,</p>
    <p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.7;">להלן סיכום יומי של השאלות הממתינות למענה.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td align="center">
          <div style="display:inline-block;background-color:#e8eaf6;border-radius:12px;padding:18px 36px;text-align:center;">
            <p style="margin:0 0 4px;font-size:13px;color:${NAVY};font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">שאלות ממתינות</p>
            <p style="margin:0;font-size:48px;font-weight:700;color:${NAVY};line-height:1.2;">${pendingCount}</p>
          </div>
        </td>
      </tr>
    </table>
    ${sample.length > 0 ? `
    <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:${NAVY};border-bottom:2px solid #e8d98a;padding-bottom:6px;">שאלות אחרונות שהתקבלו</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">${rowsHtml}</table>` : ''}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
      <tr>
        <td align="center" style="padding:4px 0;">
          <a href="${browseUrl}" target="_blank"
             style="display:inline-block;background-color:${GOLD};color:${NAVY};text-decoration:none;
                    padding:14px 40px;border-radius:8px;font-size:16px;font-weight:700;">
            לצפייה בכל השאלות
          </a>
        </td>
      </tr>
    </table>`;

  await Promise.allSettled(
    rabbis.map((rabbi) =>
      _send({
        to:      rabbi.email,
        subject: title,
        html:    makeHtml(title, body),
        text:    `סיכום יומי — ${date}\n\nשאלות ממתינות: ${pendingCount}\n\nלצפייה: ${browseUrl}`,
      })
    )
  );
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // ── Legacy / existing exports (unchanged) ──
  sendNewQuestionBroadcast,
  sendQuestionAssigned,
  sendAnswerToAsker,
  sendFollowUpToRabbi,
  sendFollowUpAnswerToAsker,
  sendThankNotification,
  sendWeeklyReport,
  sendNewDeviceAlert,
  sendPasswordResetEmail,
  sendEmergencyBroadcast,
  sendUrgentQuestionAlert,
  sendRabbiOfWeekNotification,
  // ── Task-spec canonical names ──
  sendQuestionBroadcast,
  sendUrgentQuestion,
  sendClaimConfirmation,
  sendAlreadyClaimed,
  sendAnswerPublished,
  sendThankYou,
  sendPasswordReset,
  sendTimeoutWarning,
  sendDailyDigest,
};
