'use strict';

/**
 * dailyDigest.js
 * ─────────────────────────────────────────────────────────────────────────────
 * שולח סיכום יומי של שאלות ממתינות לכל הרבנים הפעילים.
 * רץ כל בוקר בשעה 08:00 שעון ישראל.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { query } = require('../../db/pool');
const { notifyAll } = require('../../services/notificationRouter');

/**
 * אוסף סטטיסטיקות על שאלות ממתינות ושולח סיכום לכל הרבנים.
 */
async function runDailyDigest() {
  // ── סטטיסטיקות שאלות ──────────────────────────────────────────────────
  const statsResult = await query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending')     AS pending_count,
      COUNT(*) FILTER (WHERE status = 'in_process')  AS in_process_count,
      COUNT(*) FILTER (WHERE status = 'pending' AND urgency = 'urgent') AS urgent_count,
      COUNT(*) FILTER (WHERE status = 'pending' AND created_at < NOW() - INTERVAL '24 hours') AS stale_count
    FROM questions
  `);

  const stats = statsResult.rows[0];
  const pendingCount    = parseInt(stats.pending_count, 10);
  const inProcessCount  = parseInt(stats.in_process_count, 10);
  const urgentCount     = parseInt(stats.urgent_count, 10);
  const staleCount      = parseInt(stats.stale_count, 10);

  console.info(`[daily-digest] סיכום יומי:`);
  console.info(`  שאלות ממתינות: ${pendingCount}`);
  console.info(`  שאלות בטיפול: ${inProcessCount}`);
  console.info(`  שאלות דחופות: ${urgentCount}`);
  console.info(`  שאלות ממתינות מעל 24 שעות: ${staleCount}`);

  if (pendingCount === 0 && inProcessCount === 0) {
    console.info('[daily-digest] אין שאלות פתוחות — מדלג על שליחת סיכום.');
    return;
  }

  // ── שאלות ממתינות לפי קטגוריה ──────────────────────────────────────────
  const byCategoryResult = await query(`
    SELECT c.name AS category_name, COUNT(*) AS count
    FROM   questions q
    LEFT JOIN categories c ON c.id = q.category_id
    WHERE  q.status = 'pending'
    GROUP BY c.name
    ORDER BY count DESC
  `);

  const byCategory = byCategoryResult.rows;

  // ── רשימת רבנים פעילים ─────────────────────────────────────────────────
  const rabbisResult = await query(`
    SELECT id, name, email, notification_pref
    FROM   rabbis
    WHERE  vacation_mode = FALSE
      AND  role IN ('rabbi', 'admin')
    ORDER BY name
  `);

  if (rabbisResult.rowCount === 0) {
    console.info('[daily-digest] אין רבנים פעילים — מדלג.');
    return;
  }

  console.info(`[daily-digest] שולח סיכום ל-${rabbisResult.rowCount} רבנים פעילים.`);

  // ── בניית תוכן הסיכום ─────────────────────────────────────────────────
  const digestData = {
    date: new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' }),
    pending: pendingCount,
    inProcess: inProcessCount,
    urgent: urgentCount,
    stale: staleCount,
    byCategory,
    recipients: rabbisResult.rows,
  };

  // שליחת הסיכום דרך notificationRouter לכל הרבנים הפעילים
  const rabbiIds = rabbisResult.rows.map((r) => r.id);
  await notifyAll('daily_digest', { pendingCount }).catch((err) =>
    console.error('[daily-digest] שגיאה בשליחת הסיכום:', err.message)
  );

  console.info(`[daily-digest] סיכום יומי הושלם בהצלחה — נשלח ל-${rabbiIds.length} רבנים.`);
}

module.exports = { runDailyDigest };
