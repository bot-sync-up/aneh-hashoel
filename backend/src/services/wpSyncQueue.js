'use strict';

/**
 * WordPress Sync Queue
 * ─────────────────────────────────────────────────────────────────────────────
 * All writes to WordPress must go through this queue instead of calling the
 * WP REST API directly. This guarantees:
 *
 *   • At-least-once delivery — items are persisted in wp_sync_log before any
 *     network call is attempted, so a crash cannot lose work.
 *   • Exponential backoff — failed items are retried after 1 min, 5 min, and
 *     15 min.  After three failures the item is marked permanently_failed.
 *   • Ordered processing — items are processed FIFO within each entity.
 *   • Concurrency guard — a simple in-process flag prevents overlapping runs
 *     of processQueue() when called from a cron job.
 *
 * DB table expected (created by migration):
 *
 *   CREATE TABLE wp_sync_log (
 *     id            SERIAL PRIMARY KEY,
 *     entity_type   TEXT        NOT NULL,          -- 'question', 'answer', …
 *     entity_id     TEXT        NOT NULL,
 *     action        TEXT        NOT NULL,          -- 'publishAnswer', 'updateStatus', …
 *     payload       JSONB       NOT NULL DEFAULT '{}',
 *     status        TEXT        NOT NULL DEFAULT 'pending',
 *                                                  -- pending | processing | success
 *                                                  -- | failed | permanently_failed
 *     error_message TEXT,
 *     attempts      INTEGER     NOT NULL DEFAULT 0,
 *     next_retry_at TIMESTAMPTZ,
 *     synced_at     TIMESTAMPTZ,
 *     created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *     updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   );
 *   CREATE INDEX wp_sync_log_status_idx ON wp_sync_log (status, next_retry_at);
 *
 * Usage:
 *   const queue = require('./wpSyncQueue');
 *   await queue.enqueue('publishAnswer', questionId, { answerContent, … });
 *   // called by cron every 5 min:
 *   await queue.processQueue(wordpressService);
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { query } = require('../db/pool');

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum delivery attempts before giving up permanently. */
const MAX_ATTEMPTS = 3;

/**
 * Backoff delays (ms) indexed by attempt number (0-based).
 * attempt 0 → first failure → wait BACKOFF_MS[0] before next try
 * attempt 1 → second failure → wait BACKOFF_MS[1]
 * attempt 2 → third failure → permanently_failed
 */
const BACKOFF_MS = [
  1  * 60 * 1000,   //  1 minute
  5  * 60 * 1000,   //  5 minutes
  15 * 60 * 1000,   // 15 minutes
];

/** Maximum items to process in a single processQueue() run. */
const BATCH_SIZE = parseInt(process.env.WP_QUEUE_BATCH_SIZE || '50', 10);

// ─── In-process mutex ────────────────────────────────────────────────────────

let _processing = false;

// ─── enqueue ─────────────────────────────────────────────────────────────────

/**
 * Persist a new sync item in wp_sync_log with status=pending.
 *
 * Callers should always await this function before returning to the user so
 * that the item is safely recorded even if the process dies immediately after.
 *
 * @param {string} action     - Name of the wordpressService method to call,
 *                              e.g. 'publishAnswer', 'updateQuestionStatus'.
 * @param {string} entityId   - Local entity ID (question UUID, etc.).
 * @param {object} [payload]  - Extra data the action handler needs (will be
 *                              stored as JSONB and passed back at dispatch time).
 * @param {string} [entityType='question'] - e.g. 'question', 'answer'.
 * @returns {Promise<object>} The newly created log row.
 */
async function enqueue(action, entityId, payload = {}, entityType = 'question') {
  if (!action || !entityId) {
    throw new Error('[wp-queue] action ו-entityId הם שדות חובה');
  }

  const { rows } = await query(
    `INSERT INTO wp_sync_log
       (entity_type, entity_id, action, payload, status, attempts, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'pending', 0, NOW(), NOW())
     RETURNING *`,
    [entityType, String(entityId), action, JSON.stringify(payload)]
  );

  const row = rows[0];
  console.log(
    `[wp-queue] ← enqueued id=${row.id} action=${action} ` +
    `entity=${entityType}:${entityId}`
  );
  return row;
}

// ─── processQueue ─────────────────────────────────────────────────────────────

/**
 * Process all pending (and retry-eligible failed) items in the queue.
 *
 * @param {object} wpService  - The wordpressService module, passed in to avoid
 *                              circular requires.  Must expose async methods
 *                              matching the action names stored in the queue.
 * @returns {Promise<{ processed: number, succeeded: number, failed: number }>}
 */
async function processQueue(wpService) {
  if (_processing) {
    console.warn('[wp-queue] processQueue() כבר פועל — מדלג על הרצה כפולה');
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  _processing = true;
  let processed = 0;
  let succeeded = 0;
  let failed    = 0;

  try {
    // Fetch a batch of items that are ready to process:
    //   • status = 'pending'  (never tried yet), OR
    //   • status = 'failed'   AND next_retry_at <= NOW() AND attempts < MAX_ATTEMPTS
    const { rows: items } = await query(
      `SELECT *
       FROM   wp_sync_log
       WHERE  status IN ('pending', 'failed')
         AND  (next_retry_at IS NULL OR next_retry_at <= NOW())
         AND  attempts < $1
       ORDER  BY created_at ASC
       LIMIT  $2
       FOR UPDATE SKIP LOCKED`,
      [MAX_ATTEMPTS, BATCH_SIZE]
    );

    if (items.length === 0) {
      console.debug('[wp-queue] אין פריטים ממתינים לעיבוד');
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    console.log(`[wp-queue] מתחיל עיבוד ${items.length} פריטים`);

    for (const item of items) {
      processed++;
      const result = await _dispatchItem(item, wpService);
      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }
    }
  } catch (err) {
    console.error('[wp-queue] שגיאה בלתי צפויה ב-processQueue:', err.message, err.stack);
  } finally {
    _processing = false;
  }

  console.log(
    `[wp-queue] הושלם: processed=${processed} succeeded=${succeeded} failed=${failed}`
  );
  return { processed, succeeded, failed };
}

// ─── _dispatchItem ────────────────────────────────────────────────────────────

/**
 * Attempt to execute a single queue item by calling the corresponding
 * wordpressService method.
 *
 * @param {object} item       - Row from wp_sync_log
 * @param {object} wpService  - wordpressService module
 * @returns {Promise<{ success: boolean }>}
 * @private
 */
async function _dispatchItem(item, wpService) {
  // Mark as processing to prevent double-dispatch in concurrent environments
  await _setStatus(item.id, 'processing');

  const newAttempts = item.attempts + 1;
  console.log(
    `[wp-queue] dispatching id=${item.id} action=${item.action} ` +
    `entity=${item.entity_type}:${item.entity_id} attempt=${newAttempts}/${MAX_ATTEMPTS}`
  );

  try {
    const handler = wpService[item.action];

    if (typeof handler !== 'function') {
      throw new Error(
        `[wp-queue] handler לא קיים ב-wordpressService: "${item.action}"`
      );
    }

    // Invoke the service method; payload fields are spread as a single argument
    // for complex actions, simple actions receive entityId directly.
    await handler.call(wpService, item.entity_id, item.payload);

    // Success
    await query(
      `UPDATE wp_sync_log
       SET    status    = 'success',
              attempts  = $2,
              synced_at = NOW(),
              error_message = NULL,
              next_retry_at = NULL,
              updated_at = NOW()
       WHERE  id = $1`,
      [item.id, newAttempts]
    );

    console.log(
      `[wp-queue] ✓ id=${item.id} action=${item.action} ` +
      `entity=${item.entity_type}:${item.entity_id}`
    );
    return { success: true };

  } catch (err) {
    const errMsg = err.wpMessage || err.message || String(err);
    const isPermanent = newAttempts >= MAX_ATTEMPTS;

    const nextStatus = isPermanent ? 'permanently_failed' : 'failed';
    const nextRetry  = isPermanent
      ? null
      : new Date(Date.now() + (BACKOFF_MS[newAttempts - 1] || BACKOFF_MS[BACKOFF_MS.length - 1]));

    await query(
      `UPDATE wp_sync_log
       SET    status        = $2,
              attempts      = $3,
              error_message = $4,
              next_retry_at = $5,
              updated_at    = NOW()
       WHERE  id = $1`,
      [item.id, nextStatus, newAttempts, errMsg.slice(0, 2000), nextRetry]
    );

    if (isPermanent) {
      console.error(
        `[wp-queue] ✗ permanently_failed id=${item.id} action=${item.action} ` +
        `entity=${item.entity_type}:${item.entity_id} — ${errMsg}`
      );
    } else {
      const retryIn = Math.round((nextRetry - Date.now()) / 1000);
      console.warn(
        `[wp-queue] ✗ failed id=${item.id} action=${item.action} ` +
        `entity=${item.entity_type}:${item.entity_id} ` +
        `attempt=${newAttempts}/${MAX_ATTEMPTS} retry_in=${retryIn}s — ${errMsg}`
      );
    }

    return { success: false };
  }
}

// ─── _setStatus ───────────────────────────────────────────────────────────────

/**
 * @param {number} id
 * @param {string} status
 * @private
 */
async function _setStatus(id, status) {
  await query(
    `UPDATE wp_sync_log SET status = $2, updated_at = NOW() WHERE id = $1`,
    [id, status]
  );
}

// ─── getUnsyncedItems ─────────────────────────────────────────────────────────

/**
 * Return items that have not yet been successfully synced.
 * Useful for health-check dashboards or the service-level getUnsyncedAnswers().
 *
 * @param {object} [opts]
 * @param {string[]} [opts.statuses]      - Default: ['pending','failed','processing']
 * @param {string}   [opts.entityType]    - Filter by entity type
 * @param {string}   [opts.action]        - Filter by action name
 * @param {number}   [opts.limit=100]
 * @returns {Promise<object[]>}
 */
async function getUnsyncedItems({ statuses, entityType, action, limit = 100 } = {}) {
  const statusList = statuses || ['pending', 'failed', 'processing'];
  const conditions = [`status = ANY($1)`];
  const params     = [statusList];
  let   idx        = 2;

  if (entityType) {
    conditions.push(`entity_type = $${idx++}`);
    params.push(entityType);
  }
  if (action) {
    conditions.push(`action = $${idx++}`);
    params.push(action);
  }

  params.push(limit);

  const { rows } = await query(
    `SELECT * FROM wp_sync_log
     WHERE  ${conditions.join(' AND ')}
     ORDER  BY created_at ASC
     LIMIT  $${idx}`,
    params
  );

  return rows;
}

// ─── getQueueStats ────────────────────────────────────────────────────────────

/**
 * Return a summary of queue depth by status.
 * @returns {Promise<Record<string, number>>}
 */
async function getQueueStats() {
  const { rows } = await query(
    `SELECT status, COUNT(*)::int AS count
     FROM   wp_sync_log
     GROUP  BY status`
  );

  return rows.reduce((acc, row) => {
    acc[row.status] = row.count;
    return acc;
  }, {});
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  enqueue,
  processQueue,
  getUnsyncedItems,
  getQueueStats,

  // Exposed for unit tests
  MAX_ATTEMPTS,
  BACKOFF_MS,
};
