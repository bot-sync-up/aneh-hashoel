'use strict';

/**
 * weeklyNewsletter.js
 * ─────────────────────────────────────────────────────────────────────────────
 * שו"ת השבוע — שולח ניוזלטר שבועי עם השאלה המתוגמלת ביותר מהשבוע האחרון.
 * רץ כל יום שישי בשעה 10:00 (0 10 * * 5).
 *
 * השאלה שנבחרת היא זו שקיבלה את מספר התודות הגבוה ביותר בשבוע האחרון.
 * לא נכללים פרטי השואל (אנונימי).
 *
 * אם MailWizz לא מוגדר — מתעד את התוכן בלוג בלבד.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { query } = require('../../db/pool');
const mailwizzService = require('../../services/mailwizzService');

/**
 * Fetches the most-thanked answered question from the past week.
 * Returns null if no answered questions exist for the period.
 *
 * @returns {Promise<object|null>}
 */
async function _getMostThankedQuestion() {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const { rows } = await query(
    `SELECT
       q.id,
       q.title,
       q.content,
       q.thank_count,
       q.view_count,
       q.answered_at,
       q.wp_link,
       c.name AS category_name,
       r.name AS rabbi_name
     FROM   questions q
     LEFT JOIN categories c ON c.id = q.category_id
     LEFT JOIN rabbis     r ON r.id = q.assigned_rabbi_id
     WHERE  q.status = 'answered'
       AND  q.answered_at >= $1
       AND  q.answered_at IS NOT NULL
     ORDER BY q.thank_count DESC, q.view_count DESC
     LIMIT 1`,
    [weekAgo.toISOString()]
  );

  return rows[0] || null;
}

/**
 * Formats the newsletter HTML content.
 *
 * @param {object} question
 * @returns {string}
 */
function _formatNewsletterHtml(question) {
  const category = question.category_name || 'כללי';
  const rabbi = question.rabbi_name || 'אחד מרבני המרכז';
  const title = question.title || 'שאלה ותשובה';
  const contentPreview = (question.content || '').slice(0, 300);
  const link = question.wp_link || '#';
  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

  return `
    <div dir="rtl" style="font-family: 'Heebo', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h1 style="color: #1B2B5E; font-size: 24px; text-align: center; border-bottom: 2px solid #B8973A; padding-bottom: 12px;">
        שו"ת השבוע
      </h1>
      <p style="color: #666; text-align: center; font-size: 14px;">
        מהמרכז למורשת מרן — השאלה שזכתה להכי הרבה תודות השבוע
      </p>
      <div style="background: #f9f9f9; border-radius: 12px; padding: 20px; margin: 20px 0;">
        <p style="color: #B8973A; font-size: 13px; margin: 0 0 8px;">
          ${category}
        </p>
        <h2 style="color: #1B2B5E; font-size: 18px; margin: 0 0 12px;">
          ${title}
        </h2>
        <p style="color: #333; font-size: 15px; line-height: 1.6;">
          ${contentPreview}${(question.content || '').length > 300 ? '...' : ''}
        </p>
        <p style="color: #666; font-size: 13px; margin-top: 12px;">
          השיב: הרב ${rabbi}
        </p>
      </div>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${link}"
           style="display: inline-block; background: #B8973A; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 15px;">
          לקריאת התשובה המלאה
        </a>
      </div>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #999; font-size: 12px; text-align: center;">
        המרכז למורשת מרן — ענה את השואל
        <br />
        <a href="${appUrl}" style="color: #B8973A;">לאתר</a>
      </p>
    </div>
  `.trim();
}

/**
 * Main cron handler — runs every Friday at 10:00.
 */
async function runWeeklyNewsletter() {
  console.info('[weekly-newsletter] מחפש את השאלה המתוגמלת ביותר השבוע...');

  const question = await _getMostThankedQuestion();

  if (!question) {
    console.info('[weekly-newsletter] לא נמצאו שאלות שנענו השבוע — דילוג');
    return;
  }

  console.info(
    `[weekly-newsletter] נבחרה שאלה #${question.id}: "${question.title}" ` +
    `(${question.thank_count} תודות, ${question.view_count} צפיות)`
  );

  const subject = `שו"ת השבוע — ${question.title || 'שאלה ותשובה'}`;
  const htmlBody = _formatNewsletterHtml(question);

  const result = await mailwizzService.triggerCampaign(subject, htmlBody);

  if (result.success) {
    console.info(`[weekly-newsletter] קמפיין נשלח בהצלחה — campaignId: ${result.campaignId}`);
  } else {
    console.info(`[weekly-newsletter] קמפיין לא נשלח (${result.error}) — התוכן תועד בלוג`);
    console.info(`[weekly-newsletter] נושא: ${subject}`);
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = { runWeeklyNewsletter };
