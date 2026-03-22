'use strict';

/**
 * Question Service — Business Logic Facade
 *
 * Unified module for all question lifecycle operations.
 *
 * Exports:
 *   claimQuestion(questionId, rabbiId)
 *   releaseQuestion(questionId, rabbiId)
 *   transferQuestion(questionId, fromRabbiId, toRabbiId)
 *   submitAnswer(questionId, rabbiId, content, publishNow)
 *   editAnswer(questionId, rabbiId, newContent)
 *   answerFollowUp(questionId, rabbiId, content)
 *   checkTimeouts()
 *   sendTimeoutWarnings()
 *   incrementThankCount(questionId, ip)
 *   getStats(filters)
 *   markUrgent(questionId)
 *   hideQuestion(questionId, reason)
 *   incrementViewCount(questionId)
 *   getFollowUp(questionId)
 *   submitFollowUp(questionId, content)
 *   submitFollowUpAnswer(questionId, rabbiId, content)
 *   scheduleThankNotification(questionId, rabbiId)
 *   getRabbiStats(rabbiId, period)
 *   getTopRabbi(weekStart)
 *
 * Depends on:
 *   ../db/pool              – query, withTransaction
 *   ../db/redis             – get, setEx (rate-limiting for thank)
 *   ../socket/helpers       – emitToRabbi, emitToAll
 *   ../middleware/auditLog  – logAction, ACTIONS
 *   ./wpService             – syncAnswerToWP (alias: ./wordpress)
 *   ./askerNotification     – notifyAskerFollowUp, notifyRabbiTransfer
 */

const { query: dbQuery, withTransaction } = require('../db/pool');
const { logAction, ACTIONS }              = require('../middleware/auditLog');
const { sanitizeRichText }               = require('../utils/sanitize');

// ─── Lazy service loaders (break circular dependency chains) ──────────────────

let _redis = null;
/** @returns {typeof import('../db/redis')} */
function getRedis() {
  if (!_redis) _redis = require('../db/redis');
  return _redis;
}

let _socketHelpers = null;
/** @returns {typeof import('../socket/helpers')} */
function getSocketHelpers() {
  if (!_socketHelpers) _socketHelpers = require('../socket/helpers');
  return _socketHelpers;
}

let _wpService = null;
/** @returns {typeof import('./wordpress')} */
function getWPService() {
  if (!_wpService) _wpService = require('./wordpress');
  return _wpService;
}

let _notificationService = null;
/** @returns {typeof import('./askerNotification')} */
function getNotificationService() {
  if (!_notificationService) _notificationService = require('./askerNotification');
  return _notificationService;
}

let _answersService = null;
/** @returns {typeof import('./answers')} */
function getAnswersService() {
  if (!_answersService) _answersService = require('./answers');
  return _answersService;
}

// ─── claimQuestion ────────────────────────────────────────────────────────────

/**
 * Atomically claim a question for a rabbi.
 *
 * Uses PostgreSQL SELECT FOR UPDATE inside an explicit transaction to guarantee
 * at-most-one winner even under concurrent load.
 *
 * @param {string} questionId
 * @param {string} rabbiId
 * @returns {Promise<{ success: boolean, message: string, question?: object }>}
 */
async function claimQuestion(questionId, rabbiId) {
  return withTransaction(async (client) => {
    // Acquire a row-level lock — concurrent claim attempts block here
    const { rows: lockRows } = await client.query(
      `SELECT id, status, assigned_rabbi_id
       FROM   questions
       WHERE  id = $1
       FOR UPDATE`,
      [questionId]
    );

    if (lockRows.length === 0) {
      return { success: false, message: 'שאלה לא נמצאה' };
    }

    const current = lockRows[0];

    if (current.status !== 'pending') {
      // A different rabbi claimed it (or it was hidden/answered) — use Hebrew message
      return {
        success: false,
        message: 'השאלה כבר נלקחה לטיפול על ידי רב אחר ואינה זמינה יותר',
      };
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE questions
       SET    status            = 'in_process',
              assigned_rabbi_id = $2,
              lock_timestamp    = NOW(),
              updated_at        = NOW()
       WHERE  id = $1
       RETURNING *`,
      [questionId, rabbiId]
    );

    return {
      success:  true,
      message:  'השאלה נלקחה לטיפולך בהצלחה',
      question: updatedRows[0],
    };
  });
}

// ─── releaseQuestion ──────────────────────────────────────────────────────────

/**
 * Release a claimed question back to pending.
 *
 * Only the assigned rabbi (or an admin, signalled by isAdmin=true) may release.
 * Emits socket event `question:released` to all connected rabbis.
 *
 * @param {string}  questionId
 * @param {string}  rabbiId
 * @param {boolean} [isAdmin=false]
 * @returns {Promise<object>} – Updated question row
 * @throws {Error} 404 if not found
 * @throws {Error} 400 if not in_process
 * @throws {Error} 403 if rabbi is not the owner (and not admin)
 */
async function releaseQuestion(questionId, rabbiId, isAdmin = false) {
  const { rows } = await dbQuery(
    `SELECT id, status, assigned_rabbi_id
     FROM   questions
     WHERE  id = $1`,
    [questionId]
  );

  if (rows.length === 0) {
    const err = new Error('שאלה לא נמצאה');
    err.status = 404;
    throw err;
  }

  const question = rows[0];

  if (question.status !== 'in_process') {
    const err = new Error('ניתן לשחרר רק שאלות שנמצאות בטיפול');
    err.status = 400;
    throw err;
  }

  if (!isAdmin && String(question.assigned_rabbi_id) !== String(rabbiId)) {
    const err = new Error('אין הרשאה לשחרר שאלה שאינה מוקצית אליך');
    err.status = 403;
    throw err;
  }

  const { rows: updatedRows } = await dbQuery(
    `UPDATE questions
     SET    status            = 'pending',
            assigned_rabbi_id = NULL,
            lock_timestamp    = NULL,
            warning_sent      = FALSE,
            updated_at        = NOW()
     WHERE  id = $1
     RETURNING *`,
    [questionId]
  );

  // Broadcast release to all connected rabbis (fire-and-forget)
  _emitSafe('question:released', { questionId }, null);

  return updatedRows[0];
}

// ─── transferQuestion ─────────────────────────────────────────────────────────

/**
 * Transfer a question from the current assigned rabbi to another.
 *
 * The question remains in_process; only the assigned_rabbi_id changes.
 * Notifies the new rabbi via socket event and email/WhatsApp.
 *
 * @param {string} questionId
 * @param {string} fromRabbiId – Must be the currently assigned rabbi
 * @param {string} toRabbiId   – Target rabbi (must exist and be active)
 * @returns {Promise<object>}  – Updated question row
 * @throws {Error} 400 if toRabbiId is missing or same as from
 * @throws {Error} 403 if fromRabbiId is not the current owner
 * @throws {Error} 404 if question or target rabbi not found
 */
async function transferQuestion(questionId, fromRabbiId, toRabbiId) {
  if (!toRabbiId) {
    const err = new Error('יש לציין את הרב המקבל');
    err.status = 400;
    throw err;
  }

  if (String(fromRabbiId) === String(toRabbiId)) {
    const err = new Error('לא ניתן להעביר שאלה לעצמך');
    err.status = 400;
    throw err;
  }

  // Verify target rabbi exists and is active
  const { rows: targetRows } = await dbQuery(
    `SELECT id FROM rabbis WHERE id = $1 AND active = true`,
    [toRabbiId]
  );

  if (targetRows.length === 0) {
    const err = new Error('הרב המקבל לא נמצא או אינו פעיל');
    err.status = 404;
    throw err;
  }

  // Fetch question to verify ownership
  const { rows: qRows } = await dbQuery(
    `SELECT id, status, assigned_rabbi_id
     FROM   questions
     WHERE  id = $1`,
    [questionId]
  );

  if (qRows.length === 0) {
    const err = new Error('שאלה לא נמצאה');
    err.status = 404;
    throw err;
  }

  const question = qRows[0];

  if (String(question.assigned_rabbi_id) !== String(fromRabbiId)) {
    const err = new Error('אין הרשאה להעביר שאלה שאינה מוקצית אליך');
    err.status = 403;
    throw err;
  }

  const { rows: updatedRows } = await dbQuery(
    `UPDATE questions
     SET    assigned_rabbi_id = $2,
            lock_timestamp    = NOW(),
            updated_at        = NOW()
     WHERE  id = $1
     RETURNING *`,
    [questionId, toRabbiId]
  );

  const updatedQuestion = updatedRows[0];

  // Notify new rabbi via socket (fire-and-forget)
  _emitSafe('question:transferred', {
    questionId,
    fromRabbiId,
    toRabbiId,
    question: updatedQuestion,
  }, toRabbiId);

  // Email / WhatsApp notification — fire-and-forget
  const ns = getNotificationService();
  if (typeof ns.notifyRabbiTransfer === 'function') {
    ns.notifyRabbiTransfer(questionId, fromRabbiId, toRabbiId)
      .catch((err) => {
        console.error('[questionService] שגיאה בשליחת התראת העברה:', err.message);
      });
  }

  return updatedQuestion;
}

// ─── submitAnswer ─────────────────────────────────────────────────────────────

/**
 * Submit an answer to a question.
 *
 * Delegates content sanitisation, signature appending, and WordPress sync
 * to the answers service.  Sets notified_status=false so the notifier cron
 * picks it up.  Emits socket event `question:answered`.
 *
 * @param {string}  questionId
 * @param {string}  rabbiId
 * @param {string}  content    – Raw HTML from the editor
 * @param {boolean} [publishNow=true]
 * @returns {Promise<object>} – Created answer row
 */
async function submitAnswer(questionId, rabbiId, content, publishNow = true) {
  const answersService = getAnswersService();
  const answer = await answersService.submitAnswer(questionId, rabbiId, content);

  // Mark notified_status=false so the notifier cron handles asker notification
  dbQuery(
    `UPDATE questions
     SET    notified_status = false,
            updated_at      = NOW()
     WHERE  id = $1`,
    [questionId]
  ).catch((err) => {
    console.error('[questionService] שגיאה בעדכון notified_status:', err.message);
  });

  // Push to WordPress — fire-and-forget
  getWPService().syncAnswerToWP(questionId).catch((err) => {
    console.error('[questionService] שגיאה בסנכרון תשובה ל-WordPress:', err.message);
  });

  // Notify all rabbis that the question is answered
  _emitSafe('question:answered', { questionId, answerId: answer.id, rabbiId }, null);

  return answer;
}

// ─── editAnswer ───────────────────────────────────────────────────────────────

/**
 * Edit a published answer.
 *
 * @param {string} questionId
 * @param {string} rabbiId
 * @param {string} newContent
 * @returns {Promise<object>} – Updated answer row
 */
async function editAnswer(questionId, rabbiId, newContent) {
  const { rows: answerRows } = await dbQuery(
    `SELECT id FROM answers WHERE question_id = $1 LIMIT 1`,
    [questionId]
  );

  if (!answerRows[0]) {
    const err = new Error('לא נמצאה תשובה לשאלה זו');
    err.status = 404;
    throw err;
  }

  const answer = await getAnswersService().editAnswer(answerRows[0].id, rabbiId, newContent);

  // Trigger WP sync after edit — fire-and-forget
  getWPService().syncAnswerToWP(questionId).catch((err) => {
    console.error('[questionService] שגיאה בסנכרון WP לאחר עריכה:', err.message);
  });

  return answer;
}

// ─── answerFollowUp ───────────────────────────────────────────────────────────

/**
 * Rabbi answers a follow-up question.
 *
 * Only the original answerer may respond. Updates follow_up_questions.rabbi_answer
 * and appends below the original on WordPress.
 *
 * @param {string} questionId
 * @param {string} rabbiId
 * @param {string} content
 * @returns {Promise<object>} – Updated follow_up_questions row
 * @throws {Error} 400 if content missing
 * @throws {Error} 403 if rabbi is not the original answerer
 * @throws {Error} 404 if no follow-up or answer found
 */
async function answerFollowUp(questionId, rabbiId, content) {
  if (!content || !content.trim()) {
    const err = new Error('תוכן תשובת ההמשך נדרש');
    err.status = 400;
    throw err;
  }

  // Verify rabbi is the original answerer
  const { rows: answerRows } = await dbQuery(
    `SELECT id, rabbi_id FROM answers WHERE question_id = $1 LIMIT 1`,
    [questionId]
  );

  if (!answerRows[0]) {
    const err = new Error('לא נמצאה תשובה מקורית לשאלה זו');
    err.status = 404;
    throw err;
  }

  if (String(answerRows[0].rabbi_id) !== String(rabbiId)) {
    const err = new Error('רק הרב שענה על השאלה יכול לענות על שאלת ההמשך');
    err.status = 403;
    throw err;
  }

  // Fetch the follow-up row (table alias matches schema: follow_up_questions)
  const { rows: fuRows } = await dbQuery(
    `SELECT id FROM follow_up_questions WHERE question_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [questionId]
  );

  if (!fuRows[0]) {
    const err = new Error('לא נמצאה שאלת המשך לשאלה זו');
    err.status = 404;
    throw err;
  }

  const sanitizedContent = sanitizeRichText(content);

  if (!sanitizedContent.trim()) {
    const err = new Error('תוכן תשובת ההמשך אינו יכול להיות ריק');
    err.status = 400;
    throw err;
  }

  const updatedFollowUp = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE follow_up_questions
       SET    rabbi_answer = $2
       WHERE  id           = $1
       RETURNING *`,
      [fuRows[0].id, sanitizedContent]
    );

    await client.query(
      `UPDATE questions
       SET    updated_at = NOW()
       WHERE  id = $1`,
      [questionId]
    );

    return rows[0];
  });

  // Audit — fire-and-forget
  logAction(
    rabbiId,
    ACTIONS.QUESTION_ANSWERED,
    'follow_up_question',
    fuRows[0].id,
    null,
    { questionId, followUpAnswer: true, contentLength: sanitizedContent.length },
    null,
    null
  );

  // WP sync — fire-and-forget: use the dedicated follow-up sync so the correct
  // meta field is updated on the WP post (not just the main answer).
  const wpService = getWPService();
  if (typeof wpService.syncFollowUpAnswerToWP === 'function') {
    wpService.syncFollowUpAnswerToWP(questionId, sanitizedContent).catch((err) => {
      console.error('[questionService] שגיאה בסנכרון תשובת המשך ל-WordPress:', err.message);
    });
  } else {
    // Fallback: sync the general answer (keeps WP post up-to-date at minimum)
    wpService.syncAnswerToWP(questionId).catch((err) => {
      console.error('[questionService] שגיאה בסנכרון תשובה ל-WordPress (fallback):', err.message);
    });
  }

  // Notify asker — fire-and-forget
  const ns = getNotificationService();
  if (typeof ns.notifyAskerFollowUp === 'function') {
    ns.notifyAskerFollowUp(questionId).catch((err) => {
      console.error('[questionService] שגיאה בשליחת התראת המשך לשואל:', err.message);
    });
  }

  return updatedFollowUp;
}

// ─── checkTimeouts ────────────────────────────────────────────────────────────

/**
 * Cron helper: find in_process questions where lock_timestamp < NOW()-4h
 * and reset them to pending.
 *
 * Broadcasts `question:released` for each released question.
 *
 * @param {import('socket.io').Server|null} [io]
 * @returns {Promise<number>} – Count of questions released
 */
async function checkTimeouts(io) {
  const TIMEOUT_HOURS = 4;

  const { rows, rowCount } = await dbQuery(
    `UPDATE questions
     SET    status            = 'pending',
            assigned_rabbi_id = NULL,
            lock_timestamp    = NULL,
            warning_sent      = FALSE,
            updated_at        = NOW()
     WHERE  status = 'in_process'
       AND  lock_timestamp IS NOT NULL
       AND  lock_timestamp < NOW() - INTERVAL '${TIMEOUT_HOURS} hours'
     RETURNING id, title, assigned_rabbi_id AS prev_rabbi_id`
  );

  const released = rowCount || 0;

  if (released > 0) {
    for (const row of rows) {
      console.info(
        `[questionService.checkTimeouts] שאלה ${row.id} ("${row.title}") ` +
        `הוחזרה לתור (רב קודם: ${row.prev_rabbi_id || 'לא ידוע'})`
      );

      // Audit — fire-and-forget
      logAction(
        null,
        ACTIONS.QUESTION_RELEASED,
        'question',
        row.id,
        { status: 'in_process', assigned_rabbi_id: row.prev_rabbi_id },
        { status: 'pending', reason: 'timeout_4h' },
        null,
        null
      );

      // Socket broadcast
      if (io) {
        try {
          const { emitToAll } = getSocketHelpers();
          emitToAll(io, 'question:released', { questionId: row.id });
        } catch (socketErr) {
          console.error('[questionService.checkTimeouts] socket emit failed:', socketErr.message);
        }
      }
    }
  }

  return released;
}

// ─── sendTimeoutWarnings ──────────────────────────────────────────────────────

/**
 * Cron helper: find in_process questions where lock_timestamp is between
 * 3h and 3.5h old (i.e. 30–60 min before the 4h cutoff) and send email/WA
 * warnings to the assigned rabbi.
 *
 * Sets warning_sent = TRUE before sending to avoid duplicate warnings.
 *
 * @returns {Promise<number>} – Count of warnings sent
 */
async function sendTimeoutWarnings() {
  const { rows } = await dbQuery(
    `SELECT q.id,
            q.title,
            q.assigned_rabbi_id,
            r.email      AS rabbi_email,
            r.name       AS rabbi_name,
            r.phone      AS rabbi_phone
     FROM   questions q
     JOIN   rabbis    r ON r.id = q.assigned_rabbi_id
     WHERE  q.status       = 'in_process'
       AND  q.warning_sent = FALSE
       AND  q.lock_timestamp IS NOT NULL
       AND  q.lock_timestamp < NOW() - INTERVAL '3 hours'
       AND  q.lock_timestamp >= NOW() - INTERVAL '3.5 hours'`
  );

  if (rows.length === 0) return 0;

  let warned = 0;

  for (const row of rows) {
    // Mark warning sent first to prevent duplicate sends on failure
    await dbQuery(
      `UPDATE questions SET warning_sent = TRUE, updated_at = NOW() WHERE id = $1`,
      [row.id]
    ).catch((dbErr) => {
      console.error('[questionService.sendTimeoutWarnings] DB update failed:', dbErr.message);
    });

    console.info(
      `[questionService.sendTimeoutWarnings] שאלה ${row.id} — שולח אזהרת timeout לרב ${row.rabbi_name}`
    );

    // Email warning — fire-and-forget
    _sendTimeoutWarningEmail(row).catch((err) => {
      console.error('[questionService.sendTimeoutWarnings] שגיאה בשליחת אימייל אזהרה:', err.message);
    });

    // WhatsApp warning via notification service if supported — fire-and-forget
    const ns = getNotificationService();
    if (typeof ns.sendTimeoutWarning === 'function') {
      ns.sendTimeoutWarning(row).catch((err) => {
        console.error('[questionService.sendTimeoutWarnings] שגיאה בשליחת WA אזהרה:', err.message);
      });
    }

    warned++;
  }

  return warned;
}

/**
 * Internal: send a timeout-warning email to the rabbi.
 *
 * @param {{ id: string, title: string, rabbi_email: string, rabbi_name: string }} row
 */
async function _sendTimeoutWarningEmail(row) {
  if (!row.rabbi_email) return;

  let nodemailer;
  try { nodemailer = require('nodemailer'); } catch { return; }

  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({
    from:    process.env.SMTP_FROM || '"ענה את השואל" <noreply@aneh-hashoel.co.il>',
    to:      row.rabbi_email,
    subject: `תזכורת: נותרה שעה לטיפול בשאלה — ${row.title}`,
    html: `<div dir="rtl" style="font-family: Arial, sans-serif;">
      <h2>שלום הרב ${row.rabbi_name},</h2>
      <p>תזכורת: השאלה <strong>"${row.title}"</strong> ממתינה לתשובתך.</p>
      <p>נותרה כשעה לפני שהשאלה תוחזר אוטומטית לתור הפנוי.</p>
      <p>אנא היכנס למערכת וסיים את הטיפול בשאלה בהקדם האפשרי.</p>
      <p>בברכה,<br>צוות ענה את השואל</p>
    </div>`,
  });
}

// ─── incrementThankCount ──────────────────────────────────────────────────────

/**
 * Increment thank_count for a question, rate-limited by IP via Redis.
 *
 * A unique Redis key per (questionId, ip) with a 30-day TTL prevents the same
 * IP from thanking the same question more than once.
 *
 * Emits `question:thankReceived` to the assigned rabbi's socket room.
 *
 * @param {string} questionId
 * @param {string} ip
 * @returns {Promise<{ thankCount: number, alreadyThanked: boolean, rabbiId: string|null }>}
 * @throws {Error} 404 if question not found
 */
async function incrementThankCount(questionId, ip) {
  const { rows: qRows } = await dbQuery(
    `SELECT id, assigned_rabbi_id, thank_count FROM questions WHERE id = $1`,
    [questionId]
  );

  if (qRows.length === 0) {
    const err = new Error('שאלה לא נמצאה');
    err.status = 404;
    throw err;
  }

  const question = qRows[0];

  // Rate-limit by IP (30-day window per question)
  const redisKey   = `thank:${questionId}:${ip}`;
  const redis      = getRedis();
  const alreadyKey = await redis.exists(redisKey);

  if (alreadyKey) {
    return {
      thankCount:     question.thank_count,
      alreadyThanked: true,
      rabbiId:        question.assigned_rabbi_id,
    };
  }

  // Mark in Redis before the DB update to minimise race windows
  await redis.setEx(redisKey, 30 * 24 * 60 * 60, '1');

  const { rows: updatedRows } = await dbQuery(
    `UPDATE questions
     SET    thank_count = COALESCE(thank_count, 0) + 1,
            updated_at  = NOW()
     WHERE  id = $1
     RETURNING thank_count, assigned_rabbi_id`,
    [questionId]
  );

  const { thank_count, assigned_rabbi_id } = updatedRows[0];

  // Notify rabbi via socket — fire-and-forget
  if (assigned_rabbi_id) {
    _emitSafe('question:thankReceived', { questionId, thankCount: thank_count }, assigned_rabbi_id);
  }

  return {
    thankCount:     thank_count,
    alreadyThanked: false,
    rabbiId:        assigned_rabbi_id,
  };
}

// ─── getStats ─────────────────────────────────────────────────────────────────

/**
 * Aggregate statistics for the admin dashboard.
 *
 * @param {object} [filters]
 * @param {string} [filters.dateFrom] – ISO date string
 * @param {string} [filters.dateTo]   – ISO date string
 * @param {string} [filters.rabbiId]  – filter by specific rabbi
 * @returns {Promise<{
 *   byStatus:       { status: string, count: number }[],
 *   totalQuestions: number,
 *   totalAnswered:  number,
 *   totalPending:   number,
 *   totalInProcess: number,
 *   totalHidden:    number,
 *   totalThanks:    number,
 *   avgResponseTimeMinutes: number|null,
 *   urgentPending:  number,
 *   byCategory:     { category_id: string, category_name: string, count: number }[],
 *   topRabbis:      { rabbi_id: string, rabbi_name: string, answer_count: number }[],
 * }>}
 */
async function getStats(filters = {}) {
  const conditions = [];
  const params     = [];
  let paramIdx     = 1;

  if (filters.dateFrom) {
    conditions.push(`q.created_at >= $${paramIdx++}`);
    params.push(filters.dateFrom);
  }

  if (filters.dateTo) {
    conditions.push(`q.created_at <= $${paramIdx++}`);
    params.push(filters.dateTo);
  }

  if (filters.rabbiId) {
    conditions.push(`q.assigned_rabbi_id = $${paramIdx++}`);
    params.push(filters.rabbiId);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Status breakdown
  const statusResult = await dbQuery(
    `SELECT status, COUNT(*)::int AS count
     FROM   questions q
     ${whereClause}
     GROUP  BY status`,
    params
  );

  const byStatus = statusResult.rows;

  const totals = {
    totalQuestions: 0,
    totalAnswered:  0,
    totalPending:   0,
    totalInProcess: 0,
    totalHidden:    0,
  };

  for (const row of byStatus) {
    totals.totalQuestions += row.count;
    if (row.status === 'answered')   totals.totalAnswered  = row.count;
    if (row.status === 'pending')    totals.totalPending   = row.count;
    if (row.status === 'in_process') totals.totalInProcess = row.count;
    if (row.status === 'hidden')     totals.totalHidden    = row.count;
  }

  // Total thanks + avg response time
  const metricsResult = await dbQuery(
    `SELECT
       COALESCE(SUM(q.thank_count), 0)::int                           AS total_thanks,
       ROUND(
         AVG(EXTRACT(EPOCH FROM (a.created_at - q.created_at)) / 60.0)::numeric,
         1
       )                                                               AS avg_response_minutes
     FROM   questions q
     LEFT JOIN answers a ON a.question_id = q.id
     ${whereClause}`,
    params
  );

  const metrics = metricsResult.rows[0] || {};

  // Urgent pending
  const urgentResult = await dbQuery(
    `SELECT COUNT(*)::int AS count
     FROM   questions q
     ${whereClause ? whereClause + ' AND q.is_urgent = true AND q.status = \'pending\'' : 'WHERE q.is_urgent = true AND q.status = \'pending\''}`,
    params
  );

  // By category
  const categoryResult = await dbQuery(
    `SELECT q.category_id,
            COALESCE(c.name, 'לא מוגדר') AS category_name,
            COUNT(*)::int                 AS count
     FROM   questions q
     LEFT JOIN categories c ON c.id = q.category_id
     ${whereClause}
     GROUP  BY q.category_id, c.name
     ORDER  BY count DESC
     LIMIT  20`,
    params
  );

  // Top rabbis by answers
  const topRabbisResult = await dbQuery(
    `SELECT a.rabbi_id,
            r.name      AS rabbi_name,
            COUNT(*)::int AS answer_count
     FROM   answers  a
     JOIN   rabbis   r ON r.id = a.rabbi_id
     JOIN   questions q ON q.id = a.question_id
     ${whereClause}
     GROUP  BY a.rabbi_id, r.name
     ORDER  BY answer_count DESC
     LIMIT  10`,
    params
  );

  return {
    byStatus,
    ...totals,
    totalThanks:            metrics.total_thanks            || 0,
    avgResponseTimeMinutes: metrics.avg_response_minutes    || null,
    urgentPending:          urgentResult.rows[0]?.count     || 0,
    byCategory:             categoryResult.rows,
    topRabbis:              topRabbisResult.rows,
  };
}

// ─── markUrgent ───────────────────────────────────────────────────────────────

/**
 * Admin only: mark a question as urgent.
 *
 * @param {string} questionId
 * @returns {Promise<object>} – Updated question row
 * @throws {Error} 404 if not found
 */
async function markUrgent(questionId) {
  const { rows } = await dbQuery(
    `UPDATE questions
     SET    is_urgent  = true,
            updated_at = NOW()
     WHERE  id = $1
     RETURNING *`,
    [questionId]
  );

  if (rows.length === 0) {
    const err = new Error('שאלה לא נמצאה');
    err.status = 404;
    throw err;
  }

  // Broadcast urgent to all rabbis — fire-and-forget
  _emitSafe('question:urgent', { questionId, question: rows[0] }, null);

  return rows[0];
}

// ─── hideQuestion ─────────────────────────────────────────────────────────────

/**
 * Admin only: hide a question (status = 'hidden').
 *
 * @param {string}      questionId
 * @param {string|null} [reason]
 * @returns {Promise<object>} – Updated question row
 * @throws {Error} 404 if not found
 * @throws {Error} 400 if already hidden
 */
async function hideQuestion(questionId, reason) {
  const { rows: checkRows } = await dbQuery(
    `SELECT id, status FROM questions WHERE id = $1`,
    [questionId]
  );

  if (checkRows.length === 0) {
    const err = new Error('שאלה לא נמצאה');
    err.status = 404;
    throw err;
  }

  if (checkRows[0].status === 'hidden') {
    const err = new Error('השאלה כבר מוסתרת');
    err.status = 400;
    throw err;
  }

  const prevStatus = checkRows[0].status;

  const { rows } = await dbQuery(
    `UPDATE questions
     SET    status          = 'hidden',
            previous_status = $2,
            hide_reason     = $3,
            updated_at      = NOW()
     WHERE  id = $1
     RETURNING *`,
    [questionId, prevStatus, reason || null]
  );

  return rows[0];
}

// ─── incrementViewCount ───────────────────────────────────────────────────────

/**
 * Increment view_count for a question.
 * Fire-and-forget from the GET /:id route.
 *
 * @param {string} questionId
 * @returns {Promise<void>}
 */
async function incrementViewCount(questionId) {
  await dbQuery(
    `UPDATE questions
     SET    view_count = COALESCE(view_count, 0) + 1,
            updated_at = NOW()
     WHERE  id = $1`,
    [questionId]
  );
}

// ─── getFollowUp ──────────────────────────────────────────────────────────────

/**
 * Return the follow-up row for a question, or null if none exists.
 *
 * @param {string} questionId
 * @returns {Promise<object|null>}
 */
async function getFollowUp(questionId) {
  const { rows } = await dbQuery(
    `SELECT id, question_id, asker_content, rabbi_answer, created_at
     FROM   follow_up_questions
     WHERE  question_id = $1
     ORDER  BY created_at DESC
     LIMIT  1`,
    [questionId]
  );

  return rows[0] || null;
}

// ─── submitFollowUp ───────────────────────────────────────────────────────────

/**
 * Create a follow-up question submitted by the asker.
 *
 * Business rules:
 *   - question must be in answered status
 *   - follow_up_count must be < 1 (max one follow-up per question)
 *
 * @param {string} questionId
 * @param {string} content
 * @returns {Promise<object>} – Created follow_up_questions row
 * @throws {Error} 400 if follow-up limit reached or question not answered
 * @throws {Error} 404 if question not found
 */
async function submitFollowUp(questionId, content) {
  if (!content || !content.trim()) {
    const err = new Error('תוכן שאלת ההמשך נדרש');
    err.status = 400;
    throw err;
  }

  const { rows: qRows } = await dbQuery(
    `SELECT id, status, follow_up_count, assigned_rabbi_id
     FROM   questions
     WHERE  id = $1`,
    [questionId]
  );

  if (qRows.length === 0) {
    const err = new Error('שאלה לא נמצאה');
    err.status = 404;
    throw err;
  }

  const question = qRows[0];

  if (question.status !== 'answered') {
    const err = new Error('ניתן לשלוח שאלת המסך רק לשאלות שנענו');
    err.status = 400;
    throw err;
  }

  if ((question.follow_up_count || 0) >= 1) {
    const err = new Error('מותרת שאלת המשך אחת בלבד לכל שאלה');
    err.status = 400;
    throw err;
  }

  const sanitizedContent = sanitizeRichText(content);

  if (!sanitizedContent.trim()) {
    const err = new Error('תוכן שאלת ההמשך אינו יכול להיות ריק');
    err.status = 400;
    throw err;
  }

  const followUp = await withTransaction(async (client) => {
    const { rows: fuRows } = await client.query(
      `INSERT INTO follow_up_questions (question_id, asker_content, created_at)
       VALUES ($1, $2, NOW())
       RETURNING *`,
      [questionId, sanitizedContent]
    );

    await client.query(
      `UPDATE questions
       SET    follow_up_count = COALESCE(follow_up_count, 0) + 1,
              updated_at      = NOW()
       WHERE  id = $1`,
      [questionId]
    );

    return fuRows[0];
  });

  // Notify assigned rabbi — fire-and-forget
  if (question.assigned_rabbi_id) {
    _emitSafe('question:followUpReceived', { questionId, followUp }, question.assigned_rabbi_id);
  }

  return followUp;
}

// ─── submitFollowUpAnswer ─────────────────────────────────────────────────────

/**
 * Rabbi answers a follow-up question (alias that delegates to answerFollowUp).
 *
 * @param {string} questionId
 * @param {string} rabbiId
 * @param {string} content
 * @returns {Promise<object>}
 */
async function submitFollowUpAnswer(questionId, rabbiId, content) {
  return answerFollowUp(questionId, rabbiId, content);
}

// ─── scheduleThankNotification ────────────────────────────────────────────────

/**
 * Schedule a WhatsApp + email thank-you notification to the rabbi.
 * Fire-and-forget — callers do not await.
 *
 * @param {string}      questionId
 * @param {string|null} rabbiId
 * @returns {Promise<void>}
 */
async function scheduleThankNotification(questionId, rabbiId) {
  if (!rabbiId) return;

  const { rows } = await dbQuery(
    `SELECT r.email, r.name, q.title, q.wp_post_id, q.thank_count
     FROM   rabbis    r
     JOIN   questions q ON q.assigned_rabbi_id = r.id
     WHERE  r.id = $1 AND q.id = $2`,
    [rabbiId, questionId]
  );

  if (!rows[0]) return;

  const { email, name, title, wp_post_id, thank_count } = rows[0];
  const siteUrl     = (process.env.WP_SITE_URL || process.env.WP_API_URL || '')
    .replace(/\/wp-json.*$/, '').replace(/\/$/, '');
  const questionUrl = wp_post_id ? `${siteUrl}/question/${wp_post_id}` : '';

  let nodemailer;
  try { nodemailer = require('nodemailer'); } catch { return; }

  if (!email) return;

  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({
    from:    process.env.SMTP_FROM || '"ענה את השואל" <noreply@aneh-hashoel.co.il>',
    to:      email,
    subject: `קיבלת תודה על תשובתך — ${title}`,
    html: `<div dir="rtl" style="font-family: Arial, sans-serif;">
      <h2>שלום הרב ${name},</h2>
      <p>שואל שלח לך תודה על תשובתך לשאלה: <strong>${title}</strong></p>
      <p>סך הכל תודות לשאלה זו: <strong>${thank_count}</strong></p>
      ${questionUrl ? `<p><a href="${questionUrl}" style="color:#2563eb;">לצפייה בשאלה</a></p>` : ''}
      <p>בברכה,<br>צוות ענה את השואל</p>
    </div>`,
  }).catch((err) => {
    console.error('[questionService.scheduleThankNotification] שגיאה בשליחת אימייל תודה:', err.message);
  });
}

// ─── getRabbiStats ────────────────────────────────────────────────────────────

/**
 * Aggregated statistics for a rabbi.
 *
 * @param {string} rabbiId
 * @param {'week'|'month'|'all'} period
 * @returns {Promise<{
 *   totalAnswered: number,
 *   totalThanks: number,
 *   avgResponseTimeMinutes: number|null,
 *   byPeriod: object[],
 * }>}
 */
async function getRabbiStats(rabbiId, period) {
  let dateFilter = '';
  const params   = [rabbiId];

  if (period === 'week') {
    dateFilter = `AND q.answered_at >= NOW() - INTERVAL '7 days'`;
  } else if (period === 'month') {
    dateFilter = `AND q.answered_at >= NOW() - INTERVAL '30 days'`;
  }

  const totalsResult = await dbQuery(
    `SELECT
       COUNT(a.id)::int                                                      AS total_answered,
       COALESCE(SUM(q.thank_count), 0)::int                                  AS total_thanks,
       ROUND(
         AVG(EXTRACT(EPOCH FROM (a.created_at - q.created_at)) / 60.0)::numeric,
         1
       )                                                                      AS avg_response_minutes
     FROM   answers   a
     JOIN   questions q ON q.id = a.question_id
     WHERE  a.rabbi_id = $1
       ${dateFilter}`,
    params
  );

  const weekLimit  = period === 'week' ? 1 : period === 'month' ? 4 : 12;
  const statsResult = await dbQuery(
    `SELECT week_start::text, answers_count, views_count, thanks_count
     FROM   rabbi_stats
     WHERE  rabbi_id = $1
     ORDER  BY week_start DESC
     LIMIT  $2`,
    [rabbiId, weekLimit]
  );

  const totals = totalsResult.rows[0] || {};

  return {
    totalAnswered:          totals.total_answered          || 0,
    totalThanks:            totals.total_thanks            || 0,
    avgResponseTimeMinutes: totals.avg_response_minutes    || null,
    byPeriod:               statsResult.rows,
  };
}

// ─── getTopRabbi ──────────────────────────────────────────────────────────────

/**
 * Return the rabbi with the most answers for a given week.
 * Used by the rabbi-of-the-week cron job.
 *
 * @param {string} weekStart – ISO date string (Monday of the target week)
 * @returns {Promise<object|null>}
 */
async function getTopRabbi(weekStart) {
  const { rows } = await dbQuery(
    `SELECT rs.rabbi_id,
            rs.answers_count,
            rs.views_count,
            rs.thanks_count,
            r.name,
            r.email,
            r.photo_url
     FROM   rabbi_stats rs
     JOIN   rabbis      r ON r.id = rs.rabbi_id
     WHERE  rs.week_start = $1
     ORDER  BY rs.answers_count DESC, rs.thanks_count DESC
     LIMIT  1`,
    [weekStart]
  );

  return rows[0] || null;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Internal: safely emit a socket event to a specific rabbi room or broadcast.
 *
 * @param {string}      event    – Socket event name
 * @param {*}           data     – Payload
 * @param {string|null} rabbiId  – If set, emit to that rabbi's room; otherwise emitToAll
 */
function _emitSafe(event, data, rabbiId) {
  // io is stored on the global app — resolve lazily to avoid import-time issues
  try {
    const { emitToRabbi, emitToAll } = getSocketHelpers();
    // We need the io instance; fall back to the module-level cache populated by server.js
    const io = _getIO();
    if (!io) return;

    if (rabbiId) {
      emitToRabbi(io, String(rabbiId), event, data);
    } else {
      emitToAll(io, event, data);
    }
  } catch (err) {
    console.error(`[questionService._emitSafe] שגיאה ב-emit "${event}":`, err.message);
  }
}

/**
 * Resolve the socket.io server instance stored on the Express app.
 * Services don't have access to the app object directly; this module expects
 * server.js to call `questionService.setIO(app.get('io'))` after startup,
 * OR the caller passes io explicitly (e.g. checkTimeouts(io)).
 *
 * Returns null if not yet initialised.
 *
 * @returns {import('socket.io').Server|null}
 */
let _io = null;
function _getIO() {
  return _io;
}

/**
 * Store the io instance for use by `_emitSafe`.
 * Call once from server.js after `const io = require('socket.io')(server)`.
 *
 * @param {import('socket.io').Server} io
 */
function setIO(io) {
  _io = io;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Core question operations
  claimQuestion,
  releaseQuestion,
  transferQuestion,
  submitAnswer,
  editAnswer,

  // Follow-up operations
  answerFollowUp,
  getFollowUp,
  submitFollowUp,
  submitFollowUpAnswer,

  // Cron helpers
  checkTimeouts,
  sendTimeoutWarnings,

  // Thank / view tracking
  incrementThankCount,
  incrementViewCount,
  scheduleThankNotification,

  // Stats / admin
  getStats,
  markUrgent,
  hideQuestion,

  // Rabbi stats / gamification
  getRabbiStats,
  getTopRabbi,

  // IO registration
  setIO,
};
