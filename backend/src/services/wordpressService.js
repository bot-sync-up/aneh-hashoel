'use strict';

/**
 * WordPress Service — REST API Client
 * ─────────────────────────────────────────────────────────────────────────────
 * High-level operations against the WordPress /wp-json/wp/v2/questions CPT.
 * All calls use the pre-configured axios instance from config/wordpress.js
 * which handles auth headers, timeouts, and error normalisation.
 *
 * IMPORTANT: Direct callers should prefer going through wpSyncQueue.enqueue()
 * rather than calling these methods directly, so that failures are retried
 * automatically.  The queue calls these methods on your behalf.
 *
 * Methods:
 *   getQuestion(wpPostId)
 *   updateQuestionStatus(wpPostId, status, assignedRabbiName)
 *   publishAnswer(wpPostId, answerContent, rabbiSignature, rabbiName)
 *   publishFollowUpAnswer(wpPostId, followUpAnswer)
 *   updateThankCount(wpPostId, newCount)
 *   updateViewCount(wpPostId, newCount)
 *   hideQuestion(wpPostId)
 *   markNotified(wpPostId)
 *   syncQuestionFromWP(wpPostId)
 *   getUnsyncedAnswers()
 *   retryFailedSyncs()
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { getWpAxios }       = require('../config/wordpress');
const { query }            = require('../db/pool');
const { getUnsyncedItems, processQueue } = require('./wpSyncQueue');

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Shorthand for the configured axios instance. */
const wp = () => getWpAxios();

/**
 * Resolve a WP post ID argument that might come from the queue as a string
 * entityId or as a plain number.
 *
 * @param {string|number} id
 * @returns {number}
 */
function toWpId(id) {
  const n = parseInt(id, 10);
  if (!n || n <= 0) throw new Error(`[wp-service] wp_post_id לא תקין: "${id}"`);
  return n;
}

/**
 * Normalise a raw WP REST API question post object into our internal shape.
 *
 * @param {object} wpPost - Raw API response data
 * @returns {object} Normalised question
 */
function normaliseQuestion(wpPost) {
  const meta = wpPost.meta || wpPost.acf || {};

  return {
    wpPostId:           wpPost.id,
    title:              wpPost.title?.rendered || '',
    content:            wpPost.content?.rendered || '',
    status:             meta.status             || wpPost.status || 'pending',
    assignedRabbiName:  meta.assigned_rabbi_name || null,
    answerContent:      meta.answer_content      || null,
    answeringRabbiName: meta.answering_rabbi_name || null,
    rabbiSignature:     meta.rabbi_signature     || null,
    followUpAnswer:     meta.follow_up_answer    || null,
    thankCount:         parseInt(meta.thank_count  || '0', 10),
    viewCount:          parseInt(meta.view_count   || '0', 10),
    notifiedStatus:     meta.notified_status === true || meta.notified_status === 'true',
    askerEmail:         meta.asker_email          || null,
    askerPhone:         meta.asker_phone          || null,
    category:           meta.question_category    || null,
    urgency:            meta.urgency              || 'normal',
    wpCreatedAt:        wpPost.date_gmt
                          ? new Date(wpPost.date_gmt + 'Z')
                          : null,
    wpModifiedAt:       wpPost.modified_gmt
                          ? new Date(wpPost.modified_gmt + 'Z')
                          : null,
    wpLink:             wpPost.link              || null,
    wpSlug:             wpPost.slug              || null,
  };
}

// ─── getQuestion ──────────────────────────────────────────────────────────────

/**
 * Fetch a single question CPT post from WordPress and return a normalised object.
 *
 * @param {string|number} wpPostId
 * @returns {Promise<object>} Normalised question
 * @throws if the post is not found (404) or on network error
 */
async function getQuestion(wpPostId) {
  const id = toWpId(wpPostId);
  console.log(`[wp-service] getQuestion wpPostId=${id}`);

  const { data } = await wp().get(`/questions/${id}`, {
    params: { _fields: 'id,title,content,status,meta,acf,date_gmt,modified_gmt,link,slug' },
  });

  const normalised = normaliseQuestion(data);
  console.log(`[wp-service] getQuestion ✓ wpPostId=${id} status=${normalised.status}`);
  return normalised;
}

// ─── updateQuestionStatus ─────────────────────────────────────────────────────

/**
 * Update the question's status meta field and (optionally) the assigned rabbi name
 * on the WordPress post.
 *
 * Queue action name: 'updateQuestionStatus'
 * Payload shape: { status, assignedRabbiName }
 *
 * @param {string|number} wpPostId
 * @param {object}        payload
 * @param {string}        payload.status           - e.g. 'pending', 'in_process', 'answered'
 * @param {string}        [payload.assignedRabbiName]
 */
async function updateQuestionStatus(wpPostId, payload = {}) {
  const id     = toWpId(wpPostId);
  const { status, assignedRabbiName } = payload;

  if (!status) throw new Error('[wp-service] updateQuestionStatus: status נדרש');

  console.log(
    `[wp-service] updateQuestionStatus wpPostId=${id} status=${status}` +
    (assignedRabbiName ? ` rabbi=${assignedRabbiName}` : '')
  );

  const meta = { status };
  if (assignedRabbiName !== undefined) {
    meta.assigned_rabbi_name = assignedRabbiName || '';
  }

  await wp().post(`/questions/${id}`, { meta });

  console.log(`[wp-service] updateQuestionStatus ✓ wpPostId=${id}`);
}

// ─── publishAnswer ────────────────────────────────────────────────────────────

/**
 * Publish a rabbi's answer to WordPress.
 * Appends the rabbi's signature to the answer content, sets status=answered,
 * sets answering_rabbi_name, and triggers WP to notify the asker
 * (the WP plugin listens on save and sends the notification email/WhatsApp).
 *
 * Queue action name: 'publishAnswer'
 * Payload shape: { answerContent, rabbiSignature, rabbiName }
 *
 * @param {string|number} wpPostId
 * @param {object}        payload
 * @param {string}        payload.answerContent   - HTML or plain-text answer body
 * @param {string}        [payload.rabbiSignature] - Signature block appended to content
 * @param {string}        payload.rabbiName        - Answering rabbi display name
 */
async function publishAnswer(wpPostId, payload = {}) {
  const id = toWpId(wpPostId);
  const { answerContent, rabbiSignature, rabbiName } = payload;

  if (!answerContent) throw new Error('[wp-service] publishAnswer: answerContent נדרש');
  if (!rabbiName)     throw new Error('[wp-service] publishAnswer: rabbiName נדרש');

  console.log(`[wp-service] publishAnswer wpPostId=${id} rabbi=${rabbiName}`);

  // Build full answer with signature appended
  const signature = rabbiSignature
    ? `\n\n---\n${rabbiSignature}`
    : '';
  const fullAnswer = `${answerContent}${signature}`;

  await wp().post(`/questions/${id}`, {
    meta: {
      answer_content:       fullAnswer,
      answering_rabbi_name: rabbiName,
      rabbi_signature:      rabbiSignature || '',
      status:               'answered',
      // Setting this flag signals the WP plugin to fire its notification hook
      notify_asker:         true,
    },
  });

  console.log(`[wp-service] publishAnswer ✓ wpPostId=${id}`);
}

// ─── publishFollowUpAnswer ────────────────────────────────────────────────────

/**
 * Append a follow-up answer below the original answer on WordPress.
 * The existing answer_content is preserved; follow_up_answer receives the new text.
 *
 * Queue action name: 'publishFollowUpAnswer'
 * Payload shape: { followUpAnswer }
 *
 * @param {string|number} wpPostId
 * @param {object}        payload
 * @param {string}        payload.followUpAnswer - Additional answer content
 */
async function publishFollowUpAnswer(wpPostId, payload = {}) {
  const id = toWpId(wpPostId);
  const { followUpAnswer } = payload;

  if (!followUpAnswer) {
    throw new Error('[wp-service] publishFollowUpAnswer: followUpAnswer נדרש');
  }

  console.log(`[wp-service] publishFollowUpAnswer wpPostId=${id}`);

  // Fetch the existing follow_up_answer so we append rather than overwrite
  let existing = '';
  try {
    const current = await getQuestion(id);
    existing = current.followUpAnswer || '';
  } catch (fetchErr) {
    // Non-fatal: if fetch fails we still write the new text
    console.warn(
      `[wp-service] publishFollowUpAnswer: לא ניתן לאחזר תשובה קיימת — ` +
      `כותב מחדש. (${fetchErr.message})`
    );
  }

  const combined = existing
    ? `${existing}\n\n---\n\n${followUpAnswer}`
    : followUpAnswer;

  await wp().post(`/questions/${id}`, {
    meta: {
      follow_up_answer: combined,
      // Signal WP to notify asker of the follow-up
      notify_asker_followup: true,
    },
  });

  console.log(`[wp-service] publishFollowUpAnswer ✓ wpPostId=${id}`);
}

// ─── updateThankCount ─────────────────────────────────────────────────────────

/**
 * Update the thank_count meta field on a WP question post.
 *
 * Queue action name: 'updateThankCount'
 * Payload shape: { newCount }
 *
 * @param {string|number} wpPostId
 * @param {object}        payload
 * @param {number}        payload.newCount
 */
async function updateThankCount(wpPostId, payload = {}) {
  const id = toWpId(wpPostId);
  const newCount = parseInt(payload.newCount, 10);

  if (isNaN(newCount) || newCount < 0) {
    throw new Error(`[wp-service] updateThankCount: newCount לא תקין (${payload.newCount})`);
  }

  console.log(`[wp-service] updateThankCount wpPostId=${id} count=${newCount}`);

  await wp().post(`/questions/${id}`, {
    meta: { thank_count: newCount },
  });

  console.log(`[wp-service] updateThankCount ✓ wpPostId=${id}`);
}

// ─── updateViewCount ──────────────────────────────────────────────────────────

/**
 * Update the view_count meta field on a WP question post.
 *
 * Queue action name: 'updateViewCount'
 * Payload shape: { newCount }
 *
 * @param {string|number} wpPostId
 * @param {object}        payload
 * @param {number}        payload.newCount
 */
async function updateViewCount(wpPostId, payload = {}) {
  const id = toWpId(wpPostId);
  const newCount = parseInt(payload.newCount, 10);

  if (isNaN(newCount) || newCount < 0) {
    throw new Error(`[wp-service] updateViewCount: newCount לא תקין (${payload.newCount})`);
  }

  console.log(`[wp-service] updateViewCount wpPostId=${id} count=${newCount}`);

  await wp().post(`/questions/${id}`, {
    meta: { view_count: newCount },
  });

  console.log(`[wp-service] updateViewCount ✓ wpPostId=${id}`);
}

// ─── hideQuestion ─────────────────────────────────────────────────────────────

/**
 * Set the WP post status to 'private', effectively hiding it from the public site.
 *
 * Queue action name: 'hideQuestion'
 * Payload shape: {} (no extra payload needed)
 *
 * @param {string|number} wpPostId
 */
async function hideQuestion(wpPostId) {
  const id = toWpId(wpPostId);
  console.log(`[wp-service] hideQuestion wpPostId=${id}`);

  await wp().post(`/questions/${id}`, {
    status: 'private',
    meta:   { status: 'hidden' },
  });

  console.log(`[wp-service] hideQuestion ✓ wpPostId=${id}`);
}

// ─── markNotified ─────────────────────────────────────────────────────────────

/**
 * Set the notified_status meta flag to true on WordPress.
 * Called after the asker notification email/WhatsApp has been sent by our backend.
 *
 * Queue action name: 'markNotified'
 * Payload shape: {} (no extra payload needed)
 *
 * @param {string|number} wpPostId
 */
async function markNotified(wpPostId) {
  const id = toWpId(wpPostId);
  console.log(`[wp-service] markNotified wpPostId=${id}`);

  await wp().post(`/questions/${id}`, {
    meta: { notified_status: true },
  });

  console.log(`[wp-service] markNotified ✓ wpPostId=${id}`);
}

// ─── syncQuestionFromWP ───────────────────────────────────────────────────────

/**
 * Pull the latest question data from WordPress and upsert our local DB record.
 *
 * This is used to reconcile the local state with WP in cases where WP admin
 * edits a question directly, or after a webhook arrives with partial data.
 *
 * @param {string|number} wpPostId
 * @returns {Promise<object>} The normalised question (as returned by getQuestion)
 */
async function syncQuestionFromWP(wpPostId) {
  const id = toWpId(wpPostId);
  console.log(`[wp-service] syncQuestionFromWP wpPostId=${id}`);

  const q = await getQuestion(id);

  // Upsert into local questions table.
  // Only update fields that originate from WP (don't touch rabbi-side fields).
  await query(
    `UPDATE questions
     SET    title              = COALESCE($2, title),
            category           = COALESCE($3, category),
            urgency            = COALESCE($4, urgency),
            wp_modified_at     = $5,
            updated_at         = NOW()
     WHERE  wp_post_id = $1`,
    [
      id,
      q.title     || null,
      q.category  || null,
      q.urgency   || null,
      q.wpModifiedAt,
    ]
  );

  console.log(`[wp-service] syncQuestionFromWP ✓ wpPostId=${id}`);
  return q;
}

// ─── getUnsyncedAnswers ───────────────────────────────────────────────────────

/**
 * Return all wp_sync_log items for 'publishAnswer' actions that have not
 * successfully synced (status != 'success').
 *
 * This is a convenience wrapper around wpSyncQueue.getUnsyncedItems().
 *
 * @returns {Promise<object[]>}
 */
async function getUnsyncedAnswers() {
  return getUnsyncedItems({
    statuses:   ['pending', 'failed', 'processing'],
    action:     'publishAnswer',
    entityType: 'question',
  });
}

// ─── retryFailedSyncs ─────────────────────────────────────────────────────────

/**
 * Trigger an immediate queue flush for any retry-eligible failed items.
 * Intended to be called by the cron job (cron/jobs/wpSyncRetry.js).
 *
 * Items that have reached MAX_ATTEMPTS are already marked permanently_failed
 * by the queue and will NOT be retried — they require manual intervention.
 *
 * @returns {Promise<{ processed: number, succeeded: number, failed: number }>}
 */
async function retryFailedSyncs() {
  console.log('[wp-service] retryFailedSyncs: triggering queue flush');

  // Import self to pass as the wpService argument to processQueue
  // (avoids a circular require at module load time)
  // eslint-disable-next-line global-require
  const self = require('./wordpressService');
  const stats = await processQueue(self);

  console.log(
    `[wp-service] retryFailedSyncs: processed=${stats.processed} ` +
    `succeeded=${stats.succeeded} failed=${stats.failed}`
  );

  return stats;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getQuestion,
  updateQuestionStatus,
  publishAnswer,
  publishFollowUpAnswer,
  updateThankCount,
  updateViewCount,
  hideQuestion,
  markNotified,
  syncQuestionFromWP,
  getUnsyncedAnswers,
  retryFailedSyncs,

  // Exposed for testing
  normaliseQuestion,
};
