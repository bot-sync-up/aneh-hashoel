'use strict';

/**
 * Inbound Email Webhook Router
 *
 * Receives email replies from rabbis via Mailgun's inbound routing webhook.
 * Parses the reply, validates the sender, saves the answer, and triggers
 * downstream sync (WordPress) and notification (to the asker).
 *
 * Mounted at:  /api/email
 *
 * Routes:
 *   POST  /inbound       – Mailgun webhook (production)
 *   POST  /inbound/test  – dev-only simulation endpoint
 *
 * Flow:
 *   Rabbi replies to email → Mailgun catches it →
 *   POST /api/email/inbound → parse, validate, save answer →
 *   sync to WP + notify asker → return 200
 */

const express = require('express');

const { verifyMailgunSignature }                                       = require('../utils/mailgunVerify');
const { extractEmailAction, cleanEmailBody, validateSender,
        findRabbiByEmail }                                             = require('../services/emailParser');
const { query }                                                        = require('../db/pool');
const { logAction, ACTIONS }                                           = require('../middleware/auditLog');

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the plain email address from a "From" header that may include
 * a display name, e.g. "הרב ישראל ישראלי <rabbi@example.com>".
 *
 * @param {string} from
 * @returns {string}
 */
function extractEmailAddress(from) {
  if (!from) return '';
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim().toLowerCase();
}

/**
 * Attempt to load optional service modules that may not exist yet.
 * Returns a no-op stub if the module is unavailable, so the inbound
 * endpoint never crashes due to a missing downstream service.
 *
 * @param {string} modulePath
 * @returns {object}
 */
function tryRequire(modulePath) {
  try {
    return require(modulePath);
  } catch {
    return null;
  }
}

// ─── POST /inbound ──────────────────────────────────────────────────────────

router.post('/inbound', async (req, res) => {
  // ── Always respond quickly — Mailgun expects 200 within seconds ──
  // We process everything synchronously in a try/catch and return 200
  // at the end regardless; Mailgun will retry on non-2xx.

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || null;

  try {
    // ─── 1. Verify Mailgun webhook signature ──────────────────────────
    const timestamp = req.body.timestamp;
    const token     = req.body.token;
    const signature = req.body.signature;

    if (!verifyMailgunSignature(timestamp, token, signature)) {
      console.warn('[emailInbound] חתימת Mailgun לא תקינה', { timestamp, ip });

      await logAction(null, 'email.inbound_rejected', 'email', null, null, {
        reason: 'invalid_signature',
        ip,
      }, ip, null);

      return res.status(406).json({ error: 'חתימה לא תקינה' });
    }

    // ─── 2. Extract fields from the webhook payload ───────────────────
    const senderRaw = req.body.sender || req.body.from || '';
    const sender    = extractEmailAddress(senderRaw);
    const subject   = req.body.subject || '';
    const bodyPlain = req.body['body-plain'] || req.body['body-html'] || '';

    // Log every inbound email for auditing
    await logAction(null, 'email.inbound_received', 'email', null, null, {
      sender,
      subject: subject.substring(0, 200),
      body_length: bodyPlain.length,
      ip,
    }, ip, null);

    // ─── 3. Determine action from subject + body ("תפוס"/"שחרר" keywords)
    const cleanedBody = cleanEmailBody(bodyPlain);
    const emailAction = extractEmailAction(subject, cleanedBody);

    if (!emailAction) {
      console.warn('[emailInbound] לא נמצאה פעולה בנושא:', subject);
      return res.status(200).json({ ok: true });   // silent ignore — not our email
    }

    const { action, questionId, followUpId } = emailAction;
    console.info(`[emailInbound] action=${action} questionId=${questionId}${followUpId ? ` followUpId=${followUpId}` : ''} from=${sender}`);

    // ─── 4a. CLAIM ───────────────────────────────────────────────────
    if (action === 'claim') {
      const rabbi = await findRabbiByEmail(sender);

      if (!rabbi) {
        console.warn('[emailInbound] claim: שולח לא זוהה כרב פעיל:', sender);
        await logAction(null, 'email.inbound_rejected', 'email', String(questionId), null,
          { reason: 'unknown_sender', sender, action: 'claim' }, ip, null);
        return res.status(200).json({ ok: true });
      }

      try {
        const { claimQuestion } = require('../services/questions');
        const result = await claimQuestion(questionId, rabbi.id);

        if (!result.success) {
          console.info(`[emailInbound] claim: שאלה ${questionId} כבר נתפסה — ${sender}`);
          // Send polite "already taken" reply (fire-and-forget)
          setImmediate(async () => {
            try {
              const emailSvc = require('../services/email');
              await emailSvc.sendAlreadyClaimed(rabbi.email, rabbi.name, questionId);
            } catch (e) {
              console.warn('[emailInbound] claim: שגיאה בשליחת "כבר נתפסה":', e.message);
            }
          });
          return res.status(200).json({ ok: true });
        }

        console.info(`[emailInbound] claim: שאלה ${questionId} נתפסה על ידי רב ${rabbi.id}`);
        await logAction(rabbi.id, ACTIONS.QUESTION_CLAIMED, 'question', String(questionId), null,
          { source: 'email' }, ip, null);

        // Fire-and-forget: send full question email + socket broadcast
        setImmediate(async () => {
          try {
            const emailSvc = require('../services/email');
            await emailSvc.sendFullQuestion(rabbi.email, result.question);
            console.info(`[emailInbound] claim: מייל שאלה מלאה נשלח לרב ${rabbi.id}`);
          } catch (e) {
            console.error('[emailInbound] claim: שגיאה בשליחת מייל מלא:', e.message);
          }

          try {
            const io = router._io || (req.app && req.app.get('io'));
            if (io) {
              io.emit('question:claimed', { id: questionId, assigned_rabbi: rabbi.id, status: 'in_process' });
            }
          } catch (e) {
            console.warn('[emailInbound] claim: socket error:', e.message);
          }
        });

      } catch (claimErr) {
        console.error('[emailInbound] claim error:', claimErr.message);
      }

      return res.status(200).json({ ok: true });
    }

    // ─── 4b. RELEASE ─────────────────────────────────────────────────
    if (action === 'release') {
      const rabbi = await findRabbiByEmail(sender);

      if (!rabbi) {
        console.warn('[emailInbound] release: שולח לא זוהה כרב פעיל:', sender);
        return res.status(200).json({ ok: true });
      }

      try {
        // Release only if this rabbi currently holds the question
        const released = await query(
          `UPDATE questions
           SET    status = 'pending', assigned_rabbi_id = NULL,
                  lock_timestamp = NULL, updated_at = NOW()
           WHERE  id = $1
             AND  assigned_rabbi_id = $2
             AND  status = 'in_process'
           RETURNING id`,
          [questionId, rabbi.id]
        );

        if (released.rowCount > 0) {
          console.info(`[emailInbound] release: שאלה ${questionId} שוחררה על ידי רב ${rabbi.id}`);
          await logAction(rabbi.id, ACTIONS.QUESTION_RELEASED, 'question', String(questionId), null,
            { source: 'email' }, ip, null);

          // Notify rabbi + broadcast socket
          setImmediate(async () => {
            try {
              const emailSvc = require('../services/email');
              await emailSvc.sendReleaseConfirmation(rabbi.email, rabbi.name, questionId);
            } catch (e) {
              console.warn('[emailInbound] release: שגיאה בשליחת אישור:', e.message);
            }
            try {
              const io = router._io || (req.app && req.app.get('io'));
              if (io) io.emit('question:released', { id: questionId, status: 'pending' });
            } catch (e) { /* ignore */ }
          });
        } else {
          console.info(`[emailInbound] release: שאלה ${questionId} לא שייכת לרב ${rabbi.id} — מתעלם`);
        }
      } catch (releaseErr) {
        console.error('[emailInbound] release error:', releaseErr.message);
      }

      return res.status(200).json({ ok: true });
    }

    // ─── 4c. ANSWER / FOLLOWUP_ANSWER ──────────────────────────────
    // (action === 'answer' or 'followup_answer')

    let { valid, rabbi, question } = await validateSender(sender, questionId);

    // If the subject explicitly carries [FOLLOWUP:XX:YY], inject the
    // follow_up_id so the answer-saving logic treats it as a follow-up reply.
    if (action === 'followup_answer' && followUpId && question) {
      question.follow_up_id = followUpId;
    }

    if (!question) {
      console.warn('[emailInbound] שאלה לא נמצאה:', questionId);
      await logAction(null, 'email.inbound_rejected', 'email', String(questionId), null,
        { reason: 'question_not_found', sender, questionId }, ip, null);
      return res.status(200).json({ error: 'השאלה לא נמצאה במערכת' });
    }

    // ── Auto-claim: if the question is unassigned (pending), the replying
    //    rabbi is implicitly claiming + answering in one step. ──
    if (!valid && question.status === 'pending' && !question.assigned_rabbi_id) {
      const senderRabbi = await findRabbiByEmail(sender);
      if (senderRabbi) {
        try {
          const { claimQuestion } = require('../services/questions');
          const claimResult = await claimQuestion(questionId, senderRabbi.id);
          if (claimResult.success) {
            console.info(`[emailInbound] auto-claim: שאלה ${questionId} נתפסה אוטומטית על ידי רב ${senderRabbi.id} (reply-to-answer)`);
            await logAction(senderRabbi.id, ACTIONS.QUESTION_CLAIMED, 'question', String(questionId), null,
              { source: 'email', auto_claim: true }, ip, null);
            // Re-validate now that the rabbi is assigned
            ({ valid, rabbi, question } = await validateSender(sender, questionId));
            // Re-inject follow-up ID if this was a followup_answer action
            if (action === 'followup_answer' && followUpId && question) {
              question.follow_up_id = followUpId;
            }
          } else {
            console.info(`[emailInbound] auto-claim: שאלה ${questionId} כבר נתפסה — ${sender}`);
          }
        } catch (claimErr) {
          console.error('[emailInbound] auto-claim error:', claimErr.message);
        }
      }
    }

    if (!valid) {
      console.warn('[emailInbound] שולח לא מורשה:', sender, 'לשאלה:', questionId);
      await logAction(null, 'email.inbound_rejected', 'email', String(questionId), null,
        { reason: 'unauthorized_sender', sender, questionId,
          assigned_rabbi_id: question.assigned_rabbi_id }, ip, null);
      return res.status(200).json({ error: 'השולח אינו הרב המוקצה לשאלה זו' });
    }

    // ─── 5. Clean the email body ──────────────────────────────────────
    const cleanBody = cleanEmailBody(bodyPlain);

    if (!cleanBody) {
      console.warn('[emailInbound] גוף אימייל ריק לאחר ניקוי, שאלה:', questionId);
      await logAction(rabbi.id, 'email.inbound_rejected', 'email', String(questionId), null,
        { reason: 'empty_body', sender, questionId }, ip, null);
      return res.status(200).json({ error: 'גוף האימייל ריק. לא ניתן לשמור תשובה ריקה' });
    }

    // ─── 6. Check if question is already answered ─────────────────────
    if (question.status === 'answered' && !question.follow_up_id) {
      console.warn('[emailInbound] שאלה כבר נענתה:', questionId);
      await logAction(rabbi.id, 'email.inbound_rejected', 'email', String(questionId), null,
        { reason: 'already_answered', sender, questionId }, ip, null);
      return res.status(200).json({ error: 'השאלה כבר נענתה' });
    }

    // ─── 7. Save the answer ───────────────────────────────────────────
    let answerId;

    if (question.follow_up_id) {
      const { rows } = await query(
        `INSERT INTO answers (question_id, rabbi_id, answer_text, source, follow_up_id, created_at, updated_at)
         VALUES ($1, $2, $3, 'email', $4, NOW(), NOW())
         RETURNING id`,
        [questionId, rabbi.id, cleanBody, question.follow_up_id]
      );
      answerId = rows[0].id;

      await query(
        `UPDATE follow_ups SET status = 'answered', answered_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [question.follow_up_id]
      );

      console.info('[emailInbound] תשובה לשאלת המשך נשמרה:', { answerId, questionId, followUpId: question.follow_up_id });
    } else {
      const { rows } = await query(
        `INSERT INTO answers (question_id, rabbi_id, answer_text, source, created_at, updated_at)
         VALUES ($1, $2, $3, 'email', NOW(), NOW())
         RETURNING id`,
        [questionId, rabbi.id, cleanBody]
      );
      answerId = rows[0].id;

      await query(
        `UPDATE questions SET status = 'answered', answered_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [questionId]
      );

      console.info('[emailInbound] תשובה נשמרה:', { answerId, questionId });
    }

    await logAction(rabbi.id, ACTIONS.QUESTION_ANSWERED, 'question', String(questionId), null, {
      answer_id: answerId,
      source: 'email',
      follow_up_id: question.follow_up_id || null,
      body_length: cleanBody.length,
    }, ip, null);

    // ─── 8. WP sync + asker notification + confirmation to rabbi ──────
    setImmediate(async () => {
      try {
        const wpSync = tryRequire('../services/wpSync');
        if (wpSync && typeof wpSync.syncAnswer === 'function') {
          await wpSync.syncAnswer(questionId, answerId);
          console.info('[emailInbound] סנכרון WP הושלם:', { questionId, answerId });
        }
      } catch (err) {
        console.error('[emailInbound] שגיאה בסנכרון WP:', err.message, { questionId, answerId });
      }

      try {
        const notifications = tryRequire('../services/notifications');
        if (notifications && typeof notifications.notifyAskerAnswered === 'function') {
          await notifications.notifyAskerAnswered(questionId, answerId);
          console.info('[emailInbound] התראה לשואל נשלחה:', { questionId });
        }
      } catch (err) {
        console.error('[emailInbound] שגיאה בשליחת התראה:', err.message, { questionId });
      }

      // Confirmation email to rabbi
      try {
        const emailSvc = require('../services/email');
        if (emailSvc.sendAnswerConfirmation) {
          await emailSvc.sendAnswerConfirmation(rabbi.email, rabbi.name, questionId);
        }
      } catch (err) {
        console.warn('[emailInbound] שגיאה בשליחת אישור לרב:', err.message);
      }

      try {
        const io = router._io || (req.app && req.app.get('io'));
        if (io) {
          io.emit('question:answered', {
            id: questionId, answerId, rabbiId: rabbi.id, status: 'answered', answered_at: new Date().toISOString(), source: 'email',
          });
        }
      } catch (err) {
        console.error('[emailInbound] שגיאה בשליחת Socket event:', err.message);
      }
    });

    // ─── 9. Return 200 ────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      message: 'התשובה נקלטה בהצלחה',
      answerId,
      questionId,
    });

  } catch (err) {
    console.error('[emailInbound] שגיאה בעיבוד אימייל נכנס:', err.message, err.stack);

    await logAction(null, 'email.inbound_error', 'email', null, null, {
      error: err.message,
      ip,
    }, ip, null).catch(() => {});

    // Return 200 even on error to prevent Mailgun retries for unrecoverable issues
    return res.status(200).json({ error: 'שגיאה פנימית בעיבוד האימייל' });
  }
});

// ─── POST /inbound/test ─────────────────────────────────────────────────────

/**
 * Development-only endpoint to simulate an inbound email without Mailgun.
 * Bypasses signature verification; accepts the same body fields.
 *
 * Body:
 *   sender   – email address of the rabbi
 *   subject  – must contain [ID: ###]
 *   body-plain – the reply text
 */
if (process.env.NODE_ENV !== 'production') {
  router.post('/inbound/test', async (req, res) => {
    const ip = req.ip || '127.0.0.1';

    try {
      const sender    = extractEmailAddress(req.body.sender || req.body.from || '');
      const subject   = req.body.subject || '';
      const bodyPlain = req.body['body-plain'] || '';

      console.info('[emailInbound/test] סימולציית אימייל נכנס:', { sender, subject });

      // ── Parse action from subject ──
      const emailAction = extractEmailAction(subject);
      if (!emailAction || (emailAction.action !== 'answer' && emailAction.action !== 'followup_answer')) {
        return res.status(400).json({ error: 'לא נמצא מזהה שאלה בנושא האימייל. פורמט נדרש: [ID: ###] או [FOLLOWUP: ###:###]' });
      }
      const questionId = emailAction.questionId;

      // ── Validate sender ──
      const { valid, rabbi, question } = await validateSender(sender, questionId);

      if (!question) {
        return res.status(404).json({ error: 'השאלה לא נמצאה במערכת' });
      }
      if (!valid) {
        return res.status(403).json({ error: 'השולח אינו הרב המוקצה לשאלה זו' });
      }

      // ── Clean body ──
      const cleanBody = cleanEmailBody(bodyPlain);
      if (!cleanBody) {
        return res.status(400).json({ error: 'גוף האימייל ריק לאחר ניקוי' });
      }

      // ── Check if already answered ──
      if (question.status === 'answered' && !question.follow_up_id) {
        return res.status(409).json({ error: 'השאלה כבר נענתה' });
      }

      // ── Save answer ──
      let answerId;

      if (question.follow_up_id) {
        const { rows } = await query(
          `INSERT INTO answers (question_id, rabbi_id, answer_text, source, follow_up_id, created_at, updated_at)
           VALUES ($1, $2, $3, 'email_test', $4, NOW(), NOW())
           RETURNING id`,
          [questionId, rabbi.id, cleanBody, question.follow_up_id]
        );
        answerId = rows[0].id;

        await query(
          `UPDATE follow_ups SET status = 'answered', answered_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [question.follow_up_id]
        );
      } else {
        const { rows } = await query(
          `INSERT INTO answers (question_id, rabbi_id, answer_text, source, created_at, updated_at)
           VALUES ($1, $2, $3, 'email_test', NOW(), NOW())
           RETURNING id`,
          [questionId, rabbi.id, cleanBody]
        );
        answerId = rows[0].id;

        await query(
          `UPDATE questions SET status = 'answered', answered_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [questionId]
        );
      }

      await logAction(rabbi.id, ACTIONS.QUESTION_ANSWERED, 'question', String(questionId), null, {
        answer_id: answerId,
        source: 'email_test',
        follow_up_id: question.follow_up_id || null,
      }, ip, null);

      return res.status(200).json({
        success: true,
        message: 'תשובת טסט נקלטה בהצלחה',
        answerId,
        questionId,
        rabbi: { id: rabbi.id, name: rabbi.name },
      });

    } catch (err) {
      console.error('[emailInbound/test] שגיאה:', err.message, err.stack);
      return res.status(500).json({ error: 'שגיאה פנימית בעיבוד האימייל' });
    }
  });
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = router;
