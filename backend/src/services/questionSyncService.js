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
const { logger }             = require('../utils/logger');

const log = logger.child({ module: 'questionSync' });
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

const { notifyAll }   = require('./notificationRouter');
const { upsertLead }  = require('./leadsService');

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
  log.info('syncPendingQuestions: starting sync from WordPress');

  // ── 1. Fetch from WordPress ───────────────────────────────────────────────
  const wpResult = await getNewQuestions();

  if (!wpResult.success) {
    log.error({ error: wpResult.error }, 'syncPendingQuestions: WP fetch error');
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
    log.info('syncPendingQuestions: no new questions from WordPress');
    return { success: true, fetched: 0, imported: 0, skipped: 0, failed: 0 };
  }

  log.info({ count: wpQuestions.length }, 'syncPendingQuestions: new questions from WP to import');

  let imported = 0;
  let skipped  = 0;
  let failed   = 0;

  // ── 2. Import each new question ───────────────────────────────────────────
  for (const wpQ of wpQuestions) {
    const wpPostId = wpQ.id;
    const meta     = wpQ.meta || {};
    const acf      = wpQ.acf  || {};
    // Merge meta and acf so fields are found regardless of where WP exposes them
    const allFields = { ...meta, ...acf };

    // Extract and normalise fields from the WP REST API response structure.
    // Content can live in meta['ask-quest'], acf['ask-quest'], or the standard
    // WP content.rendered field — try all sources.
    const questionData = {
      title:       _stripHtml(wpQ.title?.rendered || wpQ.title || '').trim(),
      content:     allFields['ask-quest']
                     || _stripHtml(wpQ.content?.rendered || '').trim()
                     || '',
      asker_name:  allFields.visitor_name  || allFields.asker_name  || null,
      asker_email: allFields.visitor_email || allFields.asker_email || null,
      asker_phone: allFields.visitor_phone || allFields.asker_phone || null,
      urgency:        allFields.urgency        || 'normal',
      source:         'wordpress_poll',
      wp_post_id:     wpPostId,
      attachment_url: null, // resolved below from attachment ID if present
      _attachmentId:  allFields['ask-visitor-img'] || null,
      wp_link:        wpQ.link || null,
    };

    if (!questionData.title || !questionData.content) {
      log.warn({ wpPostId, hasTitle: !!questionData.title, hasContent: !!questionData.content }, 'syncPendingQuestions: missing title/content — skipping');
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
      log.warn({ err: checkErr, wpPostId }, 'syncPendingQuestions: idempotency check error');
      // Fall through — createFromWebhook will fail on UNIQUE constraint
    }

    // ── Resolve attachment ID → URL ────────────────────────────────────────
    if (questionData._attachmentId) {
      try {
        const { getAttachmentUrl } = require('./wpService');
        if (typeof getAttachmentUrl === 'function') {
          questionData.attachment_url = await getAttachmentUrl(questionData._attachmentId);
        }
      } catch (_) { /* non-fatal */ }
      delete questionData._attachmentId;
    }

    // ── Persist ────────────────────────────────────────────────────────────
    let question;
    try {
      question = await createFromWebhook(questionData);
      imported++;
      log.info({ questionId: question.id, wpPostId }, 'syncPendingQuestions: question imported');
    } catch (createErr) {
      failed++;
      log.error({ err: createErr, wpPostId }, 'syncPendingQuestions: error creating question');
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

    // ── Email/WhatsApp notifications to all active rabbis ─────────────────
    const notifType = ['critical', 'urgent'].includes(questionData.urgency)
      ? 'urgent_question'
      : 'question_broadcast';

    notifyAll(notifType, { question, actionTokens: {} }).catch((err) => {
      log.error({ err, questionId: question.id }, 'syncPendingQuestions: error sending notifications');
    });

    // ── CRM: upsert lead for this asker (fire-and-forget) ─────────────────
    upsertLead({
      ...question,
      // question.asker_email is the *encrypted* value from the DB;
      // pass it as asker_email_encrypted, and use the original plaintext from WP.
      asker_email_encrypted: question.asker_email,
      asker_phone_encrypted: question.asker_phone,
      asker_email: questionData.asker_email || null,
      asker_phone: questionData.asker_phone || null,
    }).catch((err) => {
      log.error({ err, questionId: question.id }, 'upsertLead error');
    });
  }

  const result = {
    success:  true,
    fetched:  wpQuestions.length,
    imported,
    skipped,
    failed,
  };

  log.info({ imported, skipped, failed, fetched: wpQuestions.length }, 'syncPendingQuestions complete');

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

  log.info('syncAnswersToWP: searching for un-synced answers');

  // ── 1. Find un-synced answered questions ──────────────────────────────────
  let rows;
  try {
    const result = await query(
      `SELECT q.id,
              q.wp_post_id,
              a.content     AS answer_content,
              a.published_at,
              r.name        AS rabbi_name,
              r.signature   AS rabbi_signature,
              r.wp_term_id  AS wp_rabbi_term_id,
              c.wp_term_id  AS wp_category_term_id
       FROM   questions q
       JOIN   answers   a ON a.question_id = q.id
       JOIN   rabbis    r ON r.id          = a.rabbi_id
       LEFT JOIN categories c ON c.id = q.category_id
       WHERE  q.status      = 'answered'
         AND  q.wp_synced_at IS NULL
         AND  q.wp_post_id  IS NOT NULL
         AND  (a.is_private IS NULL OR a.is_private = false)
       ORDER BY q.answered_at ASC
       LIMIT  $1`,
      [batchLimit]
    );

    rows = result.rows;
  } catch (dbErr) {
    log.error({ err: dbErr }, 'syncAnswersToWP: DB error fetching answers');
    return { success: false, total: 0, succeeded: 0, failed: 0, error: dbErr.message };
  }

  if (rows.length === 0) {
    log.info('syncAnswersToWP: no answers pending sync');
    return { success: true, total: 0, succeeded: 0, failed: 0 };
  }

  log.info({ count: rows.length }, 'syncAnswersToWP: answers found for sync');

  let succeeded = 0;
  let failed    = 0;

  // ── 2. Push each answer to WP ─────────────────────────────────────────────
  for (const row of rows) {
    // If rabbi has no wp_term_id, create the rabbi in WP first
    let rabbiTermId = row.wp_rabbi_term_id || null;
    if (!rabbiTermId && row.rabbi_name) {
      try {
        const { createWPRabbi } = require('./wpService');
        const wpResult = await createWPRabbi(row.rabbi_name);
        if (wpResult.success && wpResult.data?.id) {
          rabbiTermId = wpResult.data.id;
          // Save the wp_term_id back to the rabbi record
          await query(
            `UPDATE rabbis SET wp_term_id = $1 WHERE name = $2 AND wp_term_id IS NULL`,
            [rabbiTermId, row.rabbi_name]
          );
          log.info({ rabbiName: row.rabbi_name, termId: rabbiTermId }, 'Created WP rabbi');
        }
      } catch (e) {
        log.warn({ err: e, rabbiName: row.rabbi_name }, 'Failed to create WP rabbi');
      }
    }

    const publishResult = await publishAnswer(row.wp_post_id, {
      content:           row.answer_content,
      rabbiName:         row.rabbi_name,
      publishedAt:       row.published_at
        ? new Date(row.published_at).toISOString()
        : new Date().toISOString(),
      wpCategoryTermId:  row.wp_category_term_id || null,
      wpRabbiTermId:     rabbiTermId,
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
        log.info({ questionId: row.id, wpPostId: row.wp_post_id }, 'syncAnswersToWP: answer synced');
      } catch (markErr) {
        // Sync succeeded in WP but DB update failed — log and count as failed
        // so next run will retry (answer will be re-pushed to WP idempotently)
        failed++;
        log.error({ err: markErr, questionId: row.id }, 'syncAnswersToWP: error marking wp_synced_at');
        await logSync(
          row.wp_post_id,
          'sync_answer_mark_synced',
          'failed',
          markErr.message
        );
      }
    } else {
      failed++;
      log.error({ questionId: row.id, wpPostId: row.wp_post_id, error: publishResult.error }, 'syncAnswersToWP: publish failed');
      // logSync already called inside publishAnswer for retryable failures
    }
  }

  const result = {
    success:   true,
    total:     rows.length,
    succeeded,
    failed,
  };

  log.info({ succeeded, failed, total: rows.length }, 'syncAnswersToWP complete');

  return result;
}

// ─── backfillAttachmentUrls ───────────────────────────────────────────────────

/**
 * One-time (or periodic) backfill: for every question that has a wp_post_id but
 * a NULL attachment_url, fetch the WP post meta to see if there is an attachment
 * ID (ask-visitor-img), resolve it to a URL via getAttachmentUrl(), and write it
 * back to the DB.
 *
 * Safe to call multiple times — only touches rows where attachment_url IS NULL.
 *
 * @param {{ limit?: number }} [options]
 * @returns {Promise<{
 *   success:  boolean,
 *   checked:  number,
 *   updated:  number,
 *   noImage:  number,
 *   failed:   number,
 *   error?:   string
 * }>}
 */
async function backfillAttachmentUrls(options = {}) {
  const batchLimit = options.limit ?? 200;

  log.info('backfillAttachmentUrls: starting backfill');

  // Find questions that have a WP post but no attachment URL yet
  let rows;
  try {
    const result = await query(
      `SELECT id, wp_post_id
       FROM   questions
       WHERE  wp_post_id IS NOT NULL
         AND  attachment_url IS NULL
       ORDER  BY created_at DESC
       LIMIT  $1`,
      [batchLimit]
    );
    rows = result.rows;
  } catch (dbErr) {
    log.error({ err: dbErr }, 'backfillAttachmentUrls: DB error');
    return { success: false, checked: 0, updated: 0, noImage: 0, failed: 0, error: dbErr.message };
  }

  if (rows.length === 0) {
    log.info('backfillAttachmentUrls: no questions to update');
    return { success: true, checked: 0, updated: 0, noImage: 0, failed: 0 };
  }

  log.info({ count: rows.length }, 'backfillAttachmentUrls: checking questions');

  const { getQuestionById, getAttachmentUrl } = require('./wpService');

  let updated = 0;
  let noImage = 0;
  let failed  = 0;

  for (const row of rows) {
    try {
      // Fetch the WP post to get its meta
      const wpResult = await getQuestionById(row.wp_post_id);
      if (!wpResult.success || !wpResult.data) {
        noImage++;
        continue;
      }

      const meta          = wpResult.data.meta || {};
      const attachmentId  = meta['ask-visitor-img'] || null;

      if (!attachmentId) {
        noImage++;
        continue;
      }

      const url = await getAttachmentUrl(attachmentId);
      if (!url) {
        noImage++;
        continue;
      }

      await query(
        `UPDATE questions
         SET    attachment_url = $1,
                updated_at     = NOW()
         WHERE  id = $2`,
        [url, row.id]
      );

      updated++;
      log.info({ questionId: row.id, wpPostId: row.wp_post_id, url }, 'backfillAttachmentUrls: updated');
    } catch (err) {
      failed++;
      log.error({ err, questionId: row.id }, 'backfillAttachmentUrls: error');
    }
  }

  log.info({ updated, noImage, failed, checked: rows.length }, 'backfillAttachmentUrls complete');

  return { success: true, checked: rows.length, updated, noImage, failed };
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
  backfillAttachmentUrls,
};
