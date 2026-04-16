'use strict';

/**
 * Admin Question Management Routes  –  /admin/questions/*
 *
 * All routes require authenticate + requireAdmin.
 *
 * GET  /                   – all questions with full filters
 * PUT  /:id/status         – force change a question's status
 * PUT  /:id/assign         – force assign a question to a rabbi
 * POST /bulk               – bulk actions (hide | release | assign)
 * GET  /export             – export filtered questions to CSV
 *
 * Depends on:
 *   middleware/authenticate  – authenticate, requireAdmin
 *   middleware/auditLog      – logAction, ACTIONS
 *   services/analyticsService – exportQuestions
 *   db/pool                  – query
 */

const express = require('express');
const { stringify: csvStringify } = require('csv-stringify/sync');

const { authenticate, requireAdmin } = require('../../middleware/authenticate');
const { logAction, ACTIONS }         = require('../../middleware/auditLog');
const analyticsService               = require('../../services/analyticsService');
const { query: dbQuery, withTransaction } = require('../../db/pool');

const router = express.Router();

// ─── Auth guard ───────────────────────────────────────────────────────────────
router.use(authenticate, requireAdmin);

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_STATUSES = ['pending', 'in_process', 'answered', 'hidden'];
const BULK_ACTIONS   = ['hide', 'release', 'assign', 'delete'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.ip ||
    null
  );
}

// ─── GET / ────────────────────────────────────────────────────────────────────

/**
 * GET /admin/questions
 *
 * All questions with full admin filters.
 *
 * Query params:
 *   status    – pending | in_process | answered | hidden
 *   category  – category UUID
 *   rabbi     – rabbi UUID (assigned_rabbi_id)
 *   dateFrom  – ISO date string
 *   dateTo    – ISO date string
 *   search    – full-text search on title + content (ILIKE)
 *   isUrgent  – 'true' / 'false'
 *   page      – default 1
 *   limit     – default 50, max 200
 *
 * Response: { ok, questions: [...], total, page, limit }
 */
router.get('/', async (req, res) => {
  try {
    const conditions = [];
    const params     = [];
    let   idx        = 0;

    if (req.query.status) {
      if (!VALID_STATUSES.includes(req.query.status)) {
        return res.status(400).json({
          error: `סטטוס לא חוקי. ערכים אפשריים: ${VALID_STATUSES.join(', ')}`,
        });
      }
      conditions.push(`q.status = $${++idx}`);
      params.push(req.query.status);
    }

    if (req.query.category) {
      conditions.push(`q.category_id = $${++idx}`);
      params.push(req.query.category);
    }

    if (req.query.rabbi) {
      conditions.push(`q.assigned_rabbi_id = $${++idx}`);
      params.push(req.query.rabbi);
    }

    if (req.query.dateFrom) {
      conditions.push(`q.created_at >= $${++idx}`);
      params.push(req.query.dateFrom);
    }

    if (req.query.dateTo) {
      conditions.push(`q.created_at <= $${++idx}`);
      params.push(req.query.dateTo);
    }

    if (req.query.search) {
      conditions.push(`(q.title ILIKE $${++idx} OR q.content ILIKE $${idx})`);
      params.push(`%${req.query.search}%`);
    }

    if (req.query.isUrgent === 'true') {
      conditions.push(`q.urgency = 'urgent'`);
    } else if (req.query.isUrgent === 'false') {
      conditions.push(`q.urgency != 'urgent'`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total for pagination
    const { rows: countRows } = await dbQuery(
      `SELECT COUNT(*)::int AS total FROM questions q ${where}`,
      params
    );
    const total  = countRows[0].total;
    const page   = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const listParams = [...params, limit, offset];

    const { rows: questions } = await dbQuery(
      `SELECT
         q.id,
         q.wp_post_id,
         q.question_number,
         q.title,
         q.content,
         q.status,
         q.urgency,
         q.flagged,
         q.flag_reason,
         q.hidden_reason,
         q.thank_count,
         q.view_count,
         q.created_at,
         q.answered_at,
         q.wp_synced_at,
         q.lock_timestamp,
         c.id    AS category_id,
         c.name  AS category_name,
         c.color AS category_color,
         r.id    AS rabbi_id,
         r.name  AS rabbi_name,
         r.email AS rabbi_email
       FROM   questions q
       LEFT JOIN categories c ON c.id = q.category_id
       LEFT JOIN rabbis     r ON r.id = q.assigned_rabbi_id
       ${where}
       ORDER  BY q.created_at DESC
       LIMIT  $${++idx} OFFSET $${++idx}`,
      listParams
    );

    return res.json({ ok: true, questions, total, page, limit });
  } catch (err) {
    console.error('[admin/questions] GET / error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// ─── PUT /:id/status ──────────────────────────────────────────────────────────

/**
 * PUT /admin/questions/:id/status
 *
 * Force change a question's status.
 *
 * Body: {
 *   status:  'pending' | 'in_process' | 'answered' | 'hidden',
 *   reason?: string  (required when hiding)
 * }
 *
 * Response: { ok, question: { id, status, ... } }
 */
router.put('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `סטטוס נדרש. ערכים אפשריים: ${VALID_STATUSES.join(', ')}`,
      });
    }

    if (status === 'hidden' && !reason) {
      return res.status(400).json({ error: 'סיבת הסתרה נדרשת' });
    }

    // Fetch current state
    const { rows: existing } = await dbQuery(
      'SELECT id, status, hidden_reason FROM questions WHERE id = $1',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: 'שאלה לא נמצאה' });
    }

    const oldStatus = existing[0].status;

    let updateSql;
    let updateParams;

    if (status === 'hidden') {
      updateSql    = `UPDATE questions SET status = $1, hidden_reason = $2, updated_at = NOW()
                      WHERE id = $3
                      RETURNING id, status, hidden_reason, updated_at`;
      updateParams = [status, reason, id];
    } else if (status === 'pending') {
      // Releasing back to queue clears assignment and lock
      updateSql    = `UPDATE questions
                      SET status = $1, assigned_rabbi_id = NULL, lock_timestamp = NULL,
                          hidden_reason = NULL, updated_at = NOW()
                      WHERE id = $2
                      RETURNING id, status, updated_at`;
      updateParams = [status, id];
    } else {
      updateSql    = `UPDATE questions SET status = $1, updated_at = NOW()
                      WHERE id = $2
                      RETURNING id, status, updated_at`;
      updateParams = [status, id];
    }

    const { rows: updated } = await dbQuery(updateSql, updateParams);

    await logAction(
      req.rabbi.id,
      status === 'hidden' ? ACTIONS.QUESTION_HIDDEN : 'question.status_forced',
      'question',
      id,
      { status: oldStatus },
      { status, reason: reason || null },
      getIp(req),
      req.headers['user-agent'] || null
    );

    return res.json({ ok: true, question: updated[0] });
  } catch (err) {
    console.error('[admin/questions] PUT /:id/status error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// ─── PUT /:id/title ──────────────────────────────────────────────────────────

/**
 * PUT /admin/questions/:id/title
 * Update the question title. Also syncs title to WordPress (fire-and-forget).
 * Body: { title: string }
 */
router.put('/:id/title', async (req, res) => {
  try {
    const { id } = req.params;
    const { title } = req.body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'כותרת נדרשת' });
    }
    const trimmed = title.trim().slice(0, 500);

    const { rows: existing } = await dbQuery(
      'SELECT id, title, wp_post_id FROM questions WHERE id = $1',
      [id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'שאלה לא נמצאה' });
    }

    const { rows: updated } = await dbQuery(
      'UPDATE questions SET title = $1, updated_at = NOW() WHERE id = $2 RETURNING id, title, wp_post_id',
      [trimmed, id]
    );

    // Fire-and-forget: sync title to WP post
    const wpPostId = updated[0]?.wp_post_id;
    if (wpPostId && process.env.WP_API_URL && process.env.WP_API_KEY) {
      setImmediate(async () => {
        try {
          const axios = require('axios');
          const cred = Buffer.from(process.env.WP_API_KEY).toString('base64');
          await axios.post(
            `${process.env.WP_API_URL}/ask-rabai/${wpPostId}`,
            { title: trimmed },
            { headers: { Authorization: `Basic ${cred}`, 'Content-Type': 'application/json' }, timeout: 10000 }
          );
        } catch (wpErr) {
          console.warn('[admin/questions] WP title sync failed:', wpErr.message);
        }
      });
    }

    await logAction(
      req.rabbi.id, ACTIONS.QUESTION_EDITED, 'question', id,
      { title: existing[0].title }, { title: trimmed }, getIp(req)
    );

    return res.json({ ok: true, question: updated[0] });
  } catch (err) {
    console.error('[admin/questions] PUT /:id/title error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// ─── PUT /:id/assign ──────────────────────────────────────────────────────────

/**
 * PUT /admin/questions/:id/assign
 *
 * Force assign a question to a specific rabbi.
 * Sets status to 'in_process' and stamps lock_timestamp.
 *
 * Body: {
 *   rabbiId: string  (UUID)
 * }
 *
 * Response: { ok, question: { id, status, assigned_rabbi_id, ... } }
 */
router.put('/:id/assign', async (req, res) => {
  try {
    const { id }      = req.params;
    const { rabbiId } = req.body;

    if (!rabbiId) {
      return res.status(400).json({ error: 'מזהה רב נדרש' });
    }

    // Verify question exists
    const { rows: qRows } = await dbQuery(
      'SELECT id, status, assigned_rabbi_id FROM questions WHERE id = $1',
      [id]
    );
    if (qRows.length === 0) {
      return res.status(404).json({ error: 'שאלה לא נמצאה' });
    }

    // Verify target rabbi is active
    const { rows: rRows } = await dbQuery(
      'SELECT id, name FROM rabbis WHERE id = $1 AND is_active = TRUE',
      [rabbiId]
    );
    if (rRows.length === 0) {
      return res.status(404).json({ error: 'הרב המבוקש לא נמצא או לא פעיל' });
    }

    const { rows: updated } = await dbQuery(
      `UPDATE questions
       SET status = 'in_process',
           assigned_rabbi_id = $1,
           lock_timestamp = NOW(),
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, status, assigned_rabbi_id, lock_timestamp, updated_at`,
      [rabbiId, id]
    );

    await logAction(
      req.rabbi.id,
      ACTIONS.QUESTION_REASSIGNED,
      'question',
      id,
      { assigned_rabbi_id: qRows[0].assigned_rabbi_id, status: qRows[0].status },
      { assigned_rabbi_id: rabbiId, status: 'in_process' },
      getIp(req),
      req.headers['user-agent'] || null
    );

    return res.json({
      ok:       true,
      question: updated[0],
      rabbi:    { id: rRows[0].id, name: rRows[0].name },
    });
  } catch (err) {
    console.error('[admin/questions] PUT /:id/assign error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────

/**
 * DELETE /admin/questions/:id
 *
 * Permanently delete a question and all its related data.
 * Uses a transaction to ensure atomicity.
 *
 * Response: { ok, message }
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Verify question exists
    const { rows: existing } = await dbQuery(
      'SELECT id, title, status FROM questions WHERE id = $1',
      [id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'שאלה לא נמצאה' });
    }

    const question = existing[0];

    await withTransaction(async (client) => {
      // 1. Delete answers
      await client.query('DELETE FROM answers WHERE question_id = $1', [id]);

      // 2. Delete private notes
      await client.query('DELETE FROM private_notes WHERE question_id = $1', [id]);

      // 3. Delete discussion messages & members for discussions of this question
      const { rows: discussions } = await client.query(
        'SELECT id FROM discussions WHERE question_id = $1', [id]
      );
      if (discussions.length > 0) {
        const discIds = discussions.map(d => d.id);
        await client.query('DELETE FROM discussion_messages WHERE discussion_id = ANY($1::uuid[])', [discIds]);
        await client.query('DELETE FROM discussion_members WHERE discussion_id = ANY($1::uuid[])', [discIds]);
        await client.query('DELETE FROM discussions WHERE question_id = $1', [id]);
      }

      // 4. Delete notifications log entries
      await client.query(
        `DELETE FROM notifications_log WHERE entity_id = $1`,
        [id]
      );

      // 5. Delete the question itself
      await client.query('DELETE FROM questions WHERE id = $1', [id]);
    });

    await logAction(
      req.rabbi.id,
      ACTIONS.QUESTION_DELETED,
      'question',
      id,
      { title: question.title, status: question.status },
      null,
      getIp(req),
      req.headers['user-agent'] || null
    );

    return res.json({ ok: true, message: 'השאלה נמחקה לצמיתות' });
  } catch (err) {
    console.error('[admin/questions] DELETE /:id error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// ─── POST /bulk ───────────────────────────────────────────────────────────────

/**
 * POST /admin/questions/bulk
 *
 * Perform a bulk action on multiple questions at once.
 *
 * Body: {
 *   questionIds: string[]  (required, max 500)
 *   action:      'hide' | 'release' | 'assign'
 *   targetRabbiId?: string  (required when action === 'assign')
 * }
 *
 * Response: { ok, updatedCount }
 */
router.post('/bulk', async (req, res) => {
  try {
    const { questionIds, action, targetRabbiId } = req.body;

    if (!action || !BULK_ACTIONS.includes(action)) {
      return res.status(400).json({
        error: `פעולה לא חוקית. ערכים אפשריים: ${BULK_ACTIONS.join(', ')}`,
      });
    }

    if (!Array.isArray(questionIds) || questionIds.length === 0) {
      return res.status(400).json({ error: 'questionIds נדרש כמערך לא ריק' });
    }

    if (questionIds.length > 500) {
      return res.status(400).json({ error: 'לא ניתן לעבד יותר מ-500 שאלות בבת-אחת' });
    }

    if (action === 'assign' && !targetRabbiId) {
      return res.status(400).json({ error: 'targetRabbiId נדרש לפעולת הקצאה' });
    }

    let updateSql;
    let updateParams;

    switch (action) {
      case 'hide':
        updateSql    = `UPDATE questions SET status = 'hidden', updated_at = NOW()
                        WHERE id = ANY($1::uuid[])`;
        updateParams = [questionIds];
        break;

      case 'release':
        updateSql    = `UPDATE questions
                        SET status = 'pending',
                            assigned_rabbi_id = NULL,
                            lock_timestamp = NULL,
                            updated_at = NOW()
                        WHERE id = ANY($1::uuid[])`;
        updateParams = [questionIds];
        break;

      case 'assign': {
        // Verify rabbi
        const { rows: rRows } = await dbQuery(
          'SELECT id FROM rabbis WHERE id = $1 AND is_active = TRUE',
          [targetRabbiId]
        );
        if (rRows.length === 0) {
          return res.status(404).json({ error: 'הרב המבוקש לא נמצא או לא פעיל' });
        }
        updateSql    = `UPDATE questions
                        SET status = 'in_process',
                            assigned_rabbi_id = $1,
                            lock_timestamp = NOW(),
                            updated_at = NOW()
                        WHERE id = ANY($2::uuid[])`;
        updateParams = [targetRabbiId, questionIds];
        break;
      }

      case 'delete': {
        // Permanently delete questions and all related data
        await withTransaction(async (client) => {
          // Delete answers
          await client.query('DELETE FROM answers WHERE question_id = ANY($1::uuid[])', [questionIds]);
          // Delete private notes
          await client.query('DELETE FROM private_notes WHERE question_id = ANY($1::uuid[])', [questionIds]);
          // Delete discussion data
          const { rows: discussions } = await client.query(
            'SELECT id FROM discussions WHERE question_id = ANY($1::uuid[])', [questionIds]
          );
          if (discussions.length > 0) {
            const discIds = discussions.map(d => d.id);
            await client.query('DELETE FROM discussion_messages WHERE discussion_id = ANY($1::uuid[])', [discIds]);
            await client.query('DELETE FROM discussion_members WHERE discussion_id = ANY($1::uuid[])', [discIds]);
            await client.query('DELETE FROM discussions WHERE question_id = ANY($1::uuid[])', [questionIds]);
          }
          // Delete notifications
          await client.query('DELETE FROM notifications_log WHERE entity_id = ANY($1::text[])',
            [questionIds.map(String)]);
          // Delete questions
          await client.query('DELETE FROM questions WHERE id = ANY($1::uuid[])', [questionIds]);
        });

        await logAction(
          req.rabbi.id,
          'admin.bulk_action',
          'question',
          null,
          null,
          { action, questionIds, deletedCount: questionIds.length },
          getIp(req),
          req.headers['user-agent'] || null
        );

        return res.json({ ok: true, updatedCount: questionIds.length });
      }
    }

    const result = await dbQuery(updateSql, updateParams);

    await logAction(
      req.rabbi.id,
      'admin.bulk_action',
      'question',
      null,
      null,
      { action, questionIds, targetRabbiId: targetRabbiId || null, updatedCount: result.rowCount },
      getIp(req),
      req.headers['user-agent'] || null
    );

    return res.json({ ok: true, updatedCount: result.rowCount });
  } catch (err) {
    console.error('[admin/questions] POST /bulk error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// ─── GET /export ──────────────────────────────────────────────────────────────

/**
 * GET /admin/questions/export
 *
 * Export filtered questions to CSV (UTF-8 BOM, Hebrew headers).
 *
 * Query params: (same filter keys as GET /)
 *   status, category, rabbi, dateFrom, dateTo, search, isUrgent, format (csv|json)
 *
 * Response: CSV or JSON file attachment.
 */
router.get('/export', async (req, res) => {
  try {
    const filters = {
      status:     req.query.status     || null,
      categoryId: req.query.category   || null,
      rabbiId:    req.query.rabbi      || null,
      dateFrom:   req.query.dateFrom   || null,
      dateTo:     req.query.dateTo     || null,
      search:     req.query.search     || null,
      isUrgent:   req.query.isUrgent === 'true' ? true
                : req.query.isUrgent === 'false' ? false
                : null,
    };

    const format = req.query.format === 'json' ? 'json' : 'csv';
    const data   = await analyticsService.exportQuestions(filters);

    await logAction(
      req.rabbi.id,
      ACTIONS.ADMIN_BULK_EXPORT,
      'question',
      null,
      null,
      { format, filters, count: data.length },
      getIp(req),
      req.headers['user-agent'] || null
    );

    const timestamp = Date.now();

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="questions_${timestamp}.json"`);
      return res.json(data);
    }

    // CSV with Hebrew headers
    const csvOutput = csvStringify(data, {
      header:  true,
      columns: [
        { key: 'id',             header: 'מזהה' },
        { key: 'title',          header: 'כותרת' },
        { key: 'status',         header: 'סטטוס' },
        { key: 'urgency',        header: 'דחיפות' },
        { key: 'category_name',  header: 'קטגוריה' },
        { key: 'rabbi_name',     header: 'רב מענה' },
        { key: 'created_at',     header: 'תאריך שאלה' },
        { key: 'answered_at',    header: 'תאריך תשובה' },
        { key: 'response_hours', header: 'זמן מענה (שעות)' },
        { key: 'thank_count',    header: 'תודות' },
        { key: 'view_count',     header: 'צפיות' },
        { key: 'content',        header: 'תוכן שאלה' },
        { key: 'answer_content', header: 'תוכן תשובה' },
      ],
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="questions_${timestamp}.csv"`);
    // BOM for correct Hebrew rendering in Excel
    return res.send('\uFEFF' + csvOutput);
  } catch (err) {
    console.error('[admin/questions] GET /export error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

module.exports = router;
