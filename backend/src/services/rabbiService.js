'use strict';

/**
 * Rabbi Service — Business Logic
 *
 * Exports:
 *   getRabbiById(id)
 *   updateAchievements(rabbiId)
 *   getWeeklyTopRabbi()
 *   getRabbisForBroadcast(categoryId, urgentOnly)
 *   buildLeaderboard(period)
 *   getRabbiStats(rabbiId, period)
 *   updateWeeklyStats()
 *   getRabbiOfWeek()
 *   getLeaderboard(limit)
 *   createRabbi(data)
 *   getNotificationPreferences(rabbiId)
 *   updateNotificationPreferences(rabbiId, preferences)
 */

const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const { query, withTransaction } = require('../db/pool');

// ─── Constants ────────────────────────────────────────────────────────────────

/** Answer milestones that trigger badge awards. */
const ANSWER_MILESTONES = [
  { count: 1,   badge: 'first_answer'    },
  { count: 10,  badge: 'ten_answers'     },
  { count: 50,  badge: 'fifty_answers'   },
  { count: 100, badge: 'hundred_answers' },
];

const BCRYPT_ROUNDS       = 12;
const TEMP_PASSWORD_BYTES = 10; // hex → 20 chars

/** Max avg response time (in minutes) to qualify as rabbi-of-week */
const RABBI_OF_WEEK_MAX_AVG_MINUTES = 8 * 60; // 8 hours

// ─── Internal date helpers ────────────────────────────────────────────────────

/**
 * ISO date string for the most recent Sunday (start of current week, UTC).
 * @returns {string}  e.g. "2024-01-07"
 */
function _currentWeekStart() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/**
 * ISO date string for the Sunday before the current week.
 * @returns {string}
 */
function _previousWeekStart() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - day - 7);
  return d.toISOString().slice(0, 10);
}

/**
 * ISO date string for N weeks ago (Sunday).
 * @param {number} n
 * @returns {string}
 */
function _weekStartNWeeksAgo(n) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - day - n * 7);
  return d.toISOString().slice(0, 10);
}

// ─── getRabbiById ─────────────────────────────────────────────────────────────

/**
 * Fetch a single rabbi with their assigned categories and current-week stats.
 *
 * @param {string|number} id  Rabbi primary key
 * @returns {Promise<object>} Rabbi row enriched with categories[] and stats{}
 * @throws  {Error}           404 when the rabbi does not exist
 */
async function getRabbiById(id) {
  const { rows } = await query(
    `SELECT
       r.id,
       r.name,
       r.email,
       r.role,
       r.signature,
       r.status,
       r.is_available,
       r.is_vacation,
       r.notification_pref,
       r.whatsapp_number,
       r.max_concurrent_questions,
       r.must_change_password,
       r.preferred_categories,
       r.last_login_at,
       r.created_at
     FROM rabbis r
     WHERE r.id = $1`,
    [id]
  );

  if (!rows[0]) {
    const err = new Error('רב לא נמצא');
    err.status = 404;
    throw err;
  }

  const rabbi = rows[0];

  // ── Assigned categories ──────────────────────────────────────────────────
  const { rows: catRows } = await query(
    `SELECT c.id, c.name, c.parent_id
     FROM   categories c
     JOIN   rabbi_categories rc ON rc.category_id = c.id
     WHERE  rc.rabbi_id = $1
     ORDER  BY c.sort_order, c.name`,
    [id]
  );
  rabbi.categories = catRows;

  // ── Current-week stats ───────────────────────────────────────────────────
  const weekStart = _currentWeekStart();
  const { rows: statRows } = await query(
    `SELECT
       answers_count,
       avg_response_time_hours,
       views_count,
       thanks_count,
       week_start
     FROM rabbi_stats
     WHERE rabbi_id = $1
       AND week_start = $2`,
    [id, weekStart]
  );
  rabbi.current_week_stats = statRows[0] || {
    answers_count: 0,
    avg_response_time_hours: null,
    views_count: 0,
    thanks_count: 0,
    week_start: weekStart,
  };

  return rabbi;
}

// ─── updateAchievements ───────────────────────────────────────────────────────

/**
 * Check whether the rabbi has crossed any answer-count milestones since the
 * last time this ran, and insert a new badge row for each newly crossed one.
 *
 * @param {string|number} rabbiId
 * @returns {Promise<string[]>} Array of newly awarded badge types (may be empty)
 */
async function updateAchievements(rabbiId) {
  const { rows: countRows } = await query(
    `SELECT COUNT(*) AS total
     FROM   answers
     WHERE  rabbi_id = $1`,
    [rabbiId]
  );
  const total = parseInt(countRows[0]?.total ?? 0, 10);

  const { rows: existingRows } = await query(
    `SELECT badge_type
     FROM   rabbi_achievements
     WHERE  rabbi_id = $1
       AND  badge_type <> 'rabbi_of_week'`,
    [rabbiId]
  );
  const existingBadges = new Set(existingRows.map((r) => r.badge_type));

  const newBadges = [];

  for (const { count, badge } of ANSWER_MILESTONES) {
    if (total >= count && !existingBadges.has(badge)) {
      await query(
        `INSERT INTO rabbi_achievements (rabbi_id, badge_type, earned_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT DO NOTHING`,
        [rabbiId, badge]
      );
      newBadges.push(badge);
    }
  }

  if (newBadges.length > 0) {
    console.info(
      `[rabbiService] updateAchievements: rabbi ${rabbiId} earned new badges — ${newBadges.join(', ')}`
    );
  }

  return newBadges;
}

// ─── getWeeklyTopRabbi ────────────────────────────────────────────────────────

/**
 * Determine the top rabbi for the most recently completed week.
 *
 * @returns {Promise<object|null>}
 */
async function getWeeklyTopRabbi() {
  const prevWeekStart = _previousWeekStart();

  const { rows } = await query(
    `SELECT
       r.id,
       r.name,
       r.email,
       r.signature,
       rs.answers_count,
       rs.avg_response_time_hours,
       rs.thanks_count,
       rs.views_count,
       rs.week_start
     FROM   rabbi_stats rs
     JOIN   rabbis r ON r.id = rs.rabbi_id
     WHERE  rs.week_start = $1
       AND  rs.answers_count > 0
       AND  r.status = 'active'
     ORDER  BY rs.answers_count DESC,
               rs.avg_response_time_hours ASC NULLS LAST,
               rs.thanks_count DESC
     LIMIT  1`,
    [prevWeekStart]
  );

  return rows[0] || null;
}

// ─── getRabbisForBroadcast ────────────────────────────────────────────────────

/**
 * Return rabbis who should receive a broadcast for a given question category.
 *
 * @param {number|null} categoryId
 * @param {boolean}     [urgentOnly]
 * @returns {Promise<object[]>}
 */
async function getRabbisForBroadcast(categoryId, urgentOnly = false) {
  const params = [];
  let paramIdx = 1;

  let urgentFilter = '';
  if (urgentOnly) {
    urgentFilter = `
      AND (
        (r.notification_pref->>'push')::boolean = true
        OR (r.notification_pref->>'whatsapp')::boolean = true
      )`;
  }

  let categoryFilter = '';
  if (categoryId != null) {
    params.push(categoryId);
    categoryFilter = `
      AND (
        r.preferred_categories IS NULL
        OR cardinality(r.preferred_categories) = 0
        OR $${paramIdx} = ANY(r.preferred_categories)
      )`;
    paramIdx++;
  }

  const { rows } = await query(
    `SELECT
       r.id,
       r.name,
       r.email,
       r.whatsapp_number,
       r.notification_pref,
       r.max_concurrent_questions
     FROM rabbis r
     WHERE r.status     = 'active'
       AND r.is_vacation = false
       AND r.is_available = true
       ${categoryFilter}
       ${urgentFilter}
     ORDER BY r.name`,
    params
  );

  return rows;
}

// ─── buildLeaderboard ─────────────────────────────────────────────────────────

/**
 * Build a ranked leaderboard of rabbis by answers_count for the given period.
 *
 * @param {'current_week'|'previous_week'|'all_time'} [period='current_week']
 * @returns {Promise<Array>}
 */
async function buildLeaderboard(period = 'current_week') {
  let weekFilter = '';
  const params = [];

  if (period === 'current_week') {
    params.push(_currentWeekStart());
    weekFilter = `WHERE rs.week_start = $1`;
  } else if (period === 'previous_week') {
    params.push(_previousWeekStart());
    weekFilter = `WHERE rs.week_start = $1`;
  }

  let sql;
  if (period === 'all_time') {
    sql = `
      SELECT
        r.id            AS rabbi_id,
        r.name,
        SUM(rs.answers_count)                              AS answers_count,
        ROUND(AVG(rs.avg_response_time_hours)::numeric, 1) AS avg_response_time_hours,
        SUM(rs.thanks_count)                               AS thanks_count,
        SUM(rs.views_count)                                AS views_count
      FROM   rabbi_stats rs
      JOIN   rabbis r ON r.id = rs.rabbi_id
      WHERE  r.status = 'active'
      GROUP  BY r.id, r.name
      ORDER  BY answers_count DESC, avg_response_time_hours ASC NULLS LAST
    `;
  } else {
    sql = `
      SELECT
        r.id            AS rabbi_id,
        r.name,
        rs.answers_count,
        rs.avg_response_time_hours,
        rs.thanks_count,
        rs.views_count,
        rs.week_start
      FROM   rabbi_stats rs
      JOIN   rabbis r ON r.id = rs.rabbi_id
      ${weekFilter}
        AND  r.status = 'active'
      ORDER  BY rs.answers_count DESC,
                rs.avg_response_time_hours ASC NULLS LAST
    `;
  }

  const { rows } = await query(sql, params);
  return rows.map((row, idx) => ({ rank: idx + 1, ...row }));
}

// ─── getRabbiStats ────────────────────────────────────────────────────────────

/**
 * Aggregate stats for a rabbi from the questions/answers tables directly.
 *
 * @param {string|number} rabbiId
 * @param {'this_week'|'last_week'|'all_time'} period
 * @returns {Promise<{
 *   answers_count: number,
 *   views_count: number,
 *   thanks_count: number,
 *   avg_response_minutes: number|null
 * }>}
 */
async function getRabbiStats(rabbiId, period) {
  let dateFilter = '';
  const params = [rabbiId];
  let idx = 2;

  if (period === 'this_week') {
    params.push(_currentWeekStart());
    dateFilter = `AND a.published_at >= $${idx++}::date`;
  } else if (period === 'last_week') {
    params.push(_previousWeekStart());
    params.push(_currentWeekStart());
    dateFilter = `AND a.published_at >= $${idx++}::date AND a.published_at < $${idx++}::date`;
  }
  // all_time — no date filter

  const { rows } = await query(
    `SELECT
       COUNT(a.id)                                                AS answers_count,
       COALESCE(SUM(q.view_count), 0)                            AS views_count,
       COALESCE(SUM(q.thank_count), 0)                           AS thanks_count,
       ROUND(
         AVG(
           EXTRACT(EPOCH FROM (a.published_at - q.lock_timestamp)) / 60
         )::numeric,
         1
       )                                                          AS avg_response_minutes
     FROM   answers a
     JOIN   questions q ON q.id = a.question_id
     WHERE  a.rabbi_id = $1
       AND  a.published_at IS NOT NULL
       ${dateFilter}`,
    params
  );

  const row = rows[0];
  return {
    answers_count:        parseInt(row.answers_count, 10),
    views_count:          parseInt(row.views_count, 10),
    thanks_count:         parseInt(row.thanks_count, 10),
    avg_response_minutes: row.avg_response_minutes != null
      ? parseFloat(row.avg_response_minutes)
      : null,
  };
}

// ─── updateWeeklyStats ────────────────────────────────────────────────────────

/**
 * Compute stats for the most recently completed week and upsert into rabbi_stats.
 * Intended to be called by a cron job at the end of every Sunday.
 *
 * @returns {Promise<number>} Number of rabbi rows upserted
 */
async function updateWeeklyStats() {
  const prevWeekStart = _previousWeekStart();
  const thisWeekStart = _currentWeekStart();

  // Aggregate answers for every active rabbi in the previous week
  const { rows: statsRows } = await query(
    `SELECT
       a.rabbi_id,
       COUNT(a.id)                                                    AS answers_count,
       COALESCE(SUM(q.view_count), 0)                                 AS views_count,
       COALESCE(SUM(q.thank_count), 0)                                AS thanks_count,
       ROUND(
         AVG(
           EXTRACT(EPOCH FROM (a.published_at - q.lock_timestamp)) / 60
         )::numeric,
         1
       )                                                               AS avg_response_minutes,
       ROUND(
         AVG(
           EXTRACT(EPOCH FROM (a.published_at - q.lock_timestamp)) / 3600
         )::numeric,
         2
       )                                                               AS avg_response_time_hours
     FROM   answers a
     JOIN   questions q ON q.id = a.question_id
     WHERE  a.published_at >= $1::date
       AND  a.published_at  < $2::date
       AND  a.published_at IS NOT NULL
     GROUP  BY a.rabbi_id`,
    [prevWeekStart, thisWeekStart]
  );

  if (statsRows.length === 0) {
    console.info('[rabbiService] updateWeeklyStats: אין נתונים לשבוע הקודם');
    return 0;
  }

  let upsertedCount = 0;

  for (const row of statsRows) {
    await query(
      `INSERT INTO rabbi_stats
         (rabbi_id, week_start, answers_count, views_count, thanks_count,
          avg_response_minutes, avg_response_time_hours)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (rabbi_id, week_start)
       DO UPDATE SET
         answers_count          = EXCLUDED.answers_count,
         views_count            = EXCLUDED.views_count,
         thanks_count           = EXCLUDED.thanks_count,
         avg_response_minutes   = EXCLUDED.avg_response_minutes,
         avg_response_time_hours = EXCLUDED.avg_response_time_hours`,
      [
        row.rabbi_id,
        prevWeekStart,
        parseInt(row.answers_count, 10),
        parseInt(row.views_count, 10),
        parseInt(row.thanks_count, 10),
        row.avg_response_minutes != null ? parseFloat(row.avg_response_minutes) : null,
        row.avg_response_time_hours != null ? parseFloat(row.avg_response_time_hours) : null,
      ]
    );
    upsertedCount++;
  }

  console.info(`[rabbiService] updateWeeklyStats: עודכנו ${upsertedCount} רבנים לשבוע ${prevWeekStart}`);
  return upsertedCount;
}

// ─── getRabbiOfWeek ───────────────────────────────────────────────────────────

/**
 * Find the rabbi with the most answers in the last 7 days with an average
 * response time below 8 hours.
 *
 * Returns null if no rabbi meets the criteria.
 *
 * @returns {Promise<object|null>}
 */
async function getRabbiOfWeek() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
  const since = sevenDaysAgo.toISOString();

  const { rows } = await query(
    `SELECT
       r.id,
       r.name,
       r.email,
       r.signature,
       COUNT(a.id)                                                   AS answers_count,
       ROUND(
         AVG(
           EXTRACT(EPOCH FROM (a.published_at - q.lock_timestamp)) / 60
         )::numeric,
         1
       )                                                              AS avg_response_minutes,
       ROUND(
         AVG(
           EXTRACT(EPOCH FROM (a.published_at - q.lock_timestamp)) / 3600
         )::numeric,
         2
       )                                                              AS avg_response_hours
     FROM   answers a
     JOIN   questions q ON q.id = a.question_id
     JOIN   rabbis r ON r.id = a.rabbi_id
     WHERE  a.published_at >= $1
       AND  a.published_at IS NOT NULL
       AND  q.lock_timestamp IS NOT NULL
       AND  r.status = 'active'
     GROUP  BY r.id, r.name, r.email, r.signature
     HAVING AVG(
              EXTRACT(EPOCH FROM (a.published_at - q.lock_timestamp)) / 60
            ) < $2
     ORDER  BY answers_count DESC, avg_response_minutes ASC
     LIMIT  1`,
    [since, RABBI_OF_WEEK_MAX_AVG_MINUTES]
  );

  if (!rows[0]) return null;

  return {
    ...rows[0],
    answers_count: parseInt(rows[0].answers_count, 10),
  };
}

// ─── getLeaderboard ───────────────────────────────────────────────────────────

/**
 * Return the top N rabbis this calendar month, ranked by answers_count.
 *
 * @param {number} [limit=10]
 * @returns {Promise<Array<{rank: number, rabbi_id, name, answers_count, avg_response_hours, thanks_count}>>}
 */
async function getLeaderboard(limit = 10) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

  // First day of current month (UTC)
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);

  const { rows } = await query(
    `SELECT
       r.id                                                          AS rabbi_id,
       r.name,
       COUNT(a.id)                                                   AS answers_count,
       ROUND(
         AVG(
           EXTRACT(EPOCH FROM (a.published_at - q.lock_timestamp)) / 3600
         )::numeric,
         2
       )                                                              AS avg_response_hours,
       COALESCE(SUM(q.thank_count), 0)                               AS thanks_count,
       COALESCE(SUM(q.view_count), 0)                                AS views_count
     FROM   answers a
     JOIN   questions q ON q.id = a.question_id
     JOIN   rabbis r ON r.id = a.rabbi_id
     WHERE  a.published_at >= $1::date
       AND  a.published_at IS NOT NULL
       AND  r.status = 'active'
     GROUP  BY r.id, r.name
     ORDER  BY answers_count DESC, avg_response_hours ASC NULLS LAST
     LIMIT  $2`,
    [monthStart, safeLimit]
  );

  return rows.map((row, idx) => ({
    rank:               idx + 1,
    rabbi_id:           row.rabbi_id,
    name:               row.name,
    answers_count:      parseInt(row.answers_count, 10),
    avg_response_hours: row.avg_response_hours != null ? parseFloat(row.avg_response_hours) : null,
    thanks_count:       parseInt(row.thanks_count, 10),
    views_count:        parseInt(row.views_count, 10),
  }));
}

// ─── createRabbi ──────────────────────────────────────────────────────────────

/**
 * Insert a new rabbi, generate a temporary password, and return both the new
 * rabbi record and the plaintext temporary password so the caller can email it.
 *
 * @param {{
 *   name: string,
 *   email: string,
 *   role?: string,
 *   phone?: string,
 *   signature?: string,
 *   preferred_categories?: number[],
 *   notification_channel?: string,
 *   color_label?: string,
 * }} data
 * @returns {Promise<{ rabbi: object, tempPassword: string }>}
 * @throws {Error} 409 when the email is already registered
 */
async function createRabbi(data) {
  const {
    name,
    email,
    role = 'rabbi',
    phone,
    signature,
    preferred_categories = [],
    notification_channel = 'email',
    color_label,
  } = data;

  // Guard: unique email
  const { rows: existing } = await query(
    `SELECT id FROM rabbis WHERE email = $1`,
    [email.toLowerCase().trim()]
  );
  if (existing[0]) {
    const err = new Error('כתובת אימייל זו כבר רשומה במערכת');
    err.status = 409;
    throw err;
  }

  const tempPassword = crypto.randomBytes(TEMP_PASSWORD_BYTES).toString('hex');
  const passwordHash  = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

  const rabbi = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO rabbis (
         name, email, password_hash, role, signature, phone,
         preferred_categories, notification_channel, color_label,
         status, is_vacation, must_change_password, created_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9,
         'active', false, true, NOW()
       )
       RETURNING
         id, name, email, role, signature, phone,
         preferred_categories, notification_channel, color_label,
         status, is_vacation, must_change_password, created_at`,
      [
        name.trim(),
        email.toLowerCase().trim(),
        passwordHash,
        role,
        signature?.trim() || null,
        phone?.trim() || null,
        preferred_categories,
        notification_channel,
        color_label || null,
      ]
    );
    return rows[0];
  });

  return { rabbi, tempPassword };
}

// ─── getNotificationPreferences ───────────────────────────────────────────────

/**
 * Return a rabbi's notification preferences as a map keyed by event_type.
 *
 * @param {string|number} rabbiId
 * @returns {Promise<Record<string, { channel: string, enabled: boolean }>>}
 */
async function getNotificationPreferences(rabbiId) {
  const { rows } = await query(
    `SELECT event_type, channel, enabled
     FROM   notification_preferences
     WHERE  rabbi_id = $1
     ORDER  BY event_type`,
    [rabbiId]
  );

  const map = {};
  for (const row of rows) {
    map[row.event_type] = { channel: row.channel, enabled: row.enabled };
  }
  return map;
}

// ─── updateNotificationPreferences ───────────────────────────────────────────

/**
 * Upsert an array of notification preferences for a rabbi.
 *
 * @param {string|number} rabbiId
 * @param {Array<{ event_type: string, channel: string, enabled: boolean }>} preferences
 * @returns {Promise<void>}
 */
async function updateNotificationPreferences(rabbiId, preferences) {
  if (!Array.isArray(preferences) || preferences.length === 0) return;

  await withTransaction(async (client) => {
    for (const pref of preferences) {
      const { event_type, channel, enabled } = pref;
      await client.query(
        `INSERT INTO notification_preferences (rabbi_id, event_type, channel, enabled)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (rabbi_id, event_type)
         DO UPDATE SET
           channel = EXCLUDED.channel,
           enabled = EXCLUDED.enabled`,
        [rabbiId, event_type, channel, Boolean(enabled)]
      );
    }
  });
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Legacy / shared
  getRabbiById,
  updateAchievements,
  getWeeklyTopRabbi,
  getRabbisForBroadcast,
  buildLeaderboard,

  // New
  getRabbiStats,
  updateWeeklyStats,
  getRabbiOfWeek,
  getLeaderboard,
  createRabbi,
  getNotificationPreferences,
  updateNotificationPreferences,

  // Expose date helpers for cron jobs
  _currentWeekStart,
  _previousWeekStart,
  _weekStartNWeeksAgo,
};
