'use strict';

/**
 * rabbiOfTheWeek.js
 * ---------------------------------------------------------------------------
 * Determines the top-performing rabbi of the past week using a weighted
 * scoring formula, saves the result to the database, emits a socket event
 * for the dashboard, and sends a congratulatory email.
 *
 * Schedule is configurable via CRON_RABBI_OF_WEEK env (default: Sun 09:00).
 * ---------------------------------------------------------------------------
 *
 * Scoring weights:
 *   - Number of answers given:                50%
 *   - Average response time (lower = better): 30%
 *   - Thank count received:                   20%
 */

const { query } = require('../../db/pool');
const { sendRabbiOfWeekNotification } = require('../../services/emailService');
const { getIO } = require('../../socket/handlers');

// ─── Scoring configuration ────────────────────────────────────────────────────

const WEIGHT_ANSWERS       = 0.50;
const WEIGHT_RESPONSE_TIME = 0.30;
const WEIGHT_THANKS        = 0.20;

/**
 * Normalize a value into 0-1 range using min-max scaling.
 * Returns 0 when all values are identical (max === min).
 */
function normalize(value, min, max) {
  if (max === min) return 0;
  return (value - min) / (max - min);
}

/**
 * Calculate rabbi ranking for the past week, save winner, emit socket
 * event, and send congratulatory email.
 */
async function runRabbiOfTheWeek() {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const now = new Date();

  // ── 1. Query rabbi performance for the past 7 days ────────────────────────

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
    ORDER BY answers_count DESC
  `, [weekAgo.toISOString()]);

  if (result.rowCount === 0) {
    console.log('[rabbiOfTheWeek] No rabbi had answers this week — skipping.');
    return;
  }

  const rabbis = result.rows;

  // ── 2. Apply weighted scoring to determine the winner ─────────────────────

  // Collect min/max for normalization
  const answersCounts    = rabbis.map(r => Number(r.answers_count));
  const responseTimes    = rabbis.map(r => Number(r.avg_response_hours) || 0);
  const thanksCounts     = rabbis.map(r => Number(r.total_thanks));

  const minAnswers  = Math.min(...answersCounts);
  const maxAnswers  = Math.max(...answersCounts);
  const minRT       = Math.min(...responseTimes);
  const maxRT       = Math.max(...responseTimes);
  const minThanks   = Math.min(...thanksCounts);
  const maxThanks   = Math.max(...thanksCounts);

  let topRabbi = null;
  let topScore = -Infinity;

  for (const rabbi of rabbis) {
    const answers = Number(rabbi.answers_count);
    const rt      = Number(rabbi.avg_response_hours) || 0;
    const thanks  = Number(rabbi.total_thanks);

    // Normalize each metric to 0-1 range
    const normAnswers = normalize(answers, minAnswers, maxAnswers);
    // Invert response time — lower is better
    const normRT      = 1 - normalize(rt, minRT, maxRT);
    const normThanks  = normalize(thanks, minThanks, maxThanks);

    const score = (WEIGHT_ANSWERS * normAnswers)
                + (WEIGHT_RESPONSE_TIME * normRT)
                + (WEIGHT_THANKS * normThanks);

    rabbi._score = Math.round(score * 1000) / 1000;

    if (score > topScore) {
      topScore = score;
      topRabbi = rabbi;
    }
  }

  console.log(
    `[rabbiOfTheWeek] Winner: ${topRabbi.name} (score ${topRabbi._score}) — ` +
    `${topRabbi.answers_count} answers, ` +
    `avg ${topRabbi.avg_response_hours || 'N/A'}h response time, ` +
    `${topRabbi.total_thanks} thanks`
  );

  // ── 3. Save the winner to the database ────────────────────────────────────

  const weekStart = weekAgo.toISOString().slice(0, 10);
  const weekEnd   = now.toISOString().slice(0, 10);

  // Upsert into system_config — uses a single JSON row keyed by 'rabbi_of_the_week'
  const payload = {
    rabbi_id:           topRabbi.id,
    rabbi_name:         topRabbi.name,
    rabbi_photo_url:    topRabbi.photo_url || null,
    week_start:         weekStart,
    week_end:           weekEnd,
    answers_count:      Number(topRabbi.answers_count),
    avg_response_hours: Number(topRabbi.avg_response_hours) || 0,
    total_thanks:       Number(topRabbi.total_thanks),
    score:              topRabbi._score,
    determined_at:      now.toISOString(),
  };

  await query(`
    INSERT INTO system_config (key, value, updated_at)
    VALUES ('rabbi_of_the_week', $1::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value      = $1::jsonb,
          updated_at = NOW()
  `, [JSON.stringify(payload)]);

  console.log('[rabbiOfTheWeek] Saved winner to system_config.');

  // ── 4. Emit socket event so the dashboard can show it ─────────────────────

  const io = getIO();
  if (io) {
    io.emit('rabbi:weeklyWinner', payload);
    console.log('[rabbiOfTheWeek] Emitted rabbi:weeklyWinner socket event.');
  } else {
    console.warn('[rabbiOfTheWeek] Socket.io not available — skipped emit.');
  }

  // ── 5. Send congratulatory email to the winning rabbi ─────────────────────

  try {
    await sendRabbiOfWeekNotification(
      { id: topRabbi.id, email: topRabbi.email, name: topRabbi.name },
      {
        weekStart,
        weekEnd,
        answersCount: Number(topRabbi.answers_count),
        thanksCount:  Number(topRabbi.total_thanks),
        viewsCount:   0,  // views not tracked per-rabbi in the weekly query
      }
    );
    console.log('[rabbiOfTheWeek] Congratulation email sent.');
  } catch (err) {
    // Email failure should not break the cron job — the winner is already saved
    console.error(`[rabbiOfTheWeek] Failed to send email: ${err.message}`);
  }

  console.log('[rabbiOfTheWeek] Completed successfully.');
}

module.exports = { runRabbiOfTheWeek };
