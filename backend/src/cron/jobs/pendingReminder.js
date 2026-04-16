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

  // Load active rabbis
  const { rows: rabbis } = await query(
    `SELECT id, name, email FROM rabbis WHERE is_active = TRUE AND email IS NOT NULL AND email <> ''`
  );

  if (rabbis.length === 0) {
    log.info('pendingReminder: no active rabbis');
    return { success: true, sent: 0 };
  }

  // Build single digest email with all overdue questions
  const { sendEmail } = require('../../services/email');
  const { createEmailHTML } = require('../../templates/emailBase');
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');

  const rows = questions.map((q) => {
    const ageHours = Math.floor((Date.now() - new Date(q.created_at).getTime()) / (1000 * 60 * 60));
    const qNumber = q.question_number || q.wp_post_id || q.id;
    const cat = q.category_name ? ` — ${q.category_name}` : '';
    return `<li style="margin-bottom:6px;"><a href="${appUrl}/questions/${q.id}" style="color:#1B2B5E;">#${qNumber} ${q.title}</a>${cat} <span style="color:#999;">(${ageHours} שעות)</span></li>`;
  }).join('\n');

  const body = `
    <p>שלום רב,</p>
    <p>יש שאלות שממתינות לתפיסה מעל <strong>${hours} שעות</strong>. נא להיכנס למערכת ולענות.</p>
    <ul style="padding-right:20px;">
      ${rows}
    </ul>
    <p style="margin-top:12px; font-size:13px; color:#888;">
      תזכורת זו נשלחת אוטומטית לפי הגדרות המערכת.
    </p>
  `;

  const html = createEmailHTML('שאלות ממתינות — תזכורת', body, [
    { label: 'צפה בתור השאלות', url: `${appUrl}/questions` },
  ]);

  let sent = 0;
  for (const rabbi of rabbis) {
    try {
      await sendEmail(rabbi.email, 'תזכורת — שאלות ממתינות לתפיסה', html);
      sent++;
    } catch (err) {
      log.error({ err, rabbiEmail: rabbi.email }, 'pendingReminder: email failed');
    }
  }

  // Mark reminder sent
  const questionIds = questions.map((q) => q.id);
  await query(
    `UPDATE questions SET last_reminder_at = NOW() WHERE id = ANY($1::uuid[])`,
    [questionIds]
  );

  log.info({ sent, questionCount: questions.length }, 'pendingReminder: done');
  return { success: true, sent, questionCount: questions.length };
}

module.exports = { runPendingReminder };
