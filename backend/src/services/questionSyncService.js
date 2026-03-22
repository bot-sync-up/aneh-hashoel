'use strict';

/**
 * questionSyncService.js — Polling Fallback for WordPress Sync
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides two functions invoked by cron jobs when webhooks are unavailable
 * or may have been missed:
 *
 *   syncPendingQuestions()
 *     Called every 30 minutes.
 *     Fetches new pending questions from WordPress, identifies those not yet
 *     in our DB, imports them, and broadcasts Socket.io events for each new
 *     question.
 *
 *   syncAnswersToWP()
 *     Called on a configurable schedule (e.g. every 5 minutes by wpSyncRetry).
 *     Finds locally answered questions that have not yet been synced to WP
 *     (wp_synced_at IS NULL) and pushes each answer via wpService.publishAnswer().
 *
 * Both functions return a structured result object and never throw — all errors
 * are caught, logged, and written to the audit_log via wpService.logSync().
 *
 * Dependencies:
 *   services/wpService       – getNewQuestions, publishAnswer, logSync
 *   services/questions       – createFromWebhook
 *   db/pool                  – query
 *   socket/questionEvents    – broadcastNewQuestion, broadcastUrgentQuestion
 *
 * Usage (typically via cron/index.js):
 *   const { syncPendingQuestions, syncAnswersToWP } = require('./questionSyncService');
 *   await syncPendingQuestions(io);
 *   await syncAnswersToWP();
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { query }              = require('../db/pool');
const { createFromWebhook }  = require('./questions');
const {
  getNewQuestions,
  publishAnswer,
  logSync,
}                            = require('./wpService');

const {
  broadcastNewQuestion,
  broadcastUrgentQuestion,
} = require('../socket/questionEvents');

// ─── syncPendingQuestions ─────────────────────────────────────────────────────

/**
 * Polling fallback: fetch pending questions from WordPress, import any that are
 * not yet in our local DB, and trigger Socket.io broadcasts for new arrivals.
 *
 * This mirrors what the /webhook/wordpress/new-question endpoint does in push
 * mode, but operates in pull mode for resilience.
 *
 * @param {import('socket.io').Server|null} [io]
 *   Optional Socket.io server instance for real-time broadcasts.
 *   If omitted, DB import still happens but no sockets are emitted.
 *
 * @returns {Promise<{
 *   success:  boolean,
 *   fetched:  number,
 *   imported: number,
 *   skipped:  number,
 *   failed:   number,
 *   error?:   string
 * }>}
 */
async function syncPendingQuestions(io = null) {
  console.log('[questionSync] syncPendingQuestions: מתחיל סנכרון שאלות ממתינות מ-WordPress');

  // ── 1. Fetch from WordPress ───────────────────────────────────────────────
  const wpResult = await getNewQuestions();

  if (!wpResult.success) {
    console.error('[questionSync] syncPendingQuestions: שגיאה בשליפה מ-WP:', wpResult.error);
    return {
      success:  false,
      fetched:  0,
      imported: 0,
      skipped:  0,
      failed:   0,
      error:    wpResult.error,
    };
  }

  const wpQuestions = wpResult.data;

  if (!wpQuestions.length) {
    console.info('[questionSync] syncPendingQuestions: אין שאלות חדשות מ-WordPress');
    return { success: true, fetched: 0, imported: 0, skipped: 0, failed: 0 };
  }

  console.info(
    `[questionSync] syncPendingQuestions: ${wpQuestions.length} שאלות חדשות מ-WP לייבוא`
  );

  let imported = 0;
  let skipped  = 0;
  let failed   = 0;

  // ── 2. Import each new question ───────────────────────────────────────────
  for (const wpQ of wpQuestions) {
    const wpPostId = wpQ.id;
    const meta     = wpQ.meta || {};

    // Extract and normalise fields from the WP REST API response structure
    const questionData = {
      title:       _stripHtml(wpQ.title?.rendered || wpQ.title || '').trim(),
      content:     meta['ask-quest']      || '',
      asker_name:  meta.visitor_name      || null,
      asker_email: meta.asker_email       || null,
      asker_phone: meta.visitor_phone     || meta.asker_phone || null,
      urgency:     meta.urgency           || 'normal',
      source:      'wordpress_poll',
      wp_post_id:  wpPostId,
    };

    if (!questionData.title || !questionData.content) {
      console.warn(
        `[questionSync] syncPendingQuestions: wpPostId=${wpPostId} ` +
        'חסרים title/content — מדלג'
      );
      skipped++;
      continue;
    }

    // ── Idempotency guard (belt-and-suspenders after getNewQuestions filter) ──
    try {
      // Check blocklist first (manually rejected WP posts we never want back)
      const blocked = await query(
        'SELECT 1 FROM wp_post_blocklist WHERE wp_post_id = $1 LIMIT 1',
        [wpPostId]
      );
      if (blocked.rowCount > 0) {
        skipped++;
        continue;
      }

      const existing = await query(
        'SELECT id FROM questions WHERE wp_post_id = $1 LIMIT 1',
        [wpPostId]
      );

      if (existing.rowCount > 0) {
        skipped++;
        continue;
      }
    } catch (checkErr) {
      console.warn(
        `[questionSync] syncPendingQuestions: idempotency check שגיאה wpPostId=${wpPostId}:`,
        checkErr.message
      );
      // Fall through — createFromWebhook will fail on UNIQUE constraint
    }

    // ── Persist ────────────────────────────────────────────────────────────
    let question;
    try {
      question = await createFromWebhook(questionData);
      imported++;
      console.info(
        `[questionSync] syncPendingQuestions: ✓ יובאה שאלה id=${question.id} ` +
        `wpPostId=${wpPostId}`
      );
    } catch (createErr) {
      failed++;
      console.error(
        `[questionSync] syncPendingQuestions: שגיאה ביצירת שאלה wpPostId=${wpPostId}:`,
        createErr.message
      );
      await logSync(wpPostId, 'poll_import_question', 'failed', createErr.message);
      continue;
    }

    await logSync(wpPostId, 'poll_import_question', 'success');

    // ── Socket.io broadcast ────────────────────────────────────────────────
    if (io) {
      broadcastNewQuestion(io, question);

      if (['critical', 'urgent'].includes(questionData.urgency)) {
        broadcastUrgentQuestion(io, question);
      }
    }
  }

  const result = {
    success:  true,
    fetched:  wpQuestions.length,
    imported,
    skipped,
    failed,
  };

  console.info(
    `[questionSync] syncPendingQuestions: הושלם — ` +
    `ייובאו ${imported}, דולגו ${skipped}, נכשלו ${failed} ` +
    `מתוך ${wpQuestions.length} שנמשכו`
  );

  return result;
}

// ─── syncAnswersToWP ──────────────────────────────────────────────────────────

/**
 * Push all locally answered questions that have not yet been synced to WordPress.
 *
 * Identifies rows where:
 *   status       = 'answered'
 *   wp_synced_at IS NULL
 *   wp_post_id   IS NOT NULL
 *
 * For each, calls wpService.publishAnswer() and on success sets wp_synced_at.
 *
 * @param {{ limit?: number }} [options]
 * @returns {Promise<{
 *   success:   boolean,
 *   total:     number,
 *   succeeded: number,
 *   failed:    number,
 *   error?:    string
 * }>}
 */
async function syncAnswersToWP(options = {}) {
  const batchLimit = options.limit ?? 50;

  console.log('[questionSync] syncAnswersToWP: מחפש תשובות שלא סונכרנו ל-WordPress');

  // ── 1. Find un-synced answered questions ──────────────────────────────────
  let rows;
  try {
    const result = await query(
      `SELECT q.id,
              q.wp_post_id,
              a.content     AS answer_content,
              a.published_at,
              r.name        AS rabbi_name,
              r.signature   AS rabbi_signature
       FROM   questions q
       JOIN   answers   a ON a.question_id = q.id
       JOIN   rabbis    r ON r.id          = a.rabbi_id
       WHERE  q.status      = 'answered'
         AND  q.wp_synced_at IS NULL
         AND  q.wp_post_id  IS NOT NULL
       ORDER BY q.answered_at ASC
       LIMIT  $1`,
      [batchLimit]
    );

    rows = result.rows;
  } catch (dbErr) {
    console.error('[questionSync] syncAnswersToWP: שגיאת DB בשליפת תשובות:', dbErr.message);
    return { success: false, total: 0, succeeded: 0, failed: 0, error: dbErr.message };
  }

  if (rows.length === 0) {
    console.info('[questionSync] syncAnswersToWP: אין תשובות ממתינות לסנכרון');
    return { success: true, total: 0, succeeded: 0, failed: 0 };
  }

  console.info(`[questionSync] syncAnswersToWP: נמצאו ${rows.length} תשובות לסנכרון`);

  let succeeded = 0;
  let failed    = 0;

  // ── 2. Push each answer to WP ─────────────────────────────────────────────
  for (const row of rows) {
    const publishResult = await publishAnswer(row.wp_post_id, {
      content:     row.answer_content,
      rabbiName:   row.rabbi_name,
      signature:   row.rabbi_signature || '',
      publishedAt: row.published_at
        ? new Date(row.published_at).toISOString()
        : new Date().toISOString(),
    });

    if (publishResult.success) {
      // Mark as synced in local DB
      try {
        await query(
          `UPDATE questions
           SET    wp_synced_at = NOW(),
                  updated_at   = NOW()
           WHERE  id = $1`,
          [row.id]
        );
        succeeded++;
        console.info(
          `[questionSync] syncAnswersToWP: ✓ סונכרן id=${row.id} ` +
          `wpPostId=${row.wp_post_id}`
        );
      } catch (markErr) {
        // Sync succeeded in WP but DB update failed — log and count as failed
        // so next run will retry (answer will be re-pushed to WP idempotently)
        failed++;
        console.error(
          `[questionSync] syncAnswersToWP: שגיאה בסימון wp_synced_at ` +
          `id=${row.id}:`,
          markErr.message
        );
        await logSync(
          row.wp_post_id,
          'sync_answer_mark_synced',
          'failed',
          markErr.message
        );
      }
    } else {
      failed++;
      console.error(
        `[questionSync] syncAnswersToWP: נכשל id=${row.id} ` +
        `wpPostId=${row.wp_post_id}: ${publishResult.error}`
      );
      // logSync already called inside publishAnswer for retryable failures
    }
  }

  const result = {
    success:   true,
    total:     rows.length,
    succeeded,
    failed,
  };

  console.info(
    `[questionSync] syncAnswersToWP: הושלם — ` +
    `${succeeded} הצליחו, ${failed} נכשלו מתוך ${rows.length}`
  );

  return result;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Remove HTML tags from a string (for use on WP REST API title.rendered).
 * @param {string} str
 * @returns {string}
 */
function _stripHtml(str) {
  return String(str).replace(/<[^>]*>/g, '');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  syncPendingQuestions,
  syncAnswersToWP,
};
