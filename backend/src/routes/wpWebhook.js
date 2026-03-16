'use strict';

/**
 * wpWebhook.js — WordPress → Our System Webhook Endpoints
 * ─────────────────────────────────────────────────────────────────────────────
 * Receives push notifications from the WordPress asker-side site and triggers
 * the appropriate local actions (DB persistence, Socket.io broadcasts, etc.).
 *
 * Mount point (register in server.js):
 *   app.use('/webhook/wordpress', require('./routes/wpWebhook'));
 *
 * Routes:
 *   POST /webhook/wordpress/new-question      – New question submitted by asker
 *   POST /webhook/wordpress/question-updated  – Question edited / deleted on WP side
 *   POST /webhook/wordpress/thank-click       – Asker clicked "תודה לרב" button
 *
 * Security:
 *   All requests must include the header  X-WP-Webhook-Secret  matching the
 *   value in process.env.WP_WEBHOOK_SECRET.  Validated with a constant-time
 *   compare to resist timing attacks.  Missing or invalid secret → 401.
 *
 * Idempotency:
 *   new-question is idempotent by wp_post_id.  Duplicate deliveries return 200.
 *
 * Dependency chain:
 *   services/questions  – createFromWebhook, getQuestionById (local)
 *   services/wpService  – logSync
 *   socket/questionEvents – broadcastNewQuestion, broadcastUrgentQuestion,
 *                           broadcastStatusChanged, notifyThankReceived
 *   utils/sanitize      – sanitizeRichText
 * ─────────────────────────────────────────────────────────────────────────────
 */

const crypto  = require('crypto');
const express = require('express');

const { query }                    = require('../db/pool');
const { createFromWebhook }        = require('../services/questions');
const { sanitizeRichText }         = require('../utils/sanitize');
const { logSync }                  = require('../services/wpService');

const {
  broadcastNewQuestion,
  broadcastUrgentQuestion,
  broadcastStatusChanged,
  notifyThankReceived,
} = require('../socket/questionEvents');

const router = express.Router();

// ─── Secret validation middleware ─────────────────────────────────────────────

/**
 * Validate the X-WP-Webhook-Secret header with a constant-time comparison.
 * Rejects with 401 when the header is absent or does not match.
 *
 * Reads WP_WEBHOOK_SECRET from the environment at call time so tests can set
 * it without re-requiring the module.
 *
 * @type {import('express').RequestHandler}
 */
function verifyWebhookSecret(req, res, next) {
  const expected = process.env.WP_WEBHOOK_SECRET;

  if (!expected) {
    console.error('[wpWebhook] WP_WEBHOOK_SECRET לא מוגדר בסביבת הריצה');
    return res.status(500).json({ error: 'שגיאת תצורת שרת: WP_WEBHOOK_SECRET חסר' });
  }

  const provided = req.headers['x-wp-webhook-secret'] || '';

  if (!provided) {
    console.warn(`[wpWebhook] קריאה ללא X-WP-Webhook-Secret מ-${_clientIp(req)}`);
    return res.status(401).json({ error: 'חסר כותרת X-WP-Webhook-Secret' });
  }

  // Constant-time comparison — both buffers must have the same length
  const bufExpected = Buffer.from(expected);
  const bufProvided = Buffer.from(provided);

  const lengthMatch = bufExpected.length === bufProvided.length;
  const valueMatch  = lengthMatch && crypto.timingSafeEqual(bufExpected, bufProvided);

  if (!lengthMatch || !valueMatch) {
    console.warn(
      `[wpWebhook] X-WP-Webhook-Secret לא תקין מ-${_clientIp(req)} ` +
      `(${provided.length} תווים סופקו)`
    );
    return res.status(401).json({ error: 'X-WP-Webhook-Secret לא תקין' });
  }

  return next();
}

// ─── Payload normaliser ───────────────────────────────────────────────────────

/**
 * Normalise the raw WP webhook body into a consistent shape.
 * WordPress plugins may send different field structures; we handle the most
 * common variants.
 *
 * @param {object} body
 * @returns {object} Normalised payload
 */
function normalisePayload(body) {
  const src  = body.post || body;
  const meta = src.meta || src.acf || src.fields || {};

  return {
    wpPostId:       parseInt(src.ID || src.id || src.post_id || 0, 10) || null,
    title:          (src.post_title   || src.title   || '').trim(),
    content:        src.post_content  || src.content || '',
    wpStatus:       src.post_status   || src.status  || 'publish',
    modifiedGmt:    src.post_modified_gmt || src.modified_gmt || null,
    // ACF / meta
    askerName:      meta.asker_name        || src.asker_name  || null,
    askerEmail:     meta.asker_email       || src.asker_email || null,
    askerPhone:     meta.asker_phone       || src.asker_phone || null,
    categorySlug:   meta.question_category || src.category    || null,
    urgency:        meta.urgency           || src.urgency     || 'normal',
    questionStatus: meta.status            || null,
    // thank-click specific
    sessionToken:   src.session_token      || src.sessionToken || null,
    thankMessage:   src.message            || meta.message     || null,
  };
}

// ─── POST /new-question ───────────────────────────────────────────────────────

/**
 * WordPress sends this when an asker submits a new question via the site form.
 *
 * Steps:
 *   1. Validate webhook secret
 *   2. Normalise and validate payload
 *   3. Idempotency check (skip if wp_post_id already in DB)
 *   4. Persist via createFromWebhook()
 *   5. Broadcast to rabbis via Socket.io
 *   6. Respond 201 immediately (WP must not time out)
 *
 * @route POST /webhook/wordpress/new-question
 */
router.post('/new-question', verifyWebhookSecret, async (req, res, next) => {
  const raw = req.body;

  if (!raw || typeof raw !== 'object' || Object.keys(raw).length === 0) {
    return res.status(400).json({ error: 'גוף הבקשה ריק או לא תקין' });
  }

  const payload = normalisePayload(raw);

  if (!payload.wpPostId) {
    return res.status(400).json({ error: 'wp_post_id חסר בנתוני ה-webhook' });
  }
  if (!payload.title || !payload.content) {
    return res.status(400).json({ error: 'title ו-content נדרשים' });
  }

  console.log(
    `[wpWebhook] new-question wpPostId=${payload.wpPostId} ` +
    `urgency=${payload.urgency} ip=${_clientIp(req)}`
  );

  // ── Idempotency guard ──────────────────────────────────────────────────────
  try {
    const existing = await query(
      'SELECT id FROM questions WHERE wp_post_id = $1 LIMIT 1',
      [payload.wpPostId]
    );

    if (existing.rowCount > 0) {
      console.log(
        `[wpWebhook] new-question: wpPostId=${payload.wpPostId} כבר קיים ` +
        `(id=${existing.rows[0].id}) — מדלג (idempotent)`
      );
      return res.status(200).json({
        message:    'שאלה כבר קיימת',
        questionId: existing.rows[0].id,
      });
    }
  } catch (checkErr) {
    // Non-fatal — fall through; DB UNIQUE constraint will catch duplicates
    console.warn('[wpWebhook] new-question: שגיאת idempotency check:', checkErr.message);
  }

  // ── Persist question ───────────────────────────────────────────────────────
  let question;
  try {
    question = await createFromWebhook({
      title:       payload.title,
      content:     payload.content,
      asker_name:  payload.askerName,
      asker_email: payload.askerEmail,
      asker_phone: payload.askerPhone,
      urgency:     payload.urgency,
      source:      'wordpress',
      wp_post_id:  payload.wpPostId,
    });
  } catch (createErr) {
    console.error(
      `[wpWebhook] new-question: שגיאה ביצירת שאלה wpPostId=${payload.wpPostId}:`,
      createErr.message
    );
    await logSync(payload.wpPostId, 'webhook_new_question', 'failed', createErr.message);
    return next(createErr);
  }

  // ── Socket.io broadcast ────────────────────────────────────────────────────
  const io = req.app.get('io');
  if (io) {
    broadcastNewQuestion(io, question);

    if (payload.urgency === 'critical' || payload.urgency === 'urgent') {
      broadcastUrgentQuestion(io, question);
    }
  }

  await logSync(payload.wpPostId, 'webhook_new_question', 'success');

  console.log(
    `[wpWebhook] new-question ✓ id=${question.id} wpPostId=${payload.wpPostId}`
  );

  return res.status(201).json({
    message:    'שאלה נוצרה בהצלחה',
    questionId: question.id,
    wpPostId:   payload.wpPostId,
  });
});

// ─── POST /question-updated ───────────────────────────────────────────────────

/**
 * WordPress sends this when an admin edits or deletes a question CPT post.
 *
 * Steps:
 *   1. Validate webhook secret
 *   2. Normalise payload
 *   3. Look up local question by wp_post_id
 *   4. Apply updates (title, content, urgency, status)
 *      – WP post_status='trash' → mark local question as hidden
 *      – Stale update guard via modifiedGmt
 *   5. Broadcast socket status-change event if status changed
 *   6. Respond 200
 *
 * @route POST /webhook/wordpress/question-updated
 */
router.post('/question-updated', verifyWebhookSecret, async (req, res, next) => {
  const raw = req.body;

  if (!raw || typeof raw !== 'object' || Object.keys(raw).length === 0) {
    return res.status(400).json({ error: 'גוף הבקשה ריק או לא תקין' });
  }

  const payload = normalisePayload(raw);

  if (!payload.wpPostId) {
    return res.status(400).json({ error: 'wp_post_id חסר בנתוני ה-webhook' });
  }

  console.log(
    `[wpWebhook] question-updated wpPostId=${payload.wpPostId} ` +
    `wpStatus=${payload.wpStatus} ip=${_clientIp(req)}`
  );

  // ── Find local record ──────────────────────────────────────────────────────
  let local;
  try {
    const { rows } = await query(
      `SELECT id, status, updated_at
       FROM   questions
       WHERE  wp_post_id = $1
       LIMIT  1`,
      [payload.wpPostId]
    );

    if (rows.length === 0) {
      console.warn(
        `[wpWebhook] question-updated: wpPostId=${payload.wpPostId} ` +
        'לא נמצא ב-DB המקומי — מתעלם'
      );
      return res.status(200).json({ message: 'שאלה לא נמצאה — מתעלם' });
    }

    local = rows[0];
  } catch (lookupErr) {
    return next(lookupErr);
  }

  // ── Stale update guard ─────────────────────────────────────────────────────
  if (payload.modifiedGmt) {
    const wpTs    = new Date(payload.modifiedGmt).getTime();
    const localTs = new Date(local.updated_at).getTime();
    if (!isNaN(wpTs) && !isNaN(localTs) && wpTs < localTs) {
      console.log(
        `[wpWebhook] question-updated: wpPostId=${payload.wpPostId} ` +
        'stale (wpTs < localTs) — מדלג'
      );
      return res.status(200).json({ message: 'עדכון ישן — מדלג' });
    }
  }

  // ── Build SET clauses ──────────────────────────────────────────────────────
  const setParts = [];
  const params   = [];
  let   pIdx     = 1;

  function addSet(col, value) {
    setParts.push(`${col} = $${pIdx++}`);
    params.push(value);
  }

  if (payload.title)   addSet('title',   payload.title.trim());
  if (payload.content) addSet('content', sanitizeRichText(payload.content));
  if (payload.urgency) addSet('urgency', payload.urgency);

  // Custom WP status field → local status (only if valid and different)
  const VALID_STATUSES = new Set(['pending', 'in_process', 'answered', 'hidden']);
  if (payload.questionStatus && VALID_STATUSES.has(payload.questionStatus)
      && payload.questionStatus !== local.status) {
    addSet('status', payload.questionStatus);
  }

  // WP post deleted/trashed → hide locally
  if (['trash', 'private'].includes(payload.wpStatus) && local.status !== 'hidden') {
    addSet('status', 'hidden');
  }

  setParts.push('updated_at = NOW()');

  // Nothing changed — no-op
  if (setParts.length === 1) {
    // Only 'updated_at = NOW()' — skip the DB write
    return res.status(200).json({
      message:    'אין שינויים רלוונטיים',
      questionId: local.id,
      wpPostId:   payload.wpPostId,
    });
  }

  // ── Apply updates ──────────────────────────────────────────────────────────
  params.push(local.id);
  const whereIdx = pIdx;

  let newStatus = local.status;
  try {
    const updateResult = await query(
      `UPDATE questions
       SET    ${setParts.join(', ')}
       WHERE  id = $${whereIdx}
       RETURNING id, status`,
      params
    );

    if (updateResult.rowCount > 0) {
      newStatus = updateResult.rows[0].status;
    }
  } catch (updateErr) {
    console.error(
      `[wpWebhook] question-updated: שגיאה בעדכון שאלה id=${local.id}:`,
      updateErr.message
    );
    await logSync(payload.wpPostId, 'webhook_question_updated', 'failed', updateErr.message);
    return next(updateErr);
  }

  // ── Socket.io broadcast ────────────────────────────────────────────────────
  const io = req.app.get('io');
  if (io && newStatus !== local.status) {
    broadcastStatusChanged(io, local.id, newStatus, { source: 'wordpress_webhook' });
  }

  await logSync(payload.wpPostId, 'webhook_question_updated', 'success');

  console.log(
    `[wpWebhook] question-updated ✓ id=${local.id} wpPostId=${payload.wpPostId} ` +
    `status: ${local.status} → ${newStatus}`
  );

  return res.status(200).json({
    message:    'שאלה עודכנה בהצלחה',
    questionId: local.id,
    wpPostId:   payload.wpPostId,
    status:     newStatus,
  });
});

// ─── POST /thank-click ────────────────────────────────────────────────────────

/**
 * WordPress sends this when an asker clicks the "תודה לרב" button on the site.
 *
 * Steps:
 *   1. Validate webhook secret
 *   2. Look up local question by wp_post_id
 *   3. Increment thank_count on local question
 *   4. Notify the assigned rabbi via Socket.io (notifyThankReceived)
 *   5. Respond 200
 *
 * @route POST /webhook/wordpress/thank-click
 */
router.post('/thank-click', verifyWebhookSecret, async (req, res, next) => {
  const raw = req.body;

  if (!raw || typeof raw !== 'object' || Object.keys(raw).length === 0) {
    return res.status(400).json({ error: 'גוף הבקשה ריק או לא תקין' });
  }

  const payload = normalisePayload(raw);

  if (!payload.wpPostId) {
    return res.status(400).json({ error: 'wp_post_id חסר בנתוני ה-webhook' });
  }

  console.log(
    `[wpWebhook] thank-click wpPostId=${payload.wpPostId} ip=${_clientIp(req)}`
  );

  // ── Look up local question ─────────────────────────────────────────────────
  let question;
  try {
    const { rows } = await query(
      `SELECT id, assigned_rabbi_id, thank_count
       FROM   questions
       WHERE  wp_post_id = $1
       LIMIT  1`,
      [payload.wpPostId]
    );

    if (rows.length === 0) {
      console.warn(
        `[wpWebhook] thank-click: wpPostId=${payload.wpPostId} לא נמצא — מתעלם`
      );
      return res.status(200).json({ message: 'שאלה לא נמצאה — מתעלם' });
    }

    question = rows[0];
  } catch (lookupErr) {
    return next(lookupErr);
  }

  // ── Increment thank_count ──────────────────────────────────────────────────
  let newThankCount = question.thank_count;
  try {
    const updateResult = await query(
      `UPDATE questions
       SET    thank_count = COALESCE(thank_count, 0) + 1,
              updated_at  = NOW()
       WHERE  id = $1
       RETURNING thank_count, assigned_rabbi_id`,
      [question.id]
    );

    if (updateResult.rowCount > 0) {
      newThankCount = updateResult.rows[0].thank_count;
    }
  } catch (updateErr) {
    console.error(
      `[wpWebhook] thank-click: שגיאה בעדכון thank_count עבור id=${question.id}:`,
      updateErr.message
    );
    // Non-fatal — still notify the rabbi if we can
  }

  // ── Notify assigned rabbi via Socket.io ───────────────────────────────────
  const io = req.app.get('io');
  if (io && question.assigned_rabbi_id) {
    notifyThankReceived(
      io,
      question.assigned_rabbi_id,
      question.id,
      payload.thankMessage || 'השואל הודה לך על תשובתך!'
    );
  }

  await logSync(payload.wpPostId, 'webhook_thank_click', 'success');

  console.log(
    `[wpWebhook] thank-click ✓ id=${question.id} wpPostId=${payload.wpPostId} ` +
    `thankCount=${newThankCount} rabbi=${question.assigned_rabbi_id}`
  );

  return res.status(200).json({
    message:      'תודה נרשמה בהצלחה',
    questionId:   question.id,
    wpPostId:     payload.wpPostId,
    thankCount:   newThankCount,
  });
});

// ─── Utility helpers ──────────────────────────────────────────────────────────

/**
 * Extract the best-available client IP for logging.
 * @param {import('express').Request} req
 * @returns {string}
 */
function _clientIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.ip ||
    'unknown'
  );
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = router;
