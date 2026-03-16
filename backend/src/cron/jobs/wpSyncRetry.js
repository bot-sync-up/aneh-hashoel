'use strict';

/**
 * wpSyncRetry.js
 * ─────────────────────────────────────────────────────────────────────────────
 * מנסה לסנכרן מחדש תשובות שנכשלו בסנכרון ל-WordPress.
 * מאתר שאלות שנענו אך wp_synced_at הוא NULL, ושולח POST ל-WP REST API.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const axios = require('axios');
const { query } = require('../../db/pool');

const WP_API_URL  = process.env.WP_API_URL;   // e.g. https://example.com/wp-json/wp/v2
const WP_USERNAME = process.env.WP_USERNAME;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;

const MAX_RETRIES_PER_RUN = 50;

/**
 * מאתר תשובות שלא סונכרנו ומנסה לשלוח אותן ל-WordPress.
 */
async function runWpSyncRetry() {
  if (!WP_API_URL || !WP_USERNAME || !WP_APP_PASSWORD) {
    console.info('[wp-sync-retry] הגדרות WordPress חסרות (WP_API_URL / WP_USERNAME / WP_APP_PASSWORD) — מדלג.');
    return;
  }

  // מציאת שאלות שנענו אך לא סונכרנו ל-WP
  const result = await query(
    `SELECT q.id, q.wp_post_id, q.title, q.content AS question_content,
            a.id AS answer_id, a.content AS answer_content,
            r.name AS rabbi_name, r.signature AS rabbi_signature
     FROM   questions q
     JOIN   answers a ON a.question_id = q.id
     JOIN   rabbis  r ON r.id = a.rabbi_id
     WHERE  q.status = 'answered'
       AND  q.wp_synced_at IS NULL
       AND  q.wp_post_id IS NOT NULL
     ORDER BY q.answered_at ASC
     LIMIT  $1`,
    [MAX_RETRIES_PER_RUN]
  );

  if (result.rowCount === 0) {
    console.info('[wp-sync-retry] אין תשובות ממתינות לסנכרון WP.');
    return;
  }

  console.info(`[wp-sync-retry] נמצאו ${result.rowCount} תשובות לסנכרון חוזר.`);

  const auth = Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD}`).toString('base64');
  let successCount = 0;
  let failCount = 0;

  for (const row of result.rows) {
    try {
      // בניית תוכן התשובה עבור WordPress
      const wpContent = buildWpContent(row);

      // עדכון הפוסט ב-WordPress
      await axios.put(
        `${WP_API_URL}/posts/${row.wp_post_id}`,
        {
          content: wpContent,
          status: 'publish',
          meta: {
            rabbi_name: row.rabbi_name,
            answer_id: row.answer_id,
          },
        },
        {
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
          timeout: 30_000,
        }
      );

      // סימון סנכרון מוצלח
      await query(
        'UPDATE questions SET wp_synced_at = NOW(), updated_at = NOW() WHERE id = $1',
        [row.id]
      );

      successCount++;
      console.info(`[wp-sync-retry] סונכרן בהצלחה: שאלה ${row.id} (WP post ${row.wp_post_id})`);
    } catch (err) {
      failCount++;
      const status = err.response?.status || 'N/A';
      const message = err.response?.data?.message || err.message;
      console.error(
        `[wp-sync-retry] נכשל סנכרון שאלה ${row.id} (WP post ${row.wp_post_id}): ` +
        `סטטוס ${status} — ${message}`
      );

      // רישום ביומן ביקורת
      await query(
        `INSERT INTO audit_log (action, entity_type, entity_id, new_value)
         VALUES ($1, $2, $3, $4)`,
        [
          'wp_sync_failed',
          'question',
          row.id,
          JSON.stringify({ wp_post_id: row.wp_post_id, error: message, status }),
        ]
      );
    }
  }

  console.info(`[wp-sync-retry] סיכום: ${successCount} הצליחו, ${failCount} נכשלו.`);
}

/**
 * בונה את תוכן ה-HTML עבור פוסט ב-WordPress.
 *
 * @param {Object} row - שורת תוצאה מהשאילתה
 * @returns {string} HTML content
 */
function buildWpContent(row) {
  const signature = row.rabbi_signature
    ? `<p class="rabbi-signature">${row.rabbi_signature}</p>`
    : '';

  return `
<div class="question-content">
  ${row.question_content}
</div>
<div class="answer-content">
  <h3>תשובה מאת ${row.rabbi_name}</h3>
  ${row.answer_content}
  ${signature}
</div>
`.trim();
}

module.exports = { runWpSyncRetry };
