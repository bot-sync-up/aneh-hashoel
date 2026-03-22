'use strict';

/**
 * warningCheck.js
 * ─────────────────────────────────────────────────────────────────────────────
 * בודק שאלות שמתקרבות לחריגת זמן (שעה לפני ה-timeout) ושולח התראת אזהרה
 * לרב המטפל כדי שיספיק לסיים.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { query } = require('../../db/pool');
const { notify } = require('../../services/notificationRouter');

/**
 * מאתר שאלות שנמצאות בטווח אזהרה (שעה לפני timeout) ושולח התראה לרב.
 * מסמן warning_sent = true כדי לא לשלוח שוב.
 */
async function runWarningCheck() {
  // שליפת הגדרות SLA
  const slaResult = await query('SELECT hours_to_timeout, hours_to_warning, enabled FROM sla_config WHERE id = 1');
  const sla = slaResult.rows[0];

  if (!sla || !sla.enabled) {
    console.info('[warning-check] בדיקת SLA מושבתת — מדלג.');
    return;
  }

  const hoursToTimeout = sla.hours_to_timeout;
  // שעת אזהרה = שעה אחת לפני ה-timeout
  const warningThresholdHours = hoursToTimeout - 1;

  if (warningThresholdHours <= 0) {
    console.info('[warning-check] מרווח אזהרה לא תקין (timeout קצר מדי) — מדלג.');
    return;
  }

  // מציאת שאלות שנכנסו לטווח אזהרה אך עדיין לא חרגו
  const result = await query(
    `SELECT q.id, q.title, q.assigned_rabbi_id, q.lock_timestamp,
            r.name AS rabbi_name, r.email AS rabbi_email, r.notification_pref
     FROM   questions q
     JOIN   rabbis r ON r.id = q.assigned_rabbi_id
     WHERE  q.status = 'in_process'
       AND  q.warning_sent = FALSE
       AND  q.lock_timestamp IS NOT NULL
       AND  q.lock_timestamp < NOW() - INTERVAL '1 hour' * $1
       AND  q.lock_timestamp >= NOW() - INTERVAL '1 hour' * $2`,
    [warningThresholdHours, hoursToTimeout]
  );

  if (result.rowCount === 0) {
    console.info('[warning-check] אין שאלות בטווח אזהרה.');
    return;
  }

  console.info(`[warning-check] נמצאו ${result.rowCount} שאלות בטווח אזהרה:`);

  for (const row of result.rows) {
    console.info(`  - שאלה ${row.id}: "${row.title}" — רב: ${row.rabbi_name} (${row.rabbi_email})`);

    // סימון שהאזהרה נשלחה
    await query(
      'UPDATE questions SET warning_sent = TRUE, updated_at = NOW() WHERE id = $1',
      [row.id]
    );

    // שליחת התראת אזהרה לרב דרך notificationRouter
    const minutesLeft = Math.round((hoursToTimeout - warningThresholdHours) * 60);
    await notify(row.assigned_rabbi_id, 'timeout_warning', {
      question:   { id: row.id, title: row.title },
      minutesLeft,
    }).catch((err) =>
      console.error(`[warning-check] שגיאה בשליחת התראה לרב ${row.assigned_rabbi_id}:`, err.message)
    );
  }

  console.info(`[warning-check] סומנו ${result.rowCount} שאלות כאזהרה נשלחה.`);
}

module.exports = { runWarningCheck };
