'use strict';

/**
 * Analytics Service
 *
 * Provides aggregate queries for the admin dashboard, rabbi stats,
 * activity heatmaps, SLA reports, and trending questions.
 *
 * Depends on:
 *   ../db/pool – query()
 */

const { query } = require('../db/pool');

// ─── getOverview ──────────────────────────────────────────────────────────────

/**
 * Platform-wide overview stats.
 *
 * @returns {Promise<object>} { totalQuestions, totalAnswers, pending, avgResponseHours, totalThanks, totalViews }
 */
async function getOverview() {
  const { rows } = await query(`
    SELECT
      COUNT(*)                                              AS total_questions,
      COUNT(*) FILTER (WHERE status = 'answered')           AS total_answers,
      COUNT(*) FILTER (WHERE status = 'pending')            AS pending,
      COALESCE(
        ROUND(
          AVG(
            EXTRACT(EPOCH FROM (answered_at - created_at)) / 3600.0
          ) FILTER (WHERE answered_at IS NOT NULL),
          2
        ),
        0
      )                                                     AS avg_response_hours,
      COALESCE(SUM(thank_count), 0)                         AS total_thanks,
      COALESCE(SUM(view_count), 0)                          AS total_views
    FROM questions
    WHERE status != 'hidden'
  `);

  const row = rows[0];
  return {
    totalQuestions:    parseInt(row.total_questions, 10),
    totalAnswers:      parseInt(row.total_answers, 10),
    pending:           parseInt(row.pending, 10),
    avgResponseHours:  parseFloat(row.avg_response_hours),
    totalThanks:       parseInt(row.total_thanks, 10),
    totalViews:        parseInt(row.total_views, 10),
  };
}

// ─── getRabbiStats ────────────────────────────────────────────────────────────

/**
 * Personal statistics for a single rabbi.
 *
 * @param {string} rabbiId
 * @returns {Promise<object>} { answersCount, avgResponseHours, thanks, views, activeStreak }
 */
async function getRabbiStats(rabbiId) {
  if (!rabbiId) {
    const e = new Error('מזהה רב נדרש');
    e.status = 400;
    throw e;
  }

  // Main stats
  const { rows } = await query(`
    SELECT
      COUNT(a.id)                                           AS answers_count,
      COALESCE(
        ROUND(
          AVG(
            EXTRACT(EPOCH FROM (q.answered_at - q.created_at)) / 3600.0
          ) FILTER (WHERE q.answered_at IS NOT NULL),
          2
        ),
        0
      )                                                     AS avg_response_hours,
      COALESCE(SUM(q.thank_count), 0)                       AS thanks,
      COALESCE(SUM(q.view_count), 0)                        AS views
    FROM   answers a
    JOIN   questions q ON q.id = a.question_id
    WHERE  a.rabbi_id = $1
  `, [rabbiId]);

  // Active streak: consecutive days with at least one answer (up to today)
  const { rows: streakRows } = await query(`
    WITH daily AS (
      SELECT DISTINCT DATE(q.answered_at AT TIME ZONE 'Asia/Jerusalem') AS d
      FROM   answers a
      JOIN   questions q ON q.id = a.question_id
      WHERE  a.rabbi_id = $1
        AND  q.answered_at IS NOT NULL
      ORDER  BY d DESC
    ),
    numbered AS (
      SELECT d,
             d - (ROW_NUMBER() OVER (ORDER BY d DESC))::int AS grp
      FROM   daily
    )
    SELECT COUNT(*) AS streak
    FROM   numbered
    WHERE  grp = (
      SELECT grp FROM numbered ORDER BY d DESC LIMIT 1
    )
  `, [rabbiId]);

  const stats = rows[0];
  return {
    answersCount:      parseInt(stats.answers_count, 10),
    avgResponseHours:  parseFloat(stats.avg_response_hours),
    thanks:            parseInt(stats.thanks, 10),
    views:             parseInt(stats.views, 10),
    activeStreak:      streakRows[0] ? parseInt(streakRows[0].streak, 10) : 0,
  };
}

// ─── getAllRabbiStats ─────────────────────────────────────────────────────────

/**
 * Leaderboard: all rabbis ranked by answer count, with thanks/views.
 *
 * @returns {Promise<object[]>}
 */
async function getAllRabbiStats() {
  const { rows } = await query(`
    SELECT
      r.id,
      r.name,
      r.photo_url,
      COUNT(a.id)                       AS answers_count,
      COALESCE(SUM(q.thank_count), 0)   AS thanks,
      COALESCE(SUM(q.view_count), 0)    AS views
    FROM      rabbis   r
    LEFT JOIN answers  a ON a.rabbi_id = r.id
    LEFT JOIN questions q ON q.id = a.question_id
    WHERE     r.is_active = TRUE
    GROUP BY  r.id, r.name, r.photo_url
    ORDER BY  answers_count DESC, thanks DESC
  `);

  return rows.map((row) => ({
    id:           row.id,
    name:         row.name,
    photoUrl:     row.photo_url,
    answersCount: parseInt(row.answers_count, 10),
    thanks:       parseInt(row.thanks, 10),
    views:        parseInt(row.views, 10),
  }));
}

// ─── getActivityHeatmap ───────────────────────────────────────────────────────

/**
 * Questions grouped by day-of-week and hour (Israel timezone) for a heatmap chart.
 *
 * @param {string} dateFrom  ISO date string (inclusive)
 * @param {string} dateTo    ISO date string (inclusive)
 * @returns {Promise<object[]>} [{ dayOfWeek, hour, count }, ...]
 */
async function getActivityHeatmap(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) {
    const e = new Error('נדרשים תאריך התחלה ותאריך סיום');
    e.status = 400;
    throw e;
  }

  const { rows } = await query(`
    SELECT
      EXTRACT(DOW  FROM created_at AT TIME ZONE 'Asia/Jerusalem')::int AS day_of_week,
      EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Jerusalem')::int AS hour,
      COUNT(*)::int                                                     AS count
    FROM   questions
    WHERE  created_at >= $1::timestamptz
      AND  created_at <  ($2::date + INTERVAL '1 day')::timestamptz
      AND  status != 'hidden'
    GROUP BY day_of_week, hour
    ORDER BY day_of_week, hour
  `, [dateFrom, dateTo]);

  return rows.map((r) => ({
    dayOfWeek: r.day_of_week,
    hour:      r.hour,
    count:     r.count,
  }));
}

// ─── getCategoryBreakdown ─────────────────────────────────────────────────────

/**
 * Questions per category with answer rate.
 *
 * @returns {Promise<object[]>}
 */
async function getCategoryBreakdown() {
  const { rows } = await query(`
    SELECT
      c.id,
      c.name,
      c.color,
      COUNT(q.id)                                                   AS total,
      COUNT(q.id) FILTER (WHERE q.status = 'answered')              AS answered,
      CASE
        WHEN COUNT(q.id) = 0 THEN 0
        ELSE ROUND(
          COUNT(q.id) FILTER (WHERE q.status = 'answered')::numeric
          / COUNT(q.id) * 100,
          1
        )
      END                                                           AS answer_rate
    FROM      categories c
    LEFT JOIN questions   q ON q.category_id = c.id AND q.status != 'hidden'
    GROUP BY  c.id, c.name, c.color
    ORDER BY  total DESC
  `);

  return rows.map((r) => ({
    id:         r.id,
    name:       r.name,
    color:      r.color,
    total:      parseInt(r.total, 10),
    answered:   parseInt(r.answered, 10),
    answerRate: parseFloat(r.answer_rate),
  }));
}

// ─── getSLAReport ─────────────────────────────────────────────────────────────

/**
 * SLA compliance report: met SLA, avg answer time, timed-out questions.
 *
 * @returns {Promise<object>}
 */
async function getSLAReport() {
  // Fetch current SLA thresholds
  const { rows: configRows } = await query(
    `SELECT hours_to_warning, hours_to_timeout FROM sla_config WHERE id = 1`
  );

  const config = configRows[0] || { hours_to_warning: 3, hours_to_timeout: 4 };
  const timeoutHours = config.hours_to_timeout;

  const { rows } = await query(`
    SELECT
      COUNT(*) FILTER (
        WHERE status = 'answered'
          AND EXTRACT(EPOCH FROM (answered_at - created_at)) / 3600.0 <= $1
      )                                                               AS met_sla,
      COUNT(*) FILTER (WHERE status = 'answered')                     AS total_answered,
      COUNT(*) FILTER (
        WHERE status = 'answered'
          AND EXTRACT(EPOCH FROM (answered_at - created_at)) / 3600.0 > $1
      )                                                               AS timed_out,
      COUNT(*) FILTER (
        WHERE status IN ('pending', 'in_process')
          AND EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600.0 > $1
      )                                                               AS currently_overdue,
      COALESCE(
        ROUND(
          AVG(
            EXTRACT(EPOCH FROM (answered_at - created_at)) / 3600.0
          ) FILTER (WHERE answered_at IS NOT NULL),
          2
        ),
        0
      )                                                               AS avg_response_hours
    FROM questions
    WHERE status != 'hidden'
  `, [timeoutHours]);

  const row = rows[0];
  return {
    slaThresholdHours:  timeoutHours,
    metSLA:             parseInt(row.met_sla, 10),
    totalAnswered:      parseInt(row.total_answered, 10),
    timedOut:           parseInt(row.timed_out, 10),
    currentlyOverdue:   parseInt(row.currently_overdue, 10),
    avgResponseHours:   parseFloat(row.avg_response_hours),
    slaRate:            parseInt(row.total_answered, 10) > 0
      ? parseFloat(
          ((parseInt(row.met_sla, 10) / parseInt(row.total_answered, 10)) * 100).toFixed(1)
        )
      : 0,
  };
}

// ─── getQuestionTrends ────────────────────────────────────────────────────────

/**
 * Questions over time grouped by day, week, or month.
 *
 * @param {'day'|'week'|'month'} period
 * @returns {Promise<object[]>} [{ period, count }, ...]
 */
async function getQuestionTrends(period = 'day') {
  const truncMap = {
    day:   'day',
    week:  'week',
    month: 'month',
  };

  const trunc = truncMap[period];
  if (!trunc) {
    const e = new Error('תקופה לא תקינה. ערכים אפשריים: day, week, month');
    e.status = 400;
    throw e;
  }

  const { rows } = await query(`
    SELECT
      DATE_TRUNC($1, created_at AT TIME ZONE 'Asia/Jerusalem')::date AS period,
      COUNT(*)::int                                                   AS count
    FROM   questions
    WHERE  status != 'hidden'
    GROUP  BY period
    ORDER  BY period ASC
  `, [trunc]);

  return rows.map((r) => ({
    period: r.period,
    count:  r.count,
  }));
}

// ─── getTopQuestions ──────────────────────────────────────────────────────────

/**
 * Most viewed / thanked questions.
 *
 * @param {number} [limit=10]
 * @returns {Promise<object[]>}
 */
async function getTopQuestions(limit = 10) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

  const { rows } = await query(`
    SELECT
      q.id,
      q.title,
      q.view_count,
      q.thank_count,
      q.status,
      q.created_at,
      q.answered_at,
      c.name AS category_name,
      r.name AS rabbi_name
    FROM      questions  q
    LEFT JOIN categories c ON c.id = q.category_id
    LEFT JOIN rabbis     r ON r.id = q.assigned_rabbi_id
    WHERE     q.status != 'hidden'
    ORDER BY  q.view_count DESC, q.thank_count DESC
    LIMIT     $1
  `, [safeLimit]);

  return rows.map((r) => ({
    id:           r.id,
    title:        r.title,
    viewCount:    r.view_count,
    thankCount:   r.thank_count,
    status:       r.status,
    createdAt:    r.created_at,
    answeredAt:   r.answered_at,
    categoryName: r.category_name,
    rabbiName:    r.rabbi_name,
  }));
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getOverview,
  getRabbiStats,
  getAllRabbiStats,
  getActivityHeatmap,
  getCategoryBreakdown,
  getSLAReport,
  getQuestionTrends,
  getTopQuestions,
};
