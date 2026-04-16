'use strict';

/**
 * Onboarding Drip — sends 3 welcome emails to first-time askers.
 *
 * Step 1 (immediate):  onboarding_1 template
 * Step 2 (after 2 days): onboarding_2 template
 * Step 3 (after 5 days): onboarding_3 template
 *
 * All subject+body content is loaded from the admin-editable templates
 * (system_config['email_templates']). Only asker's name is a variable.
 *
 * Skips leads that have opted out (leads.is_unsubscribed = TRUE) per
 * Israeli §30א spam law. Every email includes an unsubscribe link in
 * the footer.
 *
 * Runs every 10 minutes via cron. Picks up queued items where
 * send_at <= NOW() and sent_at IS NULL.
 */

const { query: db } = require('../../db/pool');

const TAG = '[onboardingDrip]';

// ── Queue new asker for onboarding ───────────────────────────────────────────

/**
 * Called when a new first-time asker submits a question.
 * Queues 3 emails: immediate, +2 days, +5 days.
 */
async function queueOnboarding(leadId, encryptedEmail, askerName) {
  try {
    const now = new Date();
    const step2 = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // +2 days
    const step3 = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000); // +5 days

    await db(
      `INSERT INTO onboarding_queue (lead_id, email_encrypted, asker_name, step, send_at)
       VALUES ($1, $2, $3, 1, $4),
              ($1, $2, $3, 2, $5),
              ($1, $2, $3, 3, $6)
       ON CONFLICT (lead_id, step) DO NOTHING`,
      [leadId, encryptedEmail, askerName || 'ידיד/ה', now.toISOString(), step2.toISOString(), step3.toISOString()]
    );
    console.log(TAG, `Queued onboarding for lead ${leadId}`);
  } catch (err) {
    console.error(TAG, 'Failed to queue onboarding:', err.message);
  }
}

// ── Process queued emails ────────────────────────────────────────────────────

async function runOnboardingDrip() {
  try {
    // Fetch due emails + leads opt-out flag
    const { rows } = await db(
      `SELECT oq.id, oq.email_encrypted, oq.asker_name, oq.step, oq.lead_id,
              COALESCE(l.is_unsubscribed, FALSE) AS is_unsubscribed
       FROM   onboarding_queue oq
       LEFT JOIN leads l ON l.id = oq.lead_id
       WHERE  oq.sent_at IS NULL
         AND  oq.send_at <= NOW()
       ORDER BY oq.send_at ASC
       LIMIT 20`
    );

    if (rows.length === 0) return { sent: 0 };

    console.log(TAG, `Processing ${rows.length} onboarding emails`);

    const { decryptField } = require('../../utils/encryption');
    const { sendTemplated, buildUnsubscribeLink } = require('../../services/emailTemplates');

    let sent = 0;
    let skipped = 0;

    for (const row of rows) {
      // Skip unsubscribed leads (marketing email)
      if (row.is_unsubscribed) {
        await db(
          `UPDATE onboarding_queue SET sent_at = NOW(), error = 'skipped: unsubscribed' WHERE id = $1`,
          [row.id]
        );
        skipped++;
        continue;
      }

      let email;
      try { email = decryptField(row.email_encrypted); } catch { email = null; }
      if (!email) {
        await db(`UPDATE onboarding_queue SET error = 'decrypt/no email', sent_at = NOW() WHERE id = $1`, [row.id]);
        continue;
      }

      // Use the admin-editable template — no hardcoded content.
      const key = `onboarding_${row.step}`;
      const result = await sendTemplated(key, {
        to: email,
        audience: 'asker',
        unsubscribeLink: buildUnsubscribeLink(row.lead_id),
        fromName: 'המרכז למורשת מרן',
        vars: {
          name: row.asker_name || 'ידיד/ה',
        },
      });

      if (result.ok) {
        await db(`UPDATE onboarding_queue SET sent_at = NOW() WHERE id = $1`, [row.id]);
        sent++;
        console.log(TAG, `Sent step ${row.step} to ${email}`);
      } else {
        await db(`UPDATE onboarding_queue SET error = $1 WHERE id = $2`, [result.error || 'send failed', row.id]);
        console.error(TAG, `Failed step ${row.step} for ${email}: ${result.error}`);
      }
    }

    if (sent + skipped > 0) {
      console.log(TAG, `Done. sent=${sent} skipped=${skipped}`);
    }
    return { sent, skipped };
  } catch (err) {
    console.error(TAG, 'runOnboardingDrip error:', err.message);
    return { sent: 0, error: err.message };
  }
}

module.exports = { runOnboardingDrip, queueOnboarding };
