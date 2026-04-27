'use strict';

/**
 * timeoutCheck.js
 * ─────────────────────────────────────────────────────────────────────────────
 * בודק שאלות בסטטוס in_process שעברו את מגבלת הזמן (SLA) ומחזיר אותן
 * לסטטוס pending כדי שרב אחר יוכל לקחת אותן.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { query } = require('../../db/pool');
const { notify } = require('../../services/notificationRouter');

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

  // מציאת שאלות שחרגו מהזמן.
  // הערה: ב-PostgreSQL `RETURNING` מחזיר את הערך **החדש** של העמודה אחרי
  // ה-UPDATE — לכן `RETURNING assigned_rabbi_id` היה תמיד מחזיר NULL,
  // וה-audit_log איבד את זהות הרב הקודם. ה-CTE שלמטה תופס את הערך הישן
  // לפני העדכון ומאפשר להחזיר אותו נכון.
  const result = await query(
    `WITH expired AS (
       SELECT id,
              assigned_rabbi_id AS prev_rabbi_id,
              title             AS prev_title
       FROM   questions
       WHERE  status = 'in_process'
         AND  lock_timestamp IS NOT NULL
         AND  lock_timestamp < NOW() - INTERVAL '1 hour' * $1
       FOR UPDATE
     )
     UPDATE questions q
     SET    status            = 'pending',
            assigned_rabbi_id = NULL,
            lock_timestamp    = NULL,
            warning_sent      = FALSE,
            updated_at        = NOW()
     FROM   expired e
     WHERE  q.id = e.id
     RETURNING q.id, e.prev_rabbi_id AS previous_rabbi_id, e.prev_title AS title`,
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

  // שליחת התראה לרב שהשאלה נלקחה ממנו
  for (const row of result.rows) {
    if (row.previous_rabbi_id) {
      await notify(row.previous_rabbi_id, 'timeout_reset', {
        question: { id: row.id, title: row.title },
        message: `השאלה ${row.title} הוחזרה לתור — עבר זמן המענה המוגדר.`,
      }).catch((err) =>
        console.error(`[timeout-check] שגיאה בשליחת התראה לרב ${row.previous_rabbi_id}:`, err.message)
      );
    }
  }
}

module.exports = { runTimeoutCheck };
