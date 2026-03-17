"use strict";

/**
 * Dashboard Routes  –  /api/dashboard/*
 *
 * GET /stats          – rabbi-level stats (own questions, answers, thanks)
 * GET /my-questions   – rabbi's own active questions
 * GET /activity       – recent activity feed
 */

const express = require("express");
const { authenticate } = require("../middleware/auth");
const { query: db } = require("../db/pool");

const router = express.Router();
router.use(authenticate);

// ─── GET /stats ───────────────────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const rabbiId = req.rabbi.id;

    const [inProcess, answered, thanks] = await Promise.all([
      db("SELECT COUNT(*) AS count FROM questions WHERE assigned_rabbi_id=$1 AND status='in_process'", [rabbiId]),
      db("SELECT COUNT(*) AS count FROM questions WHERE assigned_rabbi_id=$1 AND status='answered'", [rabbiId]),
      db("SELECT COALESCE(SUM(thank_count),0) AS total FROM questions WHERE assigned_rabbi_id=$1", [rabbiId]),
    ]);

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);

    const weekAnswered = await db(
      "SELECT COUNT(*) AS count FROM questions WHERE assigned_rabbi_id=$1 AND status='answered' AND answered_at>$2",
      [rabbiId, weekStart.toISOString()]
    );

    return res.json({
      inProcess: parseInt(inProcess.rows[0].count, 10),
      totalAnswered: parseInt(answered.rows[0].count, 10),
      totalThanks: parseInt(thanks.rows[0].total, 10),
      weekAnswers: parseInt(weekAnswered.rows[0].count, 10),
      weeklyActivity: [],
      categoryBreakdown: [],
      recentActivity: [],
      onlineRabbisList: [],
    });
  } catch (err) {
    console.error("[dashboard] GET /stats error:", err.message);
    return res.status(500).json({ error: "שגיאת שרת פנימית" });
  }
});

// ─── GET /my-questions ────────────────────────────────────────────────────────
router.get("/my-questions", async (req, res) => {
  try {
    const rabbiId = req.rabbi.id;
    const { rows } = await db(
      `SELECT q.id, q.title, q.status, q.urgency, q.created_at, q.lock_timestamp,
              c.name AS category_name
       FROM   questions q
       LEFT JOIN categories c ON c.id = q.category_id
       WHERE  q.assigned_rabbi_id = $1
         AND  q.status IN ('in_process', 'pending')
       ORDER BY q.created_at DESC
       LIMIT 20`,
      [rabbiId]
    );
    return res.json({ questions: rows });
  } catch (err) {
    console.error("[dashboard] GET /my-questions error:", err.message);
    return res.status(500).json({ error: "שגיאת שרת פנימית" });
  }
});

// ─── GET /activity ────────────────────────────────────────────────────────────
router.get("/activity", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const { rows } = await db(
      `SELECT q.id, q.title, q.status, q.updated_at AS timestamp,
              r.name AS rabbi_name
       FROM   questions q
       LEFT JOIN rabbis r ON r.id = q.assigned_rabbi_id
       ORDER BY q.updated_at DESC
       LIMIT $1`,
      [limit]
    );
    return res.json(rows);
  } catch (err) {
    console.error("[dashboard] GET /activity error:", err.message);
    return res.status(500).json({ error: "שגיאת שרת פנימית" });
  }
});

module.exports = router;
