'use strict';

/**
 * WhatsApp Incoming Webhook — GreenAPI
 *
 * מקבל הודעות WhatsApp נכנסות מ-GreenAPI.
 *
 * מותקן על:  POST /webhook/whatsapp
 *
 * Routes:
 *   POST  /webhook/whatsapp       – webhook מ-GreenAPI (ייצור)
 *   POST  /webhook/whatsapp/test  – סימולציה (dev בלבד)
 *
 * זרימה (v1 — stub):
 *   GreenAPI שולח POST עם payload JSON →
 *   מנתחים את סוג האירוע (incomingMessageReceived) →
 *   מזהים אם ההודעה מכילה [ID: ###] (תגובה לשאלה) →
 *   מתעדים ומחזירים 200 — ב-v1 WhatsApp הוא ערוץ הוצאה בלבד (אין מענה דו-כיווני)
 *   המנגנון הבסיסי קיים לתמיכה עתידית.
 *
 * הערה: WhatsApp ב-v1 משמש לשליחה בלבד:
 *   1. התראות לרבנים (שידורים, תפיסת שאלה, אזהרות וכו')
 *   2. הודעת "יש לך תשובה!" לשואל
 * אין ערוץ מענה דו-כיווני ב-v1.
 *
 * מבנה payload של GreenAPI (incomingMessageReceived):
 * {
 *   typeWebhook: "incomingMessageReceived",
 *   instanceData: { idInstance, wid, typeInstance },
 *   timestamp: 1234567890,
 *   idMessage: "BAE5...",
 *   senderData: { chatId: "972501234567@c.us", sender: "972501234567@c.us", senderName: "..." },
 *   messageData: {
 *     typeMessage: "textMessage" | "extendedTextMessage" | "quotedMessage" | ...,
 *     textMessageData: { textMessage: "..." },
 *     extendedTextMessageData: { text: "...", stanzaId: "...", participant: "..." },
 *     quotedMessage: { typeMessage: "textMessage", textMessageData: { textMessage: "..." } }
 *   }
 * }
 */

const express = require('express');
const { query } = require('../db/pool');
const { logAction, ACTIONS } = require('../middleware/auditLog');
const { sendMessage }        = require('../services/whatsappService');
const questionService        = require('../services/questionService');

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * חולץ את מזהה השאלה מתוכן הודעה.
 * מחפש דפוסים כגון:
 *   re:#42    re: #42    #42    [ID: 42]    שאלה #42
 *
 * @param {string} text
 * @returns {number|null}
 */
function extractQuestionIdFromText(text) {
  if (!text) return null;

  const patterns = [
    /re:\s*#(\d+)/i,
    /\[ID:\s*(\d+)\]/i,
    /שאלה\s*#(\d+)/,
    /#(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return null;
}

/**
 * חולץ את מספר הטלפון הנקי מ-chatId של WhatsApp.
 * "972501234567@c.us" → "972501234567"
 *
 * @param {string} chatId
 * @returns {string}
 */
function extractPhone(chatId) {
  if (!chatId) return '';
  return chatId.replace('@c.us', '').replace('@g.us', '').trim();
}

/**
 * מנסה לטעון מודול אופציונלי.
 * מחזיר null אם המודול לא קיים — לא קורס.
 *
 * @param {string} modulePath
 * @returns {object|null}
 */
function tryRequire(modulePath) {
  try {
    return require(modulePath);
  } catch {
    return null;
  }
}

/**
 * חולץ את תוכן הטקסט מה-payload של GreenAPI.
 * תומך ב-textMessage, extendedTextMessage, ובהודעות מצוטטות.
 *
 * @param {object} messageData
 * @returns {string}
 */
function extractMessageText(messageData) {
  if (!messageData) return '';

  // textMessage
  if (messageData.textMessageData?.textMessage) {
    return messageData.textMessageData.textMessage;
  }

  // extendedTextMessage (כולל תשובה לציטוט)
  if (messageData.extendedTextMessageData?.text) {
    return messageData.extendedTextMessageData.text;
  }

  // quotedMessage (גוף ההודעה המצוטטת עצמה)
  if (messageData.quotedMessage?.textMessageData?.textMessage) {
    return messageData.quotedMessage.textMessageData.textMessage;
  }

  return '';
}

/**
 * בודק אם ה-webhook מגיע מה-instance שלנו (אימות בסיסי).
 * GreenAPI לא חותם על webhooks; אנחנו מאמתים על-ידי השוואת instanceId.
 *
 * @param {object} body
 * @returns {boolean}
 */
function isValidInstance(body) {
  const expectedId = process.env.GREENAPI_INSTANCE_ID;
  if (!expectedId) return true; // אם לא הוגדר — נקבל הכל (dev)

  const receivedId = String(body?.instanceData?.idInstance || '');
  return receivedId === String(expectedId);
}

// ─── POST / (מותקן על /webhook/whatsapp) ──────────────────────────────────────

/**
 * webhook ראשי — מקבל אירועים מ-GreenAPI.
 * תמיד מחזיר 200 מהר כדי למנוע retries מיותרים.
 * ב-v1: stub — מזהה הודעות עם [ID: ###] ומתעד, אך אינו שומר תשובות.
 */
router.post('/', async (req, res) => {
  // ─── תשובה מיידית ל-GreenAPI ─────────────────────────────────────
  res.status(200).json({ ok: true });

  // ─── עיבוד א-סינכרוני ────────────────────────────────────────────
  setImmediate(async () => {
    try {
      await _processWebhookPayload(req.body, req.ip || null);
    } catch (err) {
      console.error('[whatsappWebhook] שגיאה לא צפויה בעיבוד webhook:', err.message, err.stack);
    }
  });
});

// ─── POST /test ───────────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'production') {
  /**
   * endpoint לבדיקות — מסמלץ webhook ללא GreenAPI אמיתי.
   * Body: אותו מבנה כמו GreenAPI, עם instanceData אופציונלי.
   */
  router.post('/test', async (req, res) => {
    console.info('[whatsappWebhook/test] סימולציית webhook נכנסת');

    try {
      const result = await _processWebhookPayload(req.body, req.ip || '127.0.0.1', true);
      return res.status(200).json({ ok: true, debug: result });
    } catch (err) {
      console.error('[whatsappWebhook/test] שגיאה:', err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
}

// ─── _processWebhookPayload ───────────────────────────────────────────────────

/**
 * לוגיקת עיבוד webhook מרכזית.
 *
 * @param {object}  body
 * @param {string|null} ip
 * @param {boolean} [returnDebug=false]  אם true — מחזיר אובייקט debug לבדיקות
 * @returns {Promise<object>}
 */
async function _processWebhookPayload(body, ip, returnDebug = false) {
  const debug = {};

  // ─── 1. אמת מופע ─────────────────────────────────────────────────
  if (!isValidInstance(body)) {
    const instanceId = body?.instanceData?.idInstance;
    console.warn(`[whatsappWebhook] webhook ממופע לא מזוהה: ${instanceId}`);

    await logAction(null, 'whatsapp.webhook_rejected', 'webhook', null, null, {
      reason: 'wrong_instance',
      instanceId,
      ip,
    }, ip, null);

    return returnDebug ? { skipped: 'wrong_instance' } : {};
  }

  // ─── 2. טיפול רק ב-incomingMessageReceived ──────────────────────
  const webhookType = body?.typeWebhook;
  debug.webhookType = webhookType;

  if (webhookType !== 'incomingMessageReceived') {
    console.debug(`[whatsappWebhook] אירוע שאינו הודעה נכנסת — מתעלם: ${webhookType}`);
    return returnDebug ? { skipped: `non_message_webhook: ${webhookType}` } : {};
  }

  // ─── 3. חולץ נתוני שולח ─────────────────────────────────────────
  const senderData  = body?.senderData || {};
  const chatId      = senderData.chatId    || senderData.sender || '';
  const senderPhone = extractPhone(chatId);
  const senderName  = senderData.senderName || '';
  const messageId   = body?.idMessage || null;

  debug.senderPhone = senderPhone;
  debug.messageId   = messageId;

  if (!senderPhone) {
    console.warn('[whatsappWebhook] לא ניתן לחלץ מספר שולח מה-webhook');
    return returnDebug ? { skipped: 'no_sender_phone' } : {};
  }

  // ─── 4. חולץ תוכן הודעה ─────────────────────────────────────────
  const messageData = body?.messageData || {};
  const messageText = extractMessageText(messageData);

  debug.messageText = messageText?.slice(0, 100);

  // ─── 5. תיעוד ראשוני ─────────────────────────────────────────────
  await logAction(null, 'whatsapp.inbound_received', 'whatsapp', null, null, {
    senderPhone,
    senderName,
    messageId,
    messageType: messageData.typeMessage || 'unknown',
    textPreview: messageText?.slice(0, 100),
    ip,
  }, ip, null);

  // ─── 6. זהה אם ההודעה היא תגובה לשאלה ──────────────────────────────
  const questionId = extractQuestionIdFromText(messageText);
  debug.questionId = questionId;

  if (!questionId) {
    console.info(
      `[whatsappWebhook] הודעה ללא מזהה שאלה מ-${senderPhone} — מתועדת ומתעלמת`
    );
    await _logInboundMessage({
      senderPhone,
      senderName,
      messageId,
      messageText,
      handled: false,
      ip,
    });
    return returnDebug ? { ...debug, handled: false, reason: 'no_question_id' } : {};
  }

  // ─── 7. זיהוי הרב לפי מספר טלפון ───────────────────────────────────
  const rabbiResult = await query(
    'SELECT id FROM rabbis WHERE phone = $1 OR whatsapp_number = $1 LIMIT 1',
    [senderPhone]
  );

  if (!rabbiResult.rows[0]) {
    console.info(`[whatsappWebhook] מספר טלפון לא מזוהה: ${senderPhone} — מתעלם`);
    await _logInboundMessage({ senderPhone, senderName, messageId, messageText, handled: false, questionId, ip });
    return returnDebug ? { ...debug, handled: false, reason: 'unknown_phone' } : {};
  }

  const rabbiId = rabbiResult.rows[0].id;
  debug.rabbiId = rabbiId;

  // ─── 8. חיפוש שאלה פתוחה (in_process) של הרב ───────────────────────
  const questionResult = await query(
    `SELECT id FROM questions
     WHERE  assigned_rabbi_id = $1
       AND  status = 'in_process'
     ORDER  BY updated_at DESC
     LIMIT  1`,
    [rabbiId]
  );

  if (!questionResult.rows[0]) {
    console.info(`[whatsappWebhook] אין שאלה פתוחה לרב ${rabbiId} — שולח הודעת עזרה`);
    await sendMessage(senderPhone, 'אין לך שאלה פתוחה כרגע').catch((err) => {
      console.error('[whatsappWebhook] שגיאה בשליחת הודעת "אין שאלה פתוחה":', err.message);
    });
    await _logInboundMessage({ senderPhone, senderName, messageId, messageText, handled: false, questionId, ip });
    return returnDebug ? { ...debug, handled: false, reason: 'no_open_question' } : {};
  }

  const openQuestionId = questionResult.rows[0].id;
  debug.openQuestionId = openQuestionId;

  // ─── 9. שמירת התשובה ────────────────────────────────────────────────
  let answerId = null;
  try {
    const answer = await questionService.submitAnswer(openQuestionId, rabbiId, messageText);
    answerId = answer?.id || null;
    console.info(
      `[whatsappWebhook] תשובה נשמרה — questionId=${openQuestionId}, rabbiId=${rabbiId}, answerId=${answerId}`
    );
  } catch (answerErr) {
    console.error('[whatsappWebhook] שגיאה בשמירת תשובה מ-WhatsApp:', answerErr.message);
    await sendMessage(senderPhone, '❌ אירעה שגיאה בשמירת התשובה. אנא נסה שוב או פנה למנהל המערכת.').catch(() => {});
    await _logInboundMessage({ senderPhone, senderName, messageId, messageText, handled: false, questionId: openQuestionId, ip });
    return returnDebug ? { ...debug, handled: false, reason: 'answer_save_error', error: answerErr.message } : {};
  }

  // ─── 10. אישור לרב ───────────────────────────────────────────────────
  await sendMessage(senderPhone, '✅ תשובתך נקלטה בהצלחה!').catch((err) => {
    console.error('[whatsappWebhook] שגיאה בשליחת אישור לרב:', err.message);
  });

  await _logInboundMessage({
    senderPhone,
    senderName,
    messageId,
    messageText,
    handled:    true,
    questionId: openQuestionId,
    answerId,
    ip,
  });

  debug.handled    = true;
  debug.answerId   = answerId;
  return returnDebug ? debug : {};
}

// ─── _validateWhatsAppSender ──────────────────────────────────────────────────

/**
 * מאמת שמספר הטלפון השולח שייך לרב המוקצה לשאלה.
 *
 * @param {string} senderPhone  מספר טלפון נקי (ללא @c.us)
 * @param {number} questionId
 * @returns {Promise<{ rabbi: object|null, question: object|null }>}
 */
async function _validateWhatsAppSender(senderPhone, questionId) {
  const { rows } = await query(
    `SELECT
       q.id            AS question_id,
       q.status,
       q.assigned_rabbi_id,
       r.id            AS rabbi_id,
       r.name          AS rabbi_name,
       r.phone         AS rabbi_phone
     FROM questions q
     LEFT JOIN rabbis r ON r.id = q.assigned_rabbi_id
     WHERE q.id = $1
     LIMIT 1`,
    [questionId]
  );

  if (!rows.length) {
    return { rabbi: null, question: null };
  }

  const row      = rows[0];
  const question = {
    id:                 row.question_id,
    status:             row.status,
    assigned_rabbi_id:  row.assigned_rabbi_id,
  };

  if (!row.rabbi_id || !row.rabbi_phone) {
    return { rabbi: null, question };
  }

  // נרמל את מספר הטלפון של הרב לאותו פורמט
  const rabbiPhoneNorm  = row.rabbi_phone.replace(/\D/g, '');
  const senderPhoneNorm = senderPhone.replace(/\D/g, '');

  // השווה את הסופיות (9 ספרות אחרונות) — מכסה הבדלי קידומת
  const tail = (s) => s.slice(-9);

  if (!senderPhoneNorm || tail(rabbiPhoneNorm) !== tail(senderPhoneNorm)) {
    return { rabbi: null, question };
  }

  const rabbi = {
    id:    row.rabbi_id,
    name:  row.rabbi_name,
    phone: row.rabbi_phone,
  };

  return { rabbi, question };
}

// ─── _logInboundMessage ───────────────────────────────────────────────────────

/**
 * שומר הודעה נכנסת בטבלת whatsapp_inbound_log (אם קיימת).
 * שגיאות DB נבלעות.
 *
 * @param {object} params
 */
async function _logInboundMessage({
  senderPhone,
  senderName,
  messageId,
  messageText,
  handled,
  questionId = null,
  answerId   = null,
  ip         = null,
}) {
  const sql = `
    INSERT INTO whatsapp_inbound_log
      (sender_phone, sender_name, message_id, message_text, handled, question_id, answer_id, ip, received_at)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    ON CONFLICT (message_id) DO NOTHING
  `;

  try {
    await query(sql, [
      senderPhone                        || null,
      senderName                         || null,
      messageId                          || null,
      (messageText || '').slice(0, 1000),
      handled ?? false,
      questionId                         || null,
      answerId                           || null,
      ip                                 || null,
    ]);
  } catch (dbErr) {
    // טבלה אולי עוד לא קיימת — נתעד ונמשיך
    console.debug('[whatsappWebhook] לא ניתן לשמור whatsapp_inbound_log:', dbErr.message);
  }
}

// ─── Exports ───────────────────────────────────────────────────────────────────

module.exports = router;
