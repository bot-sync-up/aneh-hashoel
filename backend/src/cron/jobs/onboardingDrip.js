'use strict';

/**
 * Onboarding Drip — sends 3 welcome emails to first-time askers.
 *
 * Step 1 (immediate):  "ברוכים הבאים! שאלתך התקבלה"
 * Step 2 (after 2 days): "הכירו את הפעילות הרחבה של העמותה"
 * Step 3 (after 5 days): "הצטרפו למשפחת התורמים"
 *
 * Runs every 10 minutes via cron. Picks up queued items where
 * send_at <= NOW() and sent_at IS NULL.
 */

const { query: db } = require('../../db/pool');

const TAG = '[onboardingDrip]';

// ── Email content per step ───────────────────────────────────────────────────

const STEP_CONTENT = {
  1: {
    subject: 'ברוכים הבאים למערכת "שאל את הרב" — המרכז למורשת מרן',
    title: 'שאלתך התקבלה!',
    body: `
      <p>שלום {{name}},</p>
      <p>תודה ששלחת את שאלתך למערכת <strong>"שאל את הרב"</strong> של המרכז למורשת מרן.</p>
      <p>שאלתך נשלחה לצוות הרבנים שלנו ותיענה בהקדם האפשרי. ברגע שתתקבל תשובה, תקבל הודעה במייל ובוואטסאפ.</p>
      <p><strong>מה עוד אנחנו עושים?</strong></p>
      <ul>
        <li>מענה הלכתי מקצועי ומהיר</li>
        <li>שיעורי תורה מגוונים</li>
        <li>הנצחת יקירים</li>
        <li>פעילות חסד וסיוע לנזקקים</li>
      </ul>
      <p>נשמח לראותך שוב!</p>
      <p>בברכה,<br/>צוות המרכז למורשת מרן</p>
    `,
  },
  2: {
    subject: 'הכירו את הפעילות הרחבה של המרכז למורשת מרן',
    title: 'יותר מתשובות — עולם שלם של חסד',
    body: `
      <p>שלום {{name}},</p>
      <p>שמחנו שפנית אלינו! רצינו לספר לך קצת על <strong>הפעילות הרחבה</strong> של המרכז למורשת מרן:</p>
      <p><strong>חלוקת מזון</strong> — מדי שבוע אנחנו מחלקים סלי מזון למשפחות נזקקות ברחבי הארץ.</p>
      <p><strong>שיעורי תורה</strong> — עשרות שיעורים שבועיים בנושאים מגוונים, פתוחים לכולם.</p>
      <p><strong>פרויקטים מיוחדים</strong> — הנצחת יקירים, חיזוק קהילות, וסיוע בשעת חירום.</p>
      <p>כל זה מתאפשר בזכות תורמים נדיבים כמוך.</p>
      <p>בברכה,<br/>צוות המרכז למורשת מרן</p>
    `,
  },
  3: {
    subject: 'הצטרפו למשפחת התורמים — המרכז למורשת מרן',
    title: 'עזרו לנו להמשיך',
    body: `
      <p>שלום {{name}},</p>
      <p>מקווים שקיבלת מענה מלא לשאלתך!</p>
      <p>הפעילות של מערכת "שאל את הרב" — כולל צוות הרבנים, התשתית הטכנולוגית, והתמיכה השוטפת —
      <strong>מתאפשרת בזכות תרומות</strong> של אנשים כמוך.</p>
      <p>אם התשובה עזרה לך, נשמח אם תשקול לתרום סכום קטן להמשך הפעילות:</p>
      <p style="text-align:center; margin:24px 0;">
        <a href="https://moreshet-maran.com/donate"
           style="display:inline-block;padding:14px 36px;background-color:#B8973A;color:#1B2B5E;
                  text-decoration:none;border-radius:6px;font-size:16px;font-weight:700;
                  font-family:'Heebo',Arial,sans-serif;">
          תרמו עכשיו
        </a>
      </p>
      <p>כל תרומה, גדולה כקטנה, עוזרת לנו להנגיש תורה לעוד ועוד יהודים.</p>
      <p>תודה רבה ובברכה,<br/>צוות המרכז למורשת מרן</p>
    `,
  },
};

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
    // Find emails that are due.  We JOIN to leads so we can filter out
    // recipients who have unsubscribed from marketing (Israeli spam law §30א).
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

    if (rows.length === 0) return;

    console.log(TAG, `Processing ${rows.length} onboarding emails`);

    const { sendEmail } = require('../../services/email');
    const { createEmailHTML } = require('../../templates/emailBase');
    const { decryptField } = require('../../utils/encryption');
    const { signUnsubscribeToken } = require('../../routes/unsubscribe');

    for (const row of rows) {
      const stepContent = STEP_CONTENT[row.step];
      if (!stepContent) continue;

      // Skip (mark done) if the lead has opted out — onboarding is marketing,
      // not a direct reply, so it's covered by the opt-out requirement.
      if (row.is_unsubscribed) {
        await db(
          `UPDATE onboarding_queue SET sent_at = NOW(), error = 'skipped: unsubscribed' WHERE id = $1`,
          [row.id]
        );
        console.log(TAG, `Skipped step ${row.step} for unsubscribed lead ${row.lead_id}`);
        continue;
      }

      let email;
      try {
        email = decryptField(row.email_encrypted);
      } catch {
        await db(`UPDATE onboarding_queue SET error = 'decrypt failed', sent_at = NOW() WHERE id = $1`, [row.id]);
        continue;
      }

      if (!email) {
        await db(`UPDATE onboarding_queue SET error = 'no email', sent_at = NOW() WHERE id = $1`, [row.id]);
        continue;
      }

      const name = row.asker_name || 'ידיד/ה';
      const body = stepContent.body.replace(/\{\{name\}\}/g, name);

      // Build unsubscribe link for this lead
      const apiBase = (process.env.APP_URL || '').replace(/\/$/, '');
      const unsubscribeLink = row.lead_id
        ? `${apiBase}/unsubscribe?token=${signUnsubscribeToken(row.lead_id)}`
        : '';

      const html = createEmailHTML(stepContent.title, body, [], {
        systemName: 'המרכז למורשת מרן',
        audience: 'asker',
        unsubscribeLink,
      });

      try {
        await sendEmail(email, stepContent.subject, html);
        await db(`UPDATE onboarding_queue SET sent_at = NOW() WHERE id = $1`, [row.id]);
        console.log(TAG, `Sent step ${row.step} to ${email}`);
      } catch (err) {
        await db(`UPDATE onboarding_queue SET error = $1 WHERE id = $2`, [err.message, row.id]);
        console.error(TAG, `Failed step ${row.step} for ${email}:`, err.message);
      }
    }
  } catch (err) {
    console.error(TAG, 'runOnboardingDrip error:', err.message);
  }
}

module.exports = { runOnboardingDrip, queueOnboarding };
