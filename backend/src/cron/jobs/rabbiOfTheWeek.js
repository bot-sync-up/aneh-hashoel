'use strict';

/**
 * rabbiOfTheWeek.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Determines the top-performing rabbi of the past week and publishes a
 * celebratory post to the WordPress site.
 * Schedule is configurable via CRON_RABBI_OF_WEEK env (default: Sun 09:00).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { query } = require('../../db/pool');
// const wordpressService = require('../../services/wordpressService');

/**
 * Calculate rabbi ranking for the past week and post to WordPress.
 *
 * TODO:
 *  1. Query rabbi performance for the past 7 days — rank by:
 *     - number of answers given
 *     - average user rating on those answers
 *     - average response time (lower is better)
 *  2. Apply weighted scoring formula to determine the winner.
 *  3. Fetch rabbi profile data (bio, photo URL) for the post.
 *  4. Build a WordPress post with the rabbi's photo, stats summary,
 *     and a congratulatory message.
 *  5. Publish via wordpressService.createPost({ title, content, category, featuredImage }).
 *  6. Record the sync in wp_sync_log with status = 'synced'.
 *  7. If the WordPress API call fails, record status = 'failed' so the
 *     retryFailedWordPressSyncs job picks it up later.
 */
async function runRabbiOfTheWeek() {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  // Find the top rabbi for the week
  const result = await query(`
    SELECT
      r.id,
      r.name,
      r.email,
      r.bio,
      r.photo_url,
      COUNT(a.id)                                        AS answers_count,
      ROUND(AVG(EXTRACT(EPOCH FROM (a.published_at - q.lock_timestamp)) / 3600)::numeric, 1)
                                                         AS avg_response_hours,
      COALESCE(SUM(q.thank_count), 0)                   AS total_thanks
    FROM   rabbis r
    JOIN   answers a ON a.rabbi_id = r.id
                      AND a.created_at >= $1
    JOIN   questions q ON q.id = a.question_id
    WHERE  r.vacation_mode = FALSE
    GROUP BY r.id, r.name, r.email, r.bio, r.photo_url
    HAVING COUNT(a.id) > 0
    ORDER BY answers_count DESC, avg_response_hours ASC
    LIMIT 1
  `, [weekAgo.toISOString()]);

  if (result.rowCount === 0) {
    console.log('[rabbiOfTheWeek] No rabbi had answers this week — skipping.');
    return;
  }

  const topRabbi = result.rows[0];
  console.log(
    `[rabbiOfTheWeek] Winner: ${topRabbi.name} — ` +
    `${topRabbi.answers_count} answers, ` +
    `avg ${topRabbi.avg_response_hours || 'N/A'}h response time, ` +
    `${topRabbi.total_thanks} thanks`
  );

  // TODO: Publish to WordPress via wordpressService.createPost()
  // try {
  //   await wordpressService.createPost({
  //     title: `רב השבוע: ${topRabbi.name}`,
  //     content: buildPostContent(topRabbi),
  //     category: 'rabbi-of-the-week',
  //     featuredImage: topRabbi.photo_url,
  //   });
  //   await query(
  //     `INSERT INTO wp_sync_log (entity_type, entity_id, status, synced_at)
  //      VALUES ('rabbi_of_week', $1, 'synced', NOW())`,
  //     [topRabbi.id]
  //   );
  // } catch (err) {
  //   await query(
  //     `INSERT INTO wp_sync_log (entity_type, entity_id, status, error_message, retry_count)
  //      VALUES ('rabbi_of_week', $1, 'failed', $2, 0)`,
  //     [topRabbi.id, err.message]
  //   );
  //   throw err;
  // }

  console.log('[rabbiOfTheWeek] Completed successfully.');
}

module.exports = { runRabbiOfTheWeek };
