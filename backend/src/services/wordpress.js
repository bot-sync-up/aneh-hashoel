'use strict';

/**
 * WordPress REST API Integration
 *
 * Syncs answered questions, rabbi-of-the-week, and newsletter content
 * to the WordPress frontend via the WP REST API.
 *
 * Exports:
 *   syncAnswerToWP(questionId)
 *   retryFailedSyncs()
 *   postRabbiOfWeek(rabbiData)
 *   postNewsletterQuestion(questionData)
 *
 * Environment:
 *   WP_API_URL  – WordPress REST API base URL (e.g. https://example.com/wp-json/aneh/v1)
 *   WP_API_KEY  – API key sent via x-api-key header
 */

const axios = require('axios');
const { query: dbQuery } = require('../db/pool');

// ─── Axios client ──────────────────────────────────────────────────────────────

/**
 * Create a pre-configured axios instance for the WP REST API.
 * Lazily resolved so env vars are read at call time (useful for tests).
 */
function wpClient() {
  const baseURL = process.env.WP_API_URL;
  const apiKey  = process.env.WP_API_KEY;

  if (!baseURL || !apiKey) {
    throw new Error('[wordpress] WP_API_URL ו-WP_API_KEY חייבים להיות מוגדרים');
  }

  return axios.create({
    baseURL,
    timeout: 15000,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key':    apiKey,
    },
  });
}

// ─── syncAnswerToWP ────────────────────────────────────────────────────────────

/**
 * POST (update) the answered question CPT on WordPress.
 *
 * Sends answer content, rabbi name, rabbi signature, and sets
 * the WP post status to 'answered'.
 *
 * On success, updates wp_synced_at in the DB.
 * On failure, logs the error and sets wp_synced_at to NULL so the
 * cron-based retryFailedSyncs() can pick it up later.
 *
 * @param {string} questionId
 */
async function syncAnswerToWP(questionId) {
  // Fetch question + answer + rabbi data
  const { rows } = await dbQuery(
    `SELECT q.id         AS question_id,
            q.wp_post_id,
            q.status     AS question_status,
            a.content    AS answer_content,
            a.signature  AS answer_signature,
            r.name       AS rabbi_name
     FROM   questions q
     JOIN   answers   a ON a.question_id = q.id
     JOIN   rabbis    r ON r.id = a.rabbi_id
     WHERE  q.id = $1
     LIMIT  1`,
    [questionId]
  );

  if (!rows[0]) {
    console.error(`[wordpress] שאלה ${questionId} לא נמצאה לסנכרון`);
    return;
  }

  const data = rows[0];

  if (!data.wp_post_id) {
    console.warn(`[wordpress] לשאלה ${questionId} אין wp_post_id — דילוג על סנכרון`);
    return;
  }

  try {
    const client = wpClient();

    await client.post(`/questions/${data.wp_post_id}`, {
      answer_content:   data.answer_content,
      rabbi_name:       data.rabbi_name,
      rabbi_signature:  data.answer_signature || '',
      status:           'answered',
    });

    // Mark successful sync
    await dbQuery(
      `UPDATE questions
       SET    wp_synced_at = NOW(),
              updated_at   = NOW()
       WHERE  id = $1`,
      [questionId]
    );

    console.log(`[wordpress] שאלה ${questionId} סונכרנה בהצלחה (wp_post_id=${data.wp_post_id})`);
  } catch (err) {
    // Mark sync as failed (NULL) so retry cron can pick it up
    await dbQuery(
      `UPDATE questions
       SET    wp_synced_at = NULL,
              updated_at   = NOW()
       WHERE  id = $1`,
      [questionId]
    ).catch((dbErr) => {
      console.error('[wordpress] שגיאה בעדכון wp_synced_at:', dbErr.message);
    });

    const status  = err.response?.status || 'N/A';
    const message = err.response?.data?.message || err.message;
    console.error(
      `[wordpress] שגיאה בסנכרון שאלה ${questionId}: status=${status} — ${message}`
    );
  }
}

// ─── retryFailedSyncs ──────────────────────────────────────────────────────────

/**
 * Find all questions that are answered but not yet synced to WordPress,
 * and retry the sync for each.
 *
 * Intended to be called from a cron job (e.g. every 5 minutes).
 *
 * @returns {Promise<{ total: number, succeeded: number, failed: number }>}
 */
async function retryFailedSyncs() {
  const { rows } = await dbQuery(
    `SELECT id
     FROM   questions
     WHERE  status = 'answered'
       AND  wp_synced_at IS NULL
       AND  wp_post_id IS NOT NULL
     ORDER  BY answered_at ASC
     LIMIT  50`
  );

  if (rows.length === 0) {
    return { total: 0, succeeded: 0, failed: 0 };
  }

  console.log(`[wordpress] נמצאו ${rows.length} שאלות לסנכרון חוזר`);

  let succeeded = 0;
  let failed    = 0;

  for (const row of rows) {
    try {
      await syncAnswerToWP(row.id);
      succeeded++;
    } catch (err) {
      failed++;
      console.error(`[wordpress] סנכרון חוזר נכשל עבור שאלה ${row.id}:`, err.message);
    }
  }

  console.log(
    `[wordpress] סנכרון חוזר הושלם: ${succeeded} הצליחו, ${failed} נכשלו מתוך ${rows.length}`
  );

  return { total: rows.length, succeeded, failed };
}

// ─── postRabbiOfWeek ───────────────────────────────────────────────────────────

/**
 * POST rabbi-of-the-week data to a dedicated WP custom endpoint.
 *
 * @param {object} rabbiData
 * @param {string} rabbiData.name         Rabbi display name
 * @param {string} [rabbiData.bio]        Short biography
 * @param {string} [rabbiData.photoUrl]   Profile photo URL
 * @param {number} [rabbiData.answersCount] Number of answers this week
 */
async function postRabbiOfWeek(rabbiData) {
  if (!rabbiData || !rabbiData.name) {
    const e = new Error('נתוני הרב חסרים');
    e.status = 400;
    throw e;
  }

  try {
    const client = wpClient();

    const response = await client.post('/rabbi-of-the-week', {
      name:           rabbiData.name,
      bio:            rabbiData.bio || '',
      photo_url:      rabbiData.photoUrl || '',
      answers_count:  rabbiData.answersCount || 0,
    });

    console.log(`[wordpress] רב השבוע פורסם בהצלחה: ${rabbiData.name}`);
    return response.data;
  } catch (err) {
    const status  = err.response?.status || 'N/A';
    const message = err.response?.data?.message || err.message;
    console.error(`[wordpress] שגיאה בפרסום רב השבוע: status=${status} — ${message}`);
    throw err;
  }
}

// ─── postNewsletterQuestion ────────────────────────────────────────────────────

/**
 * POST a featured question to WordPress for the newsletter.
 *
 * @param {object} questionData
 * @param {string} questionData.questionId
 * @param {string} questionData.questionText   The question body
 * @param {string} questionData.answerText     The answer body
 * @param {string} questionData.rabbiName      Answering rabbi name
 * @param {string} [questionData.category]     Question category
 */
async function postNewsletterQuestion(questionData) {
  if (!questionData || !questionData.questionId) {
    const e = new Error('נתוני שאלה לניוזלטר חסרים');
    e.status = 400;
    throw e;
  }

  try {
    const client = wpClient();

    const response = await client.post('/newsletter-question', {
      question_id:    questionData.questionId,
      question_text:  questionData.questionText || '',
      answer_text:    questionData.answerText || '',
      rabbi_name:     questionData.rabbiName || '',
      category:       questionData.category || '',
    });

    console.log(`[wordpress] שאלה לניוזלטר פורסמה בהצלחה: ${questionData.questionId}`);
    return response.data;
  } catch (err) {
    const status  = err.response?.status || 'N/A';
    const message = err.response?.data?.message || err.message;
    console.error(`[wordpress] שגיאה בפרסום שאלה לניוזלטר: status=${status} — ${message}`);
    throw err;
  }
}

// ─── syncFollowUpAnswerToWP ────────────────────────────────────────────────────

/**
 * Sync a rabbi's follow-up answer to WordPress after it is saved in our DB.
 *
 * Fetches the question's wp_post_id and rabbi name from the DB, then calls
 * the WP REST API to update the follow-up meta fields on the CPT post.
 *
 * @param {string} questionId
 * @param {string} followUpContent  – Sanitized HTML content of the follow-up answer
 */
async function syncFollowUpAnswerToWP(questionId, followUpContent) {
  const { rows } = await dbQuery(
    `SELECT q.wp_post_id,
            r.name AS rabbi_name
     FROM   questions q
     LEFT JOIN answers a ON a.question_id = q.id
     LEFT JOIN rabbis  r ON r.id = a.rabbi_id
     WHERE  q.id = $1
     LIMIT  1`,
    [questionId]
  );

  if (!rows[0]) {
    console.error(`[wordpress] syncFollowUpAnswerToWP: שאלה ${questionId} לא נמצאה`);
    return;
  }

  const { wp_post_id, rabbi_name } = rows[0];

  if (!wp_post_id) {
    console.warn(
      `[wordpress] syncFollowUpAnswerToWP: לשאלה ${questionId} אין wp_post_id — דילוג`
    );
    return;
  }

  try {
    const client = wpClient();

    await client.post(`/questions/${wp_post_id}`, {
      follow_up_answer_content: followUpContent,
      follow_up_rabbi_name:     rabbi_name || '',
      follow_up_answered_at:    new Date().toISOString(),
    });

    console.log(
      `[wordpress] syncFollowUpAnswerToWP ✓ questionId=${questionId} wp_post_id=${wp_post_id}`
    );
  } catch (err) {
    const status  = err.response?.status || 'N/A';
    const message = err.response?.data?.message || err.message;
    console.error(
      `[wordpress] syncFollowUpAnswerToWP שגיאה questionId=${questionId}: ` +
      `status=${status} — ${message}`
    );
    // Non-fatal — do not rethrow; the follow-up is already saved in our DB
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  syncAnswerToWP,
  syncFollowUpAnswerToWP,
  retryFailedSyncs,
  postRabbiOfWeek,
  postNewsletterQuestion,
};
