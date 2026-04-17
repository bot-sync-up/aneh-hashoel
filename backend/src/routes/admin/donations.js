'use strict';

/**
 * Admin Donations Routes  —  /admin/donations/*
 *
 * All routes require authenticate + requireAdmin.
 *
 * GET /              – list all donations (paginated + date filter)
 * GET /stats         – period-scoped totals + month/year buckets
 * GET /recent        – last 10 donations (dashboard widget)
 * GET /export.csv    – CSV export of the current filter
 *
 * Critical field: `transaction_time` (real date from Nedarim) is used
 * everywhere — NOT `created_at` (which is when we synced the row).
 */

const express = require('express');
const { authenticate, requireAdmin } = require('../../middleware/authenticate');
const { query: dbQuery } = require('../../db/pool');

const router = express.Router();
router.use(authenticate, requireAdmin);

// ─── Helpers — date-range parsing ────────────────────────────────────────────

/**
 * Resolves a `period` query-string value OR explicit from/to ISO dates
 * into a SQL fragment using `transaction_time`.
 *
 * Supported `period` values:
 *   today  | week | month (default) | year | all
 *
 * Returns { where, params, nextParamIdx } where `where` already starts
 * with " AND " (or is empty) so it can be concatenated after an
 * existing WHERE clause.
 */
/**
 * The admin CRM "Donations" tab only shows donations that came through
 * OUR flow — i.e. via the Nedarim donation link embedded in the WP
 * "תודה לרב" popup. Every such donation has a `q:<post_id>` marker
 * inside Nedarim's `Comments` field (we inject it ourselves via the
 * iframe URL: `...?S=NJxJ&Comments=q:<post_id>`).
 *
 * Historical donations from other campaigns ("טלטרגט", "מוקד", "פורום"
 * etc.) do NOT have this marker and are excluded from this view.
 *
 * This filter runs against the `notes` column (which stores a cleaned
 * version of the Nedarim Comments field). See parseComments() in
 * services/nedarimService.js — it strips the q:/r: markers before
 * saving but the original raw_payload.Comments is preserved too.
 */
const OUR_SYSTEM_FILTER = `
  (raw_payload->>'Comments' ~ 'q:[0-9a-f]{6,}' OR notes ~ 'q:[0-9a-f]{6,}')
`;

function buildDateFilter(req, startParamIdx = 1) {
  const period = (req.query.period || 'month').toLowerCase();
  const from = req.query.from;
  const to   = req.query.to;

  const params = [];
  const conds  = [];
  let idx      = startParamIdx;

  // Explicit range wins
  if (from) {
    conds.push(`d.transaction_time >= $${idx++}`);
    params.push(from);
  }
  if (to) {
    conds.push(`d.transaction_time <= $${idx++}`);
    params.push(to);
  }

  // Otherwise use the named period
  if (!from && !to) {
    switch (period) {
      case 'today':
        conds.push(`d.transaction_time >= date_trunc('day',   NOW() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'`);
        break;
      case 'week':
        conds.push(`d.transaction_time >= date_trunc('week',  NOW() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'`);
        break;
      case 'year':
        conds.push(`d.transaction_time >= date_trunc('year',  NOW() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'`);
        break;
      case 'all':
        // no filter
        break;
      case 'month':
      default:
        conds.push(`d.transaction_time >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'`);
        break;
    }
  }

  const where = conds.length ? ` AND ${conds.join(' AND ')}` : '';
  return { where, params, nextParamIdx: idx, period };
}

// ─── GET /stats ──────────────────────────────────────────────────────────────

/**
 * Returns rich period stats + all-time baseline.
 * Query params: period=today|week|month|year|all (default: month), or from+to.
 */
router.get('/stats', async (req, res) => {
  try {
    const { where, params, period } = buildDateFilter(req, 1);

    const result = await dbQuery(
      `SELECT
         -- Selected period (from filter)
         COALESCE(SUM(d.amount) FILTER (WHERE 1=1 ${where}), 0)::numeric  AS period_total,
         COUNT(*) FILTER (WHERE 1=1 ${where})::int                         AS period_count,
         COALESCE(ROUND(AVG(d.amount) FILTER (WHERE 1=1 ${where}), 2), 0)::numeric AS period_avg,

         -- Calendar buckets for the KPI cards (always shown regardless of filter)
         COALESCE(SUM(d.amount) FILTER (WHERE d.transaction_time >= date_trunc('day',   NOW() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'), 0)::numeric AS total_today,
         COUNT(*) FILTER (WHERE d.transaction_time >= date_trunc('day',   NOW() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem')::int  AS count_today,

         COALESCE(SUM(d.amount) FILTER (WHERE d.transaction_time >= date_trunc('week',  NOW() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'), 0)::numeric AS total_week,
         COUNT(*) FILTER (WHERE d.transaction_time >= date_trunc('week',  NOW() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem')::int  AS count_week,

         COALESCE(SUM(d.amount) FILTER (WHERE d.transaction_time >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'), 0)::numeric AS total_month,
         COUNT(*) FILTER (WHERE d.transaction_time >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem')::int  AS count_month,

         COALESCE(SUM(d.amount) FILTER (WHERE d.transaction_time >= date_trunc('year',  NOW() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'), 0)::numeric AS total_year,
         COUNT(*) FILTER (WHERE d.transaction_time >= date_trunc('year',  NOW() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem')::int  AS count_year,

         COALESCE(SUM(d.amount), 0)::numeric     AS total_all_time,
         COUNT(*)::int                           AS count_all_time,
         COALESCE(ROUND(AVG(d.amount), 2), 0)::numeric AS avg_all_time
       FROM donations d
       WHERE d.status = 'completed'
         AND ${OUR_SYSTEM_FILTER}`,
      params
    );

    const row = result.rows[0];
    return res.json({
      ok: true,
      data: {
        period,
        periodTotal:     Number(row.period_total),
        periodCount:     row.period_count,
        periodAvg:       Number(row.period_avg),

        totalToday:      Number(row.total_today),
        countToday:      row.count_today,
        totalWeek:       Number(row.total_week),
        countWeek:       row.count_week,
        totalMonth:      Number(row.total_month),
        countMonth:      row.count_month,
        totalYear:       Number(row.total_year),
        countYear:       row.count_year,

        totalAllTime:    Number(row.total_all_time),
        countAllTime:    row.count_all_time,
        averageDonation: Number(row.avg_all_time),
      },
    });
  } catch (err) {
    console.error('[admin/donations] GET /stats error:', err.message);
    return res.status(500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// ─── GET /recent ─────────────────────────────────────────────────────────────

router.get('/recent', async (req, res) => {
  try {
    const result = await dbQuery(`
      SELECT
        d.id, d.amount, d.currency, d.donor_name, d.donor_email,
        d.nedarim_reference, d.transaction_id, d.transaction_type,
        d.confirmation, d.last_num, d.source, d.payment_method,
        d.status,
        d.transaction_time,
        d.created_at,
        d.lead_id,
        l.asker_name AS lead_name,
        q.title      AS question_title,
        u.name       AS rabbi_name
      FROM donations d
      LEFT JOIN leads     l ON l.id = d.lead_id
      LEFT JOIN questions q ON q.id = d.question_id
      LEFT JOIN rabbis    u ON u.id = d.rabbi_id
      WHERE ${OUR_SYSTEM_FILTER}
      ORDER BY d.transaction_time DESC NULLS LAST
      LIMIT 10
    `);

    return res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error('[admin/donations] GET /recent error:', err.message);
    return res.status(500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// ─── GET / ───────────────────────────────────────────────────────────────────

/**
 * Query params:
 *   page   – page number (default: 1)
 *   limit  – items per page (default: 50, max: 200)
 *   period – today|week|month|year|all (default: month)
 *   from   – explicit ISO start (takes precedence over period)
 *   to     – explicit ISO end
 *   search – substring match on donor_name / donor_email (optional)
 */
router.get('/', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const { where: dateWhere, params: dateParams, nextParamIdx } = buildDateFilter(req, 1);
    const params = [...dateParams];
    let idx = nextParamIdx;

    let searchClause = '';
    if (req.query.search && req.query.search.trim()) {
      params.push(`%${req.query.search.trim()}%`);
      searchClause = ` AND (d.donor_name ILIKE $${idx} OR d.donor_email ILIKE $${idx})`;
      idx++;
    }

    const where = `WHERE ${OUR_SYSTEM_FILTER} ${dateWhere} ${searchClause}`;

    const countPromise = dbQuery(
      `SELECT COUNT(*)::int AS total FROM donations d ${where}`,
      params
    );

    const dataPromise = dbQuery(
      `SELECT
         d.id, d.amount, d.currency, d.donor_name, d.donor_email, d.donor_phone,
         d.nedarim_reference, d.transaction_id, d.transaction_type,
         d.confirmation, d.last_num, d.source, d.payment_method,
         d.status, d.notes,
         d.transaction_time,
         d.created_at,
         d.lead_id,
         l.asker_name AS lead_name,
         q.title      AS question_title,
         u.name       AS rabbi_name
       FROM donations d
       LEFT JOIN leads     l ON l.id = d.lead_id
       LEFT JOIN questions q ON q.id = d.question_id
       LEFT JOIN rabbis    u ON u.id = d.rabbi_id
       ${where}
       ORDER BY d.transaction_time DESC NULLS LAST
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );

    const [countRes, dataRes] = await Promise.all([countPromise, dataPromise]);

    return res.json({
      ok: true,
      data: dataRes.rows,
      pagination: {
        page,
        limit,
        total: countRes.rows[0].total,
        pages: Math.ceil(countRes.rows[0].total / limit),
      },
    });
  } catch (err) {
    console.error('[admin/donations] GET / error:', err.message);
    return res.status(500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// ─── GET /export.csv ─────────────────────────────────────────────────────────

/**
 * CSV export of the donations matching the same filters as GET /.
 * Excel-friendly: UTF-8 BOM + comma-separated. Opens directly in Excel.
 */
router.get('/export.csv', async (req, res) => {
  try {
    const { where: dateWhere, params: dateParams, nextParamIdx } = buildDateFilter(req, 1);
    const params = [...dateParams];
    let idx = nextParamIdx;

    let searchClause = '';
    if (req.query.search && req.query.search.trim()) {
      params.push(`%${req.query.search.trim()}%`);
      searchClause = ` AND (d.donor_name ILIKE $${idx} OR d.donor_email ILIKE $${idx})`;
      idx++;
    }

    const where = `WHERE ${OUR_SYSTEM_FILTER} ${dateWhere} ${searchClause}`;

    const { rows } = await dbQuery(
      `SELECT
         d.transaction_time, d.amount, d.currency,
         d.donor_name, d.donor_email, d.donor_phone,
         d.transaction_type, d.confirmation, d.last_num,
         d.payment_method, d.tashloumim,
         d.source, d.notes, d.transaction_id, d.nedarim_reference,
         l.asker_name AS lead_name,
         q.title      AS question_title,
         u.name       AS rabbi_name
       FROM donations d
       LEFT JOIN leads     l ON l.id = d.lead_id
       LEFT JOIN questions q ON q.id = d.question_id
       LEFT JOIN rabbis    u ON u.id = d.rabbi_id
       ${where}
       ORDER BY d.transaction_time DESC NULLS LAST
       LIMIT 10000`,
      params
    );

    const headers = [
      'תאריך עסקה', 'סכום', 'מטבע',
      'שם תורם', 'אימייל', 'טלפון',
      'סוג עסקה', 'מספר אישור', '4 ספרות אחרונות',
      'כרטיס', 'מספר תשלומים',
      'מקור נתונים', 'הערות',
      'TransactionId', 'Reference',
      'ליד', 'שאלה', 'רב',
    ];

    function esc(v) {
      const s = v === null || v === undefined ? '' : String(v);
      if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }

    const lines = [headers.map(esc).join(',')];
    for (const r of rows) {
      lines.push([
        r.transaction_time ? new Date(r.transaction_time).toLocaleString('he-IL') : '',
        r.amount,
        r.currency || 'ILS',
        r.donor_name || '',
        r.donor_email || '',
        r.donor_phone || '',
        r.transaction_type === 'installments' ? 'תשלומים'
          : r.transaction_type === 'standing_order' ? 'הוראת קבע'
          : r.transaction_type === 'regular' ? 'חד-פעמי'
          : (r.transaction_type || ''),
        r.confirmation || '',
        r.last_num ? '...' + r.last_num : '',
        r.payment_method || '',
        r.tashloumim || '',
        r.source === 'webhook' ? 'live' : r.source === 'api_sync' ? 'sync' : r.source || '',
        r.notes || '',
        r.transaction_id || '',
        r.nedarim_reference || '',
        r.lead_name || '',
        r.question_title || '',
        r.rabbi_name ? 'הרב ' + r.rabbi_name.replace(/^\s*הרב\s+/, '') : '',
      ].map(esc).join(','));
    }

    const BOM = '\uFEFF';
    const csv = BOM + lines.join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="donations-${new Date().toISOString().split('T')[0]}.csv"`
    );
    return res.send(csv);
  } catch (err) {
    console.error('[admin/donations] GET /export.csv error:', err.message);
    return res.status(500).json({ error: err.message || 'שגיאת שרת' });
  }
});

module.exports = router;
