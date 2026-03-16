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
 * POST   /followup-answer/:id – rabbi answers follow-up question
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

// Socket broadcast helpers
const { emitToAll, emitToRabbi }      = require('../socket/helpers');

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
    const questions = await getMyQuestions(req.rabbi.id);
    return res.json({ questions });
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

// ─── GET /:id — single question ───────────────────────────────────────────────

/**
 * Return a single question with its answer, follow-ups, and view_count.
 * Increments view_count as a fire-and-forget side-effect.
 */
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const question = await getQuestionById(req.params.id);

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
        questionId: req.params.id,
        rabbiId:    req.rabbi.id,
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
      emitToAll(io, 'question:released', { questionId: req.params.id });
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
      const { content, publishNow = true } = req.body;

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

      const answer = await questionService.submitAnswer(
        req.params.id,
        req.rabbi.id,
        content,
        publishNow
      );

      const io = _io(req);
      if (io) {
        emitToAll(io, 'question:answered', {
          questionId: req.params.id,
          answerId:   answer.id,
          rabbiId:    req.rabbi.id,
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

// ─── POST /followup-answer/:id — rabbi answers follow-up ─────────────────────

/**
 * The original answering rabbi responds to a follow-up question.
 * The caller must be the assigned rabbi of the question.
 * Body: { content: string }
 */
router.post('/followup-answer/:id', authenticate, async (req, res, next) => {
  try {
    const { content } = req.body;

    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({
        error: 'תוכן תשובת ההמסך נדרש',
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

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = router;
