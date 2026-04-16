'use strict';

/**
 * weeklyNewsletter.js
 * ─────────────────────────────────────────────────────────────────────────────
 * שו"ת השבוע — שולח ניוזלטר שבועי עם שאלות נבחרות.
 * רץ כל יום שישי בשעה 10:00 (0 10 * * 5).
 *
 * מנהל יכול לבחור שאלות ידנית דרך לוח הניהול. אם לא נבחרו שאלות,
 * נבחרת אוטומטית השאלה עם הכי הרבה תודות מהשבוע האחרון.
 *
 * אם MailWizz לא מוגדר — מתעד את התוכן בלוג בלבד.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { query } = require('../../db/pool');
const mailwizzService = require('../../services/mailwizzService');
const systemSettings = require('../../config/systemSettings');

/**
 * Fetches admin-selected questions from system_config.
 * Returns empty array if none selected.
 *
 * @returns {Promise<object[]>}
 */
async function _getAdminSelectedQuestions() {
  try {
    const selectedIds = await systemSettings.getSetting('newsletter_selected_questions');

    if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
      return [];
    }

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
       WHERE  q.id = ANY($1::uuid[])
       ORDER BY q.thank_count DESC, q.view_count DESC`,
      [selectedIds]
    );

    return rows;
  } catch (err) {
    console.error('[weekly-newsletter] שגיאה בטעינת שאלות נבחרות:', err.message);
    return [];
  }
}

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
 * Formats the newsletter HTML content for a single question.
 *
 * @param {object} question
 * @returns {string}
 */
function _formatQuestionHtml(question) {
  const category = question.category_name || 'כללי';
  const rabbi = question.rabbi_name || 'אחד מרבני המרכז';
  const title = question.title || 'שאלה ותשובה';
  const contentPreview = (question.content || '').slice(0, 300);
  const link = question.wp_link || '#';

  return `
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
        <div style="text-align: center; margin-top: 16px;">
          <a href="${link}"
             style="display: inline-block; background: #B8973A; color: #fff; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px;">
            לקריאת התשובה המלאה
          </a>
        </div>
      </div>`;
}

/**
 * Formats the full newsletter HTML content.
 *
 * @param {object[]} questions
 * @returns {string}
 */
function _formatNewsletterHtml(questions) {
  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const isSingle = questions.length === 1;
  const subtitle = isSingle
    ? 'מהמרכז למורשת מרן — השאלה שזכתה להכי הרבה תודות השבוע'
    : 'מהמרכז למורשת מרן — שאלות נבחרות מהשבוע';

  const questionsHtml = questions.map(_formatQuestionHtml).join('\n');

  return `
    <div dir="rtl" style="font-family: 'Heebo', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h1 style="color: #1B2B5E; font-size: 24px; text-align: center; border-bottom: 2px solid #B8973A; padding-bottom: 12px;">
        שו"ת השבוע
      </h1>
      <p style="color: #666; text-align: center; font-size: 14px;">
        ${subtitle}
      </p>
      ${questionsHtml}
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
 * If admin has selected questions, uses those; otherwise auto-selects.
 */
async function runWeeklyNewsletter() {
  console.info('[weekly-newsletter] בודק שאלות נבחרות ע"י מנהל...');

  // Check admin toggle — ניתן לכבות את הניוזלטר מהגדרות המערכת.
  try {
    const enabled = await systemSettings.getSetting('newsletter_enabled');
    // treat null/undefined as enabled (legacy default)
    if (enabled === false) {
      console.info('[weekly-newsletter] הניוזלטר כבוי בהגדרות — דילוג');
      return;
    }
  } catch (err) {
    console.warn('[weekly-newsletter] לא ניתן לקרוא את newsletter_enabled — ממשיך כברירת מחדל');
  }

  // Check for admin-selected questions first
  let questions = await _getAdminSelectedQuestions();

  if (questions.length > 0) {
    console.info(`[weekly-newsletter] נמצאו ${questions.length} שאלות שנבחרו ע"י מנהל`);
  } else {
    // Fallback: auto-select most thanked
    console.info('[weekly-newsletter] אין שאלות שנבחרו — בוחר אוטומטית...');
    const autoQuestion = await _getMostThankedQuestion();

    if (!autoQuestion) {
      console.info('[weekly-newsletter] לא נמצאו שאלות שנענו השבוע — דילוג');
      return;
    }

    questions = [autoQuestion];
  }

  for (const q of questions) {
    console.info(
      `[weekly-newsletter] שאלה #${q.id}: "${q.title}" ` +
      `(${q.thank_count} תודות, ${q.view_count} צפיות)`
    );
  }

  const subject = questions.length === 1
    ? `שו"ת השבוע — ${questions[0].title || 'שאלה ותשובה'}`
    : `שו"ת השבוע — ${questions.length} שאלות נבחרות`;

  const htmlBody = _formatNewsletterHtml(questions);

  const result = await mailwizzService.triggerCampaign(subject, htmlBody);

  if (result.success) {
    console.info(`[weekly-newsletter] קמפיין נשלח בהצלחה — campaignId: ${result.campaignId}`);
  } else {
    console.info(`[weekly-newsletter] קמפיין לא נשלח (${result.error}) — התוכן תועד בלוג`);
    console.info(`[weekly-newsletter] נושא: ${subject}`);
  }

  // Archive the newsletter regardless of send success
  try {
    await query(
      `INSERT INTO newsletter_archive (title, content_html, sent_at, recipient_count)
       VALUES ($1, $2, NOW(), $3)`,
      [subject, htmlBody, result.recipientCount || 0]
    );
    console.info('[weekly-newsletter] ניוזלטר נשמר בארכיון');
  } catch (archiveErr) {
    console.error('[weekly-newsletter] שגיאה בשמירת ארכיון:', archiveErr.message);
  }

  // Clear the admin selection after sending
  try {
    await systemSettings.setSetting('newsletter_selected_questions', [], null);
  } catch (clearErr) {
    console.error('[weekly-newsletter] שגיאה בניקוי בחירות:', clearErr.message);
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = { runWeeklyNewsletter };
