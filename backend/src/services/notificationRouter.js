'use strict';

/**
 * Notification Router
 *
 * מנתב התראות לערוץ הנכון (אימייל / WhatsApp / שניהם / push) בהתאם
 * להעדפות ההתראות של כל רב.
 *
 * כישלון WhatsApp לא חוסם את שליחת האימייל ולהפך — כל ערוץ מנוהל
 * בנפרד ושגיאותיו נבלעות ומתועדות.
 *
 * שדה notification_pref ב-DB:
 *   JSONB: { email: true, whatsapp: true, push: true }
 *   או מחרוזת legacy: 'email', 'whatsapp', 'both', 'push'
 *
 * סוגי התראות נתמכים:
 *   question_broadcast   – שאלה חדשה לכלל הרבנים
 *   claim_confirmation   – אישור תפיסה לרב ספציפי
 *   question_released    – שאלה שוחררה (ניתן לתפוס שוב)
 *   answer_published     – תשובה פורסמה
 *   thank_you            – הודיית גולש לרב
 *   timeout_warning      – אזהרת פג-תוקף
 *   urgent_question      – שאלה דחופה
 *   follow_up            – שאלת המשך מהשואל
 *   new_device           – התחברות ממכשיר חדש
 *   weekly_report        – דו"ח שבועי
 *   daily_digest         – תקציר יומי
 *   emergency            – חירום (ללא סינון preference)
 */

const { query } = require('../db/pool');
const { logger } = require('../utils/logger');

const log = logger.child({ module: 'notificationRouter' });

// ─── Availability hours check ─────────────────────────────────────────────────

/**
 * Checks whether the current time in Israel (Asia/Jerusalem) falls within
 * the rabbi's configured availability hours for today's day of the week.
 *
 * @param {object|null} availabilityHours  JSONB from rabbis.availability_hours
 * @returns {boolean}  true if the rabbi is currently available (or has no hours configured)
 */
function _isWithinAvailabilityHours(availabilityHours) {
  if (!availabilityHours || typeof availabilityHours !== 'object') {
    // No availability hours configured — treat as always available
    return true;
  }

  const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  // If the object is empty or has the old default format with all nulls, treat as always available
  const hasAnyConfig = Object.values(availabilityHours).some(
    (v) => v !== null && typeof v === 'object' && v.enabled !== undefined
  );
  if (!hasAnyConfig) return true;

  // Current time in Israel
  const nowInIsrael = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })
  );
  const dayIndex = nowInIsrael.getDay(); // 0=Sunday
  const dayKey = DAY_KEYS[dayIndex];
  const dayConfig = availabilityHours[dayKey];

  // Day not configured or disabled — rabbi is unavailable
  if (!dayConfig || dayConfig.enabled === false) {
    return false;
  }

  // Day enabled but no specific hours — treat as available all day
  if (!dayConfig.start || !dayConfig.end) {
    return true;
  }

  const currentMinutes = nowInIsrael.getHours() * 60 + nowInIsrael.getMinutes();
  const [startH, startM] = dayConfig.start.split(':').map(Number);
  const [endH, endM] = dayConfig.end.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

// ─── Lazy service loaders (avoid circular dep and gracefully handle missing modules)

function _emailService() {
  try { return require('./email'); } catch { return null; }
}

function _whatsappService() {
  try { return require('./whatsappService'); } catch { return null; }
}

// ─── Preference parsing ────────────────────────────────────────────────────────

/**
 * מחזיר { email, whatsapp, push } בוליאניים מתוך notification_pref של הרב.
 *
 * @param {object|string|null} pref
 * @returns {{ email: boolean, whatsapp: boolean, push: boolean }}
 */
function _parsePreferences(pref) {
  if (!pref) {
    return { email: true, whatsapp: false, push: false };
  }

  if (typeof pref === 'object') {
    return {
      email:    pref.email    === true || pref.email    === 'true',
      whatsapp: pref.whatsapp === true || pref.whatsapp === 'true',
      push:     pref.push     === true || pref.push     === 'true',
    };
  }

  if (typeof pref === 'string') {
    const lower = pref.toLowerCase().trim();
    return {
      email:    lower === 'email' || lower === 'both' || lower === 'all',
      whatsapp: lower === 'whatsapp' || lower === 'both' || lower === 'all',
      push:     lower === 'push' || lower === 'all',
    };
  }

  return { email: true, whatsapp: false, push: false };
}

// ─── Per-event preference check ─────────────────────────────────────────────

/**
 * Check if a specific event+channel is enabled for a rabbi based on the
 * notification_preferences table. Returns true if enabled (default: true
 * when no explicit preference exists).
 *
 * @param {string} rabbiId
 * @param {string} eventType  — e.g. 'question_broadcast', 'thank_you'
 * @param {string} channel    — 'email' | 'whatsapp' | 'push'
 * @returns {Promise<boolean>}
 */
// Dispatcher-side event type → UI/preference event_type.
// The frontend's notification-preferences UI uses short, user-facing keys.
// The dispatcher uses internal operational types. This map bridges them so
// a rabbi's toggle actually gates the matching dispatch call.
const DISPATCH_TO_PREF_EVENT = {
  question_broadcast:  'new_question',
  question_released:   'new_question',
  urgent_question:     'new_question',
  claim_confirmation:  'claim_approved',
  thank_you:           'user_thanks',
  timeout_warning:     'lock_reminder',
  follow_up:           'followup_question',
  new_device:          'new_device_login',
  daily_digest:        'daily_summary',
  // identity passthroughs (same name on both sides)
  answer_published:    'answer_published',
  weekly_report:       'weekly_report',
  pending_reminder:    'pending_reminder',
};

async function _isEventEnabled(rabbiId, eventType, channel) {
  if (!rabbiId || !eventType || !channel) return true;
  try {
    const prefKey = DISPATCH_TO_PREF_EVENT[eventType] || eventType;
    // Post-migration-008 storage: one row per (event, channel) pair. Prefer
    // the exact match; if absent, accept legacy 'both'/'all' rows that cover
    // this channel.
    const { rows } = await query(
      `SELECT channel, enabled FROM notification_preferences
       WHERE rabbi_id = $1 AND event_type = $2`,
      [rabbiId, prefKey]
    );
    if (rows.length === 0) return true; // default: enabled when no record

    const exact = rows.find((r) => (r.channel || '').toLowerCase() === channel);
    if (exact) return Boolean(exact.enabled);

    // No exact row — consult any legacy aggregate row
    const legacy = rows.find((r) => {
      const c = (r.channel || '').toLowerCase();
      if (c === 'all') return true;
      if (c === 'both') return channel === 'email' || channel === 'whatsapp';
      return false;
    });
    if (legacy) return Boolean(legacy.enabled);

    // Rows exist for OTHER channels but not this one → the rabbi has explicit
    // preferences configured and chose to skip this channel → disabled.
    return false;
  } catch (err) {
    log.warn({ err, rabbiId, eventType, channel }, '_isEventEnabled: error — defaulting to enabled');
    return true;
  }
}

// ─── Rabbi loader ──────────────────────────────────────────────────────────────

/**
 * טוען פרטי רב יחיד מה-DB (כולל notification_pref, email, whatsapp_number, is_vacation).
 *
 * @param {string|number} rabbiId
 * @returns {Promise<object|null>}
 */
async function _loadRabbi(rabbiId) {
  try {
    const { rows } = await query(
      `SELECT id, name, email, whatsapp_number, notification_pref,
              is_vacation, availability_hours
       FROM rabbis
       WHERE id = $1
         AND status = 'active'
       LIMIT 1`,
      [rabbiId]
    );
    return rows[0] || null;
  } catch (err) {
    log.error({ err, rabbiId }, "Error loading rabbi");
    return null;
  }
}

/**
 * טוען את כל הרבנים הפעילים שאינם במצב חופשה.
 *
 * @returns {Promise<Array<object>>}
 */
async function _loadAllActiveRabbis() {
  try {
    const { rows } = await query(
      `SELECT id, name, email, whatsapp_number, notification_pref,
              is_vacation, availability_hours
       FROM rabbis
       WHERE status = 'active'
         AND is_vacation = false
       ORDER BY id`
    );
    return rows;
  } catch (err) {
    log.error({ err }, "Error loading active rabbis");
    return [];
  }
}

// ─── Channel dispatchers ───────────────────────────────────────────────────────

/**
 * שולח התראת אימייל לרב אחד לפי סוג.
 * שגיאות נבלעות ומתועדות.
 *
 * @param {object} rabbi
 * @param {string} type
 * @param {object} data
 */
async function _dispatchEmail(rabbi, type, data) {
  const svc = _emailService();
  if (!svc) {
    log.warn("Email service not available");
    return;
  }

  // Respect per-event notification preferences (except emergency)
  if (type !== 'emergency') {
    const enabled = await _isEventEnabled(rabbi.id, type, 'email');
    if (!enabled) {
      log.info({ rabbiId: rabbi.id, type }, '_dispatchEmail: disabled by rabbi preference — skipping');
      return;
    }
  }

  try {
    switch (type) {
      case 'question_broadcast':
      case 'urgent_question':
      case 'question_released': {
        const { question } = data;
        if (svc.sendQuestionNotification) {
          const result = await svc.sendQuestionNotification(rabbi.email, question);
          // Store Message-ID from the first successful send so follow-up emails can thread
          if (type === 'question_broadcast' && result && result.messageId && question && question.id) {
            query(
              'UPDATE questions SET email_message_id = $1 WHERE id = $2 AND email_message_id IS NULL',
              [result.messageId, question.id]
            ).catch((err) => log.warn({ err, questionId: question.id }, 'Failed to store email_message_id'));
          }
        }
        break;
      }

      case 'claim_confirmation': {
        const { question } = data;
        if (svc.sendFullQuestion) {
          await svc.sendFullQuestion(rabbi.email, question);
        }
        break;
      }

      case 'thank_you': {
        if (svc.sendThankNotification) {
          await svc.sendThankNotification(rabbi.email, data.question);
        }
        break;
      }

      case 'weekly_report': {
        if (svc.sendWeeklyReport) {
          await svc.sendWeeklyReport(rabbi.email, data.stats);
        }
        break;
      }

      case 'new_device': {
        if (svc.sendNewDeviceAlert) {
          await svc.sendNewDeviceAlert(rabbi.email, data.deviceInfo);
        }
        break;
      }

      case 'follow_up': {
        if (svc.sendFollowUpNotification) {
          // Fetch the original question's stored Message-ID for threading
          let questionWithMsgId = data.question;
          if (data.question && data.question.id && !data.question.email_message_id) {
            try {
              const { rows } = await query(
                'SELECT email_message_id FROM questions WHERE id = $1',
                [data.question.id]
              );
              if (rows[0] && rows[0].email_message_id) {
                questionWithMsgId = { ...data.question, email_message_id: rows[0].email_message_id };
              }
            } catch (err) {
              log.warn({ err, questionId: data.question.id }, 'Failed to fetch email_message_id for threading');
            }
          }
          await svc.sendFollowUpNotification(rabbi.email, questionWithMsgId, data.followUpContent);
        }
        break;
      }

      case 'answer_published':
      case 'timeout_warning':
      case 'daily_digest':
      case 'emergency':
        // אין תבנית אימייל ייעודית — לא שולחים (ניתן להרחיב בעתיד)
        log.debug({ type }, "No email template for notification type");
        break;

      default:
        log.warn({ type }, "Unknown email notification type");
    }
  } catch (err) {
    log.error({ err, rabbiId: rabbi.id, type }, "Email dispatch error");
  }
}

/**
 * שולח התראת WhatsApp לרב אחד לפי סוג.
 * שגיאות נבלעות ומתועדות.
 *
 * @param {object} rabbi
 * @param {string} type
 * @param {object} data
 */
async function _dispatchWhatsApp(rabbi, type, data) {
  const svc = _whatsappService();
  if (!svc) {
    log.warn("WhatsApp service not available");
    return;
  }

  const phone = rabbi.whatsapp_number || rabbi.phone;
  if (!phone) {
    log.debug({ rabbiId: rabbi.id }, "No WhatsApp number for rabbi");
    return;
  }

  // Respect per-event notification preferences (except emergency)
  if (type !== 'emergency') {
    const enabled = await _isEventEnabled(rabbi.id, type, 'whatsapp');
    if (!enabled) {
      log.info({ rabbiId: rabbi.id, type }, '_dispatchWhatsApp: disabled by rabbi preference — skipping');
      return;
    }
  }

  try {
    switch (type) {
      case 'question_broadcast':
      case 'question_released': {
        await svc.sendQuestionBroadcast(data.question, [rabbi]);
        break;
      }

      case 'claim_confirmation': {
        await svc.sendClaimConfirmation(data.question, rabbi);
        break;
      }

      case 'thank_you': {
        await svc.sendThankYouToRabbi(rabbi, data.question);
        break;
      }

      case 'timeout_warning': {
        await svc.sendTimeoutWarning(rabbi, data.question, data.minutesLeft);
        break;
      }

      case 'urgent_question': {
        await svc.sendUrgentBroadcast(data.question, [rabbi]);
        break;
      }

      case 'follow_up': {
        await svc.sendFollowUpToRabbi(rabbi, data.question, data.followUpContent);
        break;
      }

      case 'new_device': {
        await svc.sendNewDeviceAlert(rabbi, data.deviceInfo);
        break;
      }

      case 'weekly_report': {
        await svc.sendWeeklyReport(rabbi, data.stats);
        break;
      }

      case 'daily_digest': {
        await svc.sendDailyDigest(rabbi, data.pendingCount);
        break;
      }

      case 'emergency': {
        await svc.sendMessage(phone, data.message || 'הודעת חירום ממערכת ענה את השואל');
        break;
      }

      case 'answer_published': {
        // answer_published רלוונטי לשואל, לא לרב — לא פעולה כאן
        log.debug({ type }, "Notification type not relevant for rabbi via WhatsApp");
        break;
      }

      default:
        log.warn({ type }, "Unknown WhatsApp notification type");
    }
  } catch (err) {
    log.error({ err, rabbiId: rabbi.id, type }, "WhatsApp dispatch error");
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * שולח התראה לרב יחיד לפי העדפותיו.
 *
 * @param {string|number} rabbiId  מזהה הרב
 * @param {string}        type     סוג ההתראה
 * @param {object}        data     מידע ספציפי לסוג (question, stats, deviceInfo וכו')
 * @returns {Promise<{ rabbiId, channels: string[] }>}
 */
async function notify(rabbiId, type, data) {
  const rabbi = await _loadRabbi(rabbiId);
  if (!rabbi) {
    log.warn({ rabbiId }, "Rabbi not found or inactive");
    return { rabbiId, channels: [] };
  }

  // סוגי התראות שידור — לא נשלחים לרב בחופשה
  const BROADCAST_TYPES = [
    'question_broadcast',
    'urgent_question',
    'question_released',
    'daily_digest',
    'weekly_report',
  ];

  if (rabbi.is_vacation && BROADCAST_TYPES.includes(type)) {
    log.info({ rabbiId, type }, "Rabbi on vacation — skipping");
    return { rabbiId, channels: [] };
  }

  // Check availability hours — skip broadcast-type notifications outside hours
  if (BROADCAST_TYPES.includes(type) && !_isWithinAvailabilityHours(rabbi.availability_hours)) {
    log.info({ rabbiId, type }, "Rabbi outside availability hours — skipping");
    return { rabbiId, channels: [] };
  }

  const pref     = _parsePreferences(rabbi.notification_pref);
  const channels = [];

  // Emergency — שולח לכל הערוצים ללא סינון
  if (type === 'emergency') {
    const tasks = [
      _dispatchEmail(rabbi, type, data).then(() => channels.push('email')).catch(() => {}),
      _dispatchWhatsApp(rabbi, type, data).then(() => channels.push('whatsapp')).catch(() => {}),
    ];
    await Promise.allSettled(tasks);
    return { rabbiId, channels };
  }

  const tasks = [];

  if (pref.email && rabbi.email) {
    tasks.push(
      _dispatchEmail(rabbi, type, data)
        .then(() => channels.push('email'))
        .catch((err) => log.error({ err, rabbiId }, "Email dispatch error in notify"))
    );
  }

  if (pref.whatsapp) {
    tasks.push(
      _dispatchWhatsApp(rabbi, type, data)
        .then(() => channels.push('whatsapp'))
        .catch((err) => log.error({ err, rabbiId }, "WhatsApp dispatch error in notify"))
    );
  }

  if (pref.push) {
    // Push notifications — ממומש על ידי socket / FCM בנפרד
    log.debug({ rabbiId, type }, "Push preference detected — handled by socket layer");
    channels.push('push');
  }

  await Promise.allSettled(tasks);

  log.info({ rabbiId, type, channels }, "Notification sent");
  return { rabbiId, channels };
}

/**
 * שולח התראה לרשימת רבנים.
 * כל רב מקבל את ההתראה בהתאם להעדפותיו האישיות.
 *
 * @param {Array<string|number>} rabbiIds  מזהי רבנים
 * @param {string}               type     סוג ההתראה
 * @param {object}               data     מידע ספציפי לסוג
 * @returns {Promise<Array<{ rabbiId, channels: string[] }>>}
 */
async function notifyMultiple(rabbiIds, type, data) {
  if (!rabbiIds || !rabbiIds.length) {
    return [];
  }

  const results = await Promise.allSettled(
    rabbiIds.map((id) => notify(id, type, data))
  );

  return results.map((r) => (r.status === 'fulfilled' ? r.value : { rabbiId: null, channels: [], error: r.reason?.message }));
}

/**
 * שולח התראה לכל הרבנים הפעילים, בהתאם להעדפות כל אחד.
 *
 * @param {string} type  סוג ההתראה
 * @param {object} data  מידע ספציפי לסוג
 * @returns {Promise<Array<{ rabbiId, channels: string[] }>>}
 */
async function notifyAll(type, data) {
  const rabbis = await _loadAllActiveRabbis();

  if (!rabbis.length) {
    log.info("notifyAll: no active rabbis");
    return [];
  }

  log.info({ type, count: rabbis.length }, "notifyAll: broadcasting to active rabbis");

  // Filter out rabbis outside their availability hours for broadcast-type notifications
  const BROADCAST_TYPES_ALL = ['question_broadcast', 'urgent_question', 'question_released', 'daily_digest', 'weekly_report'];
  const availableRabbis = BROADCAST_TYPES_ALL.includes(type)
    ? rabbis.filter((r) => _isWithinAvailabilityHours(r.availability_hours))
    : rabbis;

  if (availableRabbis.length < rabbis.length) {
    log.info({ filtered: rabbis.length - availableRabbis.length }, "notifyAll: rabbis filtered by availability hours");
  }

  // עבור שידורים — ניתן לשלוח ב-batch דרך sendQuestionBroadcast/sendUrgentBroadcast
  // כדי לנצל את ה-throttling המובנה. נסנן ונחלק לפי ערוץ.
  const whatsappSvc = _whatsappService();
  const results     = [];

  if (type === 'question_broadcast' && whatsappSvc) {
    // שלח WA בבת אחת לכל הרבנים המתאימים (מנגנון ה-throttling מובנה בשירות)
    const waResults = await whatsappSvc.sendQuestionBroadcast(data.question, availableRabbis).catch((err) => {
      log.error({ err }, "notifyAll: WA broadcast error");
      return [];
    });

    // שלח אימייל לכל רב שבחר email
    for (const rabbi of availableRabbis) {
      const pref     = _parsePreferences(rabbi.notification_pref);
      const channels = [];

      if (pref.email && rabbi.email) {
        await _dispatchEmail(rabbi, type, data).catch(() => {});
        channels.push('email');
      }

      const waResult = waResults.find((r) => String(r.rabbiId) === String(rabbi.id));
      if (waResult?.success) channels.push('whatsapp');

      results.push({ rabbiId: rabbi.id, channels });
    }
    return results;
  }

  if (type === 'urgent_question' && whatsappSvc) {
    const waResults = await whatsappSvc.sendUrgentBroadcast(data.question, availableRabbis).catch((err) => {
      log.error({ err }, "notifyAll: urgent WA broadcast error");
      return [];
    });

    for (const rabbi of availableRabbis) {
      const pref     = _parsePreferences(rabbi.notification_pref);
      const channels = [];

      if (pref.email && rabbi.email) {
        await _dispatchEmail(rabbi, type, data).catch(() => {});
        channels.push('email');
      }

      const waResult = waResults.find((r) => String(r.rabbiId) === String(rabbi.id));
      if (waResult?.success) channels.push('whatsapp');

      results.push({ rabbiId: rabbi.id, channels });
    }
    return results;
  }

  // כל שאר הסוגים — שלח לכל רב בנפרד לפי העדפות
  const settled = await Promise.allSettled(
    availableRabbis.map((rabbi) => notify(rabbi.id, type, data))
  );

  return settled.map((r) => (r.status === 'fulfilled' ? r.value : { rabbiId: null, channels: [] }));
}

// ─── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  notify,
  notifyMultiple,
  notifyAll,

  // Exported for tests
  _parsePreferences,
  _isWithinAvailabilityHours,
};
