'use strict';

/**
 * Admin System Routes  –  /admin/system/*
 *
 * All routes require authenticate + requireAdmin.
 *
 * GET  /settings        – all configurable settings
 * PUT  /settings        – batch update settings
 * POST /emergency       – broadcast emergency message to all rabbis
 * GET  /audit-log       – paginated audit log with filters
 * GET  /sync-log        – WordPress sync log with retry counts
 * POST /sync-retry      – manually trigger WP sync retry
 * GET  /health          – DB / Redis / WP / GreenAPI health status
 *
 * Depends on:
 *   middleware/authenticate    – authenticate, requireAdmin
 *   middleware/auditLog        – logAction, ACTIONS
 *   services/auditService      – getAuditLog
 *   services/admin             – getSystemConfig, updateSystemConfig, sendBroadcast
 *   services/wordpress         – retryFailedSyncs
 *   db/pool                    – query, healthCheck
 *   services/redis             – getClient (ping check)
 */

const express = require('express');
const axios   = require('axios');

const { authenticate, requireAdmin } = require('../../middleware/authenticate');
const { logAction, ACTIONS }         = require('../../middleware/auditLog');
const { getAuditLog }                = require('../../services/auditService');
const adminService                   = require('../../services/admin');
const { retryFailedSyncs }           = require('../../services/wordpress');
const { backfillAttachmentUrls }     = require('../../services/questionSyncService');
const { query: dbQuery, healthCheck: dbHealthCheck } = require('../../db/pool');

const router = express.Router();

// ─── Auth guard ───────────────────────────────────────────────────────────────
router.use(authenticate, requireAdmin);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.ip ||
    null
  );
}

// ─── GET /settings ────────────────────────────────────────────────────────────

/**
 * GET /admin/system/settings
 *
 * Returns all configurable system settings merged from DB + defaults.
 * Response: { ok, settings: { key: value, ... } }
 */
router.get('/settings', async (req, res) => {
  try {
    const settings = await adminService.getSystemConfig();
    return res.json({ ok: true, settings });
  } catch (err) {
    console.error('[system] GET /settings error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// ─── PUT /settings ────────────────────────────────────────────────────────────

/**
 * PUT /admin/system/settings
 *
 * Batch update configurable settings.
 *
 * Body: {
 *   timeoutHours?:      number,
 *   weeklyReportDay?:   number (0-6, 0=Sunday),
 *   weeklyReportTime?:  string ('HH:MM'),
 *   dailyDigestTime?:   string ('HH:MM'),
 *   maxFollowUps?:      number
 * }
 *
 * Response: { ok, updated: [{ key, value }, ...] }
 */
router.put('/settings', async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'גוף הבקשה חייב להיות אובייקט הגדרות' });
    }

    const ALLOWED_KEYS = new Set([
      'timeoutHours',
      'weeklyReportDay',
      'weeklyReportTime',
      'dailyDigestTime',
      'maxFollowUps',
    ]);

    const entries = Object.entries(req.body).filter(([k]) => ALLOWED_KEYS.has(k));

    if (entries.length === 0) {
      return res.status(400).json({
        error: `לא סופקו מפתחות חוקיים. ערכים מותרים: ${[...ALLOWED_KEYS].join(', ')}`,
      });
    }

    // Validate individual values
    for (const [key, value] of entries) {
      if (['timeoutHours', 'maxFollowUps', 'weeklyReportDay'].includes(key)) {
        const num = Number(value);
        if (!Number.isFinite(num) || num < 0) {
          return res.status(400).json({ error: `ערך לא חוקי עבור ${key}: חייב להיות מספר חיובי` });
        }
      }
      if (key === 'weeklyReportDay') {
        const day = Number(value);
        if (day < 0 || day > 6) {
          return res.status(400).json({ error: 'weeklyReportDay חייב להיות בין 0 (ראשון) ל-6 (שבת)' });
        }
      }
      if (['weeklyReportTime', 'dailyDigestTime'].includes(key)) {
        if (typeof value !== 'string' || !/^\d{1,2}:\d{2}$/.test(value)) {
          return res.status(400).json({ error: `${key} חייב להיות בפורמט HH:MM` });
        }
      }
    }

    const oldSettings = await adminService.getSystemConfig();
    const updated = [];

    for (const [key, value] of entries) {
      const row = await adminService.updateSystemConfig(key, value, req.rabbi.id);
      updated.push(row);
    }

    // Audit the settings change
    await logAction(
      req.rabbi.id,
      ACTIONS.ADMIN_CONFIG_CHANGED,
      'system_config',
      null,
      oldSettings,
      Object.fromEntries(entries),
      getIp(req),
      req.headers['user-agent'] || null
    );

    return res.json({ ok: true, updated });
  } catch (err) {
    console.error('[system] PUT /settings error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// ─── POST /emergency ──────────────────────────────────────────────────────────

/**
 * POST /admin/system/emergency
 *
 * Send an emergency broadcast to all rabbis (email + WhatsApp + socket).
 *
 * Body: {
 *   message:         string  (required)
 *   targetRabbiIds?: string[]  (optional — omit to broadcast to ALL active rabbis)
 * }
 *
 * Response: { ok, sentCount, failedCount }
 */
router.post('/emergency', async (req, res) => {
  try {
    const { message, targetRabbiIds } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'הודעת שידור חירום נדרשת' });
    }

    const io = req.app.get('io');

    const result = await adminService.sendBroadcast(
      message.trim(),
      Array.isArray(targetRabbiIds) ? targetRabbiIds : [],
      { io, adminId: req.rabbi.id, ip: getIp(req) }
    );

    // Fire-and-forget: send email + WhatsApp to rabbis
    _dispatchEmergencyNotifications(message.trim(), targetRabbiIds).catch((err) => {
      console.error('[system] Emergency notification dispatch error:', err.message);
    });

    await logAction(
      req.rabbi.id,
      'system.emergency_broadcast',
      'broadcast',
      null,
      null,
      { message: message.trim(), targetRabbiIds: targetRabbiIds || 'all', ...result },
      getIp(req),
      req.headers['user-agent'] || null
    );

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[system] POST /emergency error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// ─── GET /audit-log ───────────────────────────────────────────────────────────

/**
 * GET /admin/system/audit-log
 *
 * Paginated audit log with optional filters.
 *
 * Query params:
 *   rabbiId    – filter by actor
 *   action     – filter by action type (exact match or prefix)
 *   entityType – filter by entity type
 *   dateFrom   – ISO date string
 *   dateTo     – ISO date string
 *   page       – default 1
 *   limit      – default 50, max 200
 *
 * Response: { ok, entries: [...], total, page, limit }
 */
router.get('/audit-log', async (req, res) => {
  try {
    const result = await getAuditLog({
      rabbiId:    req.query.rabbiId,
      action:     req.query.action,
      entityType: req.query.entityType,
      dateFrom:   req.query.dateFrom,
      dateTo:     req.query.dateTo,
      page:       req.query.page,
      limit:      req.query.limit,
    });

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[system] GET /audit-log error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// ─── GET /sync-log ────────────────────────────────────────────────────────────

/**
 * GET /admin/system/sync-log
 *
 * WordPress sync log for answered questions.
 * Includes retry count (approximated from audit log).
 *
 * Query params:
 *   status – 'synced' | 'pending' | 'failed' (optional)
 *   page   – default 1
 *   limit  – default 50, max 200
 *
 * Response: { ok, log: [...], total, page, limit }
 */
router.get('/sync-log', async (req, res) => {
  try {
    const conditions = [`q.status = 'answered'`];
    const params     = [];
    let   idx        = 0;

    const syncFilter = req.query.status;
    if (syncFilter === 'synced') {
      conditions.push('q.wp_synced_at IS NOT NULL');
    } else if (syncFilter === 'pending') {
      conditions.push('q.wp_synced_at IS NULL');
      conditions.push('q.wp_post_id IS NOT NULL');
    } else if (syncFilter === 'failed') {
      conditions.push('q.wp_synced_at IS NULL');
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await dbQuery(
      `SELECT COUNT(*)::int AS total FROM questions q ${where}`,
      params
    );
    const total  = countResult.rows[0].total;
    const page   = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const listParams = [...params, limit, offset];

    const { rows } = await dbQuery(
      `SELECT q.id,
              q.wp_post_id,
              q.title,
              q.answered_at,
              q.wp_synced_at,
              r.name AS rabbi_name,
              (
                SELECT COUNT(*)::int
                FROM   audit_log al
                WHERE  al.entity_type = 'wordpress_sync'
                  AND  al.new_value::jsonb->>'questionId' = q.id::text
                  AND  al.action = 'admin.sync_retry'
              ) AS retry_count
       FROM   questions q
       LEFT JOIN rabbis r ON r.id = q.assigned_rabbi_id
       ${where}
       ORDER  BY q.answered_at DESC
       LIMIT  $${++idx} OFFSET $${++idx}`,
      listParams
    );

    const log = rows.map((row) => ({
      ...row,
      syncStatus: row.wp_synced_at ? 'synced' : 'pending',
    }));

    return res.json({ ok: true, log, total, page, limit });
  } catch (err) {
    console.error('[system] GET /sync-log error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// ─── POST /sync-retry ─────────────────────────────────────────────────────────

/**
 * POST /admin/system/sync-retry
 *
 * Manually trigger a WordPress sync retry for all un-synced answered questions.
 *
 * Response: { ok, retriedCount, successCount, failedCount }
 */
router.post('/sync-retry', async (req, res) => {
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
      req.headers['user-agent'] || null
    );

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[system] POST /sync-retry error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// ─── POST /backfill-attachments ───────────────────────────────────────────────

/**
 * POST /admin/system/backfill-attachments
 *
 * One-time backfill: for every question that has a wp_post_id but NULL
 * attachment_url, fetch the WP post meta and resolve the attachment URL.
 *
 * Query params:
 *   limit – max questions to process in one call (default 200)
 *
 * Response: { ok, checked, updated, noImage, failed }
 */
router.post('/backfill-attachments', async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || req.body?.limit, 10) || 200));

    console.log(`[system] POST /backfill-attachments triggered by rabbi=${req.rabbi.id} limit=${limit}`);

    const result = await backfillAttachmentUrls({ limit });

    await logAction(
      req.rabbi.id,
      'admin.backfill_attachments',
      'questions',
      null,
      null,
      result,
      getIp(req),
      req.headers['user-agent'] || null
    );

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[system] POST /backfill-attachments error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// ─── GET /health ──────────────────────────────────────────────────────────────

/**
 * GET /admin/system/health
 *
 * Returns real-time health status for all external dependencies.
 *
 * Response: {
 *   ok,
 *   status: 'healthy' | 'degraded' | 'unhealthy',
 *   checks: {
 *     database:  { status, latencyMs },
 *     redis:     { status, latencyMs },
 *     wordpress: { status, latencyMs, httpStatus? },
 *     greenApi:  { status }
 *   }
 * }
 */
router.get('/health', async (req, res) => {
  const checks = {};

  // ── Database ──────────────────────────────────────────────────────────────
  const dbStart = Date.now();
  try {
    await dbHealthCheck();
    checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
  } catch (err) {
    checks.database = { status: 'error', error: err.message, latencyMs: Date.now() - dbStart };
  }

  // ── Redis ─────────────────────────────────────────────────────────────────
  const redisStart = Date.now();
  try {
    const redis = require('../../services/redis');
    const client = redis.getClient();
    await client.ping();
    checks.redis = { status: 'ok', latencyMs: Date.now() - redisStart };
  } catch (err) {
    checks.redis = { status: 'error', error: err.message, latencyMs: Date.now() - redisStart };
  }

  // ── WordPress ─────────────────────────────────────────────────────────────
  const wpStart = Date.now();
  try {
    const wpUrl = process.env.WP_API_URL;
    if (!wpUrl) {
      checks.wordpress = { status: 'unconfigured' };
    } else {
      const resp = await axios.get(`${wpUrl.replace(/\/$/, '')}/health`, {
        headers: { 'x-api-key': process.env.WP_API_KEY || '' },
        timeout: 5000,
      });
      checks.wordpress = {
        status:     'ok',
        latencyMs:  Date.now() - wpStart,
        httpStatus: resp.status,
      };
    }
  } catch (err) {
    checks.wordpress = {
      status:    'error',
      error:     err.message,
      latencyMs: Date.now() - wpStart,
      httpStatus: err.response?.status || null,
    };
  }

  // ── GreenAPI (WhatsApp) ───────────────────────────────────────────────────
  try {
    const instanceId  = process.env.GREEN_API_INSTANCE_ID;
    const instanceKey = process.env.GREEN_API_INSTANCE_TOKEN;

    if (!instanceId || !instanceKey) {
      checks.greenApi = { status: 'unconfigured' };
    } else {
      const greenStart = Date.now();
      const resp = await axios.get(
        `https://api.green-api.com/waInstance${instanceId}/getStateInstance/${instanceKey}`,
        { timeout: 5000 }
      );
      const state = resp.data?.stateInstance || 'unknown';
      checks.greenApi = {
        status:    state === 'authorized' ? 'ok' : 'degraded',
        state,
        latencyMs: Date.now() - greenStart,
      };
    }
  } catch (err) {
    checks.greenApi = { status: 'error', error: err.message };
  }

  // ── Queue / DB counts ───────────────────────────────────────────────────
  let counts = {};
  try {
    const { rows } = await dbQuery(`
      SELECT
        (SELECT COUNT(*) FROM questions WHERE status = 'pending')::int    AS pending_questions,
        (SELECT COUNT(*) FROM questions WHERE status = 'in_process')::int AS active_questions,
        (SELECT COUNT(*) FROM questions WHERE status = 'answered' AND wp_synced_at IS NULL)::int AS pending_wp_sync,
        (SELECT COUNT(*) FROM rabbis WHERE is_active = true)::int         AS active_rabbis,
        (SELECT COUNT(*) FROM discussions WHERE is_open = true)::int      AS open_discussions
    `);
    counts = rows[0] || {};
  } catch {
    // counts stay empty — non-critical
  }

  // ── Overall status ────────────────────────────────────────────────────────
  const allOk      = Object.values(checks).every((c) => c.status === 'ok' || c.status === 'unconfigured');
  const anyError   = Object.values(checks).some((c)  => c.status === 'error');
  const overallStatus = allOk ? 'healthy' : anyError ? 'unhealthy' : 'degraded';

  return res.status(allOk ? 200 : 503).json({
    ok: allOk,
    status: overallStatus,
    checks,
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage(),
    counts,
    timestamp: new Date().toISOString(),
  });
});

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Dispatch emergency email + WhatsApp notifications to rabbis.
 * Fire-and-forget — called without await.
 *
 * @param {string}    message
 * @param {string[]}  [targetRabbiIds]
 * @private
 */
async function _dispatchEmergencyNotifications(message, targetRabbiIds) {
  const { sendEmail }      = require('../../services/email');
  const { createEmailHTML } = require('../../templates/emailBase');

  let rabbis;
  if (Array.isArray(targetRabbiIds) && targetRabbiIds.length > 0) {
    const { rows } = await dbQuery(
      'SELECT id, name, email FROM rabbis WHERE id = ANY($1) AND is_active = TRUE',
      [targetRabbiIds]
    );
    rabbis = rows;
  } else {
    const { rows } = await dbQuery(
      'SELECT id, name, email FROM rabbis WHERE is_active = TRUE'
    );
    rabbis = rows;
  }

  const html = createEmailHTML(
    'הודעה דחופה מהנהלת המערכת',
    `<p style="font-size:16px;color:#c0392b;font-weight:bold;">${message}</p>`,
    []
  );

  await Promise.allSettled(
    rabbis.map((r) =>
      sendEmail({
        to:      r.email,
        subject: 'הודעה דחופה — ענה את השואל',
        html,
      }).catch((err) => {
        console.error(`[system] Emergency email to ${r.email} failed:`, err.message);
      })
    )
  );

  console.info(`[system] Emergency notifications dispatched to ${rabbis.length} rabbis.`);
}

module.exports = router;
