'use strict';

/**
 * Admin Router  –  /admin/*
 *
 * All routes require authentication + admin role.
 *
 * Depends on:
 *   middleware/authenticate   – authenticate, requireAdmin
 *   middleware/auditLog       – logAction, ACTIONS
 *   services/admin            – getAllRabbis, createRabbi, updateRabbi,
 *                               getSystemConfig, updateSystemConfig,
 *                               getAuditLog, bulkUpdateQuestions, sendBroadcast
 *   services/analyticsService – getDashboardStats, getQuestionsTimeSeries,
 *                               getRabbiPerformance, getCategoryBreakdown,
 *                               exportQuestions
 *   services/wordpress        – retryFailedSyncs
 *   db/pool                   – query
 */

const express = require('express');
const { stringify: csvStringify } = require('csv-stringify/sync');

const { authenticate, requireAdmin } = require('../middleware/authenticate');
const { logAction, ACTIONS }         = require('../middleware/auditLog');
const adminService                   = require('../services/admin');
const analyticsService               = require('../services/analyticsService');
const { retryFailedSyncs }           = require('../services/wordpress');
const { query: dbQuery }             = require('../db/pool');
const systemSettings                 = require('../config/systemSettings');

const router = express.Router();

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

// ─── Helper ──────────────────────────────────────────────────────────────────

function getIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.ip ||
    null
  );
}

// =============================================================================
// DASHBOARD
// =============================================================================

/**
 * GET /admin/dashboard
 * Main stats: total questions by status, questions today/week/month,
 * avg response time, top rabbis this week, pending count,
 * active discussions count, online rabbis count.
 */
router.get('/dashboard', async (req, res) => {
  try {
    const stats = await analyticsService.getDashboardStats();
    return res.json({ ok: true, data: stats });
  } catch (err) {
    console.error('[admin] /dashboard error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// Alias: frontend calls /admin/dashboard/stats
router.get('/dashboard/stats', async (req, res) => {
  try {
    const stats = await analyticsService.getDashboardStats();
    return res.json({ ok: true, data: stats });
  } catch (err) {
    console.error('[admin] /dashboard/stats error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// =============================================================================
// ANALYTICS
// =============================================================================

/**
 * GET /admin/analytics/questions
 * Time-series data for the last N days, category breakdown, status breakdown.
 * Query params: days (default 30)
 */
router.get('/analytics/questions', async (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    const [timeSeries, categoryBreakdown, statusBreakdown] = await Promise.all([
      analyticsService.getQuestionsTimeSeries(days),
      analyticsService.getCategoryBreakdown(),
      analyticsService.getStatusBreakdown(),
    ]);

    return res.json({
      ok: true,
      data: {
        timeSeries,
        categoryBreakdown,
        statusBreakdown,
        periodDays: days,
      },
    });
  } catch (err) {
    console.error('[admin] /analytics/questions error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

/**
 * GET /admin/analytics/rabbis
 * Rabbi performance table: answers, avg time, thanks, last active.
 * Query params: period (week|month|all, default: month)
 */
router.get('/analytics/rabbis', async (req, res) => {
  try {
    const period = ['week', 'month', 'all'].includes(req.query.period)
      ? req.query.period
      : 'month';

    const data = await analyticsService.getRabbiPerformance(period);
    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[admin] /analytics/rabbis error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

/**
 * GET /admin/analytics/categories
 * Category activity: question count, avg response time per category.
 */
router.get('/analytics/categories', async (req, res) => {
  try {
    const data = await analyticsService.getCategoryAnalytics();
    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[admin] /analytics/categories error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// =============================================================================
// RABBI MANAGEMENT
// =============================================================================

/**
 * GET /admin/rabbis
 * Full rabbi list with optional filters.
 * Query params: role, active, search, group, page, limit
 */
router.get('/rabbis', async (req, res) => {
  try {
    const result = await adminService.getAllRabbis({
      role:   req.query.role,
      active: req.query.active,
      search: req.query.search,
      group:  req.query.group,
      page:   req.query.page,
      limit:  req.query.limit,
    });

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[admin] GET /rabbis error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

/**
 * POST /admin/rabbis
 * Create a new rabbi account. Sends setup email with temporary password.
 * Body: { name, email, role }
 */
router.post('/rabbis', async (req, res) => {
  try {
    const { name, email, role } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'שם ואימייל נדרשים' });
    }

    const validRoles = ['rabbi', 'senior', 'admin'];
    const resolvedRole = validRoles.includes(role) ? role : 'rabbi';

    const rabbi = await adminService.createRabbi({
      name,
      email,
      role:    resolvedRole,
      adminId: req.rabbi.id,
      ip:      getIp(req),
    });

    return res.status(201).json({ ok: true, rabbi });
  } catch (err) {
    console.error('[admin] POST /rabbis error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

/**
 * PATCH /admin/rabbis/:id
 * Update rabbi fields: name, email, phone, display_name, role, isActive.
 */
router.patch('/rabbis/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone, display_name, role, isActive } = req.body;

    const { rows } = await dbQuery('SELECT id FROM rabbis WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'רב לא נמצא' });

    const fields = [];
    const vals = [];
    let idx = 1;

    if (name !== undefined)         { fields.push(`name = $${idx++}`);         vals.push(name); }
    if (email !== undefined)        { fields.push(`email = $${idx++}`);        vals.push(email); }
    if (phone !== undefined)        { fields.push(`phone = $${idx++}`);        vals.push(phone); }
    if (display_name !== undefined) { fields.push(`display_name = $${idx++}`); vals.push(display_name); }
    if (role !== undefined)         { fields.push(`role = $${idx++}`);         vals.push(role); }
    if (isActive !== undefined)     { fields.push(`is_active = $${idx++}`);    vals.push(Boolean(isActive)); }

    if (!fields.length) return res.status(400).json({ error: 'אין שדות לעדכון' });

    vals.push(id);
    const { rows: updated } = await dbQuery(
      `UPDATE rabbis SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${idx}
       RETURNING id, name, email, phone, display_name, role, is_active`,
      vals
    );

    return res.json({ ok: true, rabbi: updated[0] });
  } catch (err) {
    console.error('[admin] PATCH /rabbis/:id error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

/**
 * PUT /admin/rabbis/:id/toggle-status
 * Activate or deactivate a rabbi.
 * Body: { active: boolean }  — or infer from current state when omitted.
 */
router.put('/rabbis/:id/toggle-status', async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch current state
    const { rows } = await dbQuery(
      'SELECT id, is_active FROM rabbis WHERE id = $1',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'רב לא נמצא' });
    }

    const currentActive = rows[0].is_active;
    // If body explicitly sets `active`, use it; otherwise toggle
    const newActive = req.body.active !== undefined
      ? Boolean(req.body.active)
      : !currentActive;

    if (newActive === currentActive) {
      return res.status(400).json({
        error: `הרב כבר ${newActive ? 'פעיל' : 'מושבת'}`,
      });
    }

    if (!newActive) {
      // Deactivate path — use existing service (handles reassignment)
      const result = await adminService.deleteRabbi(id, req.rabbi.id, getIp(req));
      return res.json({ ok: true, ...result, is_active: false });
    }

    // Activate path
    const { rows: updated } = await dbQuery(
      `UPDATE rabbis SET is_active = true
       WHERE id = $1
       RETURNING id, name, email, is_active`,
      [id]
    );

    await logAction(
      req.rabbi.id,
      ACTIONS.RABBI_REACTIVATED,
      'rabbi',
      id,
      { is_active: false },
      { is_active: true },
      getIp(req),
      null
    );

    return res.json({ ok: true, rabbi: updated[0] });
  } catch (err) {
    console.error('[admin] PUT /rabbis/:id/toggle-status error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// =============================================================================
// QUESTION MANAGEMENT
// =============================================================================

/**
 * GET /admin/questions
 * All questions with full filters.
 * Query params: status, categoryId, rabbiId, urgency, search,
 *               dateFrom, dateTo, page, limit
 */
router.get('/questions', async (req, res) => {
  try {
    const conditions = [];
    const params     = [];
    let   idx        = 0;

    if (req.query.status) {
      const validStatuses = ['pending', 'in_process', 'answered', 'hidden'];
      if (!validStatuses.includes(req.query.status)) {
        return res.status(400).json({ error: 'סטטוס לא חוקי' });
      }
      conditions.push(`q.status = $${++idx}`);
      params.push(req.query.status);
    }

    if (req.query.categoryId) {
      conditions.push(`q.category_id = $${++idx}`);
      params.push(req.query.categoryId);
    }

    if (req.query.rabbiId) {
      conditions.push(`q.assigned_rabbi_id = $${++idx}`);
      params.push(req.query.rabbiId);
    }

    if (req.query.urgency) {
      conditions.push(`q.urgency = $${++idx}`);
      params.push(req.query.urgency);
    }

    if (req.query.search) {
      conditions.push(`(q.title ILIKE $${++idx} OR q.content ILIKE $${idx})`);
      params.push(`%${req.query.search}%`);
    }

    if (req.query.dateFrom) {
      conditions.push(`q.created_at >= $${++idx}`);
      params.push(req.query.dateFrom);
    }

    if (req.query.dateTo) {
      conditions.push(`q.created_at <= $${++idx}`);
      params.push(req.query.dateTo);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    // Count
    const countResult = await dbQuery(
      `SELECT COUNT(*)::int AS total FROM questions q ${whereClause}`,
      params
    );
    const total = countResult.rows[0].total;

    const page   = Math.max(1, parseInt(req.query.page, 10)  || 1);
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const listParams = [...params, limit, offset];

    const { rows: questions } = await dbQuery(
      `SELECT q.id, q.wp_post_id, q.title, q.status, q.urgency,
              q.flagged, q.flag_reason, q.hidden_reason,
              q.view_count, q.thank_count,
              q.created_at, q.answered_at, q.wp_synced_at,
              c.name  AS category_name,
              r.name  AS rabbi_name,
              r.id    AS rabbi_id
       FROM   questions q
       LEFT JOIN categories c ON c.id = q.category_id
       LEFT JOIN rabbis     r ON r.id = q.assigned_rabbi_id
       ${whereClause}
       ORDER BY q.created_at DESC
       LIMIT $${++idx} OFFSET $${++idx}`,
      listParams
    );

    return res.json({ ok: true, questions, total, page, limit });
  } catch (err) {
    console.error('[admin] GET /questions error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

/**
 * PATCH /admin/questions/:id
 * Update a single question's status or assigned rabbi.
 * Body: { status?, assignedRabbiId? }
 */
router.patch('/questions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, assignedRabbiId } = req.body;

    const validStatuses = ['pending', 'in_process', 'answered', 'hidden'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'סטטוס לא חוקי' });
    }

    const { rows } = await dbQuery('SELECT id FROM questions WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'שאלה לא נמצאה' });

    const fields = [];
    const vals   = [];
    let   idx    = 1;

    if (status !== undefined) {
      fields.push(`status = $${idx++}`);
      vals.push(status);
    }
    if (assignedRabbiId !== undefined) {
      fields.push(`assigned_rabbi_id = $${idx++}`);
      vals.push(assignedRabbiId || null);
    }

    if (!fields.length) return res.status(400).json({ error: 'אין שדות לעדכון' });

    vals.push(id);
    const { rows: updated } = await dbQuery(
      `UPDATE questions SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${idx}
       RETURNING id, status, assigned_rabbi_id`,
      vals
    );

    return res.json({ ok: true, question: updated[0] });
  } catch (err) {
    console.error('[admin] PATCH /questions/:id error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

/**
 * POST /admin/questions/bulk
 * Bulk actions on questions.
 * Body: { action: 'hide'|'reopen'|'reassign', questionIds: string[], targetRabbiId?: string }
 */
router.post('/questions/bulk', async (req, res) => {
  try {
    const { action, questionIds, targetRabbiId } = req.body;

    if (!action || !Array.isArray(questionIds) || questionIds.length === 0) {
      return res.status(400).json({ error: 'action ו-questionIds נדרשים' });
    }

    const validActions = ['hide', 'reopen', 'reassign'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ error: `פעולה לא חוקית. ערכים אפשריים: ${validActions.join(', ')}` });
    }

    if (action === 'reassign' && !targetRabbiId) {
      return res.status(400).json({ error: 'targetRabbiId נדרש לפעולת הקצאה מחדש' });
    }

    let updateSql;
    let updateParams;

    if (action === 'hide') {
      updateSql    = `UPDATE questions SET status = 'hidden' WHERE id = ANY($1)`;
      updateParams = [questionIds];
    } else if (action === 'reopen') {
      updateSql    = `UPDATE questions SET status = 'pending', assigned_rabbi_id = NULL, lock_timestamp = NULL WHERE id = ANY($1)`;
      updateParams = [questionIds];
    } else if (action === 'reassign') {
      // Verify target rabbi exists and is active
      const { rows: rabbiCheck } = await dbQuery(
        'SELECT id FROM rabbis WHERE id = $1 AND is_active = true',
        [targetRabbiId]
      );
      if (rabbiCheck.length === 0) {
        return res.status(404).json({ error: 'הרב המבוקש לא נמצא או לא פעיל' });
      }
      updateSql    = `UPDATE questions SET assigned_rabbi_id = $1, status = 'in_process', lock_timestamp = NOW() WHERE id = ANY($2)`;
      updateParams = [targetRabbiId, questionIds];
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
      null
    );

    return res.json({ ok: true, updatedCount: result.rowCount });
  } catch (err) {
    console.error('[admin] POST /questions/bulk error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

/**
 * GET /admin/questions/export
 * Export questions+answers to CSV or JSON.
 * Query params: dateFrom, dateTo, status, categoryId, format (csv|json, default: csv)
 */
router.get('/questions/export', async (req, res) => {
  try {
    const filters = {
      dateFrom:   req.query.dateFrom   || null,
      dateTo:     req.query.dateTo     || null,
      status:     req.query.status     || null,
      categoryId: req.query.categoryId || null,
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
      null
    );

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="questions_export_${Date.now()}.json"`
      );
      return res.json(data);
    }

    // CSV
    const csvOutput = csvStringify(data, {
      header:  true,
      columns: [
        { key: 'id',            header: 'מזהה' },
        { key: 'title',         header: 'כותרת' },
        { key: 'status',        header: 'סטטוס' },
        { key: 'urgency',       header: 'דחיפות' },
        { key: 'category_name', header: 'קטגוריה' },
        { key: 'rabbi_name',    header: 'רב מענה' },
        { key: 'created_at',    header: 'תאריך שאלה' },
        { key: 'answered_at',   header: 'תאריך תשובה' },
        { key: 'response_hours',header: 'זמן מענה (שעות)' },
        { key: 'thank_count',   header: 'תודות' },
        { key: 'view_count',    header: 'צפיות' },
        { key: 'content',       header: 'תוכן שאלה' },
        { key: 'answer_content',header: 'תוכן תשובה' },
      ],
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="questions_export_${Date.now()}.csv"`
    );
    // BOM for proper Hebrew rendering in Excel
    return res.send('\uFEFF' + csvOutput);
  } catch (err) {
    console.error('[admin] GET /questions/export error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// =============================================================================
// AUDIT LOG
// =============================================================================

/**
 * GET /admin/audit-log
 * Paginated audit log with filters.
 * Query params: rabbi_id, action_type, entity_type, dateFrom, dateTo, page, limit
 */
router.get('/audit-log', async (req, res) => {
  try {
    const result = await adminService.getAuditLog({
      actor:       req.query.rabbi_id,
      action:      req.query.action_type,
      entity_type: req.query.entity_type,
      entity_id:   req.query.entity_id,
      dateFrom:    req.query.dateFrom,
      dateTo:      req.query.dateTo,
      page:        req.query.page,
      limit:       req.query.limit,
    });

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[admin] GET /audit-log error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// =============================================================================
// SYSTEM SETTINGS
// =============================================================================

/**
 * GET /admin/system/settings
 * Return all system settings (merged defaults + DB overrides).
 */
router.get('/system/settings', async (req, res) => {
  try {
    const settings = await systemSettings.getAllSettings();
    return res.json({ ok: true, settings });
  } catch (err) {
    console.error('[admin] GET /system/settings error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

/**
 * PUT /admin/system/settings
 * Update one or more system settings.
 * Body: { key: value, ... }  — object of setting key-value pairs.
 */
router.put('/system/settings', async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'גוף הבקשה חייב להיות אובייקט הגדרות' });
    }

    const updates = req.body;
    const keys    = Object.keys(updates);

    if (keys.length === 0) {
      return res.status(400).json({ error: 'לא סופקו הגדרות לעדכון' });
    }

    const results = [];
    for (const key of keys) {
      const row = await systemSettings.setSetting(
        key,
        updates[key],
        req.rabbi.id,
        getIp(req)
      );
      results.push(row);
    }

    return res.json({ ok: true, updated: results });
  } catch (err) {
    console.error('[admin] PUT /system/settings error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

/**
 * POST /admin/system/emergency
 * Broadcast an emergency message to all rabbis via email + WhatsApp + socket.
 * Body: { message: string, targetRabbiIds?: string[] }
 */
router.post('/system/emergency', async (req, res) => {
  try {
    const { message, targetRabbiIds } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'הודעה נדרשת' });
    }

    // Resolve Socket.io instance attached by server.js
    const io = req.app.get('io');

    const result = await adminService.sendBroadcast(
      message.trim(),
      Array.isArray(targetRabbiIds) ? targetRabbiIds : [],
      { io, adminId: req.rabbi.id, ip: getIp(req) }
    );

    // Fire-and-forget: email + WhatsApp broadcasting
    _broadcastEmergencyEmail(message.trim(), targetRabbiIds).catch((err) => {
      console.error('[admin] Emergency email broadcast error:', err.message);
    });

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[admin] POST /system/emergency error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// =============================================================================
// WORDPRESS SYNC LOG
// =============================================================================

/**
 * GET /admin/sync-log
 * WordPress sync log: answered questions with their sync status.
 * Query params: status (synced|pending|failed), page, limit
 */
router.get('/sync-log', async (req, res) => {
  try {
    const conditions = [`q.status = 'answered'`];
    const params     = [];
    let   idx        = 0;

    const syncFilter = req.query.status;
    if (syncFilter === 'synced') {
      conditions.push('q.wp_synced_at IS NOT NULL');
    } else if (syncFilter === 'pending' || syncFilter === 'failed') {
      conditions.push('q.wp_synced_at IS NULL');
      conditions.push('q.wp_post_id IS NOT NULL');
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await dbQuery(
      `SELECT COUNT(*)::int AS total FROM questions q ${whereClause}`,
      params
    );
    const total = countResult.rows[0].total;

    const page   = Math.max(1, parseInt(req.query.page, 10)  || 1);
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const listParams = [...params, limit, offset];

    const { rows } = await dbQuery(
      `SELECT q.id, q.wp_post_id, q.title, q.answered_at, q.wp_synced_at,
              r.name AS rabbi_name
       FROM   questions q
       LEFT JOIN rabbis r ON r.id = q.assigned_rabbi_id
       ${whereClause}
       ORDER BY q.answered_at DESC
       LIMIT $${++idx} OFFSET $${++idx}`,
      listParams
    );

    const log = rows.map((row) => ({
      ...row,
      syncStatus: row.wp_synced_at ? 'synced' : 'pending',
    }));

    return res.json({ ok: true, log, total, page, limit });
  } catch (err) {
    console.error('[admin] GET /sync-log error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

/**
 * POST /admin/sync-log/retry
 * Retry all failed WordPress syncs (answered but not yet synced).
 */
router.post('/sync-log/retry', async (req, res) => {
  try {
    const result = await retryFailedSyncs();

    await logAction(
      req.rabbi.id,
      'admin.sync_retry',
      'wordpress_sync',
      null,
      null,
      result,
      getIp(req),
      null
    );

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[admin] POST /sync-log/retry error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// =============================================================================
// Private helpers
// =============================================================================

/**
 * Send emergency broadcast emails.
 * When targetRabbiIds is empty / undefined, emails ALL active rabbis.
 *
 * @param {string}   message
 * @param {string[]} [targetRabbiIds]
 * @private
 */
async function _broadcastEmergencyEmail(message, targetRabbiIds) {
  const { sendEmail } = require('../services/email');
  const { createEmailHTML } = require('../templates/emailBase');

  let rabbis;
  if (Array.isArray(targetRabbiIds) && targetRabbiIds.length > 0) {
    const { rows } = await dbQuery(
      'SELECT id, name, email FROM rabbis WHERE id = ANY($1) AND is_active = true',
      [targetRabbiIds]
    );
    rabbis = rows;
  } else {
    const { rows } = await dbQuery(
      'SELECT id, name, email FROM rabbis WHERE is_active = true'
    );
    rabbis = rows;
  }

  const html = createEmailHTML(
    'הודעה דחופה מהנהלת המערכת',
    `<p style="font-size:16px;color:#c0392b;font-weight:bold;">${message}</p>`,
    []
  );

  const sendPromises = rabbis.map((r) =>
    sendEmail({
      to:      r.email,
      subject: 'הודעה דחופה — ענה את השואל',
      html,
    }).catch((err) => {
      console.error(`[admin] Failed to send emergency email to ${r.email}:`, err.message);
    })
  );

  await Promise.all(sendPromises);
  console.log(`[admin] Emergency emails dispatched to ${rabbis.length} rabbis`);
}

// ─── Categories CRUD ──────────────────────────────────────────────────────────

router.get('/categories', requireAdmin, async (req, res) => {
  try {
    const { rows } = await dbQuery(
      'SELECT id, name, parent_id, sort_order, color, description, created_at FROM categories ORDER BY sort_order, name'
    );
    return res.json({ ok: true, categories: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/categories', requireAdmin, async (req, res) => {
  try {
    const { name, parentId = null, sortOrder = 0, color = '#1B2B5E', description = null } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'שם קטגוריה נדרש' });
    const { rows } = await dbQuery(
      'INSERT INTO categories (name, parent_id, sort_order, color, description) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [name.trim(), parentId, sortOrder, color, description]
    );
    return res.status(201).json({ ok: true, category: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch('/categories/:id', requireAdmin, async (req, res) => {
  try {
    const { name, color, description, sortOrder } = req.body;
    const { rows } = await dbQuery(
      `UPDATE categories SET
         name        = COALESCE($2, name),
         color       = COALESCE($3, color),
         description = COALESCE($4, description),
         sort_order  = COALESCE($5, sort_order),
         updated_at  = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id, name, color, description, sortOrder]
    );
    if (!rows.length) return res.status(404).json({ error: 'קטגוריה לא נמצאה' });
    return res.json({ ok: true, category: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/categories/:id', requireAdmin, async (req, res) => {
  try {
    await dbQuery('DELETE FROM categories WHERE id = $1', [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── System Health ────────────────────────────────────────────────────────────

router.get('/system/health', requireAdmin, async (req, res) => {
  try {
    const dbStart = Date.now();
    await dbQuery('SELECT 1');
    const dbLatency = Date.now() - dbStart;

    const { rows: counts } = await dbQuery(`
      SELECT
        (SELECT COUNT(*) FROM questions WHERE status = 'pending')::int    AS pending_questions,
        (SELECT COUNT(*) FROM questions WHERE status = 'in_process')::int AS active_questions,
        (SELECT COUNT(*) FROM rabbis WHERE is_active = true)::int         AS active_rabbis,
        (SELECT COUNT(*) FROM discussions WHERE is_open = true)::int      AS open_discussions
    `);

    return res.json({
      ok: true,
      status: 'healthy',
      dbLatencyMs: dbLatency,
      uptime: Math.floor(process.uptime()),
      memory: process.memoryUsage(),
      counts: counts[0],
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, status: 'degraded', error: err.message });
  }
});

// ─── Admin Leaderboard ────────────────────────────────────────────────────────

router.get('/leaderboard', requireAdmin, async (req, res) => {
  try {
    const period = req.query.period || 'month';
    const intervals = { week: '7 days', month: '30 days', year: '365 days' };
    const interval = intervals[period] || '30 days';

    const { rows } = await dbQuery(`
      SELECT
        r.id, r.name, r.role, r.photo_url,
        COUNT(q.id)::int                                                          AS answered,
        COALESCE(SUM(q.thanks_count), 0)::int                                     AS total_thanks,
        ROUND(AVG(EXTRACT(EPOCH FROM (q.answered_at - q.created_at)) / 3600)::numeric, 2) AS avg_hours
      FROM rabbis r
      LEFT JOIN questions q
        ON  q.assigned_rabbi_id = r.id
        AND q.status            = 'answered'
        AND q.answered_at      >= NOW() - INTERVAL '${interval}'
      WHERE r.is_active = true
      GROUP BY r.id
      ORDER BY answered DESC, total_thanks DESC
      LIMIT 20
    `);
    return res.json({ ok: true, leaderboard: rows, period });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
