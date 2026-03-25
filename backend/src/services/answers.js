'use strict';

/**
 * Answer Business Logic
 *
 * Exports:
 *   submitAnswer(questionId, rabbiId, content)
 *   editAnswer(answerId, rabbiId, newContent)
 *   getAnswer(questionId)
 *   getAnswerVersions(answerId)
 *   submitFollowUpAnswer(questionId, rabbiId, content)
 */

const { query: dbQuery, withTransaction } = require('../db/pool');
const { sanitizeRichText } = require('../utils/sanitize');
const { logAction, ACTIONS } = require('../middleware/auditLog');

// Lazy-load to avoid circular dependencies
let _wpService = null;
function getWPService() {
  if (!_wpService) {
    _wpService = require('./wordpress');
  }
  return _wpService;
}

let _notificationService = null;
function getNotificationService() {
  if (!_notificationService) {
    _notificationService = require('./askerNotification');
  }
  return _notificationService;
}

// ─── submitAnswer ──────────────────────────────────────────────────────────────

/**
 * Submit an answer to an assigned question.
 *
 * Flow:
 *   1. Verify the rabbi is assigned to the question.
 *   2. Sanitize HTML content.
 *   3. Fetch rabbi signature and auto-append it.
 *   4. Insert answer row with content_versions[0].
 *   5. Update question status to 'answered' + answered_at.
 *   6. Trigger WordPress sync (fire-and-forget).
 *   7. Trigger asker notification (fire-and-forget).
 *
 * @param {string} questionId
 * @param {string} rabbiId
 * @param {string} content   Raw HTML from the editor
 * @returns {Promise<object>} The created answer row
 */
async function submitAnswer(questionId, rabbiId, content, isPrivate = false) {
  if (!questionId || !rabbiId || !content) {
    const e = new Error('חסרים שדות חובה: שאלה, רב, ותוכן');
    e.status = 400;
    throw e;
  }

  // 1. Verify rabbi is assigned to this question
  const { rows: questionRows } = await dbQuery(
    `SELECT id, assigned_rabbi_id, status, wp_post_id, category_id
     FROM   questions
     WHERE  id = $1`,
    [questionId]
  );

  if (!questionRows[0]) {
    const e = new Error('השאלה לא נמצאה');
    e.status = 404;
    throw e;
  }

  const question = questionRows[0];

  if (question.status === 'answered') {
    const e = new Error('השאלה כבר נענתה');
    e.status = 409;
    throw e;
  }

  // Enforce category assignment before publishing (skip for private answers)
  if (!isPrivate && !question.category_id) {
    const e = new Error('יש לשייך קטגוריה לשאלה לפני פרסום תשובה');
    e.status = 400;
    throw e;
  }

  // Allow direct answer on pending questions (auto-claim) or own in_process questions
  const isAssignedToMe = String(question.assigned_rabbi_id) === String(rabbiId);
  const isPending = question.status === 'pending';
  const shouldAutoClaim = isPending && !question.assigned_rabbi_id;

  if (!isAssignedToMe && !shouldAutoClaim) {
    const e = new Error('אינך משויך לשאלה זו');
    e.status = 403;
    throw e;
  }

  // 2. Sanitize HTML content
  const sanitizedContent = sanitizeRichText(content);

  if (!sanitizedContent.trim()) {
    const e = new Error('תוכן התשובה אינו יכול להיות ריק');
    e.status = 400;
    throw e;
  }

  // 3. Fetch rabbi info (name + signature)
  const { rows: rabbiRows } = await dbQuery(
    `SELECT id, name, signature FROM rabbis WHERE id = $1`,
    [rabbiId]
  );

  if (!rabbiRows[0]) {
    const e = new Error('הרב לא נמצא');
    e.status = 404;
    throw e;
  }

  const rabbi = rabbiRows[0];
  const signature = rabbi.signature || '';

  // Auto-append rabbi signature to content
  // Use <div> not <p> — signature is already HTML with block elements
  const sigHtml = signature ? sanitizeRichText(signature) : '';
  const contentWithSignature = sigHtml
    ? `${sanitizedContent}<div dir="rtl" style="margin-top:1em">${sigHtml}</div>`
    : sanitizedContent;

  // 4 + 5. Insert answer and update question in a transaction
  const answer = await withTransaction(async (client) => {
    // Auto-claim if question is still pending and unassigned
    if (shouldAutoClaim) {
      const claimResult = await client.query(
        `UPDATE questions
         SET assigned_rabbi_id = $1, status = 'in_process', updated_at = NOW()
         WHERE id = $2 AND status = 'pending' AND assigned_rabbi_id IS NULL
         RETURNING id`,
        [rabbiId, questionId]
      );
      if (claimResult.rowCount === 0) {
        const e = new Error('השאלה כבר נתפסה על ידי רב אחר');
        e.status = 409;
        throw e;
      }
    }

    const { rows: answerRows } = await client.query(
      `INSERT INTO answers
         (question_id, rabbi_id, content, signature, content_versions, is_private, created_at)
       VALUES
         ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING *`,
      [
        questionId,
        rabbiId,
        contentWithSignature,
        signature,
        JSON.stringify([{
          content: contentWithSignature,
          edited_at: new Date().toISOString(),
          version: 1,
        }]),
        isPrivate === true,
      ]
    );

    await client.query(
      `UPDATE questions
       SET    status      = 'answered',
              answered_at = NOW(),
              updated_at  = NOW()
       WHERE  id = $1`,
      [questionId]
    );

    return answerRows[0];
  });

  // Audit log (fire-and-forget)
  logAction(
    rabbiId,
    ACTIONS.QUESTION_ANSWERED,
    'answer',
    answer.id,
    null,
    { questionId, contentLength: contentWithSignature.length, isPrivate },
    null,
    null
  );

  if (!isPrivate) {
    // 6. Trigger WP sync (fire-and-forget) — skip for private answers
    getWPService().syncAnswerToWP(questionId).catch((err) => {
      console.error('[answers] שגיאה בסנכרון לוורדפרס:', err.message);
    });

    // 7. Trigger asker notification (fire-and-forget) — skip for private answers
    getNotificationService().notifyAskerNewAnswer(questionId).catch((err) => {
      console.error('[answers] שגיאה בשליחת התראה לשואל:', err.message);
    });
  } else {
    console.info(`[answers] תשובה פרטית — WP sync דולג, שולח מייל עם תוכן התשובה (questionId: ${questionId})`);
    // Private answer: send email with answer content (no WP sync)
    getNotificationService().notifyAskerPrivateAnswer(questionId).catch((err) => {
      console.error('[answers] שגיאה בשליחת מייל תשובה פרטית לשואל:', err.message);
    });
  }

  return answer;
}

// ─── editAnswer ────────────────────────────────────────────────────────────────

/**
 * Edit an existing answer.
 *
 * Pushes the old content to content_versions, updates content + last_edited_at.
 *
 * @param {string} answerId
 * @param {string} rabbiId
 * @param {string} newContent  Raw HTML from the editor
 * @returns {Promise<object>}  Updated answer row
 */
async function editAnswer(answerId, rabbiId, newContent) {
  if (!answerId || !rabbiId || !newContent) {
    const e = new Error('חסרים שדות חובה: תשובה, רב, ותוכן');
    e.status = 400;
    throw e;
  }

  // Verify ownership
  const { rows: answerRows } = await dbQuery(
    `SELECT id, rabbi_id, content, content_versions
     FROM   answers
     WHERE  id = $1`,
    [answerId]
  );

  if (!answerRows[0]) {
    const e = new Error('התשובה לא נמצאה');
    e.status = 404;
    throw e;
  }

  const existingAnswer = answerRows[0];

  if (String(existingAnswer.rabbi_id) !== String(rabbiId)) {
    const e = new Error('אין הרשאה לערוך תשובה זו');
    e.status = 403;
    throw e;
  }

  // Sanitize new content
  const sanitizedContent = sanitizeRichText(newContent);

  if (!sanitizedContent.trim()) {
    const e = new Error('תוכן התשובה אינו יכול להיות ריק');
    e.status = 400;
    throw e;
  }

  // Push old content to content_versions
  const versions = Array.isArray(existingAnswer.content_versions)
    ? existingAnswer.content_versions
    : [];

  versions.push({
    content: existingAnswer.content,
    edited_at: new Date().toISOString(),
    version: versions.length + 1,
  });

  const { rows: updatedRows } = await dbQuery(
    `UPDATE answers
     SET    content          = $1,
            content_versions = $2,
            last_edited_at   = NOW()
     WHERE  id = $3
     RETURNING *`,
    [sanitizedContent, JSON.stringify(versions), answerId]
  );

  // Audit log (fire-and-forget)
  logAction(
    rabbiId,
    ACTIONS.ANSWER_EDITED,
    'answer',
    answerId,
    { content: existingAnswer.content },
    { content: sanitizedContent },
    null,
    null
  );

  return updatedRows[0];
}

// ─── getAnswer ─────────────────────────────────────────────────────────────────

/**
 * Get the answer for a question, joined with rabbi info.
 *
 * @param {string} questionId
 * @returns {Promise<object|null>}  Answer with rabbi details, or null
 */
async function getAnswer(questionId) {
  if (!questionId) {
    const e = new Error('מזהה שאלה נדרש');
    e.status = 400;
    throw e;
  }

  const { rows } = await dbQuery(
    `SELECT a.id,
            a.question_id,
            a.rabbi_id,
            a.content,
            a.signature,
            a.follow_up_content,
            a.content_versions,
            a.created_at,
            a.last_edited_at,
            r.name   AS rabbi_name,
            r.photo_url AS rabbi_photo_url,
            r.signature AS rabbi_signature
     FROM   answers a
     JOIN   rabbis  r ON r.id = a.rabbi_id
     WHERE  a.question_id = $1
     LIMIT  1`,
    [questionId]
  );

  return rows[0] || null;
}

// ─── getAnswerVersions ─────────────────────────────────────────────────────────

/**
 * Return the content_versions history for an answer.
 *
 * @param {string} answerId
 * @returns {Promise<object[]>}  Array of version entries
 */
async function getAnswerVersions(answerId) {
  if (!answerId) {
    const e = new Error('מזהה תשובה נדרש');
    e.status = 400;
    throw e;
  }

  const { rows } = await dbQuery(
    `SELECT id, rabbi_id, content_versions, created_at, last_edited_at
     FROM   answers
     WHERE  id = $1`,
    [answerId]
  );

  if (!rows[0]) {
    const e = new Error('התשובה לא נמצאה');
    e.status = 404;
    throw e;
  }

  const versions = Array.isArray(rows[0].content_versions)
    ? rows[0].content_versions
    : [];

  return {
    answerId:     rows[0].id,
    rabbiId:      rows[0].rabbi_id,
    createdAt:    rows[0].created_at,
    lastEditedAt: rows[0].last_edited_at,
    versions,
  };
}

// ─── submitFollowUpAnswer ──────────────────────────────────────────────────────

/**
 * Submit a follow-up answer to a question.
 *
 * Verifies the rabbi is the original responder, saves to
 * answers.follow_up_content, and updates question.follow_up_answered_at.
 *
 * @param {string} questionId
 * @param {string} rabbiId
 * @param {string} content    Raw HTML from the editor
 * @returns {Promise<object>} Updated answer row
 */
async function submitFollowUpAnswer(questionId, rabbiId, content) {
  if (!questionId || !rabbiId || !content) {
    const e = new Error('חסרים שדות חובה: שאלה, רב, ותוכן');
    e.status = 400;
    throw e;
  }

  // Verify the rabbi is the original responder
  const { rows: answerRows } = await dbQuery(
    `SELECT id, rabbi_id
     FROM   answers
     WHERE  question_id = $1
     LIMIT  1`,
    [questionId]
  );

  if (!answerRows[0]) {
    const e = new Error('לא נמצאה תשובה לשאלה זו');
    e.status = 404;
    throw e;
  }

  if (String(answerRows[0].rabbi_id) !== String(rabbiId)) {
    const e = new Error('רק הרב שענה על השאלה יכול להגיש תשובת המשך');
    e.status = 403;
    throw e;
  }

  const sanitizedContent = sanitizeRichText(content);

  if (!sanitizedContent.trim()) {
    const e = new Error('תוכן תשובת ההמשך אינו יכול להיות ריק');
    e.status = 400;
    throw e;
  }

  const updatedAnswer = await withTransaction(async (client) => {
    const { rows: updated } = await client.query(
      `UPDATE answers
       SET    follow_up_content = $1,
              last_edited_at    = NOW()
       WHERE  id = $2
       RETURNING *`,
      [sanitizedContent, answerRows[0].id]
    );

    await client.query(
      `UPDATE questions
       SET    follow_up_answered_at = NOW(),
              updated_at            = NOW()
       WHERE  id = $1`,
      [questionId]
    );

    return updated[0];
  });

  // Audit log (fire-and-forget)
  logAction(
    rabbiId,
    ACTIONS.QUESTION_ANSWERED,
    'answer',
    answerRows[0].id,
    null,
    { questionId, followUp: true, contentLength: sanitizedContent.length },
    null,
    null
  );

  // Trigger asker notification for follow-up (fire-and-forget)
  getNotificationService().notifyAskerFollowUp(questionId).catch((err) => {
    console.error('[answers] שגיאה בשליחת התראת המשך לשואל:', err.message);
  });

  return updatedAnswer;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  submitAnswer,
  editAnswer,
  getAnswer,
  getAnswerVersions,
  submitFollowUpAnswer,
};
