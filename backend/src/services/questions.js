'use strict';

/**
 * Questions Service — Business Logic
 *
 * All question lifecycle operations: listing, creation from WordPress
 * webhooks, claiming, releasing, transferring, hiding, flagging,
 * difficulty tagging, thank-you counting, and similarity search.
 *
 * Depends on:
 *   ../db/pool            – query, withTransaction
 *   ../utils/encryption   – encryptField, decryptField
 *   ../utils/sanitize     – sanitizeRichText
 *   ./redis               – setEx, exists
 */

const { query, withTransaction } = require('../db/pool');
const { encryptField, decryptField } = require('../utils/encryption');
const { sanitizeRichText } = require('../utils/sanitize');
const redis = require('./redis');

// ─── getQuestions ─────────────────────────────────────────────────────────────

/**
 * Paginated, filterable question list.
 *
 * @param {object} filters
 * @param {string}  [filters.status]
 * @param {string}  [filters.category_id]
 * @param {string}  [filters.assigned_rabbi_id]
 * @param {string}  [filters.urgency]
 * @param {string}  [filters.difficulty]
 * @param {boolean} [filters.flagged]
 * @param {string}  [filters.search]        – keyword in title/content
 * @param {string}  [filters.dateFrom]      – ISO date string
 * @param {string}  [filters.dateTo]        – ISO date string
 * @param {number}  [filters.page=1]
 * @param {number}  [filters.limit=20]
 * @returns {Promise<{ questions: object[], total: number, page: number, limit: number }>}
 */
async function getQuestions(filters = {}) {
  const page  = Math.max(parseInt(filters.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 20, 1), 100);
  const offset = (page - 1) * limit;

  const conditions = [];
  const params     = [];
  let paramIndex   = 1;

  if (filters.status) {
    conditions.push(`q.status = $${paramIndex++}`);
    params.push(filters.status);
  }

  if (filters.category_id) {
    conditions.push(`q.category_id = $${paramIndex++}`);
    params.push(filters.category_id);
  }

  if (filters.assigned_rabbi_id) {
    conditions.push(`q.assigned_rabbi_id = $${paramIndex++}`);
    params.push(filters.assigned_rabbi_id);
  }

  if (filters.urgency) {
    conditions.push(`q.urgency = $${paramIndex++}`);
    params.push(filters.urgency);
  }

  if (filters.difficulty) {
    conditions.push(`q.difficulty = $${paramIndex++}`);
    params.push(filters.difficulty);
  }

  if (filters.flagged !== undefined && filters.flagged !== null) {
    conditions.push(`q.flagged = $${paramIndex++}`);
    params.push(filters.flagged === true || filters.flagged === 'true');
  }

  if (filters.search) {
    conditions.push(`(q.title ILIKE $${paramIndex} OR q.content ILIKE $${paramIndex})`);
    params.push(`%${filters.search}%`);
    paramIndex++;
  }

  if (filters.dateFrom) {
    conditions.push(`q.created_at >= $${paramIndex++}`);
    params.push(filters.dateFrom);
  }

  if (filters.dateTo) {
    conditions.push(`q.created_at <= $${paramIndex++}`);
    params.push(filters.dateTo);
  }

  // Non-admin rabbis: hide in_process questions of other rabbis.
  // Exception: 'answered' status is a public feed — all rabbis may see it.
  if (filters.rabbiViewerId && filters.status !== 'answered') {
    conditions.push(`q.status = 'pending'`);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  // Count total
  const countResult = await query(
    `SELECT COUNT(*)::int AS total FROM questions q ${whereClause}`,
    params
  );
  const total = countResult.rows[0].total;

  // Fetch page
  const dataParams = [...params, limit, offset];
  const dataResult = await query(
    `SELECT q.id, q.question_number, q.title, q.content, q.status, q.urgency, q.difficulty,
            q.category_id, q.assigned_rabbi_id, q.flagged, q.flag_reason,
            q.thank_count, q.attachment_url, q.created_at, q.updated_at,
            r.name AS rabbi_name,
            c.name AS category_name
     FROM   questions q
     LEFT JOIN rabbis     r ON r.id = q.assigned_rabbi_id
     LEFT JOIN categories c ON c.id = q.category_id
     ${whereClause}
     ORDER BY q.created_at DESC
     LIMIT  $${paramIndex++}
     OFFSET $${paramIndex++}`,
    dataParams
  );

  return {
    questions: dataResult.rows,
    total,
    page,
    limit,
  };
}

// ─── getQuestionById ──────────────────────────────────────────────────────────

/**
 * Full question with rabbi name and answer (if exists).
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
async function getQuestionById(id, requestingRabbiId = null) {
  const result = await query(
    `SELECT q.*,
            r.name AS rabbi_name,
            c.name AS category_name,
            a.id         AS answer_id,
            a.content    AS answer_content,
            a.is_private AS answer_is_private,
            a.rabbi_id   AS answer_rabbi_id,
            a.created_at AS answer_created_at,
            a.updated_at AS answer_updated_at
     FROM   questions q
     LEFT JOIN rabbis     r ON r.id = q.assigned_rabbi_id
     LEFT JOIN categories c ON c.id = q.category_id
     LEFT JOIN answers    a ON a.question_id = q.id
     WHERE  q.id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  // Decrypt PII fields for the consumer
  row.asker_email = decryptField(row.asker_email);
  row.asker_phone = decryptField(row.asker_phone);

  // Privacy filter: if answer is private and requester is not the answering rabbi,
  // hide the content (but keep is_private flag so UI can show a badge).
  if (row.answer_is_private && requestingRabbiId) {
    const isAnsweringRabbi = String(row.answer_rabbi_id) === String(requestingRabbiId);
    if (!isAnsweringRabbi) {
      row.answer_content = null; // hide content
    }
  }

  return row;
}

// ─── createFromWebhook ────────────────────────────────────────────────────────

/**
 * Create a question from a WordPress webhook payload.
 * Encrypts asker email and phone, sanitises content, sets status to pending.
 *
 * @param {object} data
 * @param {string} data.title
 * @param {string} data.content
 * @param {string} [data.asker_name]
 * @param {string} [data.asker_email]
 * @param {string} [data.asker_phone]
 * @param {string} [data.category_id]
 * @param {string} [data.urgency]
 * @param {string} [data.source]       – e.g. 'wordpress'
 * @param {string} [data.wp_post_id]
 * @returns {Promise<object>}          – the created question row
 */
async function createFromWebhook(data) {
  if (!data.title || !data.content) {
    const err = new Error('כותרת ותוכן נדרשים');
    err.status = 400;
    throw err;
  }

  const sanitizedContent = sanitizeRichText(data.content);
  const encryptedEmail   = encryptField(data.asker_email || null);
  const encryptedPhone   = encryptField(data.asker_phone || null);

  const result = await query(
    `INSERT INTO questions
       (title, content, asker_name, asker_email, asker_phone,
        category_id, urgency, status, source, wp_post_id, attachment_url)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10)
     RETURNING *`,
    [
      data.title.trim(),
      sanitizedContent,
      data.asker_name || null,
      encryptedEmail,
      encryptedPhone,
      data.category_id || null,
      data.urgency || 'normal',
      data.source || 'wordpress',
      data.wp_post_id || null,
      data.attachment_url || null,
    ]
  );

  return result.rows[0];
}

// ─── claimQuestion ────────────────────────────────────────────────────────────

/**
 * ATOMIC claim: check status === 'pending' with row lock (SELECT FOR UPDATE),
 * then update to 'in_process' with assigned_rabbi_id and lock_timestamp.
 *
 * @param {string} questionId
 * @param {string} rabbiId
 * @returns {Promise<{ success: boolean, question?: object, error?: string }>}
 */
async function claimQuestion(questionId, rabbiId) {
  return withTransaction(async (client) => {
    // Row lock — prevents concurrent claims
    const lockResult = await client.query(
      `SELECT id, status, assigned_rabbi_id
       FROM   questions
       WHERE  id = $1
       FOR UPDATE`,
      [questionId]
    );

    if (lockResult.rows.length === 0) {
      return { success: false, error: 'שאלה לא נמצאה' };
    }

    const question = lockResult.rows[0];

    if (question.status !== 'pending') {
      return { success: false, error: 'השאלה כבר נלקחה לטיפול או אינה זמינה' };
    }

    const updateResult = await client.query(
      `UPDATE questions
       SET    status            = 'in_process',
              assigned_rabbi_id = $2,
              lock_timestamp    = NOW(),
              updated_at        = NOW()
       WHERE  id = $1
       RETURNING *`,
      [questionId, rabbiId]
    );

    return { success: true, question: updateResult.rows[0] };
  });
}

// ─── releaseQuestion ──────────────────────────────────────────────────────────

/**
 * Verify that the rabbi owns the question, then release it back to pending.
 *
 * @param {string} questionId
 * @param {string} rabbiId
 * @returns {Promise<object>} – updated question row
 */
async function releaseQuestion(questionId, rabbiId) {
  const check = await query(
    `SELECT id, status, assigned_rabbi_id
     FROM   questions
     WHERE  id = $1`,
    [questionId]
  );

  if (check.rows.length === 0) {
    const err = new Error('שאלה לא נמצאה');
    err.status = 404;
    throw err;
  }

  const question = check.rows[0];

  if (question.assigned_rabbi_id !== rabbiId) {
    const err = new Error('אין הרשאה לשחרר שאלה שאינה מוקצית אליך');
    err.status = 403;
    throw err;
  }

  const result = await query(
    `UPDATE questions
     SET    status            = 'pending',
            assigned_rabbi_id = NULL,
            lock_timestamp    = NULL,
            updated_at        = NOW()
     WHERE  id = $1
     RETURNING *`,
    [questionId]
  );

  return result.rows[0];
}

// ─── transferQuestion ─────────────────────────────────────────────────────────

/**
 * Transfer a question from one rabbi to another.
 * Verifies that the current rabbi (fromRabbiId) owns the question.
 *
 * @param {string} questionId
 * @param {string} fromRabbiId
 * @param {string} toRabbiId
 * @returns {Promise<object>} – updated question row
 */
async function transferQuestion(questionId, fromRabbiId, toRabbiId) {
  if (!toRabbiId) {
    const err = new Error('יש לציין את הרב המקבל');
    err.status = 400;
    throw err;
  }

  const check = await query(
    `SELECT id, status, assigned_rabbi_id
     FROM   questions
     WHERE  id = $1`,
    [questionId]
  );

  if (check.rows.length === 0) {
    const err = new Error('שאלה לא נמצאה');
    err.status = 404;
    throw err;
  }

  const question = check.rows[0];

  if (question.assigned_rabbi_id !== fromRabbiId) {
    const err = new Error('אין הרשאה להעביר שאלה שאינה מוקצית אליך');
    err.status = 403;
    throw err;
  }

  // Verify target rabbi exists
  const targetCheck = await query(
    `SELECT id FROM rabbis WHERE id = $1 AND active = true`,
    [toRabbiId]
  );

  if (targetCheck.rows.length === 0) {
    const err = new Error('הרב המקבל לא נמצא או אינו פעיל');
    err.status = 404;
    throw err;
  }

  const result = await query(
    `UPDATE questions
     SET    assigned_rabbi_id = $2,
            lock_timestamp    = NOW(),
            updated_at        = NOW()
     WHERE  id = $1
     RETURNING *`,
    [questionId, toRabbiId]
  );

  return result.rows[0];
}

// ─── hideQuestion ─────────────────────────────────────────────────────────────

/**
 * Admin only: hide a question. Stores the previous status so it can be restored.
 *
 * @param {string} questionId
 * @param {string} reason
 * @returns {Promise<object>} – updated question row
 */
async function hideQuestion(questionId, reason) {
  const check = await query(
    `SELECT id, status FROM questions WHERE id = $1`,
    [questionId]
  );

  if (check.rows.length === 0) {
    const err = new Error('שאלה לא נמצאה');
    err.status = 404;
    throw err;
  }

  if (check.rows[0].status === 'hidden') {
    const err = new Error('השאלה כבר מוסתרת');
    err.status = 400;
    throw err;
  }

  const previousStatus = check.rows[0].status;

  const result = await query(
    `UPDATE questions
     SET    status          = 'hidden',
            previous_status = $2,
            hide_reason     = $3,
            updated_at      = NOW()
     WHERE  id = $1
     RETURNING *`,
    [questionId, previousStatus, reason || null]
  );

  return result.rows[0];
}

// ─── unhideQuestion ───────────────────────────────────────────────────────────

/**
 * Admin only: restore a hidden question to its previous status.
 *
 * @param {string} questionId
 * @returns {Promise<object>} – updated question row
 */
async function unhideQuestion(questionId) {
  const check = await query(
    `SELECT id, status, previous_status FROM questions WHERE id = $1`,
    [questionId]
  );

  if (check.rows.length === 0) {
    const err = new Error('שאלה לא נמצאה');
    err.status = 404;
    throw err;
  }

  if (check.rows[0].status !== 'hidden') {
    const err = new Error('השאלה אינה מוסתרת');
    err.status = 400;
    throw err;
  }

  const restoreStatus = check.rows[0].previous_status || 'pending';

  const result = await query(
    `UPDATE questions
     SET    status          = $2,
            previous_status = NULL,
            hide_reason     = NULL,
            updated_at      = NOW()
     WHERE  id = $1
     RETURNING *`,
    [questionId, restoreStatus]
  );

  return result.rows[0];
}

// ─── flagQuestion ─────────────────────────────────────────────────────────────

/**
 * Mark a question as flagged with a reason.
 *
 * @param {string} questionId
 * @param {string} rabbiId
 * @param {string} reason
 * @returns {Promise<object>} – updated question row
 */
async function flagQuestion(questionId, rabbiId, reason) {
  const check = await query(
    `SELECT id FROM questions WHERE id = $1`,
    [questionId]
  );

  if (check.rows.length === 0) {
    const err = new Error('שאלה לא נמצאה');
    err.status = 404;
    throw err;
  }

  const result = await query(
    `UPDATE questions
     SET    flagged      = true,
            flag_reason  = $2,
            flagged_by   = $3,
            updated_at   = NOW()
     WHERE  id = $1
     RETURNING *`,
    [questionId, reason || null, rabbiId]
  );

  return result.rows[0];
}

// ─── setDifficulty ────────────────────────────────────────────────────────────

/**
 * Set the difficulty level of a question.
 *
 * @param {string} questionId
 * @param {string} rabbiId
 * @param {string} difficulty – e.g. 'easy', 'medium', 'hard'
 * @returns {Promise<object>} – updated question row
 */
async function setDifficulty(questionId, rabbiId, difficulty) {
  if (!difficulty) {
    const err = new Error('יש לציין רמת קושי');
    err.status = 400;
    throw err;
  }

  const check = await query(
    `SELECT id FROM questions WHERE id = $1`,
    [questionId]
  );

  if (check.rows.length === 0) {
    const err = new Error('שאלה לא נמצאה');
    err.status = 404;
    throw err;
  }

  const result = await query(
    `UPDATE questions
     SET    difficulty  = $2,
            updated_at  = NOW()
     WHERE  id = $1
     RETURNING *`,
    [questionId, difficulty]
  );

  return result.rows[0];
}

// ─── thankQuestion ────────────────────────────────────────────────────────────

/**
 * Increment the thank_count for a question.
 * Uses Redis to track session tokens and prevent duplicate thanks.
 *
 * @param {string} questionId
 * @param {string} sessionToken – unique session/browser token
 * @returns {Promise<{ thankCount: number, alreadyThanked: boolean }>}
 */
async function thankQuestion(questionId, sessionToken) {
  const check = await query(
    `SELECT id, assigned_rabbi_id, thank_count FROM questions WHERE id = $1`,
    [questionId]
  );

  if (check.rows.length === 0) {
    const err = new Error('שאלה לא נמצאה');
    err.status = 404;
    throw err;
  }

  // Prevent duplicate thanks using Redis (TTL: 30 days)
  const redisKey = `thank:${questionId}:${sessionToken}`;
  const alreadyThanked = await redis.exists(redisKey);

  if (alreadyThanked) {
    return {
      thankCount: check.rows[0].thank_count,
      alreadyThanked: true,
      rabbiId: check.rows[0].assigned_rabbi_id,
    };
  }

  // Mark as thanked in Redis (30 days TTL)
  await redis.setEx(redisKey, 30 * 24 * 60 * 60, '1');

  const result = await query(
    `UPDATE questions
     SET    thank_count = COALESCE(thank_count, 0) + 1,
            updated_at  = NOW()
     WHERE  id = $1
     RETURNING thank_count, assigned_rabbi_id`,
    [questionId]
  );

  return {
    thankCount: result.rows[0].thank_count,
    alreadyThanked: false,
    rabbiId: result.rows[0].assigned_rabbi_id,
  };
}

// ─── getMyQuestions ───────────────────────────────────────────────────────────

/**
 * Get questions for a specific rabbi filtered by status.
 *
 * @param {string} rabbiId
 * @param {string|null} status - 'in_process' | 'answered' | null (all)
 * @returns {Promise<object[]>}
 */
async function getMyQuestions(rabbiId, status = null) {
  const params = [rabbiId];
  let statusClause = '';

  if (status === 'in_process') {
    // Questions I claimed and haven't answered yet
    statusClause = `AND q.status = 'in_process' AND q.assigned_rabbi_id = $1`;
  } else if (status === 'answered') {
    // Questions I personally answered (assigned_rabbi_id = me AND status = answered)
    statusClause = `AND q.status = 'answered' AND q.assigned_rabbi_id = $1`;
  } else {
    // All my questions (in_process + answered)
    statusClause = `AND q.assigned_rabbi_id = $1`;
  }

  const result = await query(
    `SELECT q.id, q.title, q.content, q.status, q.urgency, q.difficulty,
            q.category_id, q.assigned_rabbi_id,
            q.flagged, q.flag_reason,
            q.thank_count, q.view_count,
            q.created_at, q.updated_at, q.answered_at,
            q.asker_name, q.asker_email,
            c.name AS category_name,
            a.content AS answer_content,
            a.created_at AS answer_created_at,
            CASE WHEN a.id IS NOT NULL THEN true ELSE false END AS has_answer
     FROM   questions q
     LEFT JOIN categories c ON c.id = q.category_id
     LEFT JOIN answers    a ON a.question_id = q.id
     WHERE  1=1
       ${statusClause}
     ORDER BY
       CASE q.status
         WHEN 'in_process' THEN 1
         WHEN 'answered'   THEN 2
         ELSE 3
       END,
       COALESCE(q.answered_at, q.updated_at, q.created_at) DESC`,
    params
  );

  return result.rows;
}

// ─── getSimilarQuestions ──────────────────────────────────────────────────────

/**
 * Basic text search for similar answered questions.
 * Uses ILIKE for a simple version (no TF-IDF).
 * Falls back to ts_vector full-text search if available.
 *
 * @param {string} questionId
 * @returns {Promise<object[]>}
 */
async function getSimilarQuestions(questionId) {
  // First, get the source question's title and content
  const source = await query(
    `SELECT id, title, content FROM questions WHERE id = $1`,
    [questionId]
  );

  if (source.rows.length === 0) {
    const err = new Error('שאלה לא נמצאה');
    err.status = 404;
    throw err;
  }

  const { title } = source.rows[0];

  // Extract meaningful keywords from title (words > 2 chars)
  const keywords = title
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  if (keywords.length === 0) {
    return [];
  }

  // Try tsvector full-text search first, fall back to ILIKE
  try {
    const tsQuery = keywords.join(' | ');
    const result = await query(
      `SELECT q.id, q.title, q.status, q.category_id,
              c.name AS category_name,
              ts_rank(
                to_tsvector('simple', COALESCE(q.title, '') || ' ' || COALESCE(q.content, '')),
                to_tsquery('simple', $2)
              ) AS rank
       FROM   questions q
       LEFT JOIN categories c ON c.id = q.category_id
       LEFT JOIN answers    a ON a.question_id = q.id
       WHERE  q.id != $1
         AND  a.id IS NOT NULL
         AND  to_tsvector('simple', COALESCE(q.title, '') || ' ' || COALESCE(q.content, ''))
              @@ to_tsquery('simple', $2)
       ORDER BY rank DESC
       LIMIT 10`,
      [questionId, tsQuery]
    );

    return result.rows;
  } catch {
    // Fallback to ILIKE if tsvector fails
    const likeConditions = keywords
      .slice(0, 5) // Limit to 5 keywords
      .map((_, i) => `(q.title ILIKE $${i + 2} OR q.content ILIKE $${i + 2})`)
      .join(' OR ');

    const likeParams = [
      questionId,
      ...keywords.slice(0, 5).map((k) => `%${k}%`),
    ];

    const result = await query(
      `SELECT q.id, q.title, q.status, q.category_id,
              c.name AS category_name
       FROM   questions q
       LEFT JOIN categories c ON c.id = q.category_id
       LEFT JOIN answers    a ON a.question_id = q.id
       WHERE  q.id != $1
         AND  a.id IS NOT NULL
         AND  (${likeConditions})
       ORDER BY q.created_at DESC
       LIMIT 10`,
      likeParams
    );

    return result.rows;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getQuestions,
  getQuestionById,
  createFromWebhook,
  claimQuestion,
  releaseQuestion,
  transferQuestion,
  hideQuestion,
  unhideQuestion,
  flagQuestion,
  setDifficulty,
  thankQuestion,
  getMyQuestions,
  getSimilarQuestions,
};
