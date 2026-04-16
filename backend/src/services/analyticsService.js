'use strict';

/**
 * Analytics Service  –  Admin Dashboard & Reports
 *
 * Functions:
 *   getDashboardStats()                    – fast aggregation for the dashboard
 *   getQuestionsTimeSeries(days)           – daily question counts (last N days)
 *   getStatusBreakdown()                   – question counts grouped by status
 *   getRabbiPerformance(period)            – per-rabbi stats table
 *   getCategoryBreakdown()                 – question count per category (answer rate)
 *   getCategoryAnalytics()                 – category activity + avg response time
 *   exportQuestions(filters)               – formatted rows for CSV/JSON export
 *   generateWeeklyReportData(rabbiId, weekStart) – data for weekly email report
 *
 * Depends on:
 *   ../db/pool  – query()
 */

const { query } = require('../db/pool');

// ─── getDashboardStats ────────────────────────────────────────────────────────

/**
 * Main dashboard aggregation.
 * Returns totals by status, period counts, avg response time,
 * top rabbis this week, pending count, active discussions, and online rabbis.
 *
 * @returns {Promise<object>}
 */
async function getDashboardStats() {
  // Run all aggregation queries in parallel for speed
  const [
    statusResult,
    periodResult,
    topRabbisResult,
    discussionsResult,
    weeklyActivityResult,
    categoryResult,
    answeredTodayResult,
    avgResponseResult,
    activeRabbisResult,
    thanksResult,
  ] = await Promise.all([
    // Status breakdown + avg response time
    query(`
      SELECT
        COUNT(*)                                                      AS total,
        COUNT(*) FILTER (WHERE status = 'pending')                    AS pending,
        COUNT(*) FILTER (WHERE status = 'in_process')                 AS in_process,
        COUNT(*) FILTER (WHERE status = 'answered')                   AS answered,
        COUNT(*) FILTER (WHERE status = 'hidden')                     AS hidden,
        COALESCE(ROUND(
          AVG(
            EXTRACT(EPOCH FROM (answered_at - created_at)) / 3600.0
          ) FILTER (WHERE answered_at IS NOT NULL), 2
        ), 0)                                                         AS avg_response_hours
      FROM questions
    `),

    // Questions today / this week / this month (Israel timezone)
    query(`
      SELECT
        COUNT(*) FILTER (
          WHERE DATE(created_at AT TIME ZONE 'Asia/Jerusalem') = CURRENT_DATE
        )                                                             AS today,
        COUNT(*) FILTER (
          WHERE created_at >= DATE_TRUNC('week',
            NOW() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'
        )                                                             AS this_week,
        COUNT(*) FILTER (
          WHERE created_at >= DATE_TRUNC('month',
            NOW() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'
        )                                                             AS this_month
      FROM questions
      WHERE status != 'hidden'
    `),

    // Top 5 rabbis by answers this week
    query(`
      SELECT
        r.id,
        r.name,
        r.photo_url,
        COUNT(a.id)::int                                              AS answers_this_week,
        COALESCE(SUM(q.thank_count), 0)::int                         AS thanks_this_week
      FROM   rabbis   r
      JOIN   answers  a ON a.rabbi_id = r.id
      JOIN   questions q ON q.id = a.question_id
      WHERE  q.answered_at >= DATE_TRUNC('week',
               NOW() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'
        AND  r.is_active = TRUE
      GROUP BY r.id, r.name, r.photo_url
      ORDER BY answers_this_week DESC
      LIMIT  5
    `),

    // Active discussions (has message in last 24h) + total open discussions
    query(`
      SELECT
        COUNT(DISTINCT d.id)::int                                     AS active_count,
        COUNT(DISTINCT d.id) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM discussion_messages dm
            WHERE dm.discussion_id = d.id
              AND dm.created_at >= NOW() - INTERVAL '24 hours'
          )
        )::int                                                        AS recently_active
      FROM discussions d
    `),

    // Weekly activity: last 7 days question counts per day
    query(`
      WITH date_series AS (
        SELECT generate_series(
          CURRENT_DATE - 6,
          CURRENT_DATE,
          INTERVAL '1 day'
        )::date AS day
      ),
      daily_counts AS (
        SELECT
          DATE(created_at AT TIME ZONE 'Asia/Jerusalem') AS day,
          COUNT(*)::int                                  AS count
        FROM   questions
        WHERE  created_at >= (CURRENT_DATE - 6)::timestamptz
          AND  status != 'hidden'
        GROUP  BY day
      )
      SELECT
        ds.day::text              AS date,
        COALESCE(dc.count, 0)    AS count
      FROM   date_series ds
      LEFT JOIN daily_counts dc ON dc.day = ds.day
      ORDER  BY ds.day ASC
    `),

    // Category breakdown
    query(`
      SELECT
        COALESCE(c.name, 'כללי') AS category,
        COUNT(q.id)::int          AS count
      FROM      questions q
      LEFT JOIN categories c ON c.id = q.category_id
      WHERE     q.status != 'hidden'
      GROUP BY  c.name
      ORDER BY  count DESC
    `),

    // Answered today
    query(`
      SELECT COUNT(*)::int AS count
      FROM   questions
      WHERE  status = 'answered'
        AND  DATE(answered_at AT TIME ZONE 'Asia/Jerusalem') = CURRENT_DATE
    `),

    // Avg response time in minutes (rounded)
    query(`
      SELECT COALESCE(
        ROUND(AVG(EXTRACT(EPOCH FROM (answered_at - created_at)) / 60.0))::int,
        0
      ) AS avg_minutes
      FROM questions
      WHERE status = 'answered'
        AND answered_at IS NOT NULL
        AND answered_at > created_at
    `),

    // Active rabbis in last 7 days (had assigned question activity)
    query(`
      SELECT COUNT(DISTINCT assigned_rabbi_id)::int AS count
      FROM   questions
      WHERE  updated_at >= NOW() - INTERVAL '7 days'
        AND  assigned_rabbi_id IS NOT NULL
    `),

    // Total thanks
    query(`
      SELECT COALESCE(SUM(thank_count), 0)::int AS total_thanks
      FROM   questions
      WHERE  status = 'answered'
    `),
  ]);

  const statusRow     = statusResult.rows[0];
  const periodRow     = periodResult.rows[0];
  const discussionRow = discussionsResult.rows[0];

  // Online rabbis: count is derived from the live socket.io `connectedRabbis`
  // Map (one entry per rabbi currently holding at least one open socket).
  // Falls back to device_sessions.last_seen only when the socket module can't
  // be loaded (e.g. during isolated unit tests).
  let onlineCount = 0;
  try {
    const { connectedRabbis } = require('../socket/helpers');
    onlineCount = connectedRabbis?.size || 0;
  } catch (e) {
    const { rows: fallback } = await query(`
      SELECT COUNT(DISTINCT rabbi_id)::int AS online_count
      FROM   device_sessions
      WHERE  last_seen >= NOW() - INTERVAL '5 minutes'
    `);
    onlineCount = fallback[0].online_count;
  }
  const onlineRows = [{ online_count: onlineCount }];

  const totalQuestions  = parseInt(statusRow.total,      10);
  const pending         = parseInt(statusRow.pending,    10);
  const inProcess       = parseInt(statusRow.in_process, 10);
  const answered        = parseInt(statusRow.answered,   10);
  const hidden          = parseInt(statusRow.hidden,     10);
  const avgResponseHours = parseFloat(statusRow.avg_response_hours);
  const onlineRabbis    = onlineRows[0].online_count;
  const totalThanks     = thanksResult.rows[0].total_thanks;
  const answeredToday   = answeredTodayResult.rows[0].count;
  const avgResponseTime = avgResponseResult.rows[0].avg_minutes; // minutes
  const activeRabbis    = activeRabbisResult.rows[0].count;

  const weeklyActivity = weeklyActivityResult.rows.map((r) => ({
    date:  r.date,
    count: r.count,
  }));

  const categoryBreakdown = categoryResult.rows.map((r) => ({
    category: r.category,
    count:    r.count,
  }));

  const topRabbisThisWeek = topRabbisResult.rows.map((r) => ({
    id:              r.id,
    name:            r.name,
    photoUrl:        r.photo_url,
    answersThisWeek: r.answers_this_week,
    thanksThisWeek:  r.thanks_this_week,
  }));

  return {
    // ── Flat fields used by extractAdminStats() in the frontend ──
    totalQuestions,
    totalPending:        pending,
    pendingCount:        pending,
    totalInProcess:      inProcess,
    inProcessCount:      inProcess,
    totalAnswered:       answered,
    answeredToday,
    answeredThisWeek:    parseInt(periodRow.this_week,  10),
    answeredThisMonth:   parseInt(periodRow.this_month, 10),
    avgResponseTime,                        // minutes
    avgResponseHours,                       // hours (legacy)
    avgResponseTimeLabel: avgResponseTime > 0
      ? (avgResponseTime < 60
          ? `${avgResponseTime}ד'`
          : `${Math.round(avgResponseTime / 60)}ש'`)
      : '—',
    activeRabbis,
    onlineRabbis,
    totalThanks,

    // ── Chart data ──
    weeklyActivity,                         // [{ date, count }] — last 7 days
    weeklyChart:     weeklyActivity,        // alias
    questionsPerDay: weeklyActivity,        // alias
    categoryBreakdown,                      // [{ category, count }]
    categories:      categoryBreakdown,     // alias

    // ── Legacy nested structure (preserved for backwards compat) ──
    questions: {
      total:     totalQuestions,
      pending,
      inProcess,
      answered,
      hidden,
      today:     parseInt(periodRow.today,      10),
      thisWeek:  parseInt(periodRow.this_week,  10),
      thisMonth: parseInt(periodRow.this_month, 10),
    },
    topRabbisThisWeek,
    discussions: {
      activeCount:    discussionRow.active_count,
      recentlyActive: discussionRow.recently_active,
    },
  };
}

// ─── getQuestionsTimeSeries ───────────────────────────────────────────────────

/**
 * Daily question submission counts for the last N days.
 * Returns chart-ready array of { date, count } objects.
 * Days with zero questions are included (gap-filling).
 *
 * @param {number} days – number of days to look back (default 30)
 * @returns {Promise<Array<{ date: string, count: number }>>}
 */
async function getQuestionsTimeSeries(days = 30) {
  const safeDays = Math.min(365, Math.max(1, parseInt(days, 10) || 30));

  const { rows } = await query(
    `
    WITH date_series AS (
      SELECT generate_series(
        (CURRENT_DATE - ($1 - 1) * INTERVAL '1 day'),
        CURRENT_DATE,
        INTERVAL '1 day'
      )::date AS day
    ),
    daily_counts AS (
      SELECT
        DATE(created_at AT TIME ZONE 'Asia/Jerusalem') AS day,
        COUNT(*)::int                                  AS count
      FROM   questions
      WHERE  created_at >= (CURRENT_DATE - ($1 - 1) * INTERVAL '1 day')::timestamptz
        AND  status != 'hidden'
      GROUP  BY day
    )
    SELECT
      ds.day::text    AS date,
      COALESCE(dc.count, 0) AS count
    FROM   date_series ds
    LEFT JOIN daily_counts dc ON dc.day = ds.day
    ORDER  BY ds.day ASC
    `,
    [safeDays]
  );

  return rows.map((r) => ({ date: r.date, count: r.count }));
}

// ─── getStatusBreakdown ───────────────────────────────────────────────────────

/**
 * Question counts grouped by status (for pie/donut chart).
 *
 * @returns {Promise<Array<{ status: string, count: number }>>}
 */
async function getStatusBreakdown() {
  const { rows } = await query(`
    SELECT status, COUNT(*)::int AS count
    FROM   questions
    GROUP  BY status
    ORDER  BY count DESC
  `);

  return rows.map((r) => ({ status: r.status, count: r.count }));
}

// ─── getRabbiPerformance ──────────────────────────────────────────────────────

/**
 * Per-rabbi performance table for admin analytics.
 * Returns one row per rabbi with answers, avg time, thanks, last active.
 *
 * @param {'week'|'month'|'all'} period
 * @returns {Promise<object[]>}
 */
async function getRabbiPerformance(period = 'month') {
  // Build the date filter
  let dateFilter = '';
  if (period === 'week') {
    dateFilter = `AND q.answered_at >= DATE_TRUNC('week',
      NOW() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'`;
  } else if (period === 'month') {
    dateFilter = `AND q.answered_at >= DATE_TRUNC('month',
      NOW() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'`;
  }

  const { rows } = await query(`
    SELECT
      r.id,
      r.name,
      r.email,
      r.photo_url,
      r.is_active,
      r.vacation_mode,
      COUNT(a.id)::int                                        AS answers_count,
      COALESCE(ROUND(
        AVG(
          EXTRACT(EPOCH FROM (q.answered_at - q.created_at)) / 3600.0
        ) FILTER (WHERE q.answered_at IS NOT NULL), 2
      ), 0)                                                   AS avg_response_hours,
      COALESCE(SUM(q.thank_count), 0)::int                   AS total_thanks,
      COALESCE(SUM(q.view_count), 0)::int                    AS total_views,
      MAX(q.answered_at)                                      AS last_active,
      COUNT(q.id) FILTER (WHERE q.status IN ('pending','in_process')
        AND q.assigned_rabbi_id = r.id)::int                  AS open_questions
    FROM   rabbis   r
    LEFT JOIN answers  a  ON a.rabbi_id    = r.id
    LEFT JOIN questions q ON q.id          = a.question_id ${dateFilter}
    WHERE  r.role IN ('rabbi', 'admin')
    GROUP  BY r.id, r.name, r.email, r.photo_url, r.is_active, r.vacation_mode
    ORDER  BY answers_count DESC, total_thanks DESC
  `);

  return rows.map((r) => ({
    id:               r.id,
    name:             r.name,
    email:            r.email,
    photoUrl:         r.photo_url,
    isActive:         r.is_active,
    vacationMode:     r.vacation_mode,
    answersCount:     r.answers_count,
    avgResponseHours: parseFloat(r.avg_response_hours),
    totalThanks:      r.total_thanks,
    totalViews:       r.total_views,
    lastActive:       r.last_active,
    openQuestions:    r.open_questions,
    period,
  }));
}

// ─── getCategoryBreakdown ─────────────────────────────────────────────────────

/**
 * Category distribution: question count, answered count, answer rate.
 * Used for pie/bar charts on the Questions analytics page.
 *
 * @returns {Promise<object[]>}
 */
async function getCategoryBreakdown() {
  const { rows } = await query(`
    SELECT
      c.id,
      c.name,
      c.color,
      COUNT(q.id)::int                                              AS total,
      COUNT(q.id) FILTER (WHERE q.status = 'answered')::int         AS answered,
      CASE WHEN COUNT(q.id) = 0 THEN 0
           ELSE ROUND(
             COUNT(q.id) FILTER (WHERE q.status = 'answered')::numeric
             / COUNT(q.id) * 100, 1
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
    total:      r.total,
    answered:   r.answered,
    answerRate: parseFloat(r.answer_rate),
  }));
}

// ─── getCategoryAnalytics ─────────────────────────────────────────────────────

/**
 * Category analytics with average response time.
 * Used on the Categories analytics page.
 *
 * @returns {Promise<object[]>}
 */
async function getCategoryAnalytics() {
  const { rows } = await query(`
    SELECT
      c.id,
      c.name,
      c.color,
      COUNT(q.id)::int                                              AS total,
      COUNT(q.id) FILTER (WHERE q.status = 'answered')::int         AS answered,
      COUNT(q.id) FILTER (WHERE q.status = 'pending')::int          AS pending,
      COUNT(q.id) FILTER (WHERE q.status = 'in_process')::int       AS in_process,
      COALESCE(ROUND(
        AVG(
          EXTRACT(EPOCH FROM (q.answered_at - q.created_at)) / 3600.0
        ) FILTER (WHERE q.answered_at IS NOT NULL), 2
      ), 0)                                                         AS avg_response_hours,
      COALESCE(SUM(q.thank_count), 0)::int                         AS total_thanks,
      COALESCE(SUM(q.view_count), 0)::int                          AS total_views,
      COUNT(q.id) FILTER (WHERE q.urgency = 'urgent')::int          AS urgent_count,
      CASE WHEN COUNT(q.id) = 0 THEN 0
           ELSE ROUND(
             COUNT(q.id) FILTER (WHERE q.status = 'answered')::numeric
             / COUNT(q.id) * 100, 1
           )
      END                                                           AS answer_rate
    FROM      categories c
    LEFT JOIN questions   q ON q.category_id = c.id AND q.status != 'hidden'
    GROUP BY  c.id, c.name, c.color
    ORDER BY  total DESC
  `);

  return rows.map((r) => ({
    id:               r.id,
    name:             r.name,
    color:            r.color,
    total:            r.total,
    answered:         r.answered,
    pending:          r.pending,
    inProcess:        r.in_process,
    avgResponseHours: parseFloat(r.avg_response_hours),
    totalThanks:      r.total_thanks,
    totalViews:       r.total_views,
    urgentCount:      r.urgent_count,
    answerRate:       parseFloat(r.answer_rate),
  }));
}

// ─── exportQuestions ─────────────────────────────────────────────────────────

/**
 * Return formatted question rows for CSV/JSON export.
 *
 * @param {object} filters
 * @param {string|null} [filters.dateFrom]
 * @param {string|null} [filters.dateTo]
 * @param {string|null} [filters.status]
 * @param {string|null} [filters.categoryId]
 * @returns {Promise<object[]>}
 */
async function exportQuestions(filters = {}) {
  const conditions = [];
  const params     = [];
  let   idx        = 0;

  if (filters.status) {
    conditions.push(`q.status = $${++idx}`);
    params.push(filters.status);
  }

  if (filters.dateFrom) {
    conditions.push(`q.created_at >= $${++idx}`);
    params.push(filters.dateFrom);
  }

  if (filters.dateTo) {
    conditions.push(`q.created_at <= $${++idx}`);
    params.push(filters.dateTo);
  }

  if (filters.categoryId) {
    conditions.push(`q.category_id = $${++idx}`);
    params.push(filters.categoryId);
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const { rows } = await query(
    `SELECT
       q.id,
       q.title,
       q.content,
       q.status,
       q.urgency,
       q.view_count,
       q.thank_count,
       q.created_at,
       q.answered_at,
       ROUND(
         EXTRACT(EPOCH FROM (q.answered_at - q.created_at)) / 3600.0, 2
       )                                    AS response_hours,
       c.name                               AS category_name,
       r.name                               AS rabbi_name,
       a.content                            AS answer_content
     FROM   questions q
     LEFT JOIN categories c ON c.id = q.category_id
     LEFT JOIN rabbis     r ON r.id = q.assigned_rabbi_id
     LEFT JOIN LATERAL (
       SELECT content FROM answers
       WHERE  question_id = q.id
       ORDER  BY created_at DESC
       LIMIT  1
     ) a ON true
     ${whereClause}
     ORDER BY q.created_at DESC`,
    params
  );

  return rows.map((r) => ({
    id:             r.id,
    title:          r.title,
    content:        r.content,
    status:         r.status,
    urgency:        r.urgency,
    category_name:  r.category_name || '',
    rabbi_name:     r.rabbi_name    || '',
    created_at:     r.created_at    ? new Date(r.created_at).toISOString()  : '',
    answered_at:    r.answered_at   ? new Date(r.answered_at).toISOString() : '',
    response_hours: r.response_hours !== null ? parseFloat(r.response_hours) : '',
    thank_count:    r.thank_count,
    view_count:     r.view_count,
    answer_content: r.answer_content || '',
  }));
}

// ─── generateWeeklyReportData ────────────────────────────────────────────────

/**
 * Generate data for a rabbi's weekly report email.
 *
 * @param {string} rabbiId
 * @param {Date|string} weekStart  – ISO date string or Date; start of the week (Sunday/Monday)
 * @returns {Promise<object>}
 */
async function generateWeeklyReportData(rabbiId, weekStart) {
  if (!rabbiId) {
    throw Object.assign(new Error('מזהה רב נדרש'), { status: 400 });
  }

  const weekStartDate = weekStart ? new Date(weekStart) : _getWeekStart();
  const weekEndDate   = new Date(weekStartDate);
  weekEndDate.setDate(weekEndDate.getDate() + 7);

  const [rabbiResult, statsResult, topQuestionsResult, categoryResult] = await Promise.all([
    // Rabbi profile
    query(
      'SELECT id, name, email, photo_url FROM rabbis WHERE id = $1',
      [rabbiId]
    ),

    // Week stats
    query(
      `SELECT
         COUNT(a.id)::int                                            AS answers_count,
         COALESCE(ROUND(
           AVG(
             EXTRACT(EPOCH FROM (q.answered_at - q.created_at)) / 3600.0
           ) FILTER (WHERE q.answered_at IS NOT NULL), 2
         ), 0)                                                       AS avg_response_hours,
         COALESCE(SUM(q.thank_count), 0)::int                       AS total_thanks,
         COALESCE(SUM(q.view_count), 0)::int                        AS total_views,
         COUNT(a.id) FILTER (
           WHERE EXTRACT(EPOCH FROM (q.answered_at - q.created_at)) / 3600.0 <= 4
         )::int                                                      AS met_sla
       FROM   answers  a
       JOIN   questions q ON q.id = a.question_id
       WHERE  a.rabbi_id  = $1
         AND  q.answered_at >= $2
         AND  q.answered_at <  $3`,
      [rabbiId, weekStartDate.toISOString(), weekEndDate.toISOString()]
    ),

    // Top 3 questions by thanks this week
    query(
      `SELECT q.id, q.title, q.thank_count, q.view_count, q.answered_at,
              c.name AS category_name
       FROM   answers  a
       JOIN   questions q ON q.id = a.question_id
       LEFT JOIN categories c ON c.id = q.category_id
       WHERE  a.rabbi_id   = $1
         AND  q.answered_at >= $2
         AND  q.answered_at <  $3
       ORDER  BY q.thank_count DESC, q.view_count DESC
       LIMIT  3`,
      [rabbiId, weekStartDate.toISOString(), weekEndDate.toISOString()]
    ),

    // Category breakdown for the week
    query(
      `SELECT c.name, COUNT(a.id)::int AS count
       FROM   answers  a
       JOIN   questions q ON q.id = a.question_id
       LEFT JOIN categories c ON c.id = q.category_id
       WHERE  a.rabbi_id   = $1
         AND  q.answered_at >= $2
         AND  q.answered_at <  $3
       GROUP  BY c.name
       ORDER  BY count DESC`,
      [rabbiId, weekStartDate.toISOString(), weekEndDate.toISOString()]
    ),
  ]);

  if (rabbiResult.rows.length === 0) {
    throw Object.assign(new Error('רב לא נמצא'), { status: 404 });
  }

  const stats = statsResult.rows[0];

  return {
    rabbi: {
      id:       rabbiResult.rows[0].id,
      name:     rabbiResult.rows[0].name,
      email:    rabbiResult.rows[0].email,
      photoUrl: rabbiResult.rows[0].photo_url,
    },
    weekStart: weekStartDate.toISOString().slice(0, 10),
    weekEnd:   weekEndDate.toISOString().slice(0, 10),
    stats: {
      answersCount:     stats.answers_count,
      avgResponseHours: parseFloat(stats.avg_response_hours),
      totalThanks:      stats.total_thanks,
      totalViews:       stats.total_views,
      metSLA:           stats.met_sla,
      slaRate:          stats.answers_count > 0
        ? parseFloat(((stats.met_sla / stats.answers_count) * 100).toFixed(1))
        : 0,
    },
    topQuestions: topQuestionsResult.rows.map((r) => ({
      id:           r.id,
      title:        r.title,
      thankCount:   r.thank_count,
      viewCount:    r.view_count,
      answeredAt:   r.answered_at,
      categoryName: r.category_name || 'כללי',
    })),
    categoryBreakdown: categoryResult.rows.map((r) => ({
      name:  r.name || 'כללי',
      count: r.count,
    })),
  };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Return the start of the current week (Sunday midnight, Israel time).
 * @private
 */
function _getWeekStart() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sunday
  const start = new Date(now);
  start.setDate(now.getDate() - dayOfWeek);
  start.setHours(0, 0, 0, 0);
  return start;
}

// ─── getOverviewStats ─────────────────────────────────────────────────────────

/**
 * High-level KPI snapshot for the admin dashboard stats cards.
 * Runs multiple aggregations in a single parallel batch.
 *
 * Returns:
 * {
 *   totalQuestions, pending, inProcess, answered, hidden,
 *   totalRabbis, activeRabbis, onlineRabbis,
 *   avgResponseTime,            ← hours, rounded to 2 dp
 *   totalThanks, thisWeekAnswers
 * }
 *
 * @returns {Promise<object>}
 */
async function getOverviewStats() {
  const [questionAgg, rabbiAgg, thanksAgg, weekAgg, onlineAgg] = await Promise.all([
    // Question status counts + avg response time
    query(`
      SELECT
        COUNT(*)::int                                                  AS total,
        COUNT(*) FILTER (WHERE status = 'pending')::int               AS pending,
        COUNT(*) FILTER (WHERE status = 'in_process')::int            AS in_process,
        COUNT(*) FILTER (WHERE status = 'answered')::int              AS answered,
        COUNT(*) FILTER (WHERE status = 'hidden')::int                AS hidden,
        COALESCE(ROUND(
          AVG(
            EXTRACT(EPOCH FROM (answered_at - created_at)) / 3600.0
          ) FILTER (WHERE answered_at IS NOT NULL), 2
        ), 0)                                                          AS avg_response_hours
      FROM questions
    `),

    // Rabbi counts
    query(`
      SELECT
        COUNT(*)::int                                     AS total_rabbis,
        COUNT(*) FILTER (WHERE is_active = TRUE)::int    AS active_rabbis
      FROM rabbis
      WHERE role IN ('rabbi', 'admin')
    `),

    // Total thanks ever
    query(`
      SELECT COALESCE(SUM(thank_count), 0)::int AS total_thanks
      FROM questions
      WHERE status = 'answered'
    `),

    // Answers published this ISO week (Mon–Sun)
    query(`
      SELECT COUNT(*)::int AS this_week_answers
      FROM   questions
      WHERE  status = 'answered'
        AND  answered_at >= DATE_TRUNC('week',
               NOW() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'
    `),

    // Online rabbis: device session active in last 5 minutes
    query(`
      SELECT COUNT(DISTINCT rabbi_id)::int AS online_rabbis
      FROM   device_sessions
      WHERE  last_seen >= NOW() - INTERVAL '5 minutes'
    `),
  ]);

  const q = questionAgg.rows[0];
  const r = rabbiAgg.rows[0];

  return {
    totalQuestions:  q.total,
    pending:         q.pending,
    inProcess:       q.in_process,
    answered:        q.answered,
    hidden:          q.hidden,
    totalRabbis:     r.total_rabbis,
    activeRabbis:    r.active_rabbis,
    // Prefer live socket map over stale device_sessions.last_seen
    onlineRabbis:    (() => {
      try {
        const { connectedRabbis } = require('../socket/helpers');
        return connectedRabbis?.size || onlineAgg.rows[0].online_rabbis || 0;
      } catch {
        return onlineAgg.rows[0].online_rabbis || 0;
      }
    })(),
    avgResponseTime: parseFloat(q.avg_response_hours),
    totalThanks:     thanksAgg.rows[0].total_thanks,
    thisWeekAnswers: weekAgg.rows[0].this_week_answers,
  };
}

// ─── getDailyActivity ─────────────────────────────────────────────────────────

/**
 * Daily counts of new and answered questions for the last N days.
 * Fills in zero rows for days with no activity (gap-filling via generate_series).
 * Intended for line chart rendering.
 *
 * @param {number} days – look-back window (default 7, max 90)
 * @returns {Promise<Array<{ date: string, newQuestions: number, answeredQuestions: number }>>}
 */
async function getDailyActivity(days = 7) {
  const safeDays = Math.min(90, Math.max(1, parseInt(days, 10) || 7));

  const { rows } = await query(
    `
    WITH date_series AS (
      SELECT generate_series(
        (CURRENT_DATE - ($1 - 1) * INTERVAL '1 day'),
        CURRENT_DATE,
        INTERVAL '1 day'
      )::date AS day
    ),
    new_q AS (
      SELECT
        DATE(created_at AT TIME ZONE 'Asia/Jerusalem') AS day,
        COUNT(*)::int                                  AS new_count
      FROM   questions
      WHERE  created_at >= (CURRENT_DATE - ($1 - 1) * INTERVAL '1 day')::timestamptz
        AND  status != 'hidden'
      GROUP  BY day
    ),
    answered_q AS (
      SELECT
        DATE(answered_at AT TIME ZONE 'Asia/Jerusalem') AS day,
        COUNT(*)::int                                   AS answered_count
      FROM   questions
      WHERE  answered_at >= (CURRENT_DATE - ($1 - 1) * INTERVAL '1 day')::timestamptz
        AND  status = 'answered'
      GROUP  BY day
    )
    SELECT
      ds.day::text                      AS date,
      COALESCE(n.new_count,      0)     AS new_questions,
      COALESCE(a.answered_count, 0)     AS answered_questions
    FROM   date_series ds
    LEFT JOIN new_q      n ON n.day = ds.day
    LEFT JOIN answered_q a ON a.day = ds.day
    ORDER  BY ds.day ASC
    `,
    [safeDays]
  );

  return rows.map((r) => ({
    date:              r.date,
    newQuestions:      r.new_questions,
    answeredQuestions: r.answered_questions,
  }));
}

// ─── getResponseTimeHistogram ─────────────────────────────────────────────────

/**
 * Distribution of response times bucketed into seven ranges.
 * Used for histogram charts on the admin analytics page.
 *
 * Buckets: <1h, 1–4h, 4–12h, 12–24h, 24–48h, 48–72h, >72h
 *
 * @returns {Promise<Array<{ bucket: string, label: string, count: number, minHours: number, maxHours: number|null }>>}
 */
async function getResponseTimeHistogram() {
  const { rows } = await query(`
    WITH response_times AS (
      SELECT
        EXTRACT(EPOCH FROM (answered_at - created_at)) / 3600.0 AS hours
      FROM   questions
      WHERE  answered_at IS NOT NULL
        AND  status = 'answered'
        AND  answered_at > created_at   -- guard against bad data
    )
    SELECT
      CASE
        WHEN hours <  1  THEN 'lt1'
        WHEN hours <  4  THEN '1to4'
        WHEN hours <  12 THEN '4to12'
        WHEN hours <  24 THEN '12to24'
        WHEN hours <  48 THEN '24to48'
        WHEN hours <  72 THEN '48to72'
        ELSE                  'gt72'
      END                        AS bucket,
      COUNT(*)::int              AS count
    FROM   response_times
    GROUP  BY bucket
    ORDER  BY
      CASE bucket
        WHEN 'lt1'   THEN 1
        WHEN '1to4'  THEN 2
        WHEN '4to12' THEN 3
        WHEN '12to24'THEN 4
        WHEN '24to48'THEN 5
        WHEN '48to72'THEN 6
        WHEN 'gt72'  THEN 7
      END
  `);

  // Build full bucket list including zero-count buckets
  const BUCKET_META = [
    { bucket: 'lt1',    label: 'פחות משעה',        minHours: 0,  maxHours: 1  },
    { bucket: '1to4',   label: '1–4 שעות',          minHours: 1,  maxHours: 4  },
    { bucket: '4to12',  label: '4–12 שעות',         minHours: 4,  maxHours: 12 },
    { bucket: '12to24', label: '12–24 שעות',        minHours: 12, maxHours: 24 },
    { bucket: '24to48', label: '24–48 שעות',        minHours: 24, maxHours: 48 },
    { bucket: '48to72', label: '48–72 שעות',        minHours: 48, maxHours: 72 },
    { bucket: 'gt72',   label: 'יותר מ-72 שעות',   minHours: 72, maxHours: null },
  ];

  const countMap = Object.fromEntries(rows.map((r) => [r.bucket, r.count]));

  return BUCKET_META.map((meta) => ({
    ...meta,
    count: countMap[meta.bucket] || 0,
  }));
}

// ─── getReturnedQuestionCount ─────────────────────────────────────────────────

/**
 * Returns count of questions that were released back to the pending queue
 * after being claimed (efficiency / churn metric).
 * Sourced from audit_log entries with action 'question.released'.
 *
 * @returns {Promise<{ total: number, thisWeek: number, thisMonth: number }>}
 */
async function getReturnedQuestionCount() {
  const { rows } = await query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE created_at >= DATE_TRUNC('week',
          NOW() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'
      )::int AS this_week,
      COUNT(*) FILTER (
        WHERE created_at >= DATE_TRUNC('month',
          NOW() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'
      )::int AS this_month
    FROM audit_log
    WHERE action = 'question.released'
  `);

  const row = rows[0];
  return {
    total:     row.total,
    thisWeek:  row.this_week,
    thisMonth: row.this_month,
  };
}

// ─── getROIStats ──────────────────────────────────────────────────────────────

/**
 * ROI dashboard stats for admin view.
 * Returns engagement and conversion metrics.
 *
 * @returns {Promise<object>}
 */
async function getROIStats() {
  const [
    thanksResult,
    thanksMonthResult,
    leadsContactedResult,
    hotLeadsResult,
    topCategoriesResult,
    avgResponseResult,
    conversionResult,
    thankDonateResult,
  ] = await Promise.all([
    // Total thanks (all time)
    query(`
      SELECT COALESCE(SUM(thank_count), 0)::int AS total_thanks
      FROM   questions
      WHERE  status = 'answered'
    `),

    // Thanks this month
    query(`
      SELECT COALESCE(SUM(thank_count), 0)::int AS thanks_this_month
      FROM   questions
      WHERE  status = 'answered'
        AND  answered_at >= DATE_TRUNC('month',
               NOW() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'
    `),

    // Leads where contacted = true
    query(`
      SELECT COUNT(*)::int AS leads_contacted
      FROM   leads
      WHERE  contacted = true
    `),

    // Hot leads count
    query(`
      SELECT COUNT(*)::int AS hot_leads_count
      FROM   leads
      WHERE  is_hot = true
    `),

    // Top 5 categories by question count
    query(`
      SELECT
        COALESCE(c.name, 'כללי') AS category_name,
        COUNT(q.id)::int          AS question_count
      FROM      questions q
      LEFT JOIN categories c ON c.id = q.category_id
      WHERE     q.status != 'hidden'
      GROUP BY  c.name
      ORDER BY  question_count DESC
      LIMIT 5
    `),

    // Average response time in hours
    query(`
      SELECT COALESCE(
        ROUND(
          AVG(
            EXTRACT(EPOCH FROM (answered_at - created_at)) / 3600.0
          )::numeric, 1
        ),
        0
      ) AS avg_response_hours
      FROM   questions
      WHERE  status = 'answered'
        AND  answered_at IS NOT NULL
        AND  answered_at > created_at
    `),

    // Asker-to-donor conversion: count unique lead email_hashes that also
    // appear as a donor_email (hashed) in the donations table.
    // Uses pgcrypto digest() to hash donor_email the same way leads are keyed.
    query(`
      WITH donor_hashes AS (
        SELECT DISTINCT encode(digest(lower(trim(donor_email)), 'sha256'), 'hex') AS email_hash
        FROM   donations
        WHERE  donor_email IS NOT NULL
          AND  trim(donor_email) != ''
          AND  status = 'completed'
      )
      SELECT
        COUNT(DISTINCT l.id)::int AS total_askers,
        COUNT(DISTINCT CASE WHEN dh.email_hash IS NOT NULL THEN l.id END)::int AS askers_who_donated
      FROM   leads l
      LEFT JOIN donor_hashes dh ON dh.email_hash = l.email_hash
      WHERE  l.email_hash IS NOT NULL
    `),

    // Thank → Donation attribution: leads who clicked "thank rabbi" AND also donated.
    // Uses has_thanked flag (set by leadsService.upsertLead when total_thanks > 0).
    query(`
      WITH donor_hashes AS (
        SELECT DISTINCT encode(digest(lower(trim(donor_email)), 'sha256'), 'hex') AS email_hash
        FROM   donations
        WHERE  donor_email IS NOT NULL
          AND  trim(donor_email) != ''
          AND  status = 'completed'
      )
      SELECT
        COUNT(DISTINCT l.id)::int AS thankers_total,
        COUNT(DISTINCT CASE WHEN dh.email_hash IS NOT NULL THEN l.id END)::int AS thankers_who_donated
      FROM   leads l
      LEFT JOIN donor_hashes dh ON dh.email_hash = l.email_hash
      WHERE  l.has_thanked = true
        AND  l.email_hash IS NOT NULL
    `),
  ]);

  const convRow       = conversionResult.rows[0];
  const totalAskers   = convRow.total_askers;
  const askersDonated = convRow.askers_who_donated;

  const thankRow          = thankDonateResult.rows[0];
  const thankersTotal     = thankRow.thankers_total;
  const thankersWhoDonated = thankRow.thankers_who_donated;

  return {
    total_thanks:              thanksResult.rows[0].total_thanks,
    thanks_this_month:         thanksMonthResult.rows[0].thanks_this_month,
    leads_converted_to_contacted: leadsContactedResult.rows[0].leads_contacted,
    hot_leads_count:           hotLeadsResult.rows[0].hot_leads_count,
    top_categories:            topCategoriesResult.rows.map((r) => ({
      name:  r.category_name,
      count: r.question_count,
    })),
    avg_response_hours:        parseFloat(avgResponseResult.rows[0].avg_response_hours),
    // Asker → Donor conversion metrics
    total_askers:              totalAskers,
    total_askers_who_donated:  askersDonated,
    conversion_rate:           totalAskers > 0
      ? parseFloat((askersDonated / totalAskers * 100).toFixed(2))
      : 0,
    // Thank → Donation attribution
    thankers_total:            thankersTotal,
    thankers_who_donated:      thankersWhoDonated,
    thank_to_donate_rate:      thankersTotal > 0
      ? parseFloat((thankersWhoDonated / thankersTotal * 100).toFixed(2))
      : 0,
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Existing exports — preserved
  getDashboardStats,
  getQuestionsTimeSeries,
  getStatusBreakdown,
  getRabbiPerformance,
  getCategoryBreakdown,
  getCategoryAnalytics,
  exportQuestions,
  generateWeeklyReportData,
  // New exports for Admin & Analytics module
  getOverviewStats,
  getDailyActivity,
  getResponseTimeHistogram,
  getReturnedQuestionCount,
  getROIStats,
};
