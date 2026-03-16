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
      email:    lower === 'email'    || lower === 'both',
      whatsapp: lower === 'whatsapp' || lower === 'both',
      push:     lower === 'push',
    };
  }

  return { email: true, whatsapp: false, push: false };
}

// ─── Rabbi loader ──────────────────────────────────────────────────────────────

/**
 * טוען פרטי רב יחיד מה-DB (כולל notification_pref, email, whatsapp_number).
 *
 * @param {string|number} rabbiId
 * @returns {Promise<object|null>}
 */
async function _loadRabbi(rabbiId) {
  try {
    const { rows } = await query(
      `SELECT id, name, email, whatsapp_number, notification_pref
       FROM rabbis
       WHERE id = $1
         AND status = 'active'
       LIMIT 1`,
      [rabbiId]
    );
    return rows[0] || null;
  } catch (err) {
    console.error(`[notificationRouter] שגיאה בטעינת רב ${rabbiId}:`, err.message);
    return null;
  }
}

/**
 * טוען את כל הרבנים הפעילים.
 *
 * @returns {Promise<Array<object>>}
 */
async function _loadAllActiveRabbis() {
  try {
    const { rows } = await query(
      `SELECT id, name, email, whatsapp_number, notification_pref
       FROM rabbis
       WHERE status = 'active'
       ORDER BY id`
    );
    return rows;
  } catch (err) {
    console.error('[notificationRouter] שגיאה בטעינת רבנים פעילים:', err.message);
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
    console.warn('[notificationRouter] שירות אימייל לא זמין');
    return;
  }

  try {
    switch (type) {
      case 'question_broadcast':
      case 'urgent_question':
      case 'question_released': {
        const { question, actionTokens } = data;
        if (svc.sendQuestionNotification) {
          await svc.sendQuestionNotification(rabbi.email, question, actionTokens || {});
        }
        break;
      }

      case 'claim_confirmation': {
        const { question, actionTokens } = data;
        if (svc.sendFullQuestion) {
          await svc.sendFullQuestion(rabbi.email, question, actionTokens || {});
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

      case 'answer_published':
      case 'follow_up':
      case 'timeout_warning':
      case 'daily_digest':
      case 'emergency':
        // אין תבנית אימייל ייעודית — לא שולחים (ניתן להרחיב בעתיד)
        console.debug(`[notificationRouter] אין תבנית אימייל לסוג '${type}' — דילוג`);
        break;

      default:
        console.warn(`[notificationRouter] סוג התראה לא מוכר לאימייל: ${type}`);
    }
  } catch (err) {
    console.error(`[notificationRouter] שגיאת אימייל לרב ${rabbi.id} (${type}):`, err.message);
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
    console.warn('[notificationRouter] שירות WhatsApp לא זמין');
    return;
  }

  const phone = rabbi.whatsapp_number || rabbi.phone;
  if (!phone) {
    console.debug(`[notificationRouter] אין מספר WhatsApp לרב ${rabbi.id} — דילוג`);
    return;
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
        console.debug(`[notificationRouter] '${type}' לא רלוונטי לרב ב-WhatsApp`);
        break;
      }

      default:
        console.warn(`[notificationRouter] סוג התראה לא מוכר ל-WhatsApp: ${type}`);
    }
  } catch (err) {
    console.error(`[notificationRouter] שגיאת WhatsApp לרב ${rabbi.id} (${type}):`, err.message);
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
    console.warn(`[notificationRouter] notify: רב ${rabbiId} לא נמצא או לא פעיל`);
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
        .catch((err) => console.error(`[notificationRouter] email dispatch error rabbi ${rabbiId}:`, err.message))
    );
  }

  if (pref.whatsapp) {
    tasks.push(
      _dispatchWhatsApp(rabbi, type, data)
        .then(() => channels.push('whatsapp'))
        .catch((err) => console.error(`[notificationRouter] whatsapp dispatch error rabbi ${rabbiId}:`, err.message))
    );
  }

  if (pref.push) {
    // Push notifications — ממומש על ידי socket / FCM בנפרד
    console.debug(`[notificationRouter] push preference detected for rabbi ${rabbiId} (${type}) — handled by socket layer`);
    channels.push('push');
  }

  await Promise.allSettled(tasks);

  console.info(`[notificationRouter] notify: רב ${rabbiId} — סוג: ${type} — ערוצים: ${channels.join(', ') || 'אין'}`);
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
    console.info('[notificationRouter] notifyAll: אין רבנים פעילים');
    return [];
  }

  console.info(`[notificationRouter] notifyAll: שליחת '${type}' ל-${rabbis.length} רבנים פעילים`);

  // עבור שידורים — ניתן לשלוח ב-batch דרך sendQuestionBroadcast/sendUrgentBroadcast
  // כדי לנצל את ה-throttling המובנה. נסנן ונחלק לפי ערוץ.
  const whatsappSvc = _whatsappService();
  const results     = [];

  if (type === 'question_broadcast' && whatsappSvc) {
    // שלח WA בבת אחת לכל הרבנים המתאימים (מנגנון ה-throttling מובנה בשירות)
    const waResults = await whatsappSvc.sendQuestionBroadcast(data.question, rabbis).catch((err) => {
      console.error('[notificationRouter] שגיאה בשידור WA:', err.message);
      return [];
    });

    // שלח אימייל לכל רב שבחר email
    for (const rabbi of rabbis) {
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
    const waResults = await whatsappSvc.sendUrgentBroadcast(data.question, rabbis).catch((err) => {
      console.error('[notificationRouter] שגיאה בשידור דחוף WA:', err.message);
      return [];
    });

    for (const rabbi of rabbis) {
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
    rabbis.map((rabbi) => notify(rabbi.id, type, data))
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
};
