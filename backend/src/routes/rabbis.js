'use strict';

/**
 * Rabbi Self-Service Routes — /api/rabbis
 *
 * All routes require a valid JWT (authenticate middleware).
 * Each rabbi may only access and modify their own data unless noted.
 *
 * Endpoints:
 *   GET  /profile                   – own full profile
 *   PUT  /profile                   – update name, signature, phone, is_vacation
 *   PUT  /profile/categories        – update preferred categories
 *   PUT  /profile/notifications     – update notification preferences per event type
 *   GET  /stats                     – this week / last week / all time aggregate stats
 *   GET  /stats/history             – weekly stats rows for chart (last 12 weeks)
 *   GET  /templates                 – list own answer templates
 *   POST /templates                 – create template
 *   PUT  /templates/:id             – edit template
 *   DELETE /templates/:id           – delete template
 *   GET  /leaderboard               – top rabbis this month
 *   GET  /online                    – currently connected rabbi IDs
 */

const express = require('express');

const { query }                       = require('../db/pool');
const { authenticate, requireAdmin }  = require('../middleware/authenticate');
const { getOnlineRabbiIds }           = require('../socket/helpers');
const {
  getRabbiById,
  getRabbiStats,
  getLeaderboard,
  getNotificationPreferences,
  updateNotificationPreferences,
  _currentWeekStart,
  _weekStartNWeeksAgo,
} = require('../services/rabbiService');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Ensure a template belongs to the requesting rabbi.
 * Returns the template row or throws a 404 / 403 with Hebrew message.
 *
 * @param {number} templateId
 * @param {string|number} rabbiId
 * @returns {Promise<object>}
 */
async function _ownTemplate(templateId, rabbiId) {
  const { rows } = await query(
    `SELECT id, rabbi_id, title, content, category_id, created_at
     FROM   rabbi_templates
     WHERE  id = $1`,
    [templateId]
  );
  if (!rows[0]) {
    const err = new Error('תבנית לא נמצאה');
    err.status = 404;
    throw err;
  }
  if (String(rows[0].rabbi_id) !== String(rabbiId)) {
    const err = new Error('אין הרשאה לגשת לתבנית זו');
    err.status = 403;
    throw err;
  }
  return rows[0];
}

// ─── GET / — search/list rabbis ──────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const { search = '', limit = 20 } = req.query;
    const lim = Math.min(parseInt(limit, 10) || 20, 100);
    const params = [];
    let where = 'WHERE r.is_active = true';
    if (search.trim()) {
      params.push(`%${search.trim()}%`);
      where += ` AND (r.name ILIKE $1 OR r.email ILIKE $1)`;
    }
    const { rows } = await query(
      `SELECT id, name, email, role, photo_url, vacation_mode
       FROM rabbis r
       ${where}
       ORDER BY r.name
       LIMIT ${lim}`,
      params
    );
    return res.json({ rabbis: rows });
  } catch (err) { return next(err); }
});

// ─── GET /profile ─────────────────────────────────────────────────────────────

/**
 * Return the authenticated rabbi's full profile.
 */
router.get('/profile', async (req, res, next) => {
  try {
    const rabbi = await getRabbiById(req.rabbi.id);

    // Notification preferences
    const notificationPreferences = await getNotificationPreferences(req.rabbi.id);
    rabbi.notification_preferences = notificationPreferences;

    return res.json({ rabbi });
  } catch (err) {
    return next(err);
  }
});

// ─── PUT /profile ─────────────────────────────────────────────────────────────

/**
 * Update own profile.
 *
 * Accepted fields: name, signature, phone, is_vacation
 */
router.put('/profile', async (req, res, next) => {
  try {
    const { name, signature, phone, is_vacation } = req.body ?? {};

    const setClauses = [];
    const params     = [];
    let   idx        = 1;

    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (trimmed.length < 2 || trimmed.length > 100) {
        return res.status(400).json({ error: 'שם חייב להיות בין 2 ל-100 תווים' });
      }
      params.push(trimmed);
      setClauses.push(`name = $${idx++}`);
    }

    if (signature !== undefined) {
      params.push(signature === null ? null : String(signature).trim().slice(0, 1000));
      setClauses.push(`signature = $${idx++}`);
    }

    if (phone !== undefined) {
      if (phone !== null && !/^\+?[\d\s\-()]{7,20}$/.test(String(phone))) {
        return res.status(400).json({ error: 'מספר טלפון אינו תקין' });
      }
      params.push(phone ? String(phone).trim() : null);
      setClauses.push(`phone = $${idx++}`);
    }

    if (is_vacation !== undefined) {
      if (typeof is_vacation !== 'boolean') {
        return res.status(400).json({ error: 'is_vacation חייב להיות true או false' });
      }
      params.push(is_vacation);
      setClauses.push(`is_vacation = $${idx++}`);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'לא סופקו שדות לעדכון' });
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(req.rabbi.id);

    const { rows } = await query(
      `UPDATE rabbis
       SET    ${setClauses.join(', ')}
       WHERE  id = $${idx}
       RETURNING
         id, name, email, signature, phone,
         is_vacation, status, role, updated_at`,
      params
    );

    return res.json({ rabbi: rows[0] });
  } catch (err) {
    return next(err);
  }
});

// ─── PUT /profile/categories ──────────────────────────────────────────────────

/**
 * Replace the rabbi's preferred category list.
 *
 * Body: { categories: number[] }
 */
router.put('/profile/categories', async (req, res, next) => {
  try {
    const { categories } = req.body ?? {};

    if (!Array.isArray(categories)) {
      return res.status(400).json({ error: 'categories חייב להיות מערך' });
    }
    if (categories.some((c) => !Number.isInteger(c) || c < 1)) {
      return res.status(400).json({ error: 'כל קטגוריה חייבת להיות מספר שלם חיובי' });
    }

    // Verify all category IDs exist
    if (categories.length > 0) {
      const { rows: catRows } = await query(
        `SELECT id FROM categories WHERE id = ANY($1::int[]) AND deleted_at IS NULL`,
        [categories]
      );
      if (catRows.length !== categories.length) {
        return res.status(400).json({ error: 'אחת או יותר מהקטגוריות לא נמצאו' });
      }
    }

    const { rows } = await query(
      `UPDATE rabbis
       SET    preferred_categories = $1,
              updated_at           = NOW()
       WHERE  id = $2
       RETURNING id, preferred_categories, updated_at`,
      [categories, req.rabbi.id]
    );

    return res.json({
      message:              'הקטגוריות המועדפות עודכנו בהצלחה',
      preferred_categories: rows[0].preferred_categories,
    });
  } catch (err) {
    return next(err);
  }
});

// ─── GET /profile/vacation ────────────────────────────────────────────────────

router.get('/profile/vacation', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT is_vacation FROM rabbis WHERE id = $1`,
      [req.rabbi.id]
    );
    return res.json({
      is_vacation: rows[0]?.is_vacation ?? false,
      return_date: null,
    });
  } catch (err) { return next(err); }
});

// ─── PUT /profile/vacation ────────────────────────────────────────────────────

router.put('/profile/vacation', async (req, res, next) => {
  try {
    const { is_vacation } = req.body ?? {};
    if (typeof is_vacation !== 'boolean') {
      return res.status(400).json({ error: 'is_vacation חייב להיות true או false' });
    }
    const { rows } = await query(
      `UPDATE rabbis SET is_vacation = $1, updated_at = NOW() WHERE id = $2 RETURNING is_vacation`,
      [is_vacation, req.rabbi.id]
    );
    return res.json({ is_vacation: rows[0].is_vacation, return_date: null });
  } catch (err) { return next(err); }
});

// ─── GET /profile/availability ──────────────────────────────────────────────

router.get('/profile/availability', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT availability_hours FROM rabbis WHERE id = $1`,
      [req.rabbi.id]
    );
    return res.json({
      availability_hours: rows[0]?.availability_hours ?? {},
    });
  } catch (err) { return next(err); }
});

// ─── PUT /profile/availability ──────────────────────────────────────────────

/**
 * Update the rabbi's weekly availability hours.
 *
 * Body: { availability_hours: { sun: { enabled, start, end }, mon: ..., ... } }
 *
 * Each day key (sun–sat) maps to an object with:
 *   enabled {boolean}  — whether the rabbi is available on this day
 *   start   {string}   — HH:MM start time (e.g. "08:00")
 *   end     {string}   — HH:MM end time   (e.g. "22:00")
 *
 * If a day key is missing or enabled is false, the rabbi is unavailable that day.
 */
router.put('/profile/availability', async (req, res, next) => {
  try {
    const { availability_hours } = req.body ?? {};
    if (!availability_hours || typeof availability_hours !== 'object') {
      return res.status(400).json({ error: 'availability_hours חייב להיות אובייקט' });
    }

    const VALID_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

    // Validate structure
    for (const [day, val] of Object.entries(availability_hours)) {
      if (!VALID_DAYS.includes(day)) {
        return res.status(400).json({ error: `יום לא תקין: ${day}` });
      }
      if (val === null) continue;
      if (typeof val !== 'object') {
        return res.status(400).json({ error: `ערך לא תקין ליום ${day}` });
      }
      if (val.enabled && val.start && !TIME_RE.test(val.start)) {
        return res.status(400).json({ error: `שעת התחלה לא תקינה ליום ${day}` });
      }
      if (val.enabled && val.end && !TIME_RE.test(val.end)) {
        return res.status(400).json({ error: `שעת סיום לא תקינה ליום ${day}` });
      }
    }

    const { rows } = await query(
      `UPDATE rabbis
       SET availability_hours = $1::jsonb, updated_at = NOW()
       WHERE id = $2
       RETURNING availability_hours`,
      [JSON.stringify(availability_hours), req.rabbi.id]
    );
    return res.json({ availability_hours: rows[0].availability_hours });
  } catch (err) { return next(err); }
});

// ─── GET /profile/notifications ───────────────────────────────────────────────

router.get('/profile/notifications', async (req, res, next) => {
  try {
    const prefs = await getNotificationPreferences(req.rabbi.id);
    return res.json({ preferences: prefs });
  } catch (err) { return next(err); }
});

// ─── PUT /profile/notifications ───────────────────────────────────────────────

/**
 * Update notification preferences per event type.
 *
 * Body: { preferences: Array<{ event_type, channel, enabled }> }
 *
 * Valid channels: email | whatsapp | both | push
 */
router.put('/profile/notifications', async (req, res, next) => {
  try {
    const { preferences } = req.body ?? {};

    if (!Array.isArray(preferences) || preferences.length === 0) {
      return res.status(400).json({ error: 'preferences חייב להיות מערך לא ריק' });
    }

    const VALID_CHANNELS = new Set(['email', 'whatsapp', 'both', 'push']);

    for (const pref of preferences) {
      if (!pref.event_type || typeof pref.event_type !== 'string') {
        return res.status(400).json({ error: 'כל העדפה חייבת לכלול event_type' });
      }
      if (!VALID_CHANNELS.has(pref.channel)) {
        return res.status(400).json({
          error: `ערוץ לא חוקי "${pref.channel}" — email | whatsapp | both | push`,
        });
      }
      if (typeof pref.enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled חייב להיות true או false' });
      }
    }

    await updateNotificationPreferences(req.rabbi.id, preferences);

    const updated = await getNotificationPreferences(req.rabbi.id);
    return res.json({
      message:                 'העדפות ההתראות עודכנו בהצלחה',
      notification_preferences: updated,
    });
  } catch (err) {
    return next(err);
  }
});

// ─── GET /stats ───────────────────────────────────────────────────────────────

/**
 * Return aggregate stats for three periods: this_week, last_week, all_time.
 */
router.get('/stats', async (req, res, next) => {
  try {
    const [thisWeek, lastWeek, allTime] = await Promise.all([
      getRabbiStats(req.rabbi.id, 'this_week'),
      getRabbiStats(req.rabbi.id, 'last_week'),
      getRabbiStats(req.rabbi.id, 'all_time'),
    ]);

    return res.json({
      this_week: thisWeek,
      last_week: lastWeek,
      all_time:  allTime,
    });
  } catch (err) {
    return next(err);
  }
});

// ─── GET /stats/history ───────────────────────────────────────────────────────

/**
 * Return weekly stats rows for the last 12 weeks (suitable for charting).
 *
 * Query params:
 *   weeks — number of weeks to include (default 12, max 52)
 */
router.get('/stats/history', async (req, res, next) => {
  try {
    const weeksBack = Math.min(
      Math.max(parseInt(req.query.weeks, 10) || 12, 1),
      52
    );

    const since = _weekStartNWeeksAgo(weeksBack);

    const { rows } = await query(
      `SELECT
         week_start,
         answers_count,
         views_count,
         thanks_count,
         avg_response_minutes,
         avg_response_time_hours
       FROM rabbi_stats
       WHERE rabbi_id  = $1
         AND week_start >= $2
       ORDER BY week_start ASC`,
      [req.rabbi.id, since]
    );

    return res.json({ history: rows, weeks: weeksBack });
  } catch (err) {
    return next(err);
  }
});

// ─── GET /templates ───────────────────────────────────────────────────────────

/**
 * List all answer templates belonging to the authenticated rabbi.
 *
 * Query params:
 *   category_id — optional filter
 */
router.get('/templates', async (req, res, next) => {
  try {
    const params  = [req.rabbi.id];
    let   filter  = '';

    if (req.query.category_id) {
      const catId = parseInt(req.query.category_id, 10);
      if (!Number.isFinite(catId)) {
        return res.status(400).json({ error: 'category_id חייב להיות מספר שלם' });
      }
      params.push(catId);
      filter = `AND t.category_id = $2`;
    }

    const { rows } = await query(
      `SELECT
         t.id,
         t.title,
         t.content,
         t.category_id,
         t.shortcut,
         t.usage_count,
         c.name AS category_name,
         t.created_at
       FROM rabbi_templates t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.rabbi_id = $1
         ${filter}
       ORDER BY t.created_at DESC`,
      params
    );

    return res.json({ templates: rows });
  } catch (err) {
    return next(err);
  }
});

// ─── POST /templates ──────────────────────────────────────────────────────────

/**
 * Create a new answer template.
 *
 * Body: { title, content, category_id? }
 */
router.post('/templates', async (req, res, next) => {
  try {
    const { title, content, category_id, shortcut } = req.body ?? {};

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'כותרת התבנית היא שדה חובה' });
    }
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'תוכן התבנית הוא שדה חובה' });
    }
    if (title.trim().length > 200) {
      return res.status(400).json({ error: 'כותרת התבנית ארוכה מדי (עד 200 תווים)' });
    }

    let resolvedCategoryId = null;
    if (category_id != null) {
      const catId = parseInt(category_id, 10);
      if (!Number.isFinite(catId)) {
        return res.status(400).json({ error: 'category_id חייב להיות מספר שלם' });
      }
      const { rows: catCheck } = await query(
        `SELECT id FROM categories WHERE id = $1 AND deleted_at IS NULL`,
        [catId]
      );
      if (!catCheck[0]) {
        return res.status(400).json({ error: 'קטגוריה לא נמצאה' });
      }
      resolvedCategoryId = catId;
    }

    const resolvedShortcut = shortcut ? String(shortcut).trim().slice(0, 50) : null;

    const { rows } = await query(
      `INSERT INTO rabbi_templates (rabbi_id, title, content, category_id, shortcut, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id, rabbi_id, title, content, category_id, shortcut, usage_count, created_at`,
      [req.rabbi.id, title.trim(), content.trim(), resolvedCategoryId, resolvedShortcut]
    );

    return res.status(201).json({
      message:  'התבנית נוצרה בהצלחה',
      template: rows[0],
    });
  } catch (err) {
    return next(err);
  }
});

// ─── PUT /templates/:id ───────────────────────────────────────────────────────

/**
 * Edit an existing answer template (own templates only).
 *
 * Body: { title?, content?, category_id? }
 */
router.put('/templates/:id', async (req, res, next) => {
  try {
    const templateId = parseInt(req.params.id, 10);
    if (!Number.isFinite(templateId)) {
      return res.status(400).json({ error: 'מזהה תבנית אינו תקין' });
    }

    // Ownership check
    await _ownTemplate(templateId, req.rabbi.id);

    const { title, content, category_id, shortcut } = req.body ?? {};

    const setClauses = [];
    const params     = [];
    let   idx        = 1;

    if (title !== undefined) {
      const trimmed = String(title).trim();
      if (!trimmed || trimmed.length > 200) {
        return res.status(400).json({ error: 'כותרת אינה תקינה (1–200 תווים)' });
      }
      params.push(trimmed);
      setClauses.push(`title = $${idx++}`);
    }

    if (content !== undefined) {
      const trimmed = String(content).trim();
      if (!trimmed) {
        return res.status(400).json({ error: 'תוכן התבנית לא יכול להיות ריק' });
      }
      params.push(trimmed);
      setClauses.push(`content = $${idx++}`);
    }

    if (shortcut !== undefined) {
      params.push(shortcut ? String(shortcut).trim().slice(0, 50) : null);
      setClauses.push(`shortcut = $${idx++}`);
    }

    if (category_id !== undefined) {
      if (category_id === null) {
        params.push(null);
        setClauses.push(`category_id = $${idx++}`);
      } else {
        const catId = parseInt(category_id, 10);
        if (!Number.isFinite(catId)) {
          return res.status(400).json({ error: 'category_id חייב להיות מספר שלם' });
        }
        const { rows: catCheck } = await query(
          `SELECT id FROM categories WHERE id = $1 AND deleted_at IS NULL`,
          [catId]
        );
        if (!catCheck[0]) {
          return res.status(400).json({ error: 'קטגוריה לא נמצאה' });
        }
        params.push(catId);
        setClauses.push(`category_id = $${idx++}`);
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'לא סופקו שדות לעדכון' });
    }

    params.push(templateId);

    const { rows } = await query(
      `UPDATE rabbi_templates
       SET    ${setClauses.join(', ')}
       WHERE  id = $${idx}
       RETURNING id, rabbi_id, title, content, category_id, shortcut, usage_count, created_at`,
      params
    );

    return res.json({ message: 'התבנית עודכנה בהצלחה', template: rows[0] });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
});

// ─── DELETE /templates/:id ────────────────────────────────────────────────────

/**
 * Delete an answer template (own templates only).
 */
router.delete('/templates/:id', async (req, res, next) => {
  try {
    const templateId = parseInt(req.params.id, 10);
    if (!Number.isFinite(templateId)) {
      return res.status(400).json({ error: 'מזהה תבנית אינו תקין' });
    }

    // Ownership check
    await _ownTemplate(templateId, req.rabbi.id);

    await query(
      `DELETE FROM rabbi_templates WHERE id = $1`,
      [templateId]
    );

    return res.json({ message: 'התבנית נמחקה בהצלחה' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
});

// ─── GET /leaderboard ─────────────────────────────────────────────────────────

/**
 * Top rabbis by answers this month.
 *
 * Admin: returns full data (name + stats).
 * Rabbi: returns anonymized data (rank + stats only, name hidden).
 *
 * Query params:
 *   limit — default 10, max 50
 */
router.get('/leaderboard', async (req, res, next) => {
  try {
    const limit      = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const isAdmin    = req.rabbi.role === 'admin';
    const myRabbiId  = String(req.rabbi.id);

    const leaderboard = await getLeaderboard(limit);

    const result = leaderboard.map((entry) => {
      const isSelf = String(entry.rabbi_id) === myRabbiId;

      if (isAdmin || isSelf) {
        return entry; // full data
      }

      // Anonymize for non-admin
      return {
        rank:               entry.rank,
        answers_count:      entry.answers_count,
        avg_response_hours: entry.avg_response_hours,
        thanks_count:       entry.thanks_count,
        views_count:        entry.views_count,
        is_me:              false,
      };
    });

    // Mark self for non-admin so the UI can highlight the rabbi's own row
    if (!isAdmin) {
      for (const entry of result) {
        const original = leaderboard[result.indexOf(entry)];
        if (String(original.rabbi_id) === myRabbiId) {
          entry.is_me = true;
        }
      }
    }

    return res.json({ leaderboard: result });
  } catch (err) {
    return next(err);
  }
});

// ─── PUT /profile/fcm-token ───────────────────────────────────────────────────

/**
 * Register or update the FCM device token for the authenticated rabbi.
 *
 * Body: { fcm_token: string | null }
 */
router.put('/profile/fcm-token', async (req, res, next) => {
  try {
    const { fcm_token } = req.body ?? {};
    const token = fcm_token ? String(fcm_token).trim() : null;

    const fcm = require('../services/fcmService');
    await fcm.registerToken(req.rabbi.id, token);

    return res.json({ message: 'FCM token עודכן בהצלחה' });
  } catch (err) {
    return next(err);
  }
});

// ─── GET /online ──────────────────────────────────────────────────────────────

/**
 * Return the list of currently connected rabbi IDs via Socket.io.
 * Available to all authenticated rabbis.
 */
router.get('/online', async (req, res, next) => {
  try {
    const io        = req.app.get('io');
    const onlineIds = getOnlineRabbiIds(io);

    // Fetch rabbi details for the online IDs
    let rabbis = [];
    if (onlineIds.length > 0) {
      const placeholders = onlineIds.map((_, i) => `$${i + 1}`).join(',');
      const { rows } = await query(
        `SELECT id, name, email, role FROM rabbis WHERE id IN (${placeholders}) AND is_active = true`,
        onlineIds
      );
      rabbis = rows.map((r) => ({ ...r, is_online: true }));
    }

    return res.json({ rabbis, online: onlineIds, count: onlineIds.length });
  } catch (err) {
    return next(err);
  }
});

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = router;
