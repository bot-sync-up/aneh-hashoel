'use strict';

/**
 * Admin Dashboard Routes  –  /admin/dashboard/*
 *
 * All routes require authenticate + requireAdmin.
 *
 * GET /stats                  – overview aggregates (KPI cards)
 * GET /activity               – last 7 days daily new/answered (line chart)
 * GET /categories/breakdown   – question count per category (pie/bar chart)
 * GET /rabbis/performance     – per-rabbi table: answers, avg time, thanks, last active
 * GET /response-times         – histogram data: response time distribution
 * GET /questions/returned     – count of questions released back to queue
 *
 * Depends on:
 *   middleware/authenticate   – authenticate, requireAdmin
 *   services/analyticsService – getOverviewStats, getDailyActivity,
 *                               getCategoryBreakdown, getRabbiPerformance,
 *                               getResponseTimeHistogram, getReturnedQuestionCount
 */

const express = require('express');
const { authenticate, requireAdmin } = require('../../middleware/authenticate');
const analyticsService = require('../../services/analyticsService');

const router = express.Router();

// Every route in this file requires auth + admin role
router.use(authenticate, requireAdmin);

// ─── GET /stats ───────────────────────────────────────────────────────────────

/**
 * GET /admin/dashboard/stats
 *
 * Returns high-level KPI snapshot:
 * {
 *   totalQuestions, pending, inProcess, answered, hidden,
 *   totalRabbis, activeRabbis, onlineRabbis,
 *   avgResponseTime,
 *   totalThanks, thisWeekAnswers
 * }
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await analyticsService.getOverviewStats();
    return res.json({ ok: true, data: stats });
  } catch (err) {
    console.error('[dashboard] GET /stats error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// ─── GET /activity ────────────────────────────────────────────────────────────

/**
 * GET /admin/dashboard/activity
 *
 * Returns daily counts for the last 7 days (for line chart):
 * [{ date, newQuestions, answeredQuestions }, ...]
 *
 * Query params:
 *   days  – optional override (default: 7, max: 90)
 */
router.get('/activity', async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));
    const data = await analyticsService.getDailyActivity(days);
    return res.json({ ok: true, data, days });
  } catch (err) {
    console.error('[dashboard] GET /activity error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// ─── GET /categories/breakdown ───────────────────────────────────────────────

/**
 * GET /admin/dashboard/categories/breakdown
 *
 * Returns question count per category for pie/bar charts:
 * [{ id, name, color, total, answered, answerRate }, ...]
 */
router.get('/categories/breakdown', async (req, res) => {
  try {
    const data = await analyticsService.getCategoryBreakdown();
    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[dashboard] GET /categories/breakdown error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// ─── GET /rabbis/performance ─────────────────────────────────────────────────

/**
 * GET /admin/dashboard/rabbis/performance
 *
 * Returns rabbi performance table rows:
 * [{ id, name, answersThisMonth, avgResponseHours, totalThanks, lastActive }, ...]
 *
 * Query params:
 *   period – 'week' | 'month' | 'all' (default: 'month')
 */
router.get('/rabbis/performance', async (req, res) => {
  try {
    const period = ['week', 'month', 'all'].includes(req.query.period)
      ? req.query.period
      : 'month';

    const data = await analyticsService.getRabbiPerformance(period);
    return res.json({ ok: true, data, period });
  } catch (err) {
    console.error('[dashboard] GET /rabbis/performance error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// ─── GET /response-times ─────────────────────────────────────────────────────

/**
 * GET /admin/dashboard/response-times
 *
 * Returns histogram-ready buckets of response time distribution:
 * [{ bucket, label, count }, ...]
 *
 * Buckets: <1h, 1-4h, 4-12h, 12-24h, 24-48h, 48-72h, >72h
 */
router.get('/response-times', async (req, res) => {
  try {
    const data = await analyticsService.getResponseTimeHistogram();
    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[dashboard] GET /response-times error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

// ─── GET /questions/returned ─────────────────────────────────────────────────

/**
 * GET /admin/dashboard/questions/returned
 *
 * Returns count of questions that were released back to queue
 * (efficiency metric — rabbi claimed then unclaimed).
 *
 * Response: { count, thisWeek, thisMonth }
 */
router.get('/questions/returned', async (req, res) => {
  try {
    const data = await analyticsService.getReturnedQuestionCount();
    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[dashboard] GET /questions/returned error:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
  }
});

module.exports = router;
