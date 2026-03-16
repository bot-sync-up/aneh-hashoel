/**
 * Notifications Router  –  src/routes/notifications.js
 *
 * REST API for rabbis to manage their own in-app notifications.
 * All routes require authentication.
 *
 * Mount point (in server.js / app.js):
 *   app.use('/api/notifications', notificationsRouter);
 *
 * Endpoints:
 *   GET    /                 – list notifications (paginated; ?unread=true to filter)
 *   PATCH  /:id/read         – mark one notification as read
 *   PATCH  /read-all         – mark all unread notifications as read
 *   DELETE /:id              – soft-delete (dismiss) one notification
 *   GET    /unread-count     – return just the unread badge count
 *
 * Assumes a `notifications_log` table with at least the columns:
 *   id, rabbi_id, type, channel, content (jsonb), sent_at, status,
 *   read_at (timestamptz nullable), dismissed_at (timestamptz nullable)
 */

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { query: dbQuery } = require('../db/pool');
const { logger } = require('../utils/logger');

const router = express.Router();

// All notification routes require an authenticated rabbi session.
router.use(authenticate);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget: push an updated badge count to the rabbi's socket room.
 * Never blocks the HTTP response; errors are silently logged.
 *
 * @param {import('express').Request} req
 * @param {string}                    rabbiId
 */
function refreshBadgeAsync(req, rabbiId) {
  try {
    const io = req.app.get('io');
    if (!io) return;

    // Lazy import to avoid circular deps at module load time
    Promise.resolve().then(() => require('../socket/notificationEvents'))
      .then(({ updateBadgeCount }) => {
        return dbQuery(
          `SELECT COUNT(*)::int AS unread
           FROM   notifications_log
           WHERE  rabbi_id      = $1
             AND  read_at       IS NULL
             AND  dismissed_at  IS NULL`,
          [rabbiId]
        ).then(({ rows }) => {
          updateBadgeCount(io, rabbiId, { unread: rows[0]?.unread ?? 0 });
        });
      })
      .catch((err) => {
        logger.warn('refreshBadgeAsync failed', { message: err.message, rabbiId });
      });
  } catch (err) {
    logger.warn('refreshBadgeAsync unexpected error', { message: err.message });
  }
}

/**
 * Shared WHERE clause builder.
 * Always excludes dismissed notifications.
 * Optionally restricts to unread only.
 *
 * @param {string}  rabbiId
 * @param {boolean} onlyUnread
 * @returns {{ where: string, params: unknown[] }}
 */
function buildWhereClause(rabbiId, onlyUnread) {
  const conditions = ['rabbi_id = $1', 'dismissed_at IS NULL'];
  const params     = [rabbiId];

  if (onlyUnread) {
    conditions.push('read_at IS NULL');
  }

  return {
    where:  `WHERE ${conditions.join(' AND ')}`,
    params,
  };
}

/**
 * Shape a raw DB row into the API response object.
 *
 * @param {object} row
 * @returns {object}
 */
function formatNotification(row) {
  let content = row.content;
  if (typeof content === 'string') {
    try {
      content = JSON.parse(content);
    } catch {
      // Leave as-is — caller stored it as plain text
    }
  }

  return {
    id:          row.id,
    type:        row.type,
    channel:     row.channel,
    content,
    sentAt:      row.sent_at,
    status:      row.status,
    isRead:      row.read_at !== null,
    readAt:      row.read_at    ?? null,
    isDismissed: row.dismissed_at !== null,
    dismissedAt: row.dismissed_at ?? null,
  };
}

// ─── GET /  ───────────────────────────────────────────────────────────────────

/**
 * GET /api/notifications
 *
 * Returns a paginated list of notifications for the authenticated rabbi.
 *
 * Query params:
 *   page   {number}  – 1-based page number (default: 1)
 *   limit  {number}  – items per page (default: 20, max: 100)
 *   unread {string}  – "true" to return only unread notifications
 *
 * Response:
 * {
 *   ok: true,
 *   notifications: [...],
 *   total: number,
 *   unread: number,
 *   page: number,
 *   limit: number,
 *   totalPages: number
 * }
 */
router.get('/', async (req, res, next) => {
  try {
    const rabbiId   = req.rabbi.id;
    const page      = Math.max(1, parseInt(req.query.page, 10)  || 1);
    const limit     = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset    = (page - 1) * limit;
    const onlyUnread = req.query.unread === 'true';

    const { where, params } = buildWhereClause(rabbiId, onlyUnread);

    // Single aggregation query for total + unread counts
    const { rows: countRows } = await dbQuery(
      `SELECT
         COUNT(*)::int                                       AS total,
         COUNT(*) FILTER (WHERE read_at IS NULL)::int       AS unread
       FROM notifications_log
       ${where}`,
      params
    );

    const total  = countRows[0].total;
    const unread = countRows[0].unread;

    // Paginated list
    const { rows } = await dbQuery(
      `SELECT
         id, type, channel, content,
         sent_at, status, read_at, dismissed_at
       FROM notifications_log
       ${where}
       ORDER BY sent_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    return res.json({
      ok:            true,
      notifications: rows.map(formatNotification),
      total,
      unread,
      page,
      limit,
      totalPages:    Math.ceil(total / limit),
    });
  } catch (err) {
    return next(err);
  }
});

// ─── GET /unread-count ────────────────────────────────────────────────────────

/**
 * GET /api/notifications/unread-count
 *
 * Returns only the unread notification count for the badge.
 * Lightweight endpoint suitable for polling every 30–60 seconds.
 *
 * Response: { ok: true, unread: number }
 */
router.get('/unread-count', async (req, res, next) => {
  try {
    const rabbiId = req.rabbi.id;

    const { rows } = await dbQuery(
      `SELECT COUNT(*)::int AS unread
       FROM   notifications_log
       WHERE  rabbi_id     = $1
         AND  read_at      IS NULL
         AND  dismissed_at IS NULL`,
      [rabbiId]
    );

    return res.json({
      ok:     true,
      unread: rows[0]?.unread ?? 0,
    });
  } catch (err) {
    return next(err);
  }
});

// ─── PATCH /:id/read ──────────────────────────────────────────────────────────

/**
 * PATCH /api/notifications/:id/read
 *
 * Mark a single notification as read.
 * Idempotent — if already read, read_at is preserved (COALESCE).
 *
 * Response: { ok: true, id, readAt }
 */
router.patch('/:id/read', async (req, res, next) => {
  try {
    const { id }  = req.params;
    const rabbiId = req.rabbi.id;

    const { rows } = await dbQuery(
      `UPDATE notifications_log
       SET    read_at = COALESCE(read_at, NOW())
       WHERE  id       = $1
         AND  rabbi_id = $2
       RETURNING id, read_at`,
      [id, rabbiId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'התראה לא נמצאה' });
    }

    refreshBadgeAsync(req, rabbiId);

    return res.json({ ok: true, id: rows[0].id, readAt: rows[0].read_at });
  } catch (err) {
    return next(err);
  }
});

// ─── PATCH /read-all ──────────────────────────────────────────────────────────

/**
 * PATCH /api/notifications/read-all
 *
 * Mark all of the authenticated rabbi's unread, non-dismissed notifications
 * as read in a single UPDATE.
 *
 * Response: { ok: true, markedCount: number }
 */
router.patch('/read-all', async (req, res, next) => {
  try {
    const rabbiId = req.rabbi.id;

    const result = await dbQuery(
      `UPDATE notifications_log
       SET    read_at = NOW()
       WHERE  rabbi_id     = $1
         AND  read_at      IS NULL
         AND  dismissed_at IS NULL`,
      [rabbiId]
    );

    refreshBadgeAsync(req, rabbiId);

    return res.json({ ok: true, markedCount: result.rowCount ?? 0 });
  } catch (err) {
    return next(err);
  }
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

/**
 * DELETE /api/notifications/:id
 *
 * Soft-delete (dismiss) a single notification.
 * Sets dismissed_at; the row is excluded from all future list queries.
 * Also marks the notification as read so it no longer counts toward the badge.
 *
 * Response: { ok: true, id, dismissedAt }
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const { id }  = req.params;
    const rabbiId = req.rabbi.id;

    const { rows } = await dbQuery(
      `UPDATE notifications_log
       SET    dismissed_at = COALESCE(dismissed_at, NOW()),
              read_at      = COALESCE(read_at,      NOW())
       WHERE  id       = $1
         AND  rabbi_id = $2
       RETURNING id, dismissed_at`,
      [id, rabbiId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'התראה לא נמצאה' });
    }

    refreshBadgeAsync(req, rabbiId);

    return res.json({
      ok:          true,
      id:          rows[0].id,
      dismissedAt: rows[0].dismissed_at,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
module.exports.router = router;
