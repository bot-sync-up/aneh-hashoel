'use strict';

/**
 * Asker Notification Service
 *
 * Notifies the original question asker when their question has been answered
 * or when a follow-up answer is submitted. Supports email and WhatsApp
 * (via GreenAPI) channels.
 *
 * Exports:
 *   notifyAskerNewAnswer(questionId)
 *   notifyAskerFollowUp(questionId)
 *
 * Environment:
 *   WP_API_URL              – base URL for building answer page links
 *   GREENAPI_INSTANCE_ID    – GreenAPI instance ID
 *   GREENAPI_TOKEN          – GreenAPI API token
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS – email transport
 *   ENCRYPTION_KEY          – AES key for decrypting asker PII
 */

const { query: dbQuery } = require('../db/pool');
const { decryptField }   = require('../utils/encryption');
const { findLeadByEmail } = require('./leadsService');
const { signUnsubscribeToken } = require('../routes/unsubscribe');

// ─── Unsubscribe link helper ───────────────────────────────────────────────────

/**
 * בונה קישור הסרה חתום לשואל על סמך כתובת המייל שלו (plaintext).
 * מחזיר מחרוזת ריקה אם אין ליד מתאים או אם APP_URL לא מוגדר.
 * משמש גם במיילים טרנזקציונליים (תשובה/אישור), כחלק מדרישות שקיפות
 * והגדלת אמון המשתמש — גם אם החוק לא מחייב ניתוק במיילים אלו.
 *
 * @param {string} plainEmail
 * @returns {Promise<string>}
 */
async function _buildUnsubscribeLink(plainEmail) {
  try {
    if (!plainEmail) return '';
    const lead = await findLeadByEmail(plainEmail);
    if (!lead) return '';
    const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
    if (!appUrl) return '';
    return `${appUrl}/unsubscribe?token=${signUnsubscribeToken(lead.id)}`;
  } catch (err) {
    console.warn('[askerNotification] _buildUnsubscribeLink failed:', err.message);
    return '';
  }
}

// ─── Encryption helpers ────────────────────────────────────────────────────────

/**
 * Decrypt a PII field stored with AES-256-GCM.
 * Delegates to the shared encryption utility which handles the correct
 * "iv:authTag:ciphertext" format and returns null-safe plaintext.
 *
 * @param {string|null} encrypted  Stored ciphertext (or plaintext for legacy rows)
 * @returns {string}               Decrypted value, or '' if absent
 */
function decrypt(encrypted) {
  if (!encrypted) return '';
  return decryptField(encrypted) || '';
}

// ─── Email sending ─────────────────────────────────────────────────────────────

/**
 * Send an email to the asker with a link to the answer page.
 *
 * Uses nodemailer lazily loaded to avoid import overhead when not needed.
 *
 * @param {string} to       Recipient email address
 * @param {string} subject  Email subject
 * @param {string} html     Email body (HTML)
 */
async function sendEmail(to, subject, html, options = {}) {
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    console.error('[askerNotification] nodemailer לא מותקן');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const fromName = options.fromName || 'ענה את השואל';
  const fromEmail = process.env.SMTP_FROM || process.env.EMAIL_FROM_ADDRESS || 'noreply@aneh-hashoel.co.il';
  const fromField = `"${fromName}" <${fromEmail}>`;

  await transporter.sendMail({
    from:    fromField,
    to,
    subject,
    html,
  });
}

// ─── WhatsApp via GreenAPI ─────────────────────────────────────────────────────

/**
 * Lazy-load the WhatsApp service to avoid circular dependencies.
 * @returns {typeof import('./whatsappService')|null}
 */
let _whatsappService = null;
function getWhatsappService() {
  if (!_whatsappService) {
    try { _whatsappService = require('./whatsappService'); } catch { return null; }
  }
  return _whatsappService;
}

/**
 * Send a WhatsApp message via GreenAPI.
 * Delegates to whatsappService.sendMessage() for proper phone normalisation
 * (Israeli 05X -> 972) and retry logic.
 *
 * @param {string} phone    Phone number (any supported format)
 * @param {string} message  Plain-text message body
 */
async function sendWhatsApp(phone, message) {
  const svc = getWhatsappService();
  if (!svc) {
    console.warn('[askerNotification] whatsappService לא זמין — דילוג על WhatsApp');
    return;
  }

  const result = await svc.sendMessage(phone, message);
  if (!result.success) {
    console.warn(`[askerNotification] WhatsApp לא נשלח: ${result.error}`);
  }
}

// ─── Shared fetch logic ────────────────────────────────────────────────────────

/**
 * Fetch question + answer + asker contact info for notification.
 *
 * @param {string} questionId
 * @returns {Promise<object|null>}
 */
async function fetchNotificationData(questionId) {
  const { rows } = await dbQuery(
    `SELECT q.id               AS question_id,
            q.title,
            q.asker_email,
            q.asker_phone,
            q.asker_name,
            q.wp_post_id,
            q.wp_link,
            q.notified_asker,
            a.id               AS answer_id,
            r.name             AS rabbi_name
     FROM   questions q
     JOIN   answers   a ON a.question_id = q.id
     JOIN   rabbis    r ON r.id = a.rabbi_id
     WHERE  q.id = $1
     LIMIT  1`,
    [questionId]
  );

  return rows[0] || null;
}

/**
 * Build the answer page URL on the WordPress site.
 * Prefers the stored wp_link permalink; falls back to constructing from wp_post_id.
 *
 * @param {object} data  Notification data object with wp_link and/or wp_post_id
 * @returns {string|null}
 */
function buildDirectAnswerUrl(data) {
  // Use stored WP permalink if available
  if (data.wp_link) return data.wp_link;

  // Fallback: build from wp_post_id
  if (!data.wp_post_id) return null;
  const baseUrl = (process.env.WP_SITE_URL || process.env.WP_API_URL || '')
    .replace(/\/wp-json.*$/, '')
    .replace(/\/$/, '');
  return `${baseUrl}/ask-rabai/${data.wp_post_id}`;
}

/**
 * Build the tracking URL that redirects to the WP answer page.
 * Routes through /api/track/:questionId to record the click before redirecting.
 *
 * @param {object} data  Notification data object with question_id
 * @returns {string|null}
 */
function buildAnswerUrl(data) {
  if (!data.question_id) return buildDirectAnswerUrl(data);

  const apiBaseUrl = (process.env.API_URL || process.env.APP_URL || 'http://localhost:4000')
    .replace(/\/$/, '');
  return `${apiBaseUrl}/api/track/${data.question_id}`;
}

// ─── notifyAskerNewAnswer ──────────────────────────────────────────────────────

/**
 * Notify the asker that their question has been answered.
 *
 * Decrypts asker email + phone, sends email with link to answer page on
 * WordPress, sends WhatsApp via GreenAPI with link. Updates notified_asker=true.
 *
 * @param {string} questionId
 */
async function notifyAskerNewAnswer(questionId) {
  const data = await fetchNotificationData(questionId);

  if (!data) {
    console.warn(`[askerNotification] שאלה ${questionId} לא נמצאה — דילוג על התראה`);
    return;
  }

  // Decrypt asker contact info
  const email = decrypt(data.asker_email);
  const phone = decrypt(data.asker_phone);

  if (!email && !phone) {
    console.warn(`[askerNotification] אין פרטי קשר לשואל בשאלה ${questionId}`);
    return;
  }

  const answerUrl = buildAnswerUrl(data);
  const { createEmailHTML } = require('../templates/emailBase');

  const greeting = data.asker_name ? `שלום ${data.asker_name},` : 'שלום,';
  const bodyContent = `
    <p style="margin: 0 0 12px; font-size: 15px;">${greeting}</p>
    <p style="margin: 0 0 16px; font-size: 15px;">
      שמחים לבשר לך שהרב <strong>${data.rabbi_name}</strong> ענה על שאלתך.
    </p>
    ${data.title ? `<div style="background: #f8f9fa; border-right: 4px solid #B8973A; padding: 16px; margin: 16px 0; border-radius: 4px;"><strong>נושא השאלה:</strong><br/><p style="margin: 8px 0 0;">${data.title}</p></div>` : ''}
    <p style="margin: 16px 0 0; color: #888; font-size: 13px;">
      לצפייה בתשובה המלאה — לחץ על הכפתור למטה.
    </p>
  `;

  const buttons = answerUrl ? [{ label: 'צפה בתשובה', url: answerUrl }] : [];
  // מייל "תשובה" — טרנזקציונלי: נשלח גם אם is_unsubscribed. קישור הסרה
  // מצורף לשקיפות ולאפשר ניהול עצמי של רשימת התפוצה.
  const unsubscribeLink = email ? await _buildUnsubscribeLink(email) : '';
  const html = createEmailHTML('התשובה לשאלתך מוכנה!', bodyContent, buttons, {
    systemName: 'שאל את הרב',
    audience: 'asker',
    unsubscribeLink,
  });

  // Send email
  if (email) {
    try {
      await sendEmail(
        email,
        'התשובה לשאלתך מוכנה — שאל את הרב',
        html,
        { fromName: 'שאל את הרב' }
      );
    } catch (err) {
      console.error(`[askerNotification] שגיאה בשליחת אימייל לשואל (שאלה ${questionId}):`, err.message);
    }
  }

  // Send WhatsApp
  if (phone) {
    try {
      const whatsappMessage = answerUrl
        ? `שלום, הרב ${data.rabbi_name} ענה על שאלתך באתר שאל את הרב.\nלצפייה בתשובה: ${answerUrl}`
        : `שלום, הרב ${data.rabbi_name} ענה על שאלתך באתר שאל את הרב. התשובה מחכה לך באתר.`;

      await sendWhatsApp(phone, whatsappMessage);
    } catch (err) {
      console.error(`[askerNotification] שגיאה בשליחת WhatsApp לשואל (שאלה ${questionId}):`, err.message);
    }
  }

  // Mark asker as notified
  await dbQuery(
    `UPDATE questions
     SET    notified_asker = true,
            updated_at     = NOW()
     WHERE  id = $1`,
    [questionId]
  ).catch((err) => {
    console.error(`[askerNotification] שגיאה בעדכון notified_asker (שאלה ${questionId}):`, err.message);
  });

  console.log(`[askerNotification] שואל קיבל התראה על תשובה לשאלה ${questionId}`);
}

// ─── notifyAskerFollowUp ───────────────────────────────────────────────────────

/**
 * Notify the asker that a follow-up answer has been submitted.
 *
 * Same mechanism as notifyAskerNewAnswer but with different message content.
 *
 * @param {string} questionId
 */
async function notifyAskerFollowUp(questionId) {
  const data = await fetchNotificationData(questionId);

  if (!data) {
    console.warn(`[askerNotification] שאלה ${questionId} לא נמצאה — דילוג על התראת המשך`);
    return;
  }

  const email = decrypt(data.asker_email);
  const phone = decrypt(data.asker_phone);

  if (!email && !phone) {
    console.warn(`[askerNotification] אין פרטי קשר לשואל בשאלה ${questionId} (המשך)`);
    return;
  }

  const answerUrl = buildAnswerUrl(data);

  // Send email — מייל המשך הוא טרנזקציונלי (תגובה ישירה לשאלת המשך)
  if (email) {
    try {
      const { createEmailHTML } = require('../templates/emailBase');
      const unsubscribeLink = await _buildUnsubscribeLink(email);
      const followUpHtml = createEmailHTML(
        'תשובת המשך לשאלתך',
        `<p style="margin:0 0 12px; font-size:15px;">הרב ${data.rabbi_name} השיב לשאלת ההמשך שלך:</p>
        <div style="background:#f8f6f0; border-right:3px solid #B8973A; padding:12px 16px; border-radius:4px; margin:12px 0;">
          <p style="font-weight:bold; margin:0 0 6px;">שאלה: ${data.title}</p>
        </div>
        <div style="background:#fff; border:1px solid #eee; padding:12px 16px; border-radius:4px; margin:12px 0;">
          ${data.follow_up_answer || ''}
        </div>`,
        answerUrl ? [{ label: 'צפה בתשובה', url: answerUrl }] : [],
        { systemName: 'שאל את הרב', audience: 'asker', unsubscribeLink }
      );
      await sendEmail(
        email,
        'תשובת המשך לשאלתך — ענה את השואל',
        followUpHtml,
        { fromName: 'שאל את הרב' }
      );
    } catch (err) {
      console.error(`[askerNotification] שגיאה בשליחת אימייל המשך (שאלה ${questionId}):`, err.message);
    }
  }

  // Send WhatsApp
  if (phone) {
    try {
      const whatsappMessage = answerUrl
        ? `שלום, הרב ${data.rabbi_name} הוסיף תשובת המשך לשאלתך באתר ענה את השואל.\nלצפייה: ${answerUrl}`
        : `שלום, הרב ${data.rabbi_name} הוסיף תשובת המשך לשאלתך באתר ענה את השואל.`;

      await sendWhatsApp(phone, whatsappMessage);
    } catch (err) {
      console.error(`[askerNotification] שגיאה בשליחת WhatsApp המשך (שאלה ${questionId}):`, err.message);
    }
  }

  console.log(`[askerNotification] שואל קיבל התראת המשך לשאלה ${questionId}`);
}

// ─── notifyAskerPrivateAnswer ──────────────────────────────────────────────────

/**
 * Notify the asker of a private answer by sending the answer content directly
 * via email and WhatsApp (since the answer won't be published on the WP site).
 *
 * @param {string} questionId
 */
async function notifyAskerPrivateAnswer(questionId) {
  // Need to fetch question + answer content + rabbi name
  const { rows } = await dbQuery(
    `SELECT q.id               AS question_id,
            q.title,
            q.asker_email,
            q.asker_phone,
            q.asker_name,
            a.content          AS answer_content,
            r.name             AS rabbi_name
     FROM   questions q
     JOIN   answers   a ON a.question_id = q.id
     JOIN   rabbis    r ON r.id = a.rabbi_id
     WHERE  q.id = $1
     LIMIT  1`,
    [questionId]
  );

  const data = rows[0];
  if (!data) {
    console.warn(`[askerNotification] notifyAskerPrivateAnswer: שאלה ${questionId} לא נמצאה`);
    return;
  }

  const email = decrypt(data.asker_email);
  const phone = decrypt(data.asker_phone);

  if (!email && !phone) {
    console.warn(`[askerNotification] notifyAskerPrivateAnswer: אין פרטי קשר לשואל בשאלה ${questionId}`);
    return;
  }

  const greeting = data.asker_name ? `שלום ${data.asker_name},` : 'שלום,';

  if (email) {
    try {
      const { createEmailHTML } = require('../templates/emailBase');
      const unsubscribeLink = await _buildUnsubscribeLink(email);
      const bodyContent = `
        <p style="text-align:right; font-size:18px; font-weight:bold; margin:0 0 8px;">${greeting}</p>
        <p style="text-align:right;">הרב <strong>${data.rabbi_name}</strong> ענה על שאלתך בתשובה אישית:</p>
        <div style="background:#f8f9fa; border-right:4px solid #B8973A; padding:16px; margin:16px 0; border-radius:4px;">
          <strong>שאלה:</strong> ${data.title}
        </div>
        <div style="background:#f0f7f0; border-radius:8px; padding:16px; margin:16px 0;">
          <p style="margin:0 0 8px;"><strong>תשובה:</strong></p>
          <div>${data.answer_content}</div>
        </div>
        <p style="color:#666; font-size:12px;">תשובה זו נשלחה אליך באופן אישי ואינה מפורסמת באתר.</p>
        <p>בברכה,<br><strong>הרב ${data.rabbi_name}</strong></p>
      `;
      const html = createEmailHTML('תשובה אישית לשאלתך', bodyContent, [], {
        systemName: 'שאל את הרב',
        audience: 'asker',
        unsubscribeLink,
      });
      await sendEmail(
        email,
        `תשובה לשאלתך — שאל את הרב`,
        html,
        { fromName: 'שאל את הרב' }
      );
      console.log(`[askerNotification] תשובה פרטית נשלחה במייל לשואל (שאלה ${questionId})`);
    } catch (err) {
      console.error(`[askerNotification] שגיאה בשליחת מייל תשובה פרטית (שאלה ${questionId}):`, err.message);
    }
  }

  if (phone) {
    try {
      const msg = `שלום${data.asker_name ? ' ' + data.asker_name : ''}, הרב ${data.rabbi_name} שלח לך תשובה אישית לשאלתך "${data.title}". התשובה נשלחה לכתובת המייל שלך.`;
      await sendWhatsApp(phone, msg);
    } catch (err) {
      console.error(`[askerNotification] שגיאה בשליחת WhatsApp תשובה פרטית (שאלה ${questionId}):`, err.message);
    }
  }
}

// ─── notifyAskerQuestionReceived ───────────────────────────────────────────────

/**
 * Send a confirmation email to the asker when their question is received.
 *
 * @param {object} question  Object with asker_email, asker_name, title/content
 */
async function notifyAskerQuestionReceived(question) {
  const email = question.asker_email;
  if (!email) return;

  const { createEmailHTML } = require('../templates/emailBase');

  const systemName = 'שאל את הרב';
  const subject = `קיבלנו את שאלתך — ${systemName}`;
  // אישור קבלת שאלה — טרנזקציונלי: נשלח גם אם is_unsubscribed.
  const unsubscribeLink = await _buildUnsubscribeLink(email);
  const bodyContent = `
    <p style="margin: 0 0 12px; font-size: 15px;">שלום ${question.asker_name || 'שואל/ת יקר/ה'},</p>
    <p style="margin: 0 0 16px; font-size: 15px;">
      קיבלנו את שאלתך ונענה בהקדם האפשרי.
    </p>
    <div style="background: #f8f9fa; border-right: 4px solid #1B2B5E; padding: 16px; margin: 16px 0; border-radius: 4px;">
      <strong>נושא השאלה:</strong><br/>
      <p style="margin: 8px 0 0;">${question.title || ''}</p>
    </div>
    <p style="margin: 16px 0 0; color: #888; font-size: 13px;">
      נשלח לך מייל נוסף כאשר תתקבל תשובה מהרב.
    </p>
  `;
  const html = createEmailHTML('שאלתך התקבלה בהצלחה', bodyContent, [], {
    systemName,
    audience: 'asker',
    unsubscribeLink,
  });

  await sendEmail(email, subject, html, { fromName: systemName });
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  notifyAskerNewAnswer,
  notifyAskerFollowUp,
  notifyAskerPrivateAnswer,
  notifyAskerQuestionReceived,
};
