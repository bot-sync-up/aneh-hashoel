'use strict';

/**
 * pendingReminder.js
 * ─────────────────────────────────────────────────────────────────────────────
 * בודק שאלות שממתינות לתפיסה יותר מ-X שעות (נקבע בהגדרות admin)
 * ושולח מייל תזכורת לכל הרבנים הפעילים, כדי למנוע שאלות שנופלות בין הכיסאות.
 *
 * הגדרות:
 *   system_config['pending_reminder'] = {
 *     enabled:       boolean  — האם מנגנון התזכורות פעיל
 *     hours:         number   — כעבור כמה שעות שאלה נחשבת "מוזנחת" (ברירת מחדל 24)
 *     remind_every:  number   — להזכיר מחדש כעבור כמה שעות (ברירת מחדל 24)
 *   }
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { query } = require('../../db/pool');
const { logger } = require('../../utils/logger');

const log = logger.child({ module: 'pendingReminder' });

const DEFAULT_CONFIG = {
  enabled: false,        // off by default — admin must enable
  hours: 24,
  remind_every: 24,
};

async function _loadConfig() {
  try {
    const { rows } = await query(
      "SELECT value FROM system_config WHERE key = 'pending_reminder'"
    );
    if (rows.length === 0 || !rows[0].value) return { ...DEFAULT_CONFIG };
    const v = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
    return { ...DEFAULT_CONFIG, ...v };
  } catch (err) {
    log.warn({ err }, 'Failed to load pending_reminder config — using defaults');
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Main entry — run this every hour.
 */
async function runPendingReminder() {
  const cfg = await _loadConfig();

  if (!cfg.enabled) {
    log.debug('pending_reminder disabled — skipping');
    return { success: true, sent: 0, disabled: true };
  }

  const hours = Math.max(1, parseInt(cfg.hours, 10) || 24);
  const remindEvery = Math.max(1, parseInt(cfg.remind_every, 10) || 24);

  // Find questions that have been pending for >= hours, and were not reminded
  // in the last `remind_every` hours.
  const { rows: questions } = await query(
    `SELECT q.id, q.title, q.created_at, q.question_number, q.wp_post_id,
            q.category_id, c.name AS category_name
     FROM   questions q
     LEFT JOIN categories c ON c.id = q.category_id
     WHERE  q.status = 'pending'
       AND  q.created_at <= NOW() - INTERVAL '1 hour' * $1
       AND  (q.last_reminder_at IS NULL
             OR q.last_reminder_at <= NOW() - INTERVAL '1 hour' * $2)
     ORDER BY q.created_at ASC
     LIMIT 50`,
    [hours, remindEvery]
  );

  if (questions.length === 0) {
    log.info('pendingReminder: no overdue pending questions');
    return { success: true, sent: 0 };
  }

  log.info({ count: questions.length }, 'pendingReminder: overdue questions found');

  // Load active rabbis — LEFT JOIN לבדיקת העדפות התראות לאירוע pending_reminder
  const { rows: rabbis } = await query(
    `SELECT r.id, r.name, r.email,
            COALESCE(np.enabled, TRUE) AS email_enabled
     FROM   rabbis r
     LEFT JOIN notification_preferences np
            ON np.rabbi_id = r.id
           AND np.event_type = 'pending_reminder'
           AND np.channel IN ('email', 'all', 'both')
     WHERE  r.is_active = TRUE
       AND  r.email IS NOT NULL
       AND  r.email <> ''`
  );

  const eligibleRabbis = rabbis.filter((r) => r.email_enabled !== false);
  if (eligibleRabbis.length === 0) {
    log.info('pendingReminder: no rabbis with pending_reminder enabled');
    return { success: true, sent: 0, questionCount: questions.length };
  }

  // Load editable template from system_config.email_templates
  let subjectTpl, bodyTpl, systemName;
  try {
    const { rows: cfgRows } = await query(
      "SELECT value FROM system_config WHERE key = 'email_templates'"
    );
    const tpls = cfgRows[0]?.value
      ? (typeof cfgRows[0].value === 'string' ? JSON.parse(cfgRows[0].value) : cfgRows[0].value)
      : {};
    subjectTpl = tpls.rabbi_pending_reminder_subject
      || 'תזכורת — שאלות ממתינות לתפיסה — {system_name}';
    bodyTpl = tpls.rabbi_pending_reminder_body
      || '<p>שלום רב,</p><p>יש שאלות שממתינות לתפיסה מעל <strong>{hours} שעות</strong>. נא להיכנס למערכת ולענות.</p><ul style="padding-right:20px;">{questions_list}</ul>';
    systemName = tpls.rabbi_system_name || 'ענה את השואל';
  } catch (err) {
    log.warn({ err }, 'pendingReminder: failed to load template — using default');
    subjectTpl = 'תזכורת — שאלות ממתינות לתפיסה — {system_name}';
    bodyTpl = '<p>שלום רב,</p><p>יש שאלות שממתינות לתפיסה מעל <strong>{hours} שעות</strong>. נא להיכנס למערכת ולענות.</p><ul style="padding-right:20px;">{questions_list}</ul>';
    systemName = 'ענה את השואל';
  }

  // Build digest
  const { sendEmail } = require('../../services/email');
  const { createEmailHTML } = require('../../templates/emailBase');
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');

  const questionsListHtml = questions.map((q) => {
    const ageHours = Math.floor((Date.now() - new Date(q.created_at).getTime()) / (1000 * 60 * 60));
    const qNumber = q.question_number || q.wp_post_id || q.id;
    const cat = q.category_name ? ` — ${q.category_name}` : '';
    return `<li style="margin-bottom:6px;"><a href="${appUrl}/questions/${q.id}" style="color:#1B2B5E;">#${qNumber} ${q.title}</a>${cat} <span style="color:#999;">(${ageHours} שעות)</span></li>`;
  }).join('\n');

  // Substitute template variables
  const fill = (str) => String(str || '')
    .replace(/\{hours\}/g, String(hours))
    .replace(/\{questions_list\}/g, questionsListHtml)
    .replace(/\{system_name\}/g, systemName);

  const subject = fill(subjectTpl);
  const body = fill(bodyTpl);
  const html = createEmailHTML('שאלות ממתינות — תזכורת', body, [
    { label: 'צפה בתור השאלות', url: `${appUrl}/questions` },
  ], { systemName });

  let sent = 0;
  const errors = [];
  for (const rabbi of eligibleRabbis) {
    try {
      await sendEmail(rabbi.email, subject, html);
      sent++;
    } catch (err) {
      errors.push({ rabbi: rabbi.email, error: err.message });
      log.error({ err, rabbiEmail: rabbi.email }, 'pendingReminder: email failed');
    }
  }

  // Mark reminder sent on overdue questions
  if (sent > 0) {
    const questionIds = questions.map((q) => q.id);
    await query(
      `UPDATE questions SET last_reminder_at = NOW() WHERE id = ANY($1::uuid[])`,
      [questionIds]
    );
  }

  log.info(
    { sent, questionCount: questions.length, eligible: eligibleRabbis.length, skipped: rabbis.length - eligibleRabbis.length },
    'pendingReminder: done'
  );
  return {
    success: true,
    sent,
    questionCount: questions.length,
    eligibleRabbis: eligibleRabbis.length,
    skipped: rabbis.length - eligibleRabbis.length,
    errors,
  };
}

module.exports = { runPendingReminder };
