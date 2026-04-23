'use strict';

/**
 * Asker Notification Service
 *
 * Notifies the original question asker when their question is received,
 * answered, or gets a follow-up answer. Supports email (via admin-editable
 * templates) and WhatsApp (via GreenAPI).
 *
 * Email bodies are loaded from `system_config['email_templates']` via
 * services/emailTemplates.js — the admin can edit them in the UI and the
 * changes propagate to the next send without a deploy.
 *
 * Exports:
 *   notifyAskerNewAnswer(questionId)
 *   notifyAskerFollowUp(questionId)
 *   notifyAskerPrivateAnswer(questionId)
 *   notifyAskerQuestionReceived(question)
 *
 * Environment:
 *   WP_API_URL / WP_SITE_URL – base URL for building answer page links
 *   API_URL / APP_URL        – base URL for tracking-redirect endpoints
 *   GREENAPI_INSTANCE_ID     – GreenAPI instance ID
 *   GREENAPI_TOKEN           – GreenAPI API token
 *   ENCRYPTION_KEY           – AES key for decrypting asker PII
 */

const { query: dbQuery } = require('../db/pool');
const { decryptField }   = require('../utils/encryption');
const { findLeadByEmail } = require('./leadsService');
const { signUnsubscribeToken } = require('../routes/unsubscribe');
const { sendTemplated }  = require('./emailTemplates');

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
            a.content          AS answer_content,
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
 * Decrypts asker email + phone, sends a templated email with a link to the
 * answer page on WordPress, sends a WhatsApp message via GreenAPI with the
 * same link. Sets notified_asker=true. Email content is pulled from the
 * `asker_answer_ready` template (admin-editable).
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
  const displayName = data.asker_name || 'שואל/ת יקר/ה';

  // Send email via admin-editable template
  if (email) {
    try {
      // מייל "תשובה" — טרנזקציונלי: נשלח גם אם is_unsubscribed. קישור הסרה
      // מצורף לשקיפות ולאפשר ניהול עצמי של רשימת התפוצה.
      const unsubscribeLink = await _buildUnsubscribeLink(email);
      await sendTemplated('asker_answer_ready', {
        to:       email,
        fromName: 'שאל את הרב',
        audience: 'asker',
        unsubscribeLink,
        vars: {
          name:        displayName,
          rabbi_name:  data.rabbi_name,
          title:       data.title || '',
        },
        buttons: answerUrl ? [{ label: 'צפה בתשובה', url: answerUrl }] : [],
      });
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
 * Uses the `asker_follow_up` template.
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
  const displayName = data.asker_name || 'שואל/ת יקר/ה';

  // Send email — מייל המשך הוא טרנזקציונלי (תגובה ישירה לשאלת המשך)
  if (email) {
    try {
      const unsubscribeLink = await _buildUnsubscribeLink(email);
      await sendTemplated('asker_follow_up', {
        to:       email,
        fromName: 'שאל את הרב',
        audience: 'asker',
        unsubscribeLink,
        vars: {
          name:       displayName,
          rabbi_name: data.rabbi_name,
          title:      data.title || '',
        },
        buttons: answerUrl ? [{ label: 'צפה בתשובה', url: answerUrl }] : [],
      });
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
 * via email (since the answer won't be published on the WP site) + a WhatsApp
 * heads-up pointing to the email. Uses the `asker_private_answer` template.
 *
 * @param {string} questionId
 */
async function notifyAskerPrivateAnswer(questionId) {
  const data = await fetchNotificationData(questionId);
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

  const displayName = data.asker_name || 'שואל/ת יקר/ה';

  if (email) {
    try {
      const unsubscribeLink = await _buildUnsubscribeLink(email);
      await sendTemplated('asker_private_answer', {
        to:       email,
        fromName: 'שאל את הרב',
        audience: 'asker',
        unsubscribeLink,
        vars: {
          name:       displayName,
          rabbi_name: data.rabbi_name,
          title:      data.title || '',
          content:    data.answer_content || '',
        },
      });
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
 * Uses the `asker_question_received` template.
 *
 * @param {object} question  Object with asker_email, asker_name, title/content
 */
async function notifyAskerQuestionReceived(question) {
  const email = question.asker_email;
  if (!email) return;

  // אישור קבלת שאלה — טרנזקציונלי: נשלח גם אם is_unsubscribed.
  const unsubscribeLink = await _buildUnsubscribeLink(email);
  const displayName = question.asker_name || 'שואל/ת יקר/ה';

  try {
    await sendTemplated('asker_question_received', {
      to:       email,
      fromName: 'שאל את הרב',
      audience: 'asker',
      unsubscribeLink,
      vars: {
        name:  displayName,
        title: question.title || '',
      },
    });
  } catch (err) {
    console.error('[askerNotification] שגיאה בשליחת מייל "שאלתך התקבלה":', err.message);
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  notifyAskerNewAnswer,
  notifyAskerFollowUp,
  notifyAskerPrivateAnswer,
  notifyAskerQuestionReceived,
};
