'use strict';

/**
 * Question Access Middleware
 *
 * Provides route-level guards for question ownership and assignment checks.
 *
 * Exports:
 *   requireAssignedRabbi   – Verify the authenticated rabbi is the one currently
 *                            assigned to the question in :id. Returns 403 or 404
 *                            on failure.
 *   requireAnswerAuthor    – Verify the authenticated rabbi is the author of the
 *                            question's answer (for follow-up answer submissions).
 *
 * Prerequisites:
 *   authenticate must run before either middleware (req.rabbi must be set).
 *
 * Depends on:
 *   ../db/pool – query
 */

const { query: dbQuery } = require('../db/pool');

// ─── requireAssignedRabbi ─────────────────────────────────────────────────────

/**
 * Verify that the authenticated rabbi (`req.rabbi.id`) is the currently
 * assigned rabbi for the question identified by `req.params.id`.
 *
 * Admin users bypass this check — an admin is always permitted.
 *
 * Attaches the question row to `req.question` so downstream handlers can use
 * it without an extra DB round-trip.
 *
 * Failure responses:
 *   400 – `:id` param is missing
 *   404 – Question not found
 *   403 – Authenticated rabbi is not the assigned one (and not admin)
 *   409 – Question is already answered (for submit-answer guard)
 *
 * @type {import('express').RequestHandler}
 */
async function requireAssignedRabbi(req, res, next) {
  const questionId = req.params.id;

  if (!questionId) {
    return res.status(400).json({ error: 'מזהה שאלה נדרש' });
  }

  // Admins bypass ownership checks
  if (req.rabbi && req.rabbi.role === 'admin') {
    return next();
  }

  if (!req.rabbi || !req.rabbi.id) {
    return res.status(401).json({ error: 'נדרשת התחברות' });
  }

  let question;
  try {
    const { rows } = await dbQuery(
      `SELECT id, status, assigned_rabbi_id
       FROM   questions
       WHERE  id = $1`,
      [questionId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'שאלה לא נמצאה' });
    }

    question = rows[0];
  } catch (err) {
    console.error('[questionAccess.requireAssignedRabbi] שגיאת DB:', err.message);
    return next(err);
  }

  if (String(question.assigned_rabbi_id) !== String(req.rabbi.id)) {
    return res.status(403).json({ error: 'אינך הרב המוקצה לשאלה זו' });
  }

  // Attach to request for downstream use without re-querying
  req.question = question;

  return next();
}

// ─── requireAnswerAuthor ──────────────────────────────────────────────────────

/**
 * Verify that the authenticated rabbi is the author of the answer for the
 * question identified by `req.params.id`.
 *
 * Intended for routes that allow editing an answer or submitting a follow-up
 * answer where the rabbi may no longer be the `assigned_rabbi_id` but must
 * still be the one who wrote the original answer.
 *
 * Admin users bypass this check.
 *
 * Attaches the answer row to `req.answer` for downstream use.
 *
 * Failure responses:
 *   400 – `:id` param is missing
 *   404 – Question or answer not found
 *   403 – Authenticated rabbi did not write the answer
 *
 * @type {import('express').RequestHandler}
 */
async function requireAnswerAuthor(req, res, next) {
  const questionId = req.params.id;

  if (!questionId) {
    return res.status(400).json({ error: 'מזהה שאלה נדרש' });
  }

  if (req.rabbi && req.rabbi.role === 'admin') {
    return next();
  }

  if (!req.rabbi || !req.rabbi.id) {
    return res.status(401).json({ error: 'נדרשת התחברות' });
  }

  let answer;
  try {
    const { rows } = await dbQuery(
      `SELECT a.id, a.rabbi_id, a.question_id
       FROM   answers a
       WHERE  a.question_id = $1
       LIMIT  1`,
      [questionId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'לא נמצאה תשובה לשאלה זו' });
    }

    answer = rows[0];
  } catch (err) {
    console.error('[questionAccess.requireAnswerAuthor] שגיאת DB:', err.message);
    return next(err);
  }

  if (String(answer.rabbi_id) !== String(req.rabbi.id)) {
    return res.status(403).json({
      error: 'רק הרב שכתב את התשובה יכול לבצע פעולה זו',
    });
  }

  req.answer = answer;

  return next();
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  requireAssignedRabbi,
  requireAnswerAuthor,
};
