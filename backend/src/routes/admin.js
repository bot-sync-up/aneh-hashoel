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
const { getWPRabbis, createWPRabbi, getWPCategories } = require('../services/wpService');

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

// ─── GET /admin/dashboard/activity ───────────────────────────────────────────
router.get('/dashboard/activity', async (req, res) => {
  try {
    const { rows } = await dbQuery(`
      SELECT
        TO_CHAR(d::date, 'YYYY-MM-DD') AS date,
        COUNT(q.id) FILTER (WHERE q.status != 'pending') AS questions,
        COUNT(q.id) FILTER (WHERE q.status = 'answered') AS answers
      FROM generate_series(
        NOW() - INTERVAL '6 days', NOW(), INTERVAL '1 day'
      ) AS d
      LEFT JOIN questions q ON q.created_at::date = d::date
      GROUP BY d ORDER BY d
    `);
    return res.json({ data: rows });
  } catch (err) {
    console.error('[admin] /dashboard/activity error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /admin/dashboard/categories/breakdown ───────────────────────────────
router.get('/dashboard/categories/breakdown', async (req, res) => {
  try {
    const { rows } = await dbQuery(`
      SELECT
        COALESCE(c.name, 'כללי') AS name,
        COUNT(q.id)::int AS value
      FROM questions q
      LEFT JOIN categories c ON c.id = q.category_id
      WHERE q.created_at >= NOW() - INTERVAL '30 days'
      GROUP BY c.name
      ORDER BY value DESC
      LIMIT 10
    `);
    return res.json({ data: rows });
  } catch (err) {
    console.error('[admin] /dashboard/categories/breakdown error:', err.message);
    return res.status(500).json({ error: err.message });
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

    // Also create rabi-add term in WP — fire-and-forget
    setImmediate(async () => {
      try {
        const wpResult = await createWPRabbi(name);
        if (wpResult.success && wpResult.data?.id) {
          await dbQuery(
            `UPDATE rabbis SET wp_term_id = $1 WHERE id = $2`,
            [wpResult.data.id, rabbi.id]
          );
          console.log(`[admin] WP rabbi term synced: rabbiId=${rabbi.id} wpTermId=${wpResult.data.id}`);
        }
      } catch (err) {
        console.error('[admin] WP rabbi term creation failed (non-fatal):', err.message);
      }
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
    const { name, email, phone, role, isActive, signature, whatsapp_number } = req.body;

    const { rows } = await dbQuery('SELECT id FROM rabbis WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'רב לא נמצא' });

    const fields = [];
    const vals = [];
    let idx = 1;

    if (name !== undefined)             { fields.push(`name = $${idx++}`);             vals.push(name); }
    if (email !== undefined)            { fields.push(`email = $${idx++}`);            vals.push(email); }
    if (phone !== undefined)            { fields.push(`phone = $${idx++}`);            vals.push(phone); }
    if (role !== undefined)             { fields.push(`role = $${idx++}`);             vals.push(role); }
    if (isActive !== undefined)         { fields.push(`is_active = $${idx++}`);        vals.push(Boolean(isActive)); }
    if (signature !== undefined)        { fields.push(`signature = $${idx++}`);        vals.push(signature); }
    if (whatsapp_number !== undefined)  { fields.push(`whatsapp_number = $${idx++}`);  vals.push(whatsapp_number); }

    if (!fields.length) return res.status(400).json({ error: 'אין שדות לעדכון' });

    vals.push(id);
    const { rows: updated } = await dbQuery(
      `UPDATE rabbis SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${idx}
       RETURNING id, name, email, phone, role, is_active, signature, whatsapp_number`,
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

// ─── POST /rabbis/sync-from-wp — pull rabi-add terms from WP ─────────────────

/**
 * POST /admin/rabbis/sync-from-wp
 * Pulls all rabi-add terms from WP and reports which exist locally and which don't.
 * Does NOT auto-create local rabbis (they need email/password).
 */
router.post('/rabbis/sync-from-wp', async (req, res) => {
  try {
    const wpResult = await getWPRabbis();
    if (!wpResult.success) {
      return res.status(502).json({ error: `שגיאה בשליפת רבנים מ-WP: ${wpResult.error}` });
    }

    const wpTerms = wpResult.data || [];
    if (wpTerms.length === 0) {
      return res.json({ message: 'לא נמצאו רבנים ב-WP', total_wp: 0, matched: 0, unmatched: [] });
    }

    // Get all local rabbis
    const { rows: localRabbis } = await dbQuery(
      `SELECT id, name, wp_term_id FROM rabbis WHERE status != 'deleted'`
    );

    const existingWpIds = new Set(
      localRabbis.filter(r => r.wp_term_id).map(r => r.wp_term_id)
    );

    let matched = 0;
    let linked = 0;
    const unmatched = [];

    for (const wpTerm of wpTerms) {
      if (existingWpIds.has(wpTerm.id)) {
        matched++;
        continue;
      }

      // Try to match by name
      const localMatch = localRabbis.find(
        r => r.name.trim().toLowerCase() === wpTerm.name.trim().toLowerCase() && !r.wp_term_id
      );

      if (localMatch) {
        await dbQuery(
          `UPDATE rabbis SET wp_term_id = $1 WHERE id = $2`,
          [wpTerm.id, localMatch.id]
        );
        linked++;
        matched++;
        console.log(`[admin/rabbis/sync] linked rabbiId=${localMatch.id} to wpTermId=${wpTerm.id}`);
      } else {
        unmatched.push({ wp_term_id: wpTerm.id, name: wpTerm.name, slug: wpTerm.slug });
      }
    }

    console.log(
      `[admin/rabbis/sync] WP: ${wpTerms.length}, matched: ${matched}, linked: ${linked}, unmatched: ${unmatched.length}`
    );

    return res.json({
      message: 'סנכרון רבנים מ-WP הושלם',
      total_wp: wpTerms.length,
      matched,
      linked,
      unmatched,
    });
  } catch (err) {
    console.error('[admin] POST /rabbis/sync-from-wp error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// ─── POST /categories/sync-from-wp — alternative admin route for category sync

/**
 * POST /admin/categories/sync-from-wp
 * Pulls all ask-cat terms from WP, creates missing ones in local DB.
 * This is an alias for the same functionality in /api/categories/sync-from-wp.
 */
router.post('/categories/sync-from-wp', async (req, res) => {
  try {
    const wpResult = await getWPCategories();
    if (!wpResult.success) {
      return res.status(502).json({ error: `שגיאה בשליפת קטגוריות מ-WP: ${wpResult.error}` });
    }

    const wpTerms = wpResult.data || [];
    if (wpTerms.length === 0) {
      return res.json({ message: 'לא נמצאו קטגוריות ב-WP', created: 0, existing: 0 });
    }

    const { rows: localCats } = await dbQuery(
      `SELECT id, name, wp_term_id FROM categories WHERE status != 'rejected'`
    );

    const existingWpIds = new Set(localCats.filter(c => c.wp_term_id).map(c => c.wp_term_id));
    const existingNames = new Set(localCats.map(c => c.name.trim().toLowerCase()));

    let created = 0;
    let existing = 0;
    let skipped = 0;

    for (const wpTerm of wpTerms) {
      if (existingWpIds.has(wpTerm.id)) {
        existing++;
        continue;
      }

      if (existingNames.has(wpTerm.name.trim().toLowerCase())) {
        const localMatch = localCats.find(
          c => c.name.trim().toLowerCase() === wpTerm.name.trim().toLowerCase() && !c.wp_term_id
        );
        if (localMatch) {
          await dbQuery(
            `UPDATE categories SET wp_term_id = $1 WHERE id = $2`,
            [wpTerm.id, localMatch.id]
          );
        }
        existing++;
        continue;
      }

      try {
        await dbQuery(
          `INSERT INTO categories (name, parent_id, sort_order, status, wp_term_id, created_at)
           VALUES ($1, NULL, 0, 'approved', $2, NOW())`,
          [wpTerm.name.trim(), wpTerm.id]
        );
        created++;
      } catch (insertErr) {
        console.error(`[admin/categories/sync] failed to create "${wpTerm.name}":`, insertErr.message);
        skipped++;
      }
    }

    return res.json({
      message: 'סנכרון קטגוריות מ-WP הושלם',
      total_wp: wpTerms.length,
      created,
      existing,
      skipped,
    });
  } catch (err) {
    console.error('[admin] POST /categories/sync-from-wp error:', err.message);
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
// EMAIL TEMPLATE SETTINGS
// =============================================================================

/**
 * GET /admin/email-settings
 * Returns the email_templates setting from system_config.
 */
router.get('/email-settings', async (req, res) => {
  try {
    const templates = await systemSettings.getSetting('email_templates');
    return res.json({ ok: true, templates: templates || null });
  } catch (err) {
    console.error('[admin] GET /email-settings error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

/**
 * PUT /admin/email-settings
 * Saves email template settings to system_config under key 'email_templates'.
 * Body: { templates: { asker_system_name, rabbi_system_name, ... } }
 */
router.put('/email-settings', async (req, res) => {
  try {
    const { templates } = req.body;

    if (!templates || typeof templates !== 'object' || Array.isArray(templates)) {
      return res.status(400).json({ error: 'גוף הבקשה חייב להכיל אובייקט templates' });
    }

    const result = await systemSettings.setSetting(
      'email_templates',
      templates,
      req.rabbi.id,
      getIp(req)
    );

    return res.json({ ok: true, updated: result });
  } catch (err) {
    console.error('[admin] PUT /email-settings error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// =============================================================================
// PENDING QUESTION REMINDER SETTINGS
// =============================================================================

/**
 * GET /admin/pending-reminder-settings
 * מחזיר את הגדרות תזכורת השאלות הממתינות (enabled, hours, remind_every)
 */
router.get('/pending-reminder-settings', async (req, res) => {
  try {
    const { rows } = await dbQuery(
      "SELECT value FROM system_config WHERE key = 'pending_reminder'"
    );
    const defaults = { enabled: false, hours: 24, remind_every: 24 };
    if (rows.length === 0 || !rows[0].value) {
      return res.json({ ok: true, settings: defaults });
    }
    const v = typeof rows[0].value === 'string'
      ? JSON.parse(rows[0].value)
      : rows[0].value;
    return res.json({ ok: true, settings: { ...defaults, ...v } });
  } catch (err) {
    console.error('[admin] GET /pending-reminder-settings error:', err.message);
    return res.status(500).json({ error: 'שגיאת שרת בטעינת ההגדרות' });
  }
});

/**
 * PUT /admin/pending-reminder-settings
 * Body: { enabled: boolean, hours: number, remind_every: number }
 */
router.put('/pending-reminder-settings', async (req, res) => {
  try {
    const { enabled, hours, remind_every } = req.body ?? {};

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled חייב להיות boolean' });
    }
    const h = parseInt(hours, 10);
    const r = parseInt(remind_every, 10);
    if (!Number.isFinite(h) || h < 1 || h > 720) {
      return res.status(400).json({ error: 'hours חייב להיות מספר בין 1 ל-720' });
    }
    if (!Number.isFinite(r) || r < 1 || r > 720) {
      return res.status(400).json({ error: 'remind_every חייב להיות מספר בין 1 ל-720' });
    }

    const value = { enabled, hours: h, remind_every: r };

    await dbQuery(
      `INSERT INTO system_config (key, value, updated_at)
       VALUES ('pending_reminder', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(value)]
    );

    // Audit log (non-blocking)
    setImmediate(() => {
      logAction(
        req.rabbi.id,
        ACTIONS.ADMIN_CONFIG_CHANGED,
        'system_config',
        'pending_reminder',
        null,
        value,
        getIp(req)
      ).catch(() => {});
    });

    return res.json({ ok: true, settings: value });
  } catch (err) {
    console.error('[admin] PUT /pending-reminder-settings error:', err.message);
    return res.status(500).json({ error: 'שגיאת שרת בשמירת ההגדרות' });
  }
});

/**
 * POST /admin/pending-reminder-settings/run-now
 * Trigger the reminder job immediately (admin test button).
 */
router.post('/pending-reminder-settings/run-now', async (req, res) => {
  try {
    const { runPendingReminder } = require('../cron/jobs/pendingReminder');
    const result = await runPendingReminder();
    return res.json({ ok: true, result });
  } catch (err) {
    console.error('[admin] POST /pending-reminder-settings/run-now error:', err.message);
    return res.status(500).json({ error: err.message || 'שגיאה בהפעלת התזכורת' });
  }
});

/**
 * POST /admin/email-preview
 * Renders a full email preview using createEmailHTML().
 * Body: { title, body, buttonLabel?, buttonUrl? }
 * Returns: { html: "<!DOCTYPE html>..." }
 */
router.post('/email-preview', async (req, res) => {
  try {
    const { createEmailHTML } = require('../templates/emailBase');
    const { title, body, buttonLabel, buttonUrl, audience } = req.body;

    if (!title || !body) {
      return res.status(400).json({ error: 'נדרשים title ו-body' });
    }

    const buttons = [];
    if (buttonLabel && buttonUrl) {
      buttons.push({ label: buttonLabel, url: buttonUrl });
    }

    // audience='asker' removes the "כניסה למערכת" link from the footer
    const options = {};
    if (audience === 'asker') options.audience = 'asker';

    const html = createEmailHTML(title, body, buttons, options);
    return res.json({ ok: true, html });
  } catch (err) {
    console.error('[admin] POST /email-preview error:', err.message);
    return res.status(500).json({ error: 'שגיאה ביצירת תצוגה מקדימה' });
  }
});

// =============================================================================
// NEWSLETTER ADMIN SELECTION
// =============================================================================

/**
 * GET /admin/newsletter/candidates
 * Returns top 10 answered questions from the past week (most thanked, most viewed).
 */
router.get('/newsletter/candidates', async (req, res) => {
  try {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const { rows } = await dbQuery(
      `SELECT
         q.id,
         q.title,
         q.content,
         q.thank_count,
         q.view_count,
         q.answered_at,
         q.wp_link,
         c.name AS category_name,
         r.name AS rabbi_name
       FROM   questions q
       LEFT JOIN categories c ON c.id = q.category_id
       LEFT JOIN rabbis     r ON r.id = q.assigned_rabbi_id
       WHERE  q.status = 'answered'
         AND  q.answered_at >= $1
         AND  q.answered_at IS NOT NULL
       ORDER BY q.thank_count DESC, q.view_count DESC
       LIMIT 10`,
      [weekAgo.toISOString()]
    );

    return res.json({ ok: true, candidates: rows });
  } catch (err) {
    console.error('[admin] GET /newsletter/candidates error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

/**
 * POST /admin/newsletter/select
 * Saves selected question IDs for the next newsletter.
 * Body: { questionIds: string[] }
 */
router.post('/newsletter/select', async (req, res) => {
  try {
    const { questionIds } = req.body;

    if (!Array.isArray(questionIds)) {
      return res.status(400).json({ error: 'questionIds חייב להיות מערך' });
    }

    const result = await systemSettings.setSetting(
      'newsletter_selected_questions',
      questionIds,
      req.rabbi.id,
      getIp(req)
    );

    return res.json({ ok: true, updated: result });
  } catch (err) {
    console.error('[admin] POST /newsletter/select error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

/**
 * POST /admin/newsletter/send
 * Triggers immediate newsletter send with selected questions.
 */
router.post('/newsletter/send', async (req, res) => {
  try {
    const { runWeeklyNewsletter } = require('../cron/jobs/weeklyNewsletter');
    await runWeeklyNewsletter();

    // Record last sent date
    await systemSettings.setSetting(
      'newsletter_last_sent',
      new Date().toISOString(),
      req.rabbi.id,
      getIp(req)
    );

    return res.json({ ok: true, message: 'ניוזלטר נשלח בהצלחה' });
  } catch (err) {
    console.error('[admin] POST /newsletter/send error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

/**
 * GET /admin/newsletter/status
 * Returns last sent date and currently selected questions.
 */
router.get('/newsletter/status', async (req, res) => {
  try {
    const lastSent = await systemSettings.getSetting('newsletter_last_sent');
    const selectedIds = await systemSettings.getSetting('newsletter_selected_questions');

    let selectedQuestions = [];
    if (Array.isArray(selectedIds) && selectedIds.length > 0) {
      const { rows } = await dbQuery(
        `SELECT q.id, q.title, q.thank_count, q.view_count, r.name AS rabbi_name
         FROM   questions q
         LEFT JOIN rabbis r ON r.id = q.assigned_rabbi_id
         WHERE  q.id = ANY($1::uuid[])`,
        [selectedIds]
      );
      selectedQuestions = rows;
    }

    return res.json({
      ok: true,
      lastSent: lastSent || null,
      selectedQuestions,
    });
  } catch (err) {
    console.error('[admin] GET /newsletter/status error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

/**
 * GET /admin/newsletter/enabled
 * Returns whether the weekly newsletter auto-send is enabled.
 */
router.get('/newsletter/enabled', async (req, res) => {
  try {
    const v = await systemSettings.getSetting('newsletter_enabled');
    // null/undefined defaults to true (legacy behavior)
    return res.json({ ok: true, enabled: v === false ? false : true });
  } catch (err) {
    console.error('[admin] GET /newsletter/enabled error:', err.message);
    return res.status(500).json({ error: 'שגיאת שרת' });
  }
});

/**
 * PUT /admin/newsletter/enabled
 * Body: { enabled: boolean }
 */
router.put('/newsletter/enabled', async (req, res) => {
  try {
    const { enabled } = req.body ?? {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled חייב להיות boolean' });
    }
    await systemSettings.setSetting('newsletter_enabled', enabled, req.rabbi.id, getIp(req));

    setImmediate(() => {
      logAction(
        req.rabbi.id,
        ACTIONS.ADMIN_CONFIG_CHANGED,
        'system_config',
        'newsletter_enabled',
        null,
        { enabled },
        getIp(req)
      ).catch(() => {});
    });

    return res.json({ ok: true, enabled });
  } catch (err) {
    console.error('[admin] PUT /newsletter/enabled error:', err.message);
    return res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// =============================================================================
// NEWSLETTER ARCHIVE
// =============================================================================

/**
 * GET /admin/newsletter/archive
 * Returns paginated list of archived newsletters.
 * Query params: page (default 1), limit (default 20)
 */
router.get('/newsletter/archive', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const [{ rows }, countResult] = await Promise.all([
      dbQuery(
        `SELECT id, title, sent_at, recipient_count, created_at
         FROM   newsletter_archive
         ORDER BY sent_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      dbQuery('SELECT COUNT(*)::int AS total FROM newsletter_archive'),
    ]);

    const total = countResult.rows[0]?.total || 0;

    return res.json({
      ok: true,
      newsletters: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('[admin] GET /newsletter/archive error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

/**
 * GET /admin/newsletter/archive/:id
 * Returns a single archived newsletter with full HTML content.
 */
router.get('/newsletter/archive/:id', async (req, res) => {
  try {
    const { rows } = await dbQuery(
      `SELECT id, title, content_html, sent_at, recipient_count, created_at
       FROM   newsletter_archive
       WHERE  id = $1`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'ניוזלטר לא נמצא' });
    }

    return res.json({ ok: true, newsletter: rows[0] });
  } catch (err) {
    console.error('[admin] GET /newsletter/archive/:id error:', err.message);
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
    sendEmail(r.email, 'הודעה דחופה — ענה את השואל', html)
      .then(() => console.log(`[system] Emergency email sent to ${r.email}`))
      .catch((err) => {
        console.error(`[system] Emergency email to ${r.email} failed:`, err.message);
      })
  );

  await Promise.all(sendPromises);
  console.log(`[admin] Emergency emails dispatched to ${rabbis.length} rabbis`);
}

// ─── Categories CRUD ──────────────────────────────────────────────────────────

router.get('/categories', requireAdmin, async (req, res) => {
  try {
    const { rows } = await dbQuery(
      `SELECT c.id, c.name, c.parent_id, c.sort_order, c.color, c.description, c.created_at,
              COUNT(q.id)::int AS "questionCount"
       FROM   categories c
       LEFT JOIN questions q ON q.category_id = c.id
       GROUP BY c.id
       ORDER BY c.sort_order, c.name`
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

router.patch('/categories/:id/reorder', requireAdmin, async (req, res) => {
  try {
    const { targetId, position } = req.body;
    const sourceId = parseInt(req.params.id, 10);
    const tgtId = parseInt(targetId, 10);
    if (!Number.isFinite(sourceId) || !Number.isFinite(tgtId)) {
      return res.status(400).json({ error: 'מזהי קטגוריה אינם חוקיים' });
    }
    // Get current sort_order of both categories
    const { rows } = await dbQuery(
      `SELECT id, sort_order FROM categories WHERE id IN ($1, $2)`,
      [sourceId, tgtId]
    );
    if (rows.length < 2) {
      return res.status(404).json({ error: 'אחת הקטגוריות לא נמצאה' });
    }
    const source = rows.find(r => r.id === sourceId);
    const target = rows.find(r => r.id === tgtId);
    // Swap sort_order values
    await dbQuery(
      `UPDATE categories SET sort_order = $1, updated_at = NOW() WHERE id = $2`,
      [target.sort_order, sourceId]
    );
    await dbQuery(
      `UPDATE categories SET sort_order = $1, updated_at = NOW() WHERE id = $2`,
      [source.sort_order, tgtId]
    );
    return res.json({ ok: true, message: 'הסדר עודכן בהצלחה' });
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
    const intervals = { week: '7 days', month: '30 days', alltime: null, year: '365 days' };
    const interval = intervals[period] ?? '30 days';

    // Date filter for period-scoped aggregates
    const dateCond = interval
      ? `AND a.published_at >= NOW() - INTERVAL '${interval}'`
      : '';

    const { rows } = await dbQuery(`
      SELECT
        r.id,
        r.name,
        r.role,
        r.photo_url,
        COUNT(a.id) FILTER (WHERE a.published_at IS NOT NULL ${dateCond})::int       AS answers,
        COUNT(a.id) FILTER (WHERE a.published_at IS NOT NULL)::int                   AS "totalAnswers",
        COALESCE(
          SUM(q.thank_count) FILTER (WHERE a.published_at IS NOT NULL ${dateCond}),
          0
        )::int                                                                       AS thanks,
        ROUND(
          AVG(
            EXTRACT(EPOCH FROM (a.published_at - q.lock_timestamp)) / 3600
          ) FILTER (
            WHERE a.published_at IS NOT NULL
              AND q.lock_timestamp IS NOT NULL
              ${dateCond}
          )::numeric,
          1
        )                                                                            AS "avgTimeHours"
      FROM rabbis r
      LEFT JOIN answers   a ON a.rabbi_id = r.id
      LEFT JOIN questions q ON q.id       = a.question_id
      WHERE r.is_active = true
      GROUP BY r.id
      HAVING COUNT(a.id) FILTER (WHERE a.published_at IS NOT NULL ${dateCond}) > 0
      ORDER BY answers DESC, thanks DESC
      LIMIT 20
    `);

    // Attach answersThisWeek for the top-rabbi card when period=week
    if (period === 'week' && rows.length > 0) {
      rows[0].answersThisWeek = rows[0].answers;
    }

    return res.json({ ok: true, leaderboard: rows, period });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
