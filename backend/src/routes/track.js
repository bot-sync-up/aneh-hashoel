'use strict';

/**
 * Click Tracking Routes — /api/track
 *
 * Public endpoints (no auth required) for tracking asker email link clicks.
 *
 * GET /api/track/:questionId — Track email click and redirect to WP answer page
 */

const express = require('express');
const { query: dbQuery } = require('../db/pool');

const router = express.Router();

// ─── GET /:questionId — track click and redirect ─────────────────────────────

/**
 * When an asker clicks the link in their notification email to view the answer,
 * this endpoint:
 *   1. Records the click in the leads table (increment interaction_score, update timestamps)
 *   2. Marks the lead as "hot" if conditions met (clicked + had 3+ questions)
 *   3. Redirects to the actual WP answer page
 *
 * Fire-and-forget: logs to Google Sheets if configured.
 *
 * @route GET /api/track/:questionId
 */
router.get('/:questionId', async (req, res) => {
  const { questionId } = req.params;

  // ── Look up the question to get the WP link and asker info ───────────────
  let question;
  try {
    const { rows } = await dbQuery(
      `SELECT id, wp_post_id, wp_link, asker_email_encrypted
       FROM   questions
       WHERE  id = $1
       LIMIT  1`,
      [questionId]
    );
    question = rows[0];
  } catch (err) {
    console.error('[track] DB lookup error:', err.message);
  }

  // ── Build redirect URL ──────────────────────────────────────────────────
  let redirectUrl;
  if (question?.wp_link) {
    redirectUrl = question.wp_link;
  } else if (question?.wp_post_id) {
    const baseUrl = (process.env.WP_SITE_URL || process.env.WP_API_URL || '')
      .replace(/\/wp-json.*$/, '').replace(/\/$/, '');
    redirectUrl = `${baseUrl}/ask-rabai/${question.wp_post_id}`;
  } else {
    // Fallback — redirect to site homepage
    redirectUrl = (process.env.WP_SITE_URL || process.env.WP_API_URL || 'https://moreshet-maran.com')
      .replace(/\/wp-json.*$/, '').replace(/\/$/, '');
  }

  // ── Fire-and-forget: update lead tracking ──────────────────────────────
  if (question?.asker_email_encrypted) {
    (async () => {
      try {
        // Update lead: increment interaction_score, update timestamps
        const { rows: updateRows } = await dbQuery(
          `UPDATE leads
           SET    interaction_score = interaction_score + 1,
                  updated_at        = NOW()
           WHERE  asker_email_encrypted = $1
           RETURNING id, question_count, interaction_score, is_hot`,
          [question.asker_email_encrypted]
        );

        // Check if lead should be marked as hot (clicked + 3+ questions)
        if (updateRows[0] && !updateRows[0].is_hot) {
          const lead = updateRows[0];
          if (lead.question_count >= 3) {
            await dbQuery(
              `UPDATE leads SET is_hot = true, updated_at = NOW() WHERE id = $1`,
              [lead.id]
            );
            console.log(`[track] Lead ${lead.id} marked as hot (clicked + ${lead.question_count} questions)`);
          }
        }

        console.log(`[track] Click recorded for question ${questionId}`);

        // Fire-and-forget: sync to Google Sheets if configured
        try {
          const sheetsService = require('../services/googleSheetsService');
          if (sheetsService.isConfigured && sheetsService.isConfigured()) {
            sheetsService.logLeadInteraction?.({
              questionId,
              type: 'email_click',
              timestamp: new Date().toISOString(),
            });
          }
        } catch {
          // Sheets not configured — ignore
        }
      } catch (trackErr) {
        console.error('[track] Lead update error:', trackErr.message);
      }
    })();
  }

  // ── Redirect immediately — don't wait for tracking ──────────────────────
  return res.redirect(302, redirectUrl);
});

module.exports = router;
