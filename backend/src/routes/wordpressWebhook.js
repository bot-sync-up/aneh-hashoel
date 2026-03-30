'use strict';

/**
 * WordPress Webhook Routes
 * ─────────────────────────────────────────────────────────────────────────────
 * Receives outbound webhook calls from WordPress when question CPT posts are
 * created or updated.
 *
 * Mounted at: /api/webhooks/wordpress  (see server.js)
 *
 * Routes:
 *   POST /new-question       – WP sends this immediately after a new question
 *                              post is published.
 *   POST /question-updated   – WP sends this when a question post is edited
 *                              in the WP admin (e.g. admin changes meta fields).
 *
 * Security:
 *   All requests must carry the header X-WP-Webhook-Secret matching the value
 *   in env.WP_WEBHOOK_SECRET.  Requests without a valid secret are rejected
 *   with 401 before any body processing occurs.
 *
 * Ordering guarantee:
 *   WP may deliver webhooks out of order or retry on timeout.  We use
 *   modified_gmt from the payload to guard against applying stale updates.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const express  = require('express');
const { query }   = require('../db/pool');
const { getWebhookSecret } = require('../config/wordpress');
const { createFromWebhook } = require('../services/questions');
const { sanitizeRichText }  = require('../utils/sanitize');
const { enqueue }           = require('../services/wpSyncQueue');
const { encryptField }      = require('../utils/encryption');

const {
  broadcastNewQuestion,
  broadcastUrgentQuestion,
  broadcastStatusChanged,
} = require('../socket/questionEvents');

const router = express.Router();

// ─── Webhook signature middleware ─────────────────────────────────────────────

/**
 * Validate the X-WP-Webhook-Secret header against our configured secret.
 * Uses a constant-time comparison to resist timing attacks.
 *
 * @type {import('express').RequestHandler}
 */
function verifyWebhookSecret(req, res, next) {
  let secret;
  try {
    secret = getWebhookSecret();
  } catch (configErr) {
    console.error('[wp-webhook] WP_WEBHOOK_SECRET לא מוגדר:', configErr.message);
    return res.status(500).json({ error: 'שגיאת תצורת שרת' });
  }

  const provided = req.headers['x-wp-webhook-secret'] || '';

  if (!provided) {
    console.warn('[wp-webhook] קריאה ללא X-WP-Webhook-Secret:', _ip(req));
    return res.status(401).json({ error: 'חסר כותרת X-WP-Webhook-Secret' });
  }

  // Constant-time comparison (both must be same byte length for this to hold,
  // but we guard the length check first)
  if (provided.length !== secret.length || !_timingSafe(provided, secret)) {
    console.warn(
      `[wp-webhook] X-WP-Webhook-Secret לא תקין מ-${_ip(req)} ` +
      `(provided length=${provided.length})`
    );
    return res.status(401).json({ error: 'X-WP-Webhook-Secret לא תקין' });
  }

  return next();
}

// ─── Normalise WP webhook payload ────────────────────────────────────────────

/**
 * Normalise the raw webhook body that WordPress sends into a consistent shape
 * our application understands.  WordPress sends different shapes depending on
 * the plugin version, so we try multiple known field paths.
 *
 * @param {object} body - Raw request body (JSON parsed by Express)
 * @returns {object} Normalised payload
 */
function normaliseWebhookPayload(body) {
  // WP may nest everything under `post` or send it flat
  const src  = body.post || body;
  const meta = src.meta || src.acf || src.fields || {};
  // JetEngine booking-form sends form fields under body.values (not in meta)
  // May arrive as JSON string or parsed object
  let vals = body.values || src.values || {};
  if (typeof vals === 'string') {
    try { vals = JSON.parse(vals); } catch { vals = {}; }
  }

  // Debug log — payload structure (no PII)
  console.log(
    '[wp-webhook] payload keys:',
    JSON.stringify({
      body_keys:  Object.keys(body),
      src_keys:   Object.keys(src).slice(0, 20),
      meta_keys:  Object.keys(meta).slice(0, 20),
      vals_keys:  Object.keys(vals).slice(0, 20),
      has_email:  !!(vals.visitor_email || vals['visitor-email'] || vals.email || vals.asker_email || vals['ask-email'] || meta.visitor_email || meta['visitor-email'] || meta.asker_email),
      has_phone:  !!(vals.visitor_phone || vals['visitor-phone'] || vals.phone || vals.asker_phone || meta.visitor_phone || meta['visitor-phone'] || meta.asker_phone),
    })
  );

  return {
    wpPostId:      parseInt(src.ID || src.id || src.post_id || 0, 10) || null,
    title:         src.post_title  || src.title  || '',
    content:       src.post_content || src.content || '',
    wpStatus:      src.post_status  || src.status  || 'publish',
    modifiedGmt:   src.post_modified_gmt || src.modified_gmt || null,
    createdGmt:    src.post_date_gmt     || src.date_gmt     || null,
    slug:          src.post_name         || src.slug          || null,
    // ACF / meta / JetEngine form values — try all known field-name patterns
    askerName:     meta.visitor_name  || vals.visitor_name  || vals['visitor-name']  || meta.asker_name  || src.visitor_name  || src.asker_name  || null,
    askerEmail:    meta.visitor_email || vals.visitor_email || vals['visitor-email'] || vals.email || vals['ask-email'] || meta.asker_email || src.visitor_email || src.asker_email || null,
    askerPhone:    meta.visitor_phone || vals.visitor_phone || vals['visitor-phone'] || vals.phone || vals['ask-phone'] || meta.asker_phone || src.visitor_phone || src.asker_phone || null,
    categorySlug:  meta.question_category || vals.question_category || meta['ask-cat'] || vals['ask-cat'] || src.category || null,
    urgency:       meta.urgency           || vals.urgency            || src.urgency  || 'normal',
    questionStatus:meta.status            || null,
    assignedRabbi: meta.assigned_rabbi_name || null,
    attachmentUrl: meta['ask-visitor-img'] || vals['ask-visitor-img'] || meta['visitor_image'] || meta.attachment_url || src.attachment_url || null,
    wpLink:        src.link || src.guid?.rendered || null,
  };
}

// ─── POST /new-question ───────────────────────────────────────────────────────

/**
 * WordPress sends this when a new "questions" CPT post is created/published.
 *
 * Actions:
 *   1. Validate secret
 *   2. Normalise payload
 *   3. Persist in local DB via createFromWebhook()
 *   4. Broadcast to rabbis via Socket.io
 *   5. Return 201 immediately so WP does not time out waiting
 *
 * Notifications (email / WhatsApp broadcast to rabbis) are handled inside
 * createFromWebhook via the askerNotification service.
 */
router.post('/new-question', verifyWebhookSecret, async (req, res, next) => {
  const raw = req.body;

  if (!raw || typeof raw !== 'object' || Object.keys(raw).length === 0) {
    return res.status(400).json({ error: 'גוף הבקשה ריק או לא תקין' });
  }

  const payload = normaliseWebhookPayload(raw);

  if (!payload.wpPostId) {
    return res.status(400).json({ error: 'wp_post_id חסר בנתוני ה-webhook' });
  }

  if (!payload.title || !payload.content) {
    return res.status(400).json({ error: 'title ו-content נדרשים' });
  }

  console.log(
    `[wp-webhook] new-question wpPostId=${payload.wpPostId} ` +
    `urgency=${payload.urgency} ip=${_ip(req)}`
  );

  // Idempotency guard — if we already have a question with this wp_post_id, skip
  try {
    const existing = await query(
      'SELECT id FROM questions WHERE wp_post_id = $1 LIMIT 1',
      [payload.wpPostId]
    );

    if (existing.rowCount > 0) {
      console.log(
        `[wp-webhook] new-question: wpPostId=${payload.wpPostId} כבר קיים ` +
        `(id=${existing.rows[0].id}) — מדלג (idempotent)`
      );
      return res.status(200).json({
        message: 'שאלה כבר קיימת',
        questionId: existing.rows[0].id,
      });
    }
  } catch (checkErr) {
    // Non-fatal: fall through to create, which will fail on UNIQUE constraint
    console.warn('[wp-webhook] new-question: שגיאה בבדיקת idempotency:', checkErr.message);
  }

  let question;
  try {
    question = await createFromWebhook({
      title:          payload.title,
      content:        payload.content,
      asker_name:     payload.askerName,
      asker_email:    payload.askerEmail,
      asker_phone:    payload.askerPhone,
      urgency:        payload.urgency,
      source:         'wordpress',
      wp_post_id:     payload.wpPostId,
      attachment_url: payload.attachmentUrl,
      wp_link:        payload.wpLink,
      // category_id resolved from slug if needed — service handles null gracefully
    });
  } catch (createErr) {
    console.error(
      `[wp-webhook] new-question: שגיאה ביצירת שאלה wpPostId=${payload.wpPostId}:`,
      createErr.message
    );
    return next(createErr);
  }

  // ── Socket.io broadcast ─────────────────────────────────────────────────────
  const io = req.app.get('io');
  if (io) {
    broadcastNewQuestion(io, question);

    if (payload.urgency === 'critical' || payload.urgency === 'high') {
      broadcastUrgentQuestion(io, question);
    }
  }

  // FCM push notification to all registered rabbis (fire-and-forget)
  setImmediate(async () => {
    try {
      const fcm = require('../services/fcmService');
      await fcm.notifyNewQuestion(question);
    } catch (e) {
      console.warn('[wp-webhook] FCM failed:', e.message);
    }
  });

  // Upsert lead immediately (fire-and-forget)
  setImmediate(async () => {
    try {
      const { upsertLead } = require('../services/leadsService');
      await upsertLead({
        ...question,
        // question.asker_email contains the encrypted value from DB;
        // map it to asker_email_encrypted so upsertLead can store it,
        // and pass the plaintext as asker_email for hash generation.
        asker_email_encrypted: question.asker_email,
        asker_phone_encrypted: question.asker_phone,
        asker_email: payload.askerEmail,
        asker_phone: payload.askerPhone,
      });
    } catch (leadErr) {
      console.warn('[wp-webhook] upsertLead failed:', leadErr.message);
    }
  });

  // Confirmation email to asker (fire-and-forget)
  setImmediate(async () => {
    try {
      const { notifyAskerQuestionReceived } = require('../services/askerNotification');
      await notifyAskerQuestionReceived({
        asker_email: payload.askerEmail,
        asker_name: payload.askerName,
        title: payload.title,
      });
    } catch(e) {
      console.warn('[wp-webhook] confirmation email failed:', e.message);
    }
  });

  // Fire-and-forget: fetch full WP data to get attachment_url, wp_link, and asker contact
  setImmediate(async () => {
    try {
      const wpService = require('../services/wpService');
      const result = await wpService.getQuestionById(payload.wpPostId);
      if (result.success && result.data) {
        const wpQ    = result.data;
        const meta   = wpQ.meta || {};
        const imgUrl = meta['ask-visitor-img'] || null;
        const wpLink = wpQ.link || null;
        // WP JetEngine stores contact as visitor_email / visitor_phone
        const emailPlain = meta['visitor_email'] || meta['asker_email'] || null;
        const phonePlain = meta['visitor_phone'] || meta['asker_phone'] || null;
        const name       = meta['visitor_name']  || meta['asker_name']  || null;
        // Encrypt PII before storing in DB
        const emailEnc   = encryptField(emailPlain);
        const phoneEnc   = encryptField(phonePlain);

        await query(
          `UPDATE questions
           SET    attachment_url     = COALESCE(attachment_url, $1),
                  wp_link            = COALESCE(wp_link, $2),
                  asker_email        = COALESCE(NULLIF(asker_email,''), $3),
                  asker_phone        = COALESCE(NULLIF(asker_phone,''), $4),
                  asker_name         = COALESCE(NULLIF(asker_name,''), $5),
                  updated_at         = NOW()
           WHERE  id = $6`,
          [imgUrl, wpLink, emailEnc, phoneEnc, name, question.id]
        );
        console.log(`[wp-webhook] enriched question ${question.id} img=${!!imgUrl} email=${!!emailPlain}`);
      }
    } catch (enrichErr) {
      console.warn('[wp-webhook] failed to enrich question with WP data:', enrichErr.message);
    }
  });

  console.log(
    `[wp-webhook] new-question ✓ created id=${question.id} ` +
    `wpPostId=${payload.wpPostId}`
  );

  return res.status(201).json({
    message: 'שאלה נוצרה בהצלחה',
    questionId: question.id,
    wpPostId:   payload.wpPostId,
  });
});

// ─── POST /question-updated ───────────────────────────────────────────────────

/**
 * WordPress sends this when an admin edits a question CPT post.
 *
 * Actions:
 *   1. Validate secret
 *   2. Normalise payload
 *   3. Find the local question by wp_post_id
 *   4. Apply non-destructive field updates (title, content, urgency, etc.)
 *   5. If WP status or assigned rabbi changed, update those too
 *   6. Broadcast socket event so the rabbi dashboard refreshes
 *   7. If WP post_status changed to 'private', mark question as hidden locally
 */
router.post('/question-updated', verifyWebhookSecret, async (req, res, next) => {
  const raw = req.body;

  if (!raw || typeof raw !== 'object' || Object.keys(raw).length === 0) {
    return res.status(400).json({ error: 'גוף הבקשה ריק או לא תקין' });
  }

  const payload = normaliseWebhookPayload(raw);

  if (!payload.wpPostId) {
    return res.status(400).json({ error: 'wp_post_id חסר בנתוני ה-webhook' });
  }

  console.log(
    `[wp-webhook] question-updated wpPostId=${payload.wpPostId} ` +
    `wpStatus=${payload.wpStatus} ip=${_ip(req)}`
  );

  // Look up our local record
  let localQuestion;
  try {
    const { rows } = await query(
      `SELECT id, status, title, updated_at, wp_modified_at
       FROM   questions
       WHERE  wp_post_id = $1
       LIMIT  1`,
      [payload.wpPostId]
    );

    if (rows.length === 0) {
      console.warn(
        `[wp-webhook] question-updated: wpPostId=${payload.wpPostId} ` +
        'לא נמצא ב-DB המקומי — מתעלם'
      );
      // Return 200 so WP doesn't keep retrying for posts we don't track
      return res.status(200).json({ message: 'שאלה לא נמצאה ב-DB המקומי — מתעלם' });
    }

    localQuestion = rows[0];
  } catch (lookupErr) {
    return next(lookupErr);
  }

  // Stale update guard — if WP sends an older modified_gmt than what we have, skip
  if (payload.modifiedGmt && localQuestion.wp_modified_at) {
    const wpTs    = new Date(payload.modifiedGmt).getTime();
    const localTs = new Date(localQuestion.wp_modified_at).getTime();
    if (wpTs < localTs) {
      console.log(
        `[wp-webhook] question-updated: wpPostId=${payload.wpPostId} ` +
        'stale update — מדלג (wpTs < localTs)'
      );
      return res.status(200).json({ message: 'עדכון ישן — מדלג' });
    }
  }

  // Build the SET clause dynamically — only update fields WP owns
  const setClauses = [
    'updated_at = NOW()',
    payload.modifiedGmt ? `wp_modified_at = $__WP_MODIFIED__` : null,
  ].filter(Boolean);

  const params = [];
  let   pIdx   = 1;

  /** @param {string} clause */
  function addSet(clause, value) {
    setClauses.push(`${clause} = $${pIdx++}`);
    params.push(value);
  }

  if (payload.title)   addSet('title',   payload.title.trim());
  if (payload.content) addSet('content', sanitizeRichText(payload.content));
  if (payload.urgency) addSet('urgency', payload.urgency);

  // WP custom status field (e.g. 'pending', 'in_process', 'answered')
  if (payload.questionStatus && payload.questionStatus !== localQuestion.status) {
    addSet('status', payload.questionStatus);
  }

  // WP post_status = 'private' → hide locally
  if (payload.wpStatus === 'private' && localQuestion.status !== 'hidden') {
    addSet('status', 'hidden');
  }

  // Inject modifiedGmt param
  if (payload.modifiedGmt) {
    const modIdx = setClauses.findIndex((c) => c.includes('__WP_MODIFIED__'));
    if (modIdx !== -1) {
      setClauses[modIdx] = `wp_modified_at = $${pIdx}`;
      params.push(new Date(payload.modifiedGmt));
      pIdx++;
    }
  }

  // entity_id param at the end
  params.push(localQuestion.id);
  const whereParam = pIdx;

  let newStatus = localQuestion.status;
  try {
    const updateResult = await query(
      `UPDATE questions
       SET    ${setClauses.join(', ')}
       WHERE  id = $${whereParam}
       RETURNING id, status`,
      params
    );

    if (updateResult.rowCount > 0) {
      newStatus = updateResult.rows[0].status;
    }
  } catch (updateErr) {
    console.error(
      `[wp-webhook] question-updated: שגיאה בעדכון שאלה id=${localQuestion.id}:`,
      updateErr.message
    );
    return next(updateErr);
  }

  // ── Socket.io broadcast ─────────────────────────────────────────────────────
  const io = req.app.get('io');
  if (io && newStatus !== localQuestion.status) {
    broadcastStatusChanged(io, localQuestion.id, newStatus, { source: 'wordpress_admin' });
  }

  console.log(
    `[wp-webhook] question-updated ✓ id=${localQuestion.id} ` +
    `wpPostId=${payload.wpPostId} newStatus=${newStatus}`
  );

  return res.status(200).json({
    message:    'שאלה עודכנה בהצלחה',
    questionId: localQuestion.id,
    wpPostId:   payload.wpPostId,
    status:     newStatus,
  });
});

// ─── Utility helpers ──────────────────────────────────────────────────────────

/**
 * Extract the best-available client IP address for logging.
 * @param {import('express').Request} req
 * @returns {string}
 */
function _ip(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.ip
    || 'unknown';
}

/**
 * Timing-safe string comparison to resist side-channel attacks.
 * Falls back to a simple check when the crypto module's timingSafeEqual
 * would throw on mismatched byte lengths (we guard before calling).
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function _timingSafe(a, b) {
  try {
    const crypto = require('crypto');
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    // Only call timingSafeEqual if lengths match (already checked by caller)
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
  } catch (_) {
    return a === b;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = router;
