'use strict';

/**
 * Question Ownership Middleware
 *
 * Verifies that the authenticated rabbi is the one currently assigned to the
 * question identified by req.params.id (i.e. assigned_rabbi_id = req.rabbi.id).
 *
 * Must be chained AFTER the `authenticate` (or `authenticateToken`) middleware
 * so that req.rabbi is already populated.
 *
 * Returns:
 *   401 – authenticate was not run first (req.rabbi absent)
 *   400 – req.params.id is missing or not a non-empty string
 *   404 – question not found
 *   403 – the authenticated rabbi is not the assigned owner
 *
 * On success, the question row is attached to req.question so downstream
 * handlers can use it without hitting the DB a second time.
 *
 * Admins (req.rabbi.role === 'admin') bypass the ownership check and are always
 * allowed through — this keeps the middleware composable with admin-only routes.
 *
 * Depends on:
 *   ../db/pool – query
 */

const { query } = require('../db/pool');

/**
 * @type {import('express').RequestHandler}
 */
async function questionOwnership(req, res, next) {
  // ── Guard: authenticate must have run first ──────────────────────────────
  if (!req.rabbi) {
    return res.status(401).json({
      error: 'נדרשת התחברות',
      code:  'UNAUTHENTICATED',
    });
  }

  // ── Guard: :id param must be present ─────────────────────────────────────
  const questionId = req.params.id;
  if (!questionId || typeof questionId !== 'string' || !questionId.trim()) {
    return res.status(400).json({
      error: 'מזהה שאלה חסר',
      code:  'MISSING_QUESTION_ID',
    });
  }

  // ── Admins bypass ownership check ────────────────────────────────────────
  if (req.rabbi.role === 'admin') {
    // Still resolve the question so downstream handlers get req.question
    try {
      const { rows } = await query(
        `SELECT id, status, assigned_rabbi_id
         FROM   questions
         WHERE  id = $1`,
        [questionId]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          error: 'שאלה לא נמצאה',
          code:  'QUESTION_NOT_FOUND',
        });
      }

      req.question = rows[0];
      return next();
    } catch (err) {
      return next(err);
    }
  }

  // ── Regular rabbi: enforce ownership ─────────────────────────────────────
  try {
    const { rows } = await query(
      `SELECT id, status, assigned_rabbi_id
       FROM   questions
       WHERE  id = $1`,
      [questionId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: 'שאלה לא נמצאה',
        code:  'QUESTION_NOT_FOUND',
      });
    }

    const question = rows[0];

    // Compare as strings to handle numeric vs uuid edge cases uniformly
    if (String(question.assigned_rabbi_id) !== String(req.rabbi.id)) {
      return res.status(403).json({
        error: 'אין הרשאה לבצע פעולה זו — השאלה אינה מוקצית אליך',
        code:  'NOT_QUESTION_OWNER',
      });
    }

    // Attach for downstream reuse
    req.question = question;
    return next();
  } catch (err) {
    return next(err);
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = { questionOwnership };
