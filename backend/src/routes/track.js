'use strict';

/**
 * Click Tracking Routes — /api/track
 *
 * Public endpoints (no auth required) for tracking asker email link clicks.
 *
 * GET /api/track/:questionId — Track email/WhatsApp click and redirect to WP answer page
 *
 * Tracking behaviour:
 *   1. Updates leads table: increment click_count, set last_click_at, bump interaction_score
 *   2. Marks lead as "hot" if they clicked within 1 hour of the notification being sent
 *      OR if they have 3+ questions
 *   3. Emits socket event 'lead:hot' so the admin dashboard can react in real time
 *   4. Syncs hot status to Google Sheets (fire-and-forget)
 */

const express = require('express');
const { query: dbQuery } = require('../db/pool');

const router = express.Router();

// ─── GET /:questionId — track click and redirect ─────────────────────────────

/**
 * When an asker clicks the link in their notification email or WhatsApp to
 * view the answer, this endpoint records the click then redirects.
 *
 * @route GET /api/track/:questionId
 */
router.get('/:questionId', async (req, res) => {
  const { questionId } = req.params;

  // ── Look up the question to get the WP link, asker info, and notification time
  let question;
  try {
    const { rows } = await dbQuery(
      `SELECT id, wp_post_id, wp_link, asker_email_encrypted, notified_asker, updated_at
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
  // Support explicit redirect param (used when link was built with ?redirect=)
  let redirectUrl = req.query.redirect || null;

  if (!redirectUrl) {
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
  }

  // ── Fire-and-forget: update lead tracking ──────────────────────────────
  if (question?.asker_email_encrypted) {
    (async () => {
      try {
        const now = new Date();

        // Update lead: increment click_count, set last_click_at, bump interaction_score
        const { rows: updateRows } = await dbQuery(
          `UPDATE leads
           SET    click_count       = click_count + 1,
                  last_click_at     = NOW(),
                  interaction_score = interaction_score + 1,
                  updated_at        = NOW()
           WHERE  asker_email_encrypted = $1
           RETURNING id, question_count, interaction_score, is_hot, asker_name,
                     asker_email_encrypted, click_count`,
          [question.asker_email_encrypted]
        );

        const lead = updateRows[0];
        if (!lead) {
          console.warn(`[track] No lead found for question ${questionId}`);
          return;
        }

        console.log(`[track] Click recorded for question ${questionId} (lead ${lead.id}, click #${lead.click_count})`);

        // ── Determine if lead should become hot ──────────────────────────
        let becameHot = false;

        if (!lead.is_hot) {
          let shouldBeHot = false;
          let hotReason = '';

          // Criterion 1: clicked within 1 hour of receiving the notification
          if (question.notified_asker && question.updated_at) {
            const notifiedAt = new Date(question.updated_at);
            const hoursSinceNotification = (now - notifiedAt) / (1000 * 60 * 60);
            if (hoursSinceNotification <= 1) {
              shouldBeHot = true;
              hotReason = `clicked ${Math.round(hoursSinceNotification * 60)} min after notification`;
            }
          }

          // Criterion 2: 3+ questions (existing logic, preserved)
          if (!shouldBeHot && lead.question_count >= 3) {
            shouldBeHot = true;
            hotReason = `clicked + ${lead.question_count} questions`;
          }

          if (shouldBeHot) {
            await dbQuery(
              `UPDATE leads SET is_hot = true, updated_at = NOW() WHERE id = $1`,
              [lead.id]
            );
            becameHot = true;
            console.log(`[track] Lead ${lead.id} marked as hot (${hotReason})`);
          }
        }

        // ── Emit socket event if lead is hot (new or existing) ──────────
        if (becameHot || lead.is_hot) {
          try {
            const { getIO } = require('../socket/handlers');
            const io = getIO();
            if (io) {
              io.to('admins').emit('lead:hot', {
                leadId:     lead.id,
                name:       lead.asker_name || null,
                questionId,
                clickCount: lead.click_count,
                isNew:      becameHot,
                timestamp:  now.toISOString(),
              });
            }
          } catch (socketErr) {
            console.error('[track] Socket emit error:', socketErr.message);
          }
        }

        // ── Fire-and-forget: mark hot in Google Sheets ──────────────────
        if (becameHot) {
          try {
            const sheetsService = require('../services/googleSheetsService');
            const { decryptField } = require('../utils/encryption');
            const email = decryptField(lead.asker_email_encrypted);
            if (email && sheetsService.markLeadHot) {
              sheetsService.markLeadHot(email, 'clicked answer link').catch((err) => {
                console.warn('[track] Sheets markLeadHot error:', err.message);
              });
            }
          } catch {
            // Sheets not configured — ignore
          }
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
