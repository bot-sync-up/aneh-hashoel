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

const crypto = require('crypto');
const axios  = require('axios');
const { query: dbQuery } = require('../db/pool');

// ─── Encryption helpers ────────────────────────────────────────────────────────

const ALGORITHM    = 'aes-256-cbc';
const IV_LENGTH    = 16;

/**
 * Decrypt a value that was encrypted with AES-256-CBC.
 * The stored format is iv:encryptedData (both hex-encoded).
 *
 * @param {string} encrypted  "iv:ciphertext" hex string
 * @returns {string}          Plain-text value
 */
function decrypt(encrypted) {
  if (!encrypted) return '';

  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    console.error('[askerNotification] ENCRYPTION_KEY לא מוגדר');
    return '';
  }

  try {
    const [ivHex, cipherHex] = encrypted.split(':');
    const iv         = Buffer.from(ivHex, 'hex');
    const cipherText = Buffer.from(cipherHex, 'hex');
    const keyBuffer  = Buffer.from(key, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
    let decrypted  = decipher.update(cipherText);
    decrypted      = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
  } catch (err) {
    console.error('[askerNotification] שגיאה בפענוח נתונים:', err.message);
    return '';
  }
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
async function sendEmail(to, subject, html) {
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

  await transporter.sendMail({
    from:    process.env.SMTP_FROM || '"ענה את השואל" <noreply@aneh-hashoel.co.il>',
    to,
    subject,
    html,
  });
}

// ─── WhatsApp via GreenAPI ─────────────────────────────────────────────────────

/**
 * Send a WhatsApp message via GreenAPI.
 *
 * @param {string} phone    Phone number (international format, no +)
 * @param {string} message  Plain-text message body
 */
async function sendWhatsApp(phone, message) {
  const instanceId = process.env.GREENAPI_INSTANCE_ID;
  const token      = process.env.GREENAPI_TOKEN;

  if (!instanceId || !token) {
    console.warn('[askerNotification] GreenAPI לא מוגדר — דילוג על WhatsApp');
    return;
  }

  // Normalize phone: strip leading + and non-digit chars
  const normalizedPhone = phone.replace(/\D/g, '');

  if (!normalizedPhone) {
    console.warn('[askerNotification] מספר טלפון לא תקין — דילוג על WhatsApp');
    return;
  }

  const url = `https://api.green-api.com/waInstance${instanceId}/sendMessage/${token}`;

  await axios.post(url, {
    chatId:  `${normalizedPhone}@c.us`,
    message,
  }, {
    timeout: 10000,
  });
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
function buildAnswerUrl(data) {
  // Use stored WP permalink if available
  if (data.wp_link) return data.wp_link;

  // Fallback: build from wp_post_id
  if (!data.wp_post_id) return null;
  const baseUrl = (process.env.WP_SITE_URL || process.env.WP_API_URL || '')
    .replace(/\/wp-json.*$/, '')
    .replace(/\/$/, '');
  return `${baseUrl}/ask-rabai/${data.wp_post_id}`;
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

  const greeting = data.asker_name ? `שלום ${data.asker_name},` : 'שלום,';
  const html = `<div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #1B2B5E;">${greeting}</h2>
  <p>שמחים לבשר לך שהרב <strong>${data.rabbi_name}</strong> ענה על שאלתך:</p>
  ${data.title ? `<blockquote style="border-right: 4px solid #B8973A; padding-right: 16px; margin: 16px 0; color: #333;">${data.title}</blockquote>` : ''}
  <p>קיבלת תשובה לשאלתך.${answerUrl ? ` לצפייה בתשובה המלאה לחץ על הקישור: <a href="${answerUrl}" style="color: #2563eb;">${answerUrl}</a>` : ''}</p>
  <p>בברכה,<br>צוות ענה את השואל</p>
</div>`;

  // Send email
  if (email) {
    try {
      await sendEmail(
        email,
        'התשובה לשאלתך מוכנה — ענה את השואל',
        html
      );
    } catch (err) {
      console.error(`[askerNotification] שגיאה בשליחת אימייל לשואל (שאלה ${questionId}):`, err.message);
    }
  }

  // Send WhatsApp
  if (phone) {
    try {
      const whatsappMessage = answerUrl
        ? `שלום, הרב ${data.rabbi_name} ענה על שאלתך באתר ענה את השואל.\nלצפייה בתשובה: ${answerUrl}`
        : `שלום, הרב ${data.rabbi_name} ענה על שאלתך באתר ענה את השואל. התשובה מחכה לך באתר.`;

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

  // Send email
  if (email) {
    try {
      await sendEmail(
        email,
        'תשובת המשך לשאלתך — ענה את השואל',
        `<div dir="rtl" style="font-family: Arial, sans-serif;">
          <h2>שלום,</h2>
          <p>הרב ${data.rabbi_name} הוסיף תשובת המשך לשאלתך.</p>
          ${answerUrl
            ? `<p><a href="${answerUrl}" style="color: #2563eb;">לחץ כאן לצפייה בתשובה</a></p>`
            : '<p>התשובה מחכה לך באתר.</p>'
          }
          <p>בברכה,<br>צוות ענה את השואל</p>
        </div>`
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
      await sendEmail(
        email,
        `תשובה לשאלתך — ${data.title || 'ענה את השואל'}`,
        `<div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1B2B5E;">${greeting}</h2>
          <p>הרב <strong>${data.rabbi_name}</strong> ענה על שאלתך בתשובה אישית:</p>
          <blockquote style="border-right: 4px solid #B8973A; padding-right: 16px; margin: 16px 0; color: #333;">
            <strong>שאלה:</strong> ${data.title}
          </blockquote>
          <div style="background: #f9f9f9; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="margin: 0;"><strong>תשובה:</strong></p>
            <div style="margin-top: 8px;">${data.answer_content}</div>
          </div>
          <p style="color: #666; font-size: 12px;">תשובה זו נשלחה אליך באופן אישי ואינה מפורסמת באתר.</p>
          <p>בברכה,<br>צוות ענה את השואל</p>
        </div>`
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

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  notifyAskerNewAnswer,
  notifyAskerFollowUp,
  notifyAskerPrivateAnswer,
};
