'use strict';

/**
 * Admin Donations Routes  —  /admin/donations/*
 *
 * All routes require authenticate + requireAdmin.
 *
 * GET /              – list all donations (paginated)
 * GET /stats         – monthly total, count, average
 * GET /recent        – last 10 donations (dashboard widget)
 *
 * Depends on:
 *   middleware/authenticate  – authenticate, requireAdmin
 *   db/pool                 – query
 */

const express = require('express');
const { authenticate, requireAdmin } = require('../../middleware/authenticate');
const { query: dbQuery } = require('../../db/pool');

const router = express.Router();

// Every route in this file requires auth + admin role
router.use(authenticate, requireAdmin);

// ─── GET /stats ──────────────────────────────────────────────────────────────

/**
 * GET /admin/donations/stats
 *
 * Returns donation KPIs:
 * {
 *   totalAllTime, totalThisMonth, countThisMonth,
 *   averageDonation, countAllTime
 * }
 */
router.get('/stats', async (req, res) => {
  try {
    const result = await dbQuery(`
      SELECT
        COALESCE(SUM(amount), 0)::numeric                              AS total_all_time,
        COUNT(*)::int                                                   AS count_all_time,
        COALESCE(SUM(amount) FILTER (
          WHERE created_at >= date_trunc('month', NOW())
        ), 0)::numeric                                                  AS total_this_month,
        COUNT(*) FILTER (
          WHERE created_at >= date_trunc('month', NOW())
        )::int                                                          AS count_this_month,
        COALESCE(ROUND(AVG(amount), 2), 0)::numeric                    AS average_donation
      FROM donations
      WHERE status = 'completed'
    `);

    const row = result.rows[0];
    return res.json({
      ok: true,
      data: {
        totalAllTime:    Number(row.total_all_time),
        countAllTime:    row.count_all_time,
        totalThisMonth:  Number(row.total_this_month),
        countThisMonth:  row.count_this_month,
        averageDonation: Number(row.average_donation),
      },
    });
  } catch (err) {
    console.error('[admin/donations] GET /stats error:', err.message);
    return res.status(500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// ─── GET /recent ─────────────────────────────────────────────────────────────

/**
 * GET /admin/donations/recent
 *
 * Returns the last 10 donations for the dashboard widget.
 */
router.get('/recent', async (req, res) => {
  try {
    const result = await dbQuery(`
      SELECT
        d.id,
        d.amount,
        d.currency,
        d.donor_name,
        d.donor_email,
        d.nedarim_reference,
        d.payment_method,
        d.status,
        d.created_at,
        q.title AS question_title,
        u.name  AS rabbi_name
      FROM donations d
      LEFT JOIN questions q ON q.id = d.question_id
      LEFT JOIN rabbis    u ON u.id = d.rabbi_id
      ORDER BY d.created_at DESC
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
 * GET /admin/donations
 *
 * Returns paginated list of all donations.
 *
 * Query params:
 *   page   – page number (default: 1)
 *   limit  – items per page (default: 50, max: 200)
 */
router.get('/', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const [countRes, dataRes] = await Promise.all([
      dbQuery('SELECT COUNT(*)::int AS total FROM donations'),
      dbQuery(
        `SELECT
           d.id,
           d.amount,
           d.currency,
           d.donor_name,
           d.donor_email,
           d.donor_phone,
           d.nedarim_reference,
           d.payment_method,
           d.status,
           d.notes,
           d.created_at,
           q.title AS question_title,
           u.name  AS rabbi_name
         FROM donations d
         LEFT JOIN questions q ON q.id = d.question_id
         LEFT JOIN rabbis    u ON u.id = d.rabbi_id
         ORDER BY d.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
    ]);

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

module.exports = router;
