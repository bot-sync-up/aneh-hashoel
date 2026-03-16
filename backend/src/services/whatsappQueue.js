'use strict';

/**
 * WhatsApp Queue Service
 *
 * תור הודעות WhatsApp עם rate-limiting ו-retry אוטומטי.
 *
 * אסטרטגיה:
 *   - תור in-memory עם עדיפויות (high / normal / low)
 *   - Rate limit: הודעה אחת כל 500ms
 *   - עד 3 ניסיונות חוזרים עם backoff אקספוננציאלי (2s, 4s, 8s)
 *   - כל שליחה מתועדת בטבלת whatsapp_log בפוסטגרס
 *   - שגיאת DB לא עוצרת את השליחה; שגיאת שליחה לא קורסת את האפליקציה
 *
 * שימוש:
 *   const queue = require('./whatsappQueue');
 *   queue.addToQueue('0501234567', 'שלום', 'high');
 *   queue.start();  // מופעל פעם אחת ב-server.js
 *
 * משתני סביבה:
 *   WHATSAPP_QUEUE_INTERVAL_MS  – אינטרוול בין הודעות (ברירת מחדל: 500)
 *   WHATSAPP_MAX_RETRIES        – מספר ניסיונות מקסימלי (ברירת מחדל: 3)
 */

const { query } = require('../db/pool');
const { sendMessage } = require('./whatsappService');

// ─── Constants ────────────────────────────────────────────────────────────────

const INTERVAL_MS  = parseInt(process.env.WHATSAPP_QUEUE_INTERVAL_MS || '500', 10);
const MAX_RETRIES  = parseInt(process.env.WHATSAPP_MAX_RETRIES       || '3',   10);

/** עדיפות לערך מספרי — גבוה יותר = עדיפות גבוהה יותר. */
const PRIORITY_MAP = { high: 3, normal: 2, low: 1 };

// ─── Queue state ──────────────────────────────────────────────────────────────

/**
 * @typedef {object} QueueItem
 * @property {string}  id           UUID של הפריט
 * @property {string}  phone        מספר טלפון
 * @property {string}  message      תוכן ההודעה
 * @property {string}  messageType  סוג ההודעה (לצרכי לוג)
 * @property {number}  priority     ערך מספרי (1–3)
 * @property {number}  attempts     מספר ניסיונות שבוצעו עד כה
 * @property {number}  nextAttempt  timestamp (ms) של הניסיון הבא
 * @property {number}  enqueueAt    timestamp (ms) של הכנסה לתור
 */

/** @type {QueueItem[]} */
let _queue = [];

let _processing = false;
let _timer      = null;

// ─── addToQueue ───────────────────────────────────────────────────────────────

/**
 * מוסיף הודעה לתור.
 *
 * @param {string} phone        מספר טלפון
 * @param {string} message      תוכן ההודעה
 * @param {string} [priority]   'high' | 'normal' | 'low' (ברירת מחדל: 'normal')
 * @param {string} [messageType] תג לתיעוד (למשל 'new_question', 'thank_notification')
 * @returns {string}  מזהה הפריט שנוסף
 */
function addToQueue(phone, message, priority = 'normal', messageType = 'generic') {
  if (!phone || !message) {
    console.warn('[whatsappQueue] addToQueue: phone ו-message נדרשים');
    return null;
  }

  const numericPriority = PRIORITY_MAP[priority] ?? PRIORITY_MAP.normal;

  const item = {
    id:          _generateId(),
    phone,
    message,
    messageType,
    priority:    numericPriority,
    attempts:    0,
    nextAttempt: Date.now(),
    enqueueAt:   Date.now(),
  };

  _queue.push(item);
  // מיין לפי עדיפות יורדת (גבוהה ראשונה), ואז לפי זמן הכנסה
  _queue.sort((a, b) => b.priority - a.priority || a.enqueueAt - b.enqueueAt);

  console.debug(`[whatsappQueue] הוספה לתור: id=${item.id}, phone=${phone}, priority=${priority}, type=${messageType}`);

  return item.id;
}

// ─── processQueue ─────────────────────────────────────────────────────────────

/**
 * מעבד פריט אחד מהתור.
 * מופעל כל INTERVAL_MS על-ידי _tick.
 *
 * @returns {Promise<void>}
 */
async function processQueue() {
  if (_processing) return;
  if (!_queue.length) return;

  // מצא את הפריט הבא שמוכן לשליחה (nextAttempt <= now)
  const now  = Date.now();
  const idx  = _queue.findIndex((item) => item.nextAttempt <= now);

  if (idx === -1) return; // כל הפריטים ממתינים ל-backoff

  const item = _queue[idx];
  _queue.splice(idx, 1);

  _processing = true;

  try {
    item.attempts += 1;

    console.debug(
      `[whatsappQueue] שולח: id=${item.id}, phone=${item.phone}, ` +
      `ניסיון ${item.attempts}/${MAX_RETRIES}, type=${item.messageType}`
    );

    const result = await sendMessage(item.phone, item.message);

    if (result.success) {
      await _logToDb({
        phone:       item.phone,
        messageType: item.messageType,
        status:      'sent',
        messageId:   result.messageId,
        attempts:    item.attempts,
      });

      console.info(
        `[whatsappQueue] נשלח בהצלחה: id=${item.id}, messageId=${result.messageId}`
      );

    } else {
      // שליחה נכשלה
      await _handleFailure(item, result.error);
    }

  } catch (err) {
    // שגיאה לא צפויה
    await _handleFailure(item, err.message);

  } finally {
    _processing = false;
  }
}

// ─── start / stop ─────────────────────────────────────────────────────────────

/**
 * מפעיל את לולאת עיבוד התור.
 * קורא לזה פעם אחת בעת אתחול השרת.
 */
function start() {
  if (_timer) return; // כבר רץ

  console.info(`[whatsappQueue] תור WhatsApp הופעל — אינטרוול: ${INTERVAL_MS}ms, ניסיונות מקסימום: ${MAX_RETRIES}`);

  _timer = setInterval(() => {
    processQueue().catch((err) => {
      console.error('[whatsappQueue] שגיאה לא צפויה בעיבוד תור:', err.message);
    });
  }, INTERVAL_MS);

  // מנע מהטיימר לחסום את Node.js בסגירה
  if (_timer.unref) _timer.unref();
}

/**
 * עוצר את לולאת העיבוד.
 */
function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    console.info('[whatsappQueue] תור WhatsApp נעצר');
  }
}

// ─── stats ────────────────────────────────────────────────────────────────────

/**
 * מחזיר נתוני סטטוס התור.
 * @returns {{ queueLength: number, processing: boolean }}
 */
function getStats() {
  return {
    queueLength: _queue.length,
    processing:  _processing,
  };
}

// ─── Private helpers ───────────────────────────────────────────────────────────

/**
 * מטפל בכישלון שליחה — ניסיון חוזר עם backoff, או גריעה עם לוג שגיאה.
 *
 * @param {QueueItem} item
 * @param {string}    error
 */
async function _handleFailure(item, error) {
  if (item.attempts < MAX_RETRIES) {
    // Exponential backoff: 2^attempts שניות (2s, 4s, 8s)
    const backoffMs    = Math.pow(2, item.attempts) * 1000;
    item.nextAttempt   = Date.now() + backoffMs;

    // החזר לתור בסוף (עדיפות נשמרת)
    _queue.push(item);
    _queue.sort((a, b) => b.priority - a.priority || a.enqueueAt - b.enqueueAt);

    console.warn(
      `[whatsappQueue] כישלון — ניסיון חוזר עוד ${backoffMs}ms: ` +
      `id=${item.id}, ניסיון ${item.attempts}/${MAX_RETRIES}, שגיאה: ${error}`
    );

  } else {
    // מיצינו ניסיונות — רשום כישלון סופי
    await _logToDb({
      phone:       item.phone,
      messageType: item.messageType,
      status:      'failed',
      error,
      attempts:    item.attempts,
    });

    console.error(
      `[whatsappQueue] נכשל לצמיתות אחרי ${item.attempts} ניסיונות: ` +
      `id=${item.id}, phone=${item.phone}, שגיאה: ${error}`
    );
  }
}

/**
 * מתעד שליחה בטבלת whatsapp_log.
 * שגיאות DB נבלעות כדי לא לשבש את הזרימה.
 *
 * עמודות צפויות בטבלה:
 *   id (serial), phone, message_type, status, message_id, attempts, error, sent_at
 *
 * @param {object} params
 * @param {string}      params.phone
 * @param {string}      params.messageType
 * @param {string}      params.status       'sent' | 'failed'
 * @param {string}     [params.messageId]
 * @param {number}     [params.attempts]
 * @param {string}     [params.error]
 */
async function _logToDb({ phone, messageType, status, messageId = null, attempts = 1, error = null }) {
  const sql = `
    INSERT INTO whatsapp_log
      (phone, message_type, status, message_id, attempts, error, sent_at)
    VALUES
      ($1, $2, $3, $4, $5, $6, NOW())
  `;

  try {
    await query(sql, [
      phone,
      messageType  || 'generic',
      status,
      messageId    || null,
      attempts,
      error        || null,
    ]);
  } catch (dbErr) {
    // לוג שגיאת DB בלבד — לא זורק
    console.error('[whatsappQueue] שגיאה בשמירת לוג whatsapp_log:', dbErr.message, {
      phone,
      messageType,
      status,
    });
  }
}

/**
 * יוצר מזהה ייחודי פשוט.
 * @returns {string}
 */
function _generateId() {
  // uuid v4 בקנה מידה קל (ללא תלות חיצונית נוספת)
  try {
    const { v4: uuidv4 } = require('uuid');
    return uuidv4();
  } catch {
    return `wq_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}

// ─── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  addToQueue,
  processQueue,
  start,
  stop,
  getStats,
};
