'use strict';

/**
 * Question-Discussion Shortcut Router
 *
 * Mounted at: /api/questions
 *
 * Provides a single convenience endpoint that creates a Discussion room
 * directly from a question, auto-generating the title and linking the two.
 *
 * Route:
 *   POST /questions/:id/discussion
 *     – Create a Discussion linked to question :id.
 *     – Auto-title: "דיון בשאלה #<id>: <question title>"
 *     – Creator (the calling rabbi) is always added as a member.
 *     – Optional body: { memberIds[], allRabbis }  (same as POST /discussions)
 *     – Responds with 201 + { discussion } and sets Location header to
 *       /api/discussions/:newId so the client can redirect.
 */

const express = require('express');

const { authenticate }          = require('../middleware/authenticate');
const { query: dbQuery }        = require('../db/pool');
const { emitToRabbi }           = require('../socket/helpers');
const { createDiscussion }      = require('../services/discussionService');

const router = express.Router({ mergeParams: true });

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Thin async error-forwarding wrapper.
 * @param {Function} fn
 * @returns {Function}
 */
function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// ─── POST /questions/:id/discussion ──────────────────────────────────────────

/**
 * Create a discussion room linked to a specific question.
 *
 * Requires: Bearer JWT (authenticate).
 *
 * URL params:
 *   id  {string}  Question ID
 *
 * Body (all optional):
 *   memberIds  {string[]}  Specific rabbi IDs to invite (besides the creator)
 *   allRabbis  {boolean}   When true, all active rabbis are added as members
 *
 * Response 201:
 *   { discussion, message }
 *   Location header → /api/discussions/:newId
 *
 * Response 404 when the question does not exist.
 * Response 409 when a discussion for this question already exists.
 */
router.post(
  '/:id/discussion',
  authenticate,
  asyncHandler(async (req, res) => {
    const questionId = req.params.id;

    // ── Fetch the question ──────────────────────────────────────────────────
    const { rows: qRows } = await dbQuery(
      `SELECT id, title, is_hidden
       FROM   questions
       WHERE  id = $1`,
      [questionId]
    );

    if (qRows.length === 0) {
      return res.status(404).json({ error: 'שאלה לא נמצאה' });
    }

    const question = qRows[0];

    if (question.is_hidden) {
      return res.status(404).json({ error: 'שאלה לא נמצאה' });
    }

    // ── Guard: prevent duplicate discussions for the same question ─────────
    const { rows: existing } = await dbQuery(
      `SELECT id FROM discussions
       WHERE  question_id = $1 AND is_archived = false
       LIMIT  1`,
      [questionId]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        error:        'דיון כבר קיים עבור שאלה זו',
        discussionId: existing[0].id,
      });
    }

    // ── Build auto-title ────────────────────────────────────────────────────
    const questionTitle = (question.title || '').trim() || `שאלה #${questionId}`;
    const autoTitle = `דיון בשאלה #${questionId}: ${questionTitle}`.slice(0, 255);

    // ── Resolve members ─────────────────────────────────────────────────────
    const { memberIds, allRabbis } = req.body;

    if (memberIds !== undefined && !Array.isArray(memberIds)) {
      return res.status(400).json({ error: 'memberIds חייב להיות מערך' });
    }

    // ── Create discussion ───────────────────────────────────────────────────
    const io = req.app.get('io');

    // Resolve final member list: 'all' string or specific IDs
    const resolvedMemberIds = allRabbis === true ? 'all' : (Array.isArray(memberIds) ? memberIds : []);

    const discussion = await createDiscussion(
      autoTitle,
      questionId,
      req.rabbi.id,
      resolvedMemberIds,
      io
    );

    // ── Notify invited members via socket ───────────────────────────────────
    if (io && Array.isArray(memberIds) && memberIds.length > 0) {
      memberIds.forEach((memberId) => {
        if (String(memberId) !== String(req.rabbi.id)) {
          emitToRabbi(io, String(memberId), 'discussion:invited', {
            discussionId: discussion.id,
            title:        discussion.title,
            questionId,
            invitedBy:    req.rabbi.id,
            timestamp:    new Date().toISOString(),
          });
        }
      });
    }

    // ── Respond ─────────────────────────────────────────────────────────────
    res.setHeader('Location', `/api/discussions/${discussion.id}`);
    return res.status(201).json({
      discussion,
      message: 'הדיון נוצר בהצלחה',
    });
  })
);

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = router;
