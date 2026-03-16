'use strict';

/**
 * timeoutCheck.js
 * ─────────────────────────────────────────────────────────────────────────────
 * בודק שאלות בסטטוס in_process שעברו את מגבלת הזמן (SLA) ומחזיר אותן
 * לסטטוס pending כדי שרב אחר יוכל לקחת אותן.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { query } = require('../../db/pool');

/**
 * מאתר שאלות שחרגו מהזמן המוגדר ב-sla_config ומאפס אותן.
 * השאלות חוזרות לסטטוס pending, השיוך לרב מוסר, ונעילה מתבטלת.
 */
async function runTimeoutCheck() {
  // שליפת הגדרות SLA
  const slaResult = await query('SELECT hours_to_timeout, enabled FROM sla_config WHERE id = 1');
  const sla = slaResult.rows[0];

  if (!sla || !sla.enabled) {
    console.info('[timeout-check] בדיקת SLA מושבתת — מדלג.');
    return;
  }

  const hoursToTimeout = sla.hours_to_timeout;

  // מציאת שאלות שחרגו מהזמן
  const result = await query(
    `UPDATE questions
     SET    status            = 'pending',
            assigned_rabbi_id = NULL,
            lock_timestamp    = NULL,
            warning_sent      = FALSE,
            updated_at        = NOW()
     WHERE  status = 'in_process'
       AND  lock_timestamp IS NOT NULL
       AND  lock_timestamp < NOW() - INTERVAL '1 hour' * $1
     RETURNING id, assigned_rabbi_id AS previous_rabbi_id, title`,
    [hoursToTimeout]
  );

  if (result.rowCount === 0) {
    console.info('[timeout-check] אין שאלות שחרגו מהזמן.');
    return;
  }

  console.info(`[timeout-check] ${result.rowCount} שאלות הוחזרו לסטטוס ממתין:`);
  for (const row of result.rows) {
    console.info(`  - שאלה ${row.id}: "${row.title}" (רב קודם: ${row.previous_rabbi_id || 'לא ידוע'})`);
  }

  // רישום ביומן ביקורת
  for (const row of result.rows) {
    await query(
      `INSERT INTO audit_log (action, entity_type, entity_id, old_value, new_value)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        'timeout_reset',
        'question',
        row.id,
        JSON.stringify({ status: 'in_process', assigned_rabbi_id: row.previous_rabbi_id }),
        JSON.stringify({ status: 'pending', assigned_rabbi_id: null }),
      ]
    );
  }

  // TODO: שליחת התראה לרב שהשאלה נלקחה ממנו (יוטמע ע"י סוכן ההתראות)
  // const notificationService = require('../../services/notifications');
  // await notificationService.notifyTimeoutReset(result.rows);
}

module.exports = { runTimeoutCheck };
