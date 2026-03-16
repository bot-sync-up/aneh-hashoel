'use strict';

/**
 * weeklyReport.js
 * ─────────────────────────────────────────────────────────────────────────────
 * מחשב סטטיסטיקות שבועיות לכל רב ושולח דו"ח ביצועים.
 * רץ פעם בשבוע ביום ובשעה הניתנים להגדרה דרך משתני סביבה.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { query } = require('../../db/pool');

/**
 * מחשב ביצועי רבנים בשבוע האחרון ושולח דו"ח.
 */
async function runWeeklyReport() {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  // ── סטטיסטיקות כלליות לשבוע ──────────────────────────────────────────
  const globalStatsResult = await query(`
    SELECT
      COUNT(*) FILTER (WHERE created_at >= $1)    AS new_questions,
      COUNT(*) FILTER (WHERE answered_at >= $1)   AS answered_questions,
      COUNT(*) FILTER (WHERE status = 'pending')  AS currently_pending
    FROM questions
  `, [weekAgo.toISOString()]);

  const globalStats = globalStatsResult.rows[0];

  console.info('[weekly-report] סטטיסטיקות שבועיות כלליות:');
  console.info(`  שאלות חדשות: ${globalStats.new_questions}`);
  console.info(`  שאלות שנענו: ${globalStats.answered_questions}`);
  console.info(`  ממתינות כעת: ${globalStats.currently_pending}`);

  // ── סטטיסטיקות לכל רב ─────────────────────────────────────────────────
  const rabbiStatsResult = await query(`
    SELECT
      r.id,
      r.name,
      r.email,
      r.notification_pref,
      COUNT(a.id)                                        AS answers_count,
      ROUND(AVG(EXTRACT(EPOCH FROM (a.published_at - q.lock_timestamp)) / 3600)::numeric, 1)
                                                         AS avg_response_hours,
      COUNT(a.id) FILTER (WHERE q.urgency = 'urgent')    AS urgent_answered,
      SUM(q.thank_count)                                 AS total_thanks
    FROM   rabbis r
    LEFT JOIN answers a ON a.rabbi_id = r.id
                        AND a.created_at >= $1
    LEFT JOIN questions q ON q.id = a.question_id
    WHERE  r.vacation_mode = FALSE
    GROUP BY r.id, r.name, r.email, r.notification_pref
    ORDER BY answers_count DESC
  `, [weekAgo.toISOString()]);

  if (rabbiStatsResult.rowCount === 0) {
    console.info('[weekly-report] אין רבנים פעילים — מדלג.');
    return;
  }

  const rabbiStats = rabbiStatsResult.rows;

  console.info(`[weekly-report] מחושב דו"ח ל-${rabbiStats.length} רבנים:`);
  for (const rabbi of rabbiStats) {
    console.info(
      `  - ${rabbi.name}: ${rabbi.answers_count} תשובות, ` +
      `ממוצע ${rabbi.avg_response_hours || 'N/A'} שעות, ` +
      `${rabbi.total_thanks || 0} תודות`
    );
  }

  // ── מציאת הרב המצטיין ─────────────────────────────────────────────────
  const topRabbi = rabbiStats.find((r) => parseInt(r.answers_count, 10) > 0) || null;

  const reportData = {
    weekStart: weekAgo.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' }),
    weekEnd: new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' }),
    global: {
      newQuestions:      parseInt(globalStats.new_questions, 10),
      answeredQuestions: parseInt(globalStats.answered_questions, 10),
      currentlyPending:  parseInt(globalStats.currently_pending, 10),
    },
    rabbiStats,
    topRabbi: topRabbi
      ? { name: topRabbi.name, answers: parseInt(topRabbi.answers_count, 10) }
      : null,
  };

  // TODO: שליחת הדו"ח בפועל (יוטמע ע"י סוכן ההתראות)
  // const notificationService = require('../../services/notifications');
  // for (const rabbi of rabbiStats) {
  //   await notificationService.sendWeeklyReport(rabbi, reportData);
  // }

  console.info('[weekly-report] דו"ח שבועי הושלם בהצלחה.');
}

module.exports = { runWeeklyReport };
