'use strict';

/**
 * Questions Router
 *
 * Mounted at: /api/questions
 *
 * All routes require the `authenticate` middleware unless noted otherwise.
 *
 * Routes
 * ──────
 * GET    /                    – paginated list (status, category, search, page, limit)
 * GET    /pending             – all pending questions (broadcast list)
 * GET    /my                  – rabbi's claimed questions (in_process or answered by this rabbi)
 * GET    /stats/overview      – admin: counts by status
 * GET    /:id                 – single question with answer, follow-ups, discussion count
 * POST   /claim/:id           – claim a question (locking mechanism)
 * POST   /release/:id         – release a claimed question back to pending
 * POST   /transfer/:id        – transfer to another rabbi { targetRabbiId }
 * POST   /answer/:id          – submit answer { content, publishNow: bool }
 * PUT    /answer/:id          – edit answer after publish
 * GET    /answer/:id/versions – answer version history
 * POST   /followup-answer/:id – rabbi answers follow-up question
 * POST   /:id/wp-follow-up    – WP: asker submits follow-up (public, email-verified, rate-limited)
 * POST   /:id/wp-thank        – WP: visitor thanks a rabbi (public, rate-limited, visitor_id dedup)
 * POST   /thank/:id           – thank a rabbi (public, rate-limited by IP)
 * POST   /urgent/:id          – admin: mark question as urgent
 * POST   /hide/:id            – admin: hide question
 *
 * Depends on:
 *   ../middleware/auth              – authenticate, requireAdmin
 *   ../middleware/questionOwnership – questionOwnership
 *   ../middleware/rateLimiter       – createRateLimiter (or express-rate-limit directly)
 *   ../middleware/auditLog          – logAction, ACTIONS
 *   ../services/questionService     – business logic facade
 *   ../services/questions           – getQuestions, getQuestionById, getMyQuestions
 *   ../socket/helpers               – emitToAll, emitToRabbi
 *   ../socket/questionEvents        – broadcast helpers
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const { authenticate, requireAdmin }  = require('../middleware/auth');
const { questionOwnership }           = require('../middleware/questionOwnership');
const { logAction, ACTIONS }          = require('../middleware/auditLog');
const questionService                 = require('../services/questionService');

// Legacy listing helpers (keep delegation to questions.js for list/detail queries)
const {
  getQuestions,
  getQuestionById,
  getMyQuestions,
} = require('../services/questions');

const { getAnswerVersions } = require('../services/answers');

// Socket broadcast helpers
const { emitToAll, emitToRabbi }      = require('../socket/helpers');
const { query: dbQuery }              = require('../db/pool');

const router = express.Router();

// ─── Rate limiters ────────────────────────────────────────────────────────────

/** Prevent thank-spam from the same IP — 10 thanks per 15 minutes. */
const thankRateLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => _clientIp(req),
  message: {
    error: 'יותר מדי בקשות תודה. נסה שוב מאוחר יותר.',
    code:  'TOO_MANY_THANKS',
  },
});

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Extract the real client IP (supports reverse proxies).
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function _clientIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    req.ip ||
    'unknown'
  );
}

/**
 * Resolve the socket.io server from the Express app.
 *
 * @param {import('express').Request} req
 * @returns {import('socket.io').Server|null}
 */
function _io(req) {
  return req.app.get('io') || null;
}

// ─── Resolve question ID (UUID or wp_post_id) ──────────────────────────────

/**
 * Given a param that could be either a UUID (internal id) or a WordPress
 * post ID (integer), return the internal UUID.  Returns null if not found.
 */
async function _resolveQuestionId(idParam) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idParam);
  if (isUuid) return idParam;

  // Treat as wp_post_id (integer)
  const numericId = parseInt(idParam, 10);
  if (!numericId || isNaN(numericId)) return null;

  const { rows } = await dbQuery(
    `SELECT id FROM questions WHERE wp_post_id = $1 LIMIT 1`,
    [numericId]
  );
  return rows[0]?.id || null;
}

// ─── GET / — paginated question list ─────────────────────────────────────────

/**
 * List questions with optional filters.
 * Admins see all statuses; rabbis see only pending + their own questions.
 *
 * Query params: status, category, search, page, limit (default 20)
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const isAdmin = req.rabbi.role === 'admin';

    const filters = {
      status:      req.query.status,
      category_id: req.query.category_id || req.query.category,
      search:      req.query.search,
      page:        req.query.page,
      limit:       req.query.limit,
      sort:        req.query.sort,
      is_urgent:   req.query.is_urgent,
      dateFrom:    req.query.date_from,
      dateTo:      req.query.date_to,
    };

    // Non-admins: restrict to pending + own assigned questions
    if (!isAdmin) {
      filters.rabbiViewerId = req.rabbi.id;
    }

    const result = await getQuestions(filters);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

// ─── GET /pending — all pending questions ─────────────────────────────────────

/**
 * Return all questions with status=pending (for broadcast/queue list).
 * Ordered by urgency (is_urgent first) then creation date ascending.
 */
router.get('/pending', authenticate, async (req, res, next) => {
  try {
    const result = await getQuestions({
      status: 'pending',
      page:   1,
      limit:  100, // reasonable upper bound for a queue list
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

// ─── GET /my — rabbi's own questions ─────────────────────────────────────────

/**
 * Return the authenticated rabbi's claimed questions:
 * - status = in_process and assigned to this rabbi, OR
 * - status = answered by this rabbi
 */
router.get('/my', authenticate, async (req, res, next) => {
  try {
    const status = ['in_process', 'answered'].includes(req.query.status)
      ? req.query.status
      : null;
    const questions = await getMyQuestions(req.rabbi.id, status);
    return res.json({ questions, total: questions.length });
  } catch (err) {
    return next(err);
  }
});

// ─── GET /stats/overview — admin stats ────────────────────────────────────────

/**
 * Admin only: aggregate question counts by status for the dashboard.
 *
 * Optional query params: dateFrom, dateTo, rabbiId
 *
 * NOTE: registered before /:id to prevent the param route swallowing it.
 */
router.get('/stats/overview', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const filters = {
      dateFrom: req.query.dateFrom,
      dateTo:   req.query.dateTo,
      rabbiId:  req.query.rabbiId,
    };

    const stats = await questionService.getStats(filters);
    return res.json(stats);
  } catch (err) {
    return next(err);
  }
});

// ─── GET /counts — sidebar badge counts ──────────────────────────────────────

router.get('/counts', authenticate, async (req, res, next) => {
  try {
    const rabbiId = req.rabbi.id;
    const { rows } = await dbQuery(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending')                              AS pending_count,
         COUNT(*) FILTER (WHERE status = 'in_process' AND assigned_rabbi_id = $1) AS my_open_count
       FROM questions`,
      [rabbiId]
    );
    return res.json({
      pendingCount: parseInt(rows[0].pending_count, 10),
      myOpenCount:  parseInt(rows[0].my_open_count,  10),
    });
  } catch (err) {
    return next(err);
  }
});

// ─── PUT /draft/:id — save answer draft ─────────────────────────────────────

/**
 * Save an answer draft for a question.
 * Only the assigned rabbi may save a draft (enforced by questionOwnership).
 * Body: { content: string }
 */
router.put(
  '/draft/:id',
  authenticate,
  questionOwnership,
  async (req, res, next) => {
    try {
      const { content } = req.body;

      if (!content || typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({
          error: 'תוכן הטיוטה נדרש',
          code:  'MISSING_CONTENT',
        });
      }

      const { rows } = await dbQuery(
        `UPDATE questions
         SET    draft_content    = $1,
                draft_updated_at = NOW(),
                updated_at       = NOW()
         WHERE  id = $2
         RETURNING id, draft_content, draft_updated_at`,
        [content.trim(), req.params.id]
      );

      if (!rows[0]) {
        return res.status(404).json({
          error: 'שאלה לא נמצאה',
          code:  'QUESTION_NOT_FOUND',
        });
      }

      return res.json({
        message:       'הטיוטה נשמרה בהצלחה',
        draft_content: rows[0].draft_content,
        draft_saved_at: rows[0].draft_updated_at,
      });
    } catch (err) {
      return next(err);
    }
  }
);

// ─── GET /draft/:id — load answer draft ─────────────────────────────────────

/**
 * Load a saved answer draft for a question.
 * Only the assigned rabbi may read the draft (enforced by questionOwnership).
 */
router.get(
  '/draft/:id',
  authenticate,
  questionOwnership,
  async (req, res, next) => {
    try {
      const { rows } = await dbQuery(
        `SELECT draft_content, draft_updated_at
         FROM   questions
         WHERE  id = $1`,
        [req.params.id]
      );

      if (!rows[0]) {
        return res.status(404).json({
          error: 'שאלה לא נמצאה',
          code:  'QUESTION_NOT_FOUND',
        });
      }

      return res.json({
        draft_content:  rows[0].draft_content,
        draft_saved_at: rows[0].draft_updated_at,
      });
    } catch (err) {
      return next(err);
    }
  }
);

// ─── GET /:id — single question ───────────────────────────────────────────────

/**
 * Return a single question with its answer, follow-ups, and view_count.
 * Increments view_count as a fire-and-forget side-effect.
 */
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const question = await getQuestionById(req.params.id, req.rabbi.id);

    if (!question) {
      return res.status(404).json({
        error: 'שאלה לא נמצאה',
        code:  'QUESTION_NOT_FOUND',
      });
    }

    // Increment view_count without blocking the response
    questionService.incrementViewCount(req.params.id).catch((err) => {
      console.error('[questions] שגיאה בעדכון view_count:', err.message);
    });

    // Attach follow-up if any
    const followUp = await questionService.getFollowUp(req.params.id);

    // Map answer_content → answer for frontend compatibility
    if (question.answer_content !== undefined) {
      question.answer = question.answer_content;
    }

    return res.json({ question, followUp: followUp || null });
  } catch (err) {
    return next(err);
  }
});

// ─── POST /claim/:id — claim a question ───────────────────────────────────────

/**
 * Atomically claim a pending question.
 * Uses SELECT FOR UPDATE — only one rabbi wins even under concurrent load.
 * On success, broadcasts `question:claimed` to all connected rabbis.
 */
router.post('/claim/:id', authenticate, async (req, res, next) => {
  try {
    const result = await questionService.claimQuestion(req.params.id, req.rabbi.id);

    if (!result.success) {
      return res.status(409).json({
        error: result.message,
        code:  'CLAIM_FAILED',
      });
    }

    const io = _io(req);
    if (io) {
      emitToAll(io, 'question:claimed', {
        id:              req.params.id,
        assigned_rabbi:  req.rabbi.id,
        status:          'in_process',
      });
    }

    logAction(
      req.rabbi.id,
      ACTIONS.QUESTION_CLAIMED,
      'question',
      req.params.id,
      null,
      { status: 'in_process', assigned_rabbi_id: req.rabbi.id },
      _clientIp(req),
      req.headers['user-agent'] || null
    );

    return res.json({
      message:  result.message,
      question: result.question,
    });
  } catch (err) {
    return next(err);
  }
});

// ─── POST /release/:id — release a question ───────────────────────────────────

/**
 * Release a claimed question back to pending.
 * Only the assigned rabbi or an admin may release.
 * Broadcasts `question:released` to all connected rabbis.
 */
router.post('/release/:id', authenticate, async (req, res, next) => {
  try {
    const isAdmin = req.rabbi.role === 'admin';
    const question = await questionService.releaseQuestion(req.params.id, req.rabbi.id, isAdmin);

    const io = _io(req);
    if (io) {
      emitToAll(io, 'question:released', { id: req.params.id, status: 'pending' });
    }

    logAction(
      req.rabbi.id,
      ACTIONS.QUESTION_RELEASED,
      'question',
      req.params.id,
      { status: 'in_process' },
      { status: 'pending', assigned_rabbi_id: null },
      _clientIp(req),
      req.headers['user-agent'] || null
    );

    return res.json({ message: 'השאלה שוחררה בהצלחה', question });
  } catch (err) {
    return next(err);
  }
});

// ─── POST /transfer/:id — transfer to another rabbi ──────────────────────────

/**
 * Transfer a question to another rabbi.
 * The caller must be the currently assigned rabbi (enforced by questionOwnership).
 * Body: { targetRabbiId: string }
 */
router.post(
  '/transfer/:id',
  authenticate,
  questionOwnership,
  async (req, res, next) => {
    try {
      const { targetRabbiId } = req.body;

      if (!targetRabbiId) {
        return res.status(400).json({
          error: 'יש לציין את מזהה הרב המקבל (targetRabbiId)',
          code:  'MISSING_TARGET_RABBI',
        });
      }

      const question = await questionService.transferQuestion(
        req.params.id,
        req.rabbi.id,
        targetRabbiId
      );

      const io = _io(req);
      if (io) {
        // Notify the new rabbi
        emitToRabbi(io, String(targetRabbiId), 'question:transferred', {
          questionId:  req.params.id,
          fromRabbiId: req.rabbi.id,
          question,
        });
        // Also broadcast so all rabbis update their queue state
        emitToAll(io, 'question:reassigned', {
          questionId:  req.params.id,
          toRabbiId:   targetRabbiId,
        });
      }

      logAction(
        req.rabbi.id,
        ACTIONS.QUESTION_REASSIGNED,
        'question',
        req.params.id,
        { assigned_rabbi_id: req.rabbi.id },
        { assigned_rabbi_id: targetRabbiId },
        _clientIp(req),
        req.headers['user-agent'] || null
      );

      return res.json({ message: 'השאלה הועברה בהצלחה', question });
    } catch (err) {
      return next(err);
    }
  }
);

// ─── POST /answer/:id — submit answer ────────────────────────────────────────

/**
 * Submit an answer to a question.
 * Only the assigned rabbi may answer (enforced by questionOwnership).
 * Body: { content: string, publishNow?: bool }
 */
router.post(
  '/answer/:id',
  authenticate,
  questionOwnership,
  async (req, res, next) => {
    try {
      const { content, publishNow = true, isPrivate = false } = req.body;

      if (!content || typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({
          error: 'תוכן התשובה נדרש',
          code:  'MISSING_CONTENT',
        });
      }

      // ── Draft save (publishNow === false) ─────────────────────────────
      if (!publishNow) {
        const { rows } = await dbQuery(
          `UPDATE questions
           SET    draft_content    = $1,
                  draft_updated_at = NOW(),
                  updated_at       = NOW()
           WHERE  id = $2
           RETURNING id, draft_content, draft_updated_at`,
          [content.trim(), req.params.id]
        );

        return res.json({
          message:       'הטיוטה נשמרה בהצלחה',
          draft_content: rows[0]?.draft_content,
          draft_saved_at: rows[0]?.draft_updated_at,
        });
      }

      // ── Publish flow ──────────────────────────────────────────────────

      if (content.trim().length < 10) {
        return res.status(400).json({
          error: 'תוכן התשובה חייב להכיל לפחות 10 תווים',
          code:  'CONTENT_TOO_SHORT',
        });
      }

      // Require category if publishing (skip for private answers)
      if (!isPrivate) {
        const { rows: catCheck } = await dbQuery(
          `SELECT category_id FROM questions WHERE id = $1`, [req.params.id]
        );
        if (!catCheck[0]?.category_id) {
          return res.status(400).json({
            error: 'לא ניתן לפרסם תשובה ללא קטגוריה. יש לשייך קטגוריה לשאלה תחילה.',
            code: 'CATEGORY_REQUIRED',
          });
        }
      }

      const answer = await questionService.submitAnswer(
        req.params.id,
        req.rabbi.id,
        content,
        true,
        Boolean(isPrivate)
      );

      // Clear draft after successful publish (fire-and-forget)
      dbQuery(
        `UPDATE questions SET draft_content = NULL, draft_updated_at = NULL WHERE id = $1`,
        [req.params.id]
      ).catch((err) => {
        console.error('[questions] Error clearing draft after publish:', err.message);
      });

      const io = _io(req);
      if (io) {
        emitToAll(io, 'question:answered', {
          id:          req.params.id,
          answerId:    answer.id,
          rabbiId:     req.rabbi.id,
          status:      'answered',
          answered_at: new Date().toISOString(),
        });
      }

      logAction(
        req.rabbi.id,
        ACTIONS.QUESTION_ANSWERED,
        'question',
        req.params.id,
        null,
        { answerId: answer.id, publishNow },
        _clientIp(req),
        req.headers['user-agent'] || null
      );

      return res.status(201).json({ message: 'התשובה נשמרה בהצלחה', answer });
    } catch (err) {
      return next(err);
    }
  }
);

// ─── PUT /answer/:id — edit published answer ──────────────────────────────────

/**
 * Edit a previously published answer.
 * Only the answering rabbi (assigned rabbi) may edit.
 * Body: { content: string }
 */
router.put(
  '/answer/:id',
  authenticate,
  questionOwnership,
  async (req, res, next) => {
    try {
      const { content } = req.body;

      if (!content || typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({
          error: 'תוכן התשובה נדרש',
          code:  'MISSING_CONTENT',
        });
      }

      if (content.trim().length < 10) {
        return res.status(400).json({
          error: 'תוכן התשובה חייב להכיל לפחות 10 תווים',
          code:  'CONTENT_TOO_SHORT',
        });
      }

      const answer = await questionService.editAnswer(req.params.id, req.rabbi.id, content);

      logAction(
        req.rabbi.id,
        ACTIONS.ANSWER_EDITED,
        'answer',
        answer.id,
        null,
        { questionId: req.params.id, contentLength: content.length },
        _clientIp(req),
        req.headers['user-agent'] || null
      );

      return res.json({ message: 'התשובה עודכנה בהצלחה', answer });
    } catch (err) {
      return next(err);
    }
  }
);

// ─── GET /answer/:id/versions — answer version history ────────────────────────

/**
 * Return all saved content versions for an answer.
 * Requires authentication (any logged-in rabbi can view).
 */
router.get('/answer/:id/versions', authenticate, async (req, res, next) => {
  try {
    const data = await getAnswerVersions(req.params.id);
    return res.json(data);
  } catch (err) {
    return next(err);
  }
});

// ─── WordPress public endpoints ──────────────────────────────────────────────
// These are called from the WordPress frontend (no auth), so they use
// rate-limiting and email verification instead of JWT authentication.

/** Rate limiter for WP follow-up: 5 per 15 minutes per IP. */
const wpFollowUpRateLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => _clientIp(req),
  message: {
    error: 'יותר מדי בקשות. נסה שוב מאוחר יותר.',
    code:  'TOO_MANY_REQUESTS',
  },
});

/**
 * POST /:id/wp-follow-up — WordPress asker submits a follow-up question.
 * Public endpoint (no auth). Verifies asker identity via email match.
 * Body: { email: string, content: string }
 * Limits: one follow-up per question (follow_up_count < 1).
 */
router.post('/:id/wp-follow-up', wpFollowUpRateLimiter, async (req, res, next) => {
  try {
    const { email, content } = req.body;

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({
        error: 'כתובת אימייל נדרשת',
        code:  'MISSING_EMAIL',
      });
    }

    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({
        error: 'תוכן שאלת ההמשך נדרש',
        code:  'MISSING_CONTENT',
      });
    }

    if (content.trim().length < 10) {
      return res.status(400).json({
        error: 'שאלת ההמשך חייבת להכיל לפחות 10 תווים',
        code:  'CONTENT_TOO_SHORT',
      });
    }

    // Resolve question ID (supports both UUID and wp_post_id)
    const questionId = await _resolveQuestionId(req.params.id);
    if (!questionId) {
      return res.status(404).json({ error: 'שאלה לא נמצאה', code: 'QUESTION_NOT_FOUND' });
    }

    // Fetch question and verify email matches the original asker
    const { rows: qRows } = await dbQuery(
      `SELECT id, status, follow_up_count, asker_email AS asker_email_encrypted, assigned_rabbi_id
       FROM   questions
       WHERE  id = $1`,
      [questionId]
    );

    if (!qRows[0]) {
      return res.status(404).json({
        error: 'שאלה לא נמצאה',
        code:  'QUESTION_NOT_FOUND',
      });
    }

    const question = qRows[0];

    // Verify asker email: decrypt stored email and compare
    let storedEmail = null;
    if (question.asker_email_encrypted) {
      try {
        const { decryptField } = require('../utils/encryption');
        storedEmail = decryptField(question.asker_email_encrypted);
      } catch (decryptErr) {
        console.error('[questions] wp-follow-up decrypt error:', decryptErr.message);
      }
    }

    if (!storedEmail || storedEmail.toLowerCase().trim() !== email.toLowerCase().trim()) {
      return res.status(403).json({
        error: 'כתובת האימייל אינה תואמת לשואל המקורי',
        code:  'EMAIL_MISMATCH',
      });
    }

    // Delegate to the existing submitFollowUp service (validates status + count)
    const followUp = await questionService.submitFollowUp(questionId, content);

    // Notify the assigned rabbi (socket + email) + update WP meta
    setImmediate(async () => {
      try {
        const { rows: qRows } = await dbQuery(
          `SELECT q.title, q.assigned_rabbi_id, q.question_number, q.wp_post_id, q.email_message_id,
                  r.email AS rabbi_email, r.name AS rabbi_name
           FROM questions q
           LEFT JOIN rabbis r ON r.id = q.assigned_rabbi_id
           WHERE q.id = $1`,
          [questionId]
        );

        // Update WP post meta so the follow-up form hides on refresh
        const wpPostId = qRows[0]?.wp_post_id;
        if (wpPostId) {
          try {
            const axios = require('axios');
            const wpUrl = process.env.WP_API_URL;
            const wpKey = process.env.WP_API_KEY;
            if (wpUrl && wpKey) {
              const cred = Buffer.from(wpKey).toString('base64');
              await axios.post(`${wpUrl}/ask-rabai/${wpPostId}`,
                { meta: { follow_up_count: '1' } },
                { headers: { Authorization: `Basic ${cred}`, 'Content-Type': 'application/json' }, timeout: 10000 }
              );
            }
          } catch (wpErr) {
            console.warn('[wp-follow-up] failed to update WP follow_up_count meta:', wpErr.message);
          }
        }
        const q = qRows[0];
        if (q && q.assigned_rabbi_id) {
          // Socket notification
          const io = _io(req);
          if (io) {
            io.to(`rabbi:${q.assigned_rabbi_id}`).emit('question:followUpReceived', {
              questionId,
              followUp: { asker_content: content },
            });
          }
          // Email notification
          if (q.rabbi_email) {
            try {
              const { sendFollowUpNotification } = require('../services/email');
              const he = require('he');
              await sendFollowUpNotification(q.rabbi_email, {
                title: he.decode(q.title || ''),
                id: questionId,
                question_number: q.question_number || q.wp_post_id,
                rabbi_name: q.rabbi_name,
                email_message_id: q.email_message_id,
              }, content);
            } catch (emailErr) {
              console.error('[wp-follow-up] email notification failed:', emailErr.message);
            }
          }
        }
      } catch (notifErr) {
        console.error('[wp-follow-up] notification error:', notifErr.message);
      }
    });

    return res.status(201).json({
      message: 'שאלת ההמשך נשמרה בהצלחה',
      followUp,
    });
  } catch (err) {
    // Forward known business-logic errors with their status code
    if (err.status) {
      return res.status(err.status).json({ error: err.message, code: err.code || 'ERROR' });
    }
    return next(err);
  }
});

/**
 * POST /:id/wp-thank — WordPress visitor thanks a rabbi.
 * Public endpoint (no auth). Rate-limited by IP.
 * Optional body: { visitor_id: string } for deduplication.
 */
router.post('/:id/wp-thank', thankRateLimiter, async (req, res, next) => {
  try {
    // Resolve question ID (supports both UUID and wp_post_id)
    const questionId = await _resolveQuestionId(req.params.id);
    if (!questionId) {
      return res.status(404).json({ error: 'שאלה לא נמצאה', code: 'QUESTION_NOT_FOUND' });
    }

    const ip        = _clientIp(req);
    const visitorId = req.body?.visitor_id;

    // Use visitor_id for dedup if provided, otherwise fall back to IP
    const dedupKey = visitorId
      ? `wp-thank:visitor:${visitorId}:${questionId}`
      : null;

    // If visitor_id provided, check Redis for dedup
    if (dedupKey) {
      try {
        const redis = require('../db/redis');
        const existing = await redis.get(dedupKey);
        if (existing) {
          // Already thanked — fetch current count and return idempotent response
          const { rows } = await dbQuery(
            `SELECT thank_count FROM questions WHERE id = $1`,
            [questionId]
          );
          return res.json({
            message:        'כבר הודית על שאלה זו',
            thankCount:     rows[0]?.thank_count || 0,
            alreadyThanked: true,
          });
        }
      } catch (redisErr) {
        // Redis down — continue with IP-based dedup via incrementThankCount
        console.error('[questions] wp-thank redis check error:', redisErr.message);
      }
    }

    const result = await questionService.incrementThankCount(questionId, ip);

    // Store visitor_id dedup key in Redis (24h TTL)
    if (dedupKey && !result.alreadyThanked) {
      try {
        const redis = require('../db/redis');
        await redis.setEx(dedupKey, 86400, '1');
      } catch (redisErr) {
        console.error('[questions] wp-thank redis set error:', redisErr.message);
      }
    }

    if (result.alreadyThanked) {
      return res.json({
        message:        'כבר הודית על שאלה זו',
        thankCount:     result.thankCount,
        alreadyThanked: true,
      });
    }

    // Fire-and-forget: sync thank count to WordPress
    if (result.wpPostId) {
      const { syncThankCount } = require('../services/wpService');
      syncThankCount(result.wpPostId, result.thankCount).catch((err) => {
        console.error('[questions] wp-thank syncThankCount error:', err.message);
      });
    }

    // Schedule WhatsApp + email thank notification — fire-and-forget
    questionService.scheduleThankNotification(questionId, result.rabbiId)
      .catch((err) => {
        console.error('[questions] wp-thank notification error:', err.message);
      });

    // Create in-app notification record for the rabbi — fire-and-forget
    if (result.rabbiId) {
      (async () => {
        try {
          const { rows: qRows } = await dbQuery(
            `SELECT title FROM questions WHERE id = $1`,
            [questionId]
          );
          const title = qRows[0]?.title || 'שאלה';
          await dbQuery(
            `INSERT INTO notifications_log (rabbi_id, type, channel, content, status)
             VALUES ($1, 'user_thanks', 'in_app', $2, 'sent')`,
            [result.rabbiId, JSON.stringify({ questionId, questionTitle: title, thankCount: result.thankCount })]
          );
          // Emit real-time notification to rabbi
          const io = _io(req);
          if (io) {
            const { sendToRabbi } = require('../socket/notificationEvents');
            sendToRabbi(io, result.rabbiId, {
              type:  'user_thanks',
              title: 'תודה מהשואל',
              body:  `מישהו הודה על תשובתך לשאלה: ${title}`,
              link:  `/questions/${questionId}`,
            });
          }
        } catch (notifErr) {
          console.error('[questions] wp-thank in-app notification error:', notifErr.message);
        }
      })();
    }

    return res.json({
      message:        'תודה רבה! ההודאה נשלחה לרב',
      thankCount:     result.thankCount,
      alreadyThanked: false,
    });
  } catch (err) {
    return next(err);
  }
});

// ─── POST /:id/follow-up — asker submits a follow-up question (rabbi portal) ─

/**
 * Asker submits a follow-up question after an answered question.
 * This endpoint is authenticated (rabbi portal) but intended to be called
 * on behalf of the asker (e.g. via webhook or portal admin action).
 * In practice the frontend FollowUpSection posts here when the asker
 * wants to ask a follow-up.
 * Body: { content: string }
 */
router.post('/:id/follow-up', authenticate, async (req, res, next) => {
  try {
    const { content } = req.body;

    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({
        error: 'תוכן שאלת ההמשך נדרש',
        code:  'MISSING_CONTENT',
      });
    }

    const followUp = await questionService.submitFollowUp(
      req.params.id,
      content
    );

    return res.status(201).json({ message: 'שאלת ההמשך נשמרה בהצלחה', followUp });
  } catch (err) {
    return next(err);
  }
});

// ─── POST /followup-answer/:id — rabbi answers follow-up ─────────────────────

/**
 * The original answering rabbi responds to a follow-up question.
 * The caller must be the assigned rabbi of the question.
 * Body: { content: string }
 * Also accepts { follow_up_answer: string } for backwards-compatibility
 * with the frontend which previously used that field name.
 */
router.post('/followup-answer/:id', authenticate, async (req, res, next) => {
  try {
    // Accept both field names for compatibility
    const content = req.body.content || req.body.follow_up_answer;

    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({
        error: 'תוכן תשובת ההמשך נדרש',
        code:  'MISSING_CONTENT',
      });
    }

    if (content.trim().length < 10) {
      return res.status(400).json({
        error: 'תוכן תשובת ההמשך חייב להכיל לפחות 10 תווים',
        code:  'CONTENT_TOO_SHORT',
      });
    }

    const followUp = await questionService.answerFollowUp(
      req.params.id,
      req.rabbi.id,
      content
    );

    return res.json({ message: 'תשובת ההמשך נשמרה בהצלחה', followUp });
  } catch (err) {
    return next(err);
  }
});

// ─── POST /thank/:id — thank a rabbi ─────────────────────────────────────────

/**
 * Public endpoint — no authentication required.
 * Rate-limited by IP (10 requests per 15 minutes).
 * Uses Redis to prevent the same IP from thanking the same question twice.
 */
router.post('/thank/:id', thankRateLimiter, async (req, res, next) => {
  try {
    const ip = _clientIp(req);

    const result = await questionService.incrementThankCount(req.params.id, ip);

    if (result.alreadyThanked) {
      return res.json({
        message:        'כבר הודית על שאלה זו',
        thankCount:     result.thankCount,
        alreadyThanked: true,
      });
    }

    // Fire-and-forget: sync thank count to WordPress
    if (result.wpPostId) {
      const { syncThankCount } = require('../services/wpService');
      syncThankCount(result.wpPostId, result.thankCount).catch((err) => {
        console.error('[questions] syncThankCount error:', err.message);
      });
    }

    // Schedule WhatsApp + email thank notification — fire-and-forget
    questionService.scheduleThankNotification(req.params.id, result.rabbiId)
      .catch((err) => {
        console.error('[questions] שגיאה בשליחת התראת תודה:', err.message);
      });

    return res.json({
      message:        'תודה רבה! ההודאה נשלחה לרב',
      thankCount:     result.thankCount,
      alreadyThanked: false,
    });
  } catch (err) {
    return next(err);
  }
});

// ─── POST /urgent/:id — admin marks question as urgent ───────────────────────

/**
 * Admin only: set is_urgent = true and broadcast to all connected rabbis.
 */
router.post('/urgent/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const question = await questionService.markUrgent(req.params.id);

    const io = _io(req);
    if (io) {
      emitToAll(io, 'question:urgent', { questionId: req.params.id, question });
    }

    logAction(
      req.rabbi.id,
      ACTIONS.ADMIN_CONFIG_CHANGED,
      'question',
      req.params.id,
      { is_urgent: false },
      { is_urgent: true },
      _clientIp(req),
      req.headers['user-agent'] || null
    );

    return res.json({ message: 'השאלה סומנה כדחופה', question });
  } catch (err) {
    return next(err);
  }
});

// ─── POST /hide/:id — admin hides question ────────────────────────────────────

/**
 * Admin only: set status = 'hidden'. Preserves previous status for restoration.
 * Body: { reason?: string }
 */
router.post('/hide/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const question = await questionService.hideQuestion(req.params.id, req.body.reason);

    const io = _io(req);
    if (io) {
      emitToAll(io, 'question:statusChanged', {
        questionId: req.params.id,
        status:     'hidden',
      });
    }

    logAction(
      req.rabbi.id,
      ACTIONS.QUESTION_HIDDEN,
      'question',
      req.params.id,
      null,
      { status: 'hidden', reason: req.body.reason || null },
      _clientIp(req),
      req.headers['user-agent'] || null
    );

    return res.json({ message: 'השאלה הוסתרה בהצלחה', question });
  } catch (err) {
    return next(err);
  }
});

// ─── PATCH /category/:id — set category on a question ────────────────────────
router.patch('/category/:id', authenticate, async (req, res, next) => {
  try {
    const { category_id } = req.body;
    const isAdmin = req.rabbi.role === 'admin';

    // Validate category exists and is approved
    if (category_id) {
      const catId = parseInt(category_id, 10);
      if (!Number.isFinite(catId))
        return res.status(400).json({ error: 'מזהה קטגוריה אינו חוקי' });

      const { rows: catRows } = await dbQuery(
        `SELECT id FROM categories WHERE id = $1 AND status = 'approved'`, [catId]
      );
      if (!catRows[0])
        return res.status(400).json({ error: 'קטגוריה לא נמצאה או לא מאושרת' });
    }

    // Any authenticated rabbi can set category — verify question exists
    const { rows: qRows } = await dbQuery(
      `SELECT id, assigned_rabbi_id, status FROM questions WHERE id = $1`, [req.params.id]
    );
    if (!qRows[0])
      return res.status(404).json({ error: 'שאלה לא נמצאה' });

    const { rows } = await dbQuery(
      `UPDATE questions SET category_id = $1 WHERE id = $2
       RETURNING id, category_id`,
      [category_id ? parseInt(category_id, 10) : null, req.params.id]
    );

    return res.json({ question: rows[0], message: 'הקטגוריה עודכנה' });
  } catch (err) { return next(err); }
});

// ─── PUT /:id/notes — save private notes for a question ──────────────────────

router.put('/:id/notes', authenticate, async (req, res, next) => {
  try {
    const questionId = req.params.id;
    const rabbiId    = req.rabbi.id;
    const { notes }  = req.body;

    if (typeof notes !== 'string') {
      return res.status(400).json({ error: 'notes חייב להיות טקסט' });
    }

    // Verify question exists
    const { rows: qRows } = await dbQuery(
      `SELECT id FROM questions WHERE id = $1`,
      [questionId]
    );
    if (!qRows[0]) {
      return res.status(404).json({ error: 'שאלה לא נמצאה' });
    }

    // Upsert private note
    const { rows } = await dbQuery(
      `INSERT INTO private_notes (question_id, rabbi_id, content, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (question_id, rabbi_id)
       DO UPDATE SET content = $3, updated_at = NOW()
       RETURNING id, content, updated_at`,
      [questionId, rabbiId, notes]
    );

    return res.json({ ok: true, note: rows[0] });
  } catch (err) {
    // If unique constraint doesn't exist, try a different approach
    if (err.code === '42P10' || err.message?.includes('ON CONFLICT')) {
      try {
        const questionId = req.params.id;
        const rabbiId    = req.rabbi.id;
        const { notes }  = req.body;

        // Check if note exists
        const { rows: existing } = await dbQuery(
          `SELECT id FROM private_notes WHERE question_id = $1 AND rabbi_id = $2`,
          [questionId, rabbiId]
        );

        let result;
        if (existing[0]) {
          result = await dbQuery(
            `UPDATE private_notes SET content = $1, updated_at = NOW()
             WHERE question_id = $2 AND rabbi_id = $3
             RETURNING id, content, updated_at`,
            [notes, questionId, rabbiId]
          );
        } else {
          result = await dbQuery(
            `INSERT INTO private_notes (question_id, rabbi_id, content, created_at, updated_at)
             VALUES ($1, $2, $3, NOW(), NOW())
             RETURNING id, content, updated_at`,
            [questionId, rabbiId, notes]
          );
        }

        return res.json({ ok: true, note: result.rows[0] });
      } catch (innerErr) {
        return next(innerErr);
      }
    }
    return next(err);
  }
});

// ─── GET /:id/notes — get private notes for a question ───────────────────────

router.get('/:id/notes', authenticate, async (req, res, next) => {
  try {
    const { rows } = await dbQuery(
      `SELECT id, content, updated_at FROM private_notes
       WHERE question_id = $1 AND rabbi_id = $2
       LIMIT 1`,
      [req.params.id, req.rabbi.id]
    );

    return res.json({ note: rows[0] || null });
  } catch (err) {
    return next(err);
  }
});

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = router;
