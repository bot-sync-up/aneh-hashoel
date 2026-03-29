'use strict';

/**
 * SendGrid Inbound Parse Webhook Router
 *
 * Receives inbound rabbi reply emails via SendGrid's Inbound Parse webhook.
 * SendGrid delivers email as a multipart/form-data POST with the fields:
 *   subject, from/sender, text, html, attachment-info, attachmentN, …
 *
 * Mounted at:  /webhooks/email
 *
 * Routes:
 *   POST /inbound          – production webhook (validates SendGrid signature)
 *   POST /inbound/test     – dev-only simulation (no signature check)
 *
 * Flow:
 *   Rabbi replies to email  →  SendGrid catches it
 *   → POST /webhooks/email/inbound
 *   → verify SendGrid signature
 *   → parseInboundEmail()   (extract questionId, senderEmail, content, attachments)
 *   → validateRabbiEmail()  (DB check: sender == assigned rabbi)
 *   → save answer to DB
 *   → async: WP sync + asker notification + Socket.io event
 *   → return 200 immediately (SendGrid retries on non-2xx)
 *
 * Environment variables:
 *   SENDGRID_WEBHOOK_VERIFY_KEY  – SendGrid Inbound Parse public key for
 *                                  signature verification (optional; if absent,
 *                                  signature check is skipped with a warning)
 */

const express  = require('express');
const crypto   = require('crypto');

const {
  parseInboundEmail,
  parseIncomingEmail,
  validateRabbiEmail,
  validateSender,
  findRabbiByEmail,
}                                                = require('../services/emailParser');
const { query }                                  = require('../db/pool');
const { logAction, ACTIONS }                     = require('../middleware/auditLog');

const router = express.Router();

// ─── SendGrid signature verification ─────────────────────────────────────────

/**
 * Verify the SendGrid Event Webhook / Inbound Parse signature.
 *
 * SendGrid signs webhook POSTs with ECDSA (P-256, SHA-256).
 * The public key is available in the SendGrid dashboard → Settings → Mail Settings.
 *
 * Headers used:
 *   X-Twilio-Email-Event-Webhook-Signature  – base64-encoded ECDSA signature
 *   X-Twilio-Email-Event-Webhook-Timestamp  – Unix timestamp (string)
 *
 * The signed payload is: timestamp + rawBody (concatenated, no separator).
 *
 * @param {import('express').Request} req
 * @returns {boolean}  true if signature is valid or verification is not configured
 */
function verifySendGridSignature(req) {
  const publicKey = process.env.SENDGRID_WEBHOOK_VERIFY_KEY;

  if (!publicKey) {
    console.warn('[emailWebhook] SENDGRID_WEBHOOK_VERIFY_KEY לא מוגדר — דילוג על אימות חתימה');
    return true; // Permissive in dev; harden in production by always setting the key
  }

  const signature = req.headers['x-twilio-email-event-webhook-signature'];
  const timestamp = req.headers['x-twilio-email-event-webhook-timestamp'];

  if (!signature || !timestamp) {
    console.warn('[emailWebhook] כותרות חתימת SendGrid חסרות');
    return false;
  }

  try {
    // The raw request body must be available as req.rawBody (set by bodyParser config)
    const rawBody = req.rawBody || '';
    const payload = timestamp + rawBody;

    const verify = crypto.createVerify('SHA256');
    verify.update(payload);

    // PublicKey must be in PEM format: "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
    const pem = publicKey.includes('BEGIN')
      ? publicKey
      : `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`;

    return verify.verify(pem, Buffer.from(signature, 'base64'));
  } catch (err) {
    console.error('[emailWebhook] שגיאה באימות חתימת SendGrid:', err.message);
    return false;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Load optional service modules without crashing if they don't exist yet.
 *
 * @param {string} modulePath
 * @returns {object|null}
 */
function tryRequire(modulePath) {
  try {
    return require(modulePath);
  } catch {
    return null;
  }
}

/**
 * Derive the request IP, respecting reverse-proxy headers.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function getIp(req) {
  const forwarded = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.ip || null;
}

// ─── Answer persistence ───────────────────────────────────────────────────────

/**
 * Save the rabbi's reply as an answer (or follow-up answer) in the database.
 *
 * @param {object} question   Validated question row
 * @param {object} rabbi      Validated rabbi row
 * @param {string} content    Cleaned reply text
 * @param {string} source     'email' | 'email_test'
 * @returns {Promise<number>} answerId
 */
async function persistAnswer(question, rabbi, content, source = 'email') {
  let answerId;

  if (question.follow_up_id) {
    // Reply to a follow-up
    const { rows } = await query(
      `INSERT INTO answers
         (question_id, rabbi_id, answer_text, source, follow_up_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING id`,
      [question.id, rabbi.id, content, source, question.follow_up_id]
    );
    answerId = rows[0].id;

    await query(
      `UPDATE follow_ups
       SET status = 'answered', answered_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [question.follow_up_id]
    );
  } else {
    // Primary answer
    const { rows } = await query(
      `INSERT INTO answers
         (question_id, rabbi_id, answer_text, source, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING id`,
      [question.id, rabbi.id, content, source]
    );
    answerId = rows[0].id;

    await query(
      `UPDATE questions
       SET status = 'answered', answered_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [question.id]
    );
  }

  return answerId;
}

// ─── Async post-processing ────────────────────────────────────────────────────

/**
 * Fire-and-forget downstream tasks after an answer is saved.
 * Never throws — errors are logged and swallowed so they do not
 * affect the 200 response already sent to SendGrid.
 *
 * @param {{ questionId, answerId, rabbiId, app }} ctx
 */
function triggerPostProcessing({ questionId, answerId, rabbiId, app }) {
  setImmediate(async () => {
    // WordPress sync
    try {
      const wpSync = tryRequire('../services/wpSync');
      if (wpSync && typeof wpSync.syncAnswer === 'function') {
        await wpSync.syncAnswer(questionId, answerId);
        console.info('[emailWebhook] סנכרון WP הושלם:', { questionId, answerId });
      }
    } catch (err) {
      console.error('[emailWebhook] שגיאה בסנכרון WP:', err.message, { questionId, answerId });
    }

    // Asker notification (email + WhatsApp)
    try {
      const notif = tryRequire('../services/askerNotification');
      if (notif && typeof notif.notifyAskerNewAnswer === 'function') {
        await notif.notifyAskerNewAnswer(questionId);
        console.info('[emailWebhook] התראה לשואל נשלחה:', { questionId });
      }
    } catch (err) {
      console.error('[emailWebhook] שגיאה בשליחת התראה לשואל:', err.message, { questionId });
    }

    // Socket.io real-time event
    try {
      const io = (app && app.get('io')) || null;
      if (io) {
        io.emit('question:answered', { id: questionId, answerId, rabbiId, status: 'answered', answered_at: new Date().toISOString(), source: 'email' });
      }
    } catch (err) {
      console.error('[emailWebhook] שגיאה בפרסום Socket.io event:', err.message);
    }
  });
}

// ─── POST /inbound ────────────────────────────────────────────────────────────

/**
 * Main SendGrid Inbound Parse webhook handler.
 *
 * Always returns 200 to prevent SendGrid retries for non-transient errors.
 * Genuine transient errors (DB down, etc.) may return 500 so SendGrid retries.
 */
router.post('/inbound', async (req, res) => {
  const ip = getIp(req);

  // ── 1. Verify SendGrid webhook signature ──────────────────────────────────
  if (!verifySendGridSignature(req)) {
    console.warn('[emailWebhook] חתימת SendGrid לא תקינה', { ip });

    await logAction(null, 'email.inbound_rejected', 'email', null, null,
      { reason: 'invalid_signature', ip }, ip, null).catch(() => {});

    // Return 406 so SendGrid sees the rejection but does not retry endlessly
    return res.status(406).json({ error: 'חתימה לא תקינה' });
  }

  try {
    // ── 2. Parse the inbound email ────────────────────────────────────────
    const { questionId, senderEmail, content, attachments } = parseInboundEmail(req.body);

    // Audit: log every inbound attempt
    await logAction(null, 'email.inbound_received', 'email', null, null, {
      senderEmail,
      subject:     (req.body.subject || '').substring(0, 200),
      bodyLength:  content.length,
      questionId,
      ip,
    }, ip, null).catch(() => {});

    // ── 3. Require question ID in subject ─────────────────────────────────
    if (!questionId) {
      console.warn('[emailWebhook] לא נמצא מזהה שאלה בנושא:', req.body.subject);
      await logAction(null, 'email.inbound_rejected', 'email', null, null,
        { reason: 'missing_question_id', senderEmail, subject: (req.body.subject || '').substring(0, 200) },
        ip, null).catch(() => {});

      // 200 — not a transient error; SendGrid need not retry
      return res.status(200).json({ ok: false, reason: 'missing_question_id' });
    }

    // ── 4. Validate sender is the assigned rabbi ──────────────────────────
    let { valid, rabbi, question } = await validateRabbiEmail(senderEmail, questionId);

    if (!question) {
      console.warn('[emailWebhook] שאלה לא נמצאה:', questionId);
      await logAction(null, 'email.inbound_rejected', 'email', String(questionId), null,
        { reason: 'question_not_found', senderEmail, questionId }, ip, null).catch(() => {});

      return res.status(200).json({ ok: false, reason: 'question_not_found' });
    }

    // ── Auto-claim: if the question is unassigned (pending), the replying
    //    rabbi is implicitly claiming + answering in one step. ──
    if (!valid && question.status === 'pending' && !question.assigned_rabbi_id) {
      const senderRabbi = await findRabbiByEmail(senderEmail);
      if (senderRabbi) {
        try {
          const { claimQuestion } = require('../services/questions');
          const claimResult = await claimQuestion(questionId, senderRabbi.id);
          if (claimResult.success) {
            console.info(`[emailWebhook] auto-claim: שאלה ${questionId} נתפסה אוטומטית על ידי רב ${senderRabbi.id}`);
            await logAction(senderRabbi.id, ACTIONS.QUESTION_CLAIMED, 'question', String(questionId), null,
              { source: 'email', auto_claim: true }, ip, null).catch(() => {});
            ({ valid, rabbi, question } = await validateRabbiEmail(senderEmail, questionId));
          }
        } catch (claimErr) {
          console.error('[emailWebhook] auto-claim error:', claimErr.message);
        }
      }
    }

    if (!valid) {
      console.warn('[emailWebhook] שולח לא מורשה:', senderEmail, 'שאלה:', questionId);
      await logAction(null, 'email.inbound_rejected', 'email', String(questionId), null,
        { reason: 'unauthorized_sender', senderEmail, questionId,
          assigned_rabbi_id: question.assigned_rabbi_id }, ip, null).catch(() => {});

      return res.status(200).json({ ok: false, reason: 'unauthorized_sender' });
    }

    // ── 5. Require non-empty body ─────────────────────────────────────────
    if (!content) {
      console.warn('[emailWebhook] גוף ריק לאחר ניקוי, שאלה:', questionId);
      await logAction(rabbi.id, 'email.inbound_rejected', 'email', String(questionId), null,
        { reason: 'empty_body', senderEmail, questionId }, ip, null).catch(() => {});

      return res.status(200).json({ ok: false, reason: 'empty_body' });
    }

    // ── 6. Guard against duplicate answers ───────────────────────────────
    if (question.status === 'answered' && !question.follow_up_id) {
      console.warn('[emailWebhook] שאלה כבר נענתה:', questionId);
      await logAction(rabbi.id, 'email.inbound_rejected', 'email', String(questionId), null,
        { reason: 'already_answered', senderEmail, questionId }, ip, null).catch(() => {});

      return res.status(200).json({ ok: false, reason: 'already_answered' });
    }

    // ── 7. Persist the answer ─────────────────────────────────────────────
    const answerId = await persistAnswer(question, rabbi, content, 'email');

    console.info('[emailWebhook] תשובה נשמרה בהצלחה:', { answerId, questionId, rabbiId: rabbi.id });

    await logAction(rabbi.id, ACTIONS.QUESTION_ANSWERED, 'question', String(questionId), null, {
      answer_id:    answerId,
      source:       'email',
      follow_up_id: question.follow_up_id || null,
      body_length:  content.length,
      attachments:  attachments.length,
    }, ip, null).catch(() => {});

    // ── 8. Trigger downstream tasks asynchronously ────────────────────────
    triggerPostProcessing({
      questionId,
      answerId,
      rabbiId: rabbi.id,
      app:     req.app,
    });

    // ── 9. Respond 200 immediately ────────────────────────────────────────
    return res.status(200).json({ ok: true, answerId, questionId });

  } catch (err) {
    console.error('[emailWebhook] שגיאה בעיבוד אימייל נכנס:', err.message, err.stack);

    await logAction(null, 'email.inbound_error', 'email', null, null,
      { error: err.message, ip }, ip, null).catch(() => {});

    // 500 tells SendGrid to retry — only appropriate for genuine transient failures
    return res.status(500).json({ ok: false, error: 'שגיאה פנימית' });
  }
});

// ─── POST /inbound/test ───────────────────────────────────────────────────────

/**
 * Development-only endpoint: simulate an inbound email without SendGrid.
 * Skips signature verification.  Disabled in production.
 *
 * Accepts the same body fields as the real webhook:
 *   sender   – rabbi email
 *   subject  – must contain [ID: ###]
 *   text     – plain-text reply body
 */
if (process.env.NODE_ENV !== 'production') {
  router.post('/inbound/test', async (req, res) => {
    const ip = getIp(req);

    try {
      const { questionId, senderEmail, content } = parseInboundEmail(req.body);

      if (!questionId) {
        return res.status(400).json({
          ok:    false,
          error: 'לא נמצא מזהה שאלה. פורמט נדרש: [ID: ###] בנושא האימייל',
        });
      }

      const { valid, rabbi, question } = await validateRabbiEmail(senderEmail, questionId);

      if (!question) {
        return res.status(404).json({ ok: false, error: 'השאלה לא נמצאה' });
      }
      if (!valid) {
        return res.status(403).json({ ok: false, error: 'השולח אינו הרב המוקצה לשאלה זו' });
      }
      if (!content) {
        return res.status(400).json({ ok: false, error: 'גוף האימייל ריק לאחר ניקוי' });
      }
      if (question.status === 'answered' && !question.follow_up_id) {
        return res.status(409).json({ ok: false, error: 'השאלה כבר נענתה' });
      }

      const answerId = await persistAnswer(question, rabbi, content, 'email_test');

      await logAction(rabbi.id, ACTIONS.QUESTION_ANSWERED, 'question', String(questionId), null, {
        answer_id:    answerId,
        source:       'email_test',
        follow_up_id: question.follow_up_id || null,
      }, ip, null).catch(() => {});

      triggerPostProcessing({ questionId, answerId, rabbiId: rabbi.id, app: req.app });

      return res.status(200).json({
        ok: true,
        message: 'תשובת טסט נקלטה בהצלחה',
        answerId,
        questionId,
        rabbi: { id: rabbi.id, name: rabbi.name },
      });

    } catch (err) {
      console.error('[emailWebhook/test] שגיאה:', err.message, err.stack);
      return res.status(500).json({ ok: false, error: 'שגיאה פנימית' });
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Task-spec route: POST /webhook/email/inbound
// ═══════════════════════════════════════════════════════════════════════════════
//
// This route is mounted by server.js at /webhook/email so the effective path
// becomes POST /webhook/email/inbound, matching the task specification.
//
// It uses the canonical parseIncomingEmail / validateSender API and adds
// error-reply emails to the rabbi when the question ID is unknown.

/**
 * Send an error notification back to the rabbi via email.
 * Best-effort: if email sending fails, we log and continue.
 *
 * @param {string} rabbiEmail
 * @param {string} subject
 * @param {string} hebrewMessage
 */
async function sendErrorReply(rabbiEmail, subject, hebrewMessage) {
  try {
    const emailService = tryRequire('../services/emailService');
    if (!emailService || typeof emailService.sendEmergencyBroadcast !== 'function') return;
    // Re-use the low-level _send-equivalent by building an sgMail call
    const sgMail = require('@sendgrid/mail');
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) return;
    sgMail.setApiKey(apiKey);

    const from = {
      email: process.env.SENDGRID_FROM_EMAIL || process.env.EMAIL_FROM_ADDRESS || 'noreply@aneh-hashoel.co.il',
      name:  process.env.SENDGRID_FROM_NAME  || process.env.EMAIL_FROM_NAME   || 'ענה את השואל',
    };

    await sgMail.send({
      to:      rabbiEmail,
      from,
      subject: `[שגיאה] ${subject}`,
      text:    hebrewMessage,
      html:    `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;">${hebrewMessage}</div>`,
    });
  } catch (err) {
    console.error('[emailWebhook] שגיאה בשליחת הודעת שגיאה לרב:', err.message);
  }
}

/**
 * POST /webhook/email/inbound
 *
 * SendGrid Inbound Parse webhook — task-spec entry point.
 * Uses parseIncomingEmail() and validateSender() from emailParser.
 * Always returns 200 (SendGrid retries on non-2xx).
 */
router.post('/webhook/email/inbound', async (req, res) => {
  // Respond immediately — SendGrid requires a fast 2xx
  res.status(200).json({ ok: true });

  const ip = getIp(req);

  // Run processing asynchronously so the response is already sent
  setImmediate(async () => {
    try {
      // 1. Signature check
      if (!verifySendGridSignature(req)) {
        console.warn('[emailWebhook/sg] חתימה לא תקינה', { ip });
        await logAction(null, 'email.inbound_rejected', 'email', null, null,
          { reason: 'invalid_signature', ip }, ip, null).catch(() => {});
        return;
      }

      // 2. Parse
      const { questionId, rabbiEmail, cleanContent } = parseIncomingEmail(req.body);

      await logAction(null, 'email.inbound_received', 'email', null, null, {
        rabbiEmail,
        subject:    (req.body.subject || '').substring(0, 200),
        bodyLength: cleanContent.length,
        questionId,
        ip,
      }, ip, null).catch(() => {});

      // 3. Unknown question ID → send error reply to rabbi
      if (!questionId) {
        console.warn('[emailWebhook/sg] לא נמצא מזהה שאלה:', req.body.subject);
        if (rabbiEmail) {
          await sendErrorReply(
            rabbiEmail,
            'לא נמצא מזהה שאלה',
            'לא הצלחנו לזהות את מספר השאלה בנושא המייל שלכם.<br/>' +
            'ודאו שנושא המייל מכיל את המזהה בפורמט: <strong>[ID: ###]</strong><br/>' +
            'שלחו שוב עם הנושא המקורי.'
          );
        }
        return;
      }

      // 4. Validate sender
      let { valid, rabbi, question } = await validateSender(rabbiEmail, questionId);

      if (!question) {
        console.warn('[emailWebhook/sg] שאלה לא נמצאה:', questionId);
        if (rabbiEmail) {
          await sendErrorReply(
            rabbiEmail,
            `שאלה ${questionId} לא נמצאה`,
            `השאלה עם המזהה ${questionId} לא נמצאה במערכת. ייתכן שהיא נמחקה או הועברה.`
          );
        }
        return;
      }

      // Auto-claim: if question is unassigned, the replying rabbi claims + answers
      if (!valid && question.status === 'pending' && !question.assigned_rabbi_id) {
        const senderRabbi = await findRabbiByEmail(rabbiEmail);
        if (senderRabbi) {
          try {
            const { claimQuestion } = require('../services/questions');
            const claimResult = await claimQuestion(questionId, senderRabbi.id);
            if (claimResult.success) {
              console.info(`[emailWebhook/sg] auto-claim: שאלה ${questionId} נתפסה אוטומטית על ידי רב ${senderRabbi.id}`);
              await logAction(senderRabbi.id, ACTIONS.QUESTION_CLAIMED, 'question', String(questionId), null,
                { source: 'email', auto_claim: true }, ip, null).catch(() => {});
              ({ valid, rabbi, question } = await validateSender(rabbiEmail, questionId));
            }
          } catch (claimErr) {
            console.error('[emailWebhook/sg] auto-claim error:', claimErr.message);
          }
        }
      }

      // Wrong sender — log and ignore (do not reply to prevent email loops)
      if (!valid) {
        console.warn('[emailWebhook/sg] שולח לא מורשה:', rabbiEmail, 'שאלה:', questionId);
        await logAction(null, 'email.inbound_rejected', 'email', String(questionId), null,
          { reason: 'unauthorized_sender', rabbiEmail, questionId,
            assigned_rabbi_id: question.assigned_rabbi_id }, ip, null).catch(() => {});
        return;
      }

      // 5. Empty body
      if (!cleanContent) {
        console.warn('[emailWebhook/sg] גוף ריק, שאלה:', questionId);
        return;
      }

      // 6. Already answered
      if (question.status === 'answered' && !question.follow_up_id) {
        console.warn('[emailWebhook/sg] שאלה כבר נענתה:', questionId);
        return;
      }

      // 7. Save answer
      const answerId = await persistAnswer(question, rabbi, cleanContent, 'email');

      console.info('[emailWebhook/sg] תשובה נשמרה:', { answerId, questionId, rabbiId: rabbi.id });

      await logAction(rabbi.id, ACTIONS.QUESTION_ANSWERED, 'question', String(questionId), null, {
        answer_id:    answerId,
        source:       'email',
        follow_up_id: question.follow_up_id || null,
        body_length:  cleanContent.length,
      }, ip, null).catch(() => {});

      // 8. Downstream tasks
      triggerPostProcessing({ questionId, answerId, rabbiId: rabbi.id, app: req.app });

    } catch (err) {
      console.error('[emailWebhook/sg] שגיאה:', err.message, err.stack);
      await logAction(null, 'email.inbound_error', 'email', null, null,
        { error: err.message, ip }, ip, null).catch(() => {});
    }
  });
});

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = router;
