'use strict';

/**
 * WhatsApp Incoming Webhook — GreenAPI (v2 — full inbound support)
 *
 * מקבל הודעות WhatsApp נכנסות מ-GreenAPI ומעבד תשובות רבנים.
 *
 * מותקן על:  POST /webhook/whatsapp
 *
 * Routes:
 *   POST  /webhook/whatsapp       – webhook מ-GreenAPI (ייצור)
 *   POST  /webhook/whatsapp/test  – סימולציה (dev בלבד)
 *
 * זרימה (v2 — ערוץ מענה דו-כיווני):
 *   1. GreenAPI שולח POST עם payload JSON
 *   2. מנתחים את סוג האירוע (incomingMessageReceived)
 *   3. מזהים את הרב לפי מספר טלפון
 *   4. מתאימים לשאלה:
 *      a. אם ההודעה מכילה מזהה שאלה (#ID / [ID:X]) — משתמשים בו
 *      b. אם לרב יש שאלה פתוחה (in_process) — מתאימים אליה
 *      c. אם יש שאלה ממתינה (pending) ששודרה אחרונה — מתאימים אליה
 *   5. תומך במילת מפתח "תפוס" (claim-only) — כמו ב-IMAP poller
 *   6. מבצע תפיסה אוטומטית אם השאלה בסטטוס pending
 *   7. שומר את התשובה ושולח אישור חזרה לרב
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

const TAG = '[whatsappWebhook]';

// ─── Claim-only keywords (mirrored from IMAP poller) ───────────────────────

const CLAIM_KEYWORDS = ['תפוס', 'תפיסה', 'קבל', 'אני לוקח', 'claim'];

/**
 * בודק אם ההודעה היא בקשת תפיסה בלבד (ללא תשובה).
 * @param {string} text
 * @returns {boolean}
 */
function isClaimOnly(text) {
  if (!text) return false;
  const trimmed = text.trim().toLowerCase();
  return CLAIM_KEYWORDS.some((kw) => trimmed === kw || trimmed === kw + '.');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * חולץ את מזהה השאלה מתוכן הודעה.
 * מחפש דפוסים כגון:
 *   re:#42    re: #42    #42    [ID: 42]    שאלה #42
 *   תומך גם ב-UUID: [Q:uuid] [ID:uuid]
 *
 * @param {string} text
 * @returns {string|null}  מזהה שאלה (מספר או UUID) או null
 */
function extractQuestionIdFromText(text) {
  if (!text) return null;

  // UUID patterns (like IMAP poller)
  const uuidPatterns = [
    /\[Q[:\-]?\s*([a-f0-9\-]{36})\]/i,
    /\[ID[:\-]?\s*([a-f0-9\-]{36})\]/i,
  ];

  for (const pattern of uuidPatterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  // Numeric patterns
  const numericPatterns = [
    /re:\s*#(\d+)/i,
    /\[ID:\s*(\d+)\]/i,
    /שאלה\s*#(\d+)/,
    /#(\d+)/,
  ];

  for (const pattern of numericPatterns) {
    const match = text.match(pattern);
    if (match) return match[1];
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

/**
 * מנרמל מספר טלפון ל-9 ספרות אחרונות להשוואה.
 * @param {string} phone
 * @returns {string}
 */
function phoneTail(phone) {
  if (!phone) return '';
  return phone.replace(/\D/g, '').slice(-9);
}

// ─── POST / (מותקן על /webhook/whatsapp) ──────────────────────────────────────

/**
 * webhook ראשי — מקבל אירועים מ-GreenAPI.
 * תמיד מחזיר 200 מהר כדי למנוע retries מיותרים.
 */
router.post('/', async (req, res) => {
  // ─── תשובה מיידית ל-GreenAPI ─────────────────────────────────────
  res.status(200).json({ ok: true });

  // ─── עיבוד א-סינכרוני ────────────────────────────────────────────
  setImmediate(async () => {
    try {
      await _processWebhookPayload(req.body, req.ip || null);
    } catch (err) {
      console.error(TAG, 'שגיאה לא צפויה בעיבוד webhook:', err.message, err.stack);
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
    console.info(TAG, '/test — סימולציית webhook נכנסת');

    try {
      const result = await _processWebhookPayload(req.body, req.ip || '127.0.0.1', true);
      return res.status(200).json({ ok: true, debug: result });
    } catch (err) {
      console.error(TAG, '/test — שגיאה:', err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
}

// ─── _processWebhookPayload ───────────────────────────────────────────────────

/**
 * לוגיקת עיבוד webhook מרכזית (v2).
 *
 * זרימה:
 *   1. אמת מופע GreenAPI
 *   2. סנן רק incomingMessageReceived
 *   3. חלץ נתוני שולח (טלפון, שם)
 *   4. חלץ תוכן הודעה
 *   5. תעד ב-audit log
 *   6. זהה רב לפי מספר טלפון
 *   7. התאם לשאלה:
 *      a. מזהה שאלה בטקסט → חפש שאלה ספציפית
 *      b. שאלה פתוחה (in_process) של הרב
 *      c. שאלה ממתינה (pending) אחרונה ששודרה
 *   8. בדוק "תפוס" (claim-only)
 *   9. תפיסה אוטומטית + שמירת תשובה
 *  10. אישור חזרה לרב
 *
 * @param {object}  body
 * @param {string|null} ip
 * @param {boolean} [returnDebug=false]
 * @returns {Promise<object>}
 */
async function _processWebhookPayload(body, ip, returnDebug = false) {
  const debug = {};

  // ─── 1. אמת מופע ─────────────────────────────────────────────────
  if (!isValidInstance(body)) {
    const instanceId = body?.instanceData?.idInstance;
    console.warn(TAG, `webhook ממופע לא מזוהה: ${instanceId}`);

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
    console.debug(TAG, `אירוע שאינו הודעה נכנסת — מתעלם: ${webhookType}`);
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
    console.warn(TAG, 'לא ניתן לחלץ מספר שולח מה-webhook');
    return returnDebug ? { skipped: 'no_sender_phone' } : {};
  }

  // ─── 4. חולץ תוכן הודעה ─────────────────────────────────────────
  const messageData = body?.messageData || {};
  const messageText = extractMessageText(messageData);

  debug.messageText = messageText?.slice(0, 100);

  if (!messageText || !messageText.trim()) {
    console.info(TAG, `הודעה ריקה מ-${senderPhone} — מתעלם`);
    await _logInboundMessage({ senderPhone, senderName, messageId, messageText: '', handled: false, ip });
    return returnDebug ? { ...debug, handled: false, reason: 'empty_message' } : {};
  }

  // ─── 5. תיעוד ראשוני ─────────────────────────────────────────────
  await logAction(null, 'whatsapp.inbound_received', 'whatsapp', null, null, {
    senderPhone,
    senderName,
    messageId,
    messageType: messageData.typeMessage || 'unknown',
    textPreview: messageText?.slice(0, 100),
    ip,
  }, ip, null);

  // ─── 6. זיהוי הרב לפי מספר טלפון ───────────────────────────────
  const rabbi = await _findRabbiByPhone(senderPhone);
  debug.rabbiId = rabbi?.id || null;

  if (!rabbi) {
    console.info(TAG, `מספר טלפון לא מזוהה: ${senderPhone} — מתעלם`);
    await _logInboundMessage({ senderPhone, senderName, messageId, messageText, handled: false, ip });
    return returnDebug ? { ...debug, handled: false, reason: 'unknown_phone' } : {};
  }

  // ─── 7. התאמה לשאלה ──────────────────────────────────────────────
  //
  // אסטרטגיית התאמה (בסדר עדיפות):
  //   a. מזהה שאלה מפורש בטקסט (#42, [ID:xxx], [Q:uuid])
  //   b. שאלה שהרב כבר תפס (in_process)
  //   c. השאלה הממתינה (pending) האחרונה

  const explicitQuestionId = extractQuestionIdFromText(messageText);
  debug.explicitQuestionId = explicitQuestionId;

  let question = null;
  let matchMethod = null;

  if (explicitQuestionId) {
    // a. מזהה מפורש — חפש שאלה ספציפית
    question = await _findQuestionById(explicitQuestionId);
    matchMethod = 'explicit_id';
  }

  if (!question) {
    // b. שאלה פתוחה (in_process) שמוקצית לרב
    question = await _findInProcessQuestion(rabbi.id);
    matchMethod = question ? 'in_process' : null;
  }

  if (!question) {
    // c. שאלה ממתינה (pending) אחרונה — הרב עונה ישירות משידור
    question = await _findLatestPendingQuestion();
    matchMethod = question ? 'latest_pending' : null;
  }

  debug.questionId  = question?.id || null;
  debug.matchMethod = matchMethod;

  if (!question) {
    console.info(TAG, `אין שאלה מתאימה לרב ${rabbi.id} (${rabbi.name}) — שולח הודעת עזרה`);
    await sendMessage(senderPhone,
      'לא נמצאה שאלה פתוחה כרגע. ניתן לענות ישירות כתגובה להודעת השאלה, או להיכנס למערכת.'
    ).catch((err) => {
      console.error(TAG, 'שגיאה בשליחת הודעת עזרה:', err.message);
    });
    await _logInboundMessage({ senderPhone, senderName, messageId, messageText, handled: false, ip });
    return returnDebug ? { ...debug, handled: false, reason: 'no_matching_question' } : {};
  }

  // ─── 8. בדוק סטטוס שאלה ─────────────────────────────────────────
  if (question.status === 'answered') {
    console.info(TAG, `שאלה ${question.id} כבר נענתה — מודיע לרב`);
    await sendMessage(senderPhone, `השאלה "${question.title || 'ללא כותרת'}" כבר נענתה על ידי רב אחר.`).catch(() => {});
    await _logInboundMessage({ senderPhone, senderName, messageId, messageText, handled: false, questionId: question.id, ip });
    return returnDebug ? { ...debug, handled: false, reason: 'already_answered' } : {};
  }

  // ─── 9. בדוק האם שאלה תפוסה על ידי רב אחר ──────────────────────
  if (question.status === 'in_process' &&
      question.assigned_rabbi_id &&
      String(question.assigned_rabbi_id) !== String(rabbi.id) &&
      rabbi.role !== 'admin') {
    console.info(TAG, `שאלה ${question.id} תפוסה ע"י רב אחר — מודיע לרב ${rabbi.id}`);
    await sendMessage(senderPhone, `השאלה "${question.title || 'ללא כותרת'}" כבר נתפסה על ידי רב אחר.`).catch(() => {});
    await _logInboundMessage({ senderPhone, senderName, messageId, messageText, handled: false, questionId: question.id, ip });
    return returnDebug ? { ...debug, handled: false, reason: 'claimed_by_other' } : {};
  }

  // ─── 10. בדוק מילת "תפוס" (claim-only) ──────────────────────────
  const trimmedText = messageText.trim();

  if (isClaimOnly(trimmedText)) {
    return await _handleClaimOnly(rabbi, question, senderPhone, {
      senderName, messageId, messageText, ip, debug, returnDebug,
    });
  }

  // ─── 11. אימות אורך תשובה מינימלי ──────────────────────────────
  if (trimmedText.length < 5) {
    console.info(TAG, `הודעה קצרה מדי מרב ${rabbi.id}: "${trimmedText}" — מתעלם`);
    await sendMessage(senderPhone, 'ההודעה קצרה מדי לתשובה. נא לכתוב תשובה מלאה או לשלוח "תפוס" לתפיסת השאלה.').catch(() => {});
    await _logInboundMessage({ senderPhone, senderName, messageId, messageText, handled: false, questionId: question.id, ip });
    return returnDebug ? { ...debug, handled: false, reason: 'message_too_short' } : {};
  }

  // ─── 12. תפיסה אוטומטית אם בסטטוס pending ──────────────────────
  if (question.status === 'pending' || !question.assigned_rabbi_id) {
    try {
      const claimResult = await questionService.claimQuestion(question.id, rabbi.id);
      if (!claimResult.success) {
        console.warn(TAG, `תפיסה אוטומטית נכשלה: ${claimResult.message}`);
        await sendMessage(senderPhone, `לא ניתן לתפוס את השאלה: ${claimResult.message}`).catch(() => {});
        await _logInboundMessage({ senderPhone, senderName, messageId, messageText, handled: false, questionId: question.id, ip });
        return returnDebug ? { ...debug, handled: false, reason: 'auto_claim_failed', error: claimResult.message } : {};
      }
      console.info(TAG, `תפיסה אוטומטית: שאלה ${question.id} ← רב ${rabbi.id} (${rabbi.name})`);
    } catch (claimErr) {
      console.error(TAG, `שגיאה בתפיסה אוטומטית: ${claimErr.message}`);
      await sendMessage(senderPhone, `לא ניתן לתפוס את השאלה: ${claimErr.message}`).catch(() => {});
      await _logInboundMessage({ senderPhone, senderName, messageId, messageText, handled: false, questionId: question.id, ip });
      return returnDebug ? { ...debug, handled: false, reason: 'auto_claim_error', error: claimErr.message } : {};
    }
  }

  // ─── 13. המרת טקסט ל-HTML פשוט ─────────────────────────────────
  const answerHtml = trimmedText
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n');

  // ─── 14. שמירת התשובה ────────────────────────────────────────────
  let answerId = null;
  try {
    const answer = await questionService.submitAnswer(question.id, rabbi.id, answerHtml);
    answerId = answer?.id || null;
    console.info(TAG, `תשובה נשמרה — questionId=${question.id}, rabbiId=${rabbi.id}, answerId=${answerId}`);
  } catch (answerErr) {
    console.error(TAG, `שגיאה בשמירת תשובה: ${answerErr.message}`);
    await sendMessage(senderPhone, '❌ אירעה שגיאה בשמירת התשובה. אנא נסה שוב או פנה למנהל המערכת.').catch(() => {});
    await _logInboundMessage({ senderPhone, senderName, messageId, messageText, handled: false, questionId: question.id, ip });
    return returnDebug ? { ...debug, handled: false, reason: 'answer_save_error', error: answerErr.message } : {};
  }

  // ─── 15. אישור לרב ──────────────────────────────────────────────
  const questionTitle = question.title || `שאלה #${question.id}`;
  await sendMessage(senderPhone,
    `✅ תשובתך לשאלה "${questionTitle}" נקלטה בהצלחה!`
  ).catch((err) => {
    console.error(TAG, 'שגיאה בשליחת אישור:', err.message);
  });

  // ─── 16. תיעוד ──────────────────────────────────────────────────
  await logAction(rabbi.id, 'whatsapp.answer_received', 'answer', question.id, answerId, {
    rabbiId:     rabbi.id,
    rabbiName:   rabbi.name,
    questionId:  question.id,
    matchMethod,
    senderPhone,
    messageId,
  }, ip, null);

  await _logInboundMessage({
    senderPhone,
    senderName,
    messageId,
    messageText,
    handled:    true,
    questionId: question.id,
    answerId,
    ip,
  });

  debug.handled    = true;
  debug.answerId   = answerId;
  debug.matchMethod = matchMethod;
  return returnDebug ? debug : {};
}

// ─── _handleClaimOnly ────────────────────────────────────────────────────────

/**
 * מטפל בבקשת "תפוס" — תפיסת שאלה ללא תשובה.
 *
 * @param {object} rabbi
 * @param {object} question
 * @param {string} senderPhone
 * @param {object} ctx  — { senderName, messageId, messageText, ip, debug, returnDebug }
 * @returns {Promise<object>}
 */
async function _handleClaimOnly(rabbi, question, senderPhone, ctx) {
  const { senderName, messageId, messageText, ip, debug, returnDebug } = ctx;

  // כבר תפוס על ידי הרב הזה
  if (question.status === 'in_process' && String(question.assigned_rabbi_id) === String(rabbi.id)) {
    console.info(TAG, `שאלה ${question.id} כבר תפוסה ע"י רב ${rabbi.id}`);
    await sendMessage(senderPhone,
      `השאלה "${question.title || 'ללא כותרת'}" כבר תפוסה על שמך. ניתן לשלוח תשובה כהודעה.`
    ).catch(() => {});
    await _logInboundMessage({ senderPhone, senderName, messageId, messageText, handled: true, questionId: question.id, ip });
    return returnDebug ? { ...debug, handled: true, reason: 'already_claimed_by_me' } : {};
  }

  // שאלה ממתינה — תפוס
  if (question.status === 'pending' || !question.assigned_rabbi_id) {
    try {
      const claimResult = await questionService.claimQuestion(question.id, rabbi.id);
      if (!claimResult.success) {
        await sendMessage(senderPhone, `לא ניתן לתפוס: ${claimResult.message}`).catch(() => {});
        await _logInboundMessage({ senderPhone, senderName, messageId, messageText, handled: false, questionId: question.id, ip });
        return returnDebug ? { ...debug, handled: false, reason: 'claim_failed', error: claimResult.message } : {};
      }

      console.info(TAG, `תפיסה דרך WhatsApp: שאלה ${question.id} ← רב ${rabbi.id} (${rabbi.name})`);

      const questionTitle = question.title || `שאלה #${question.id}`;
      const questionContent = (question.content || '').slice(0, 500);

      await sendMessage(senderPhone, [
        `✅ השאלה "${questionTitle}" נתפסה בהצלחה!`,
        '',
        ...(questionContent ? [questionContent, ''] : []),
        'ניתן לשלוח את התשובה כהודעה חזרה כאן.',
      ].join('\n')).catch(() => {});

      await logAction(rabbi.id, 'whatsapp.claim', 'question', question.id, null, {
        rabbiId:    rabbi.id,
        rabbiName:  rabbi.name,
        questionId: question.id,
        senderPhone,
        messageId,
      }, ip, null);

      await _logInboundMessage({ senderPhone, senderName, messageId, messageText, handled: true, questionId: question.id, ip });
      return returnDebug ? { ...debug, handled: true, reason: 'claimed' } : {};
    } catch (claimErr) {
      console.error(TAG, `שגיאה בתפיסה: ${claimErr.message}`);
      await sendMessage(senderPhone, `❌ שגיאה בתפיסת השאלה: ${claimErr.message}`).catch(() => {});
      await _logInboundMessage({ senderPhone, senderName, messageId, messageText, handled: false, questionId: question.id, ip });
      return returnDebug ? { ...debug, handled: false, reason: 'claim_error', error: claimErr.message } : {};
    }
  }

  // לא אמור להגיע לכאן — סטטוס לא צפוי
  await _logInboundMessage({ senderPhone, senderName, messageId, messageText, handled: false, questionId: question.id, ip });
  return returnDebug ? { ...debug, handled: false, reason: 'unexpected_status' } : {};
}

// ─── _findRabbiByPhone ──────────────────────────────────────────────────────

/**
 * מחפש רב פעיל לפי מספר טלפון.
 * תומך בהתאמה מדויקת ובהתאמת 9 ספרות אחרונות (tail match).
 *
 * @param {string} senderPhone  מספר טלפון נקי (ללא @c.us)
 * @returns {Promise<{ id, name, role, phone }|null>}
 */
async function _findRabbiByPhone(senderPhone) {
  if (!senderPhone) return null;

  // ניסיון 1: התאמה מדויקת
  const { rows: exactRows } = await query(
    `SELECT id, name, role, phone, whatsapp_number
     FROM   rabbis
     WHERE  is_active = true
       AND  (phone = $1 OR whatsapp_number = $1)
     LIMIT  1`,
    [senderPhone]
  );

  if (exactRows[0]) {
    const r = exactRows[0];
    return { id: r.id, name: r.name, role: r.role, phone: r.phone || r.whatsapp_number };
  }

  // ניסיון 2: התאמת 9 ספרות אחרונות (מכסה הבדלי קידומת 972 vs 0)
  const senderTail = phoneTail(senderPhone);
  if (senderTail.length < 9) return null;

  const { rows: allRows } = await query(
    `SELECT id, name, role, phone, whatsapp_number
     FROM   rabbis
     WHERE  is_active = true
       AND  (phone IS NOT NULL OR whatsapp_number IS NOT NULL)`
  );

  for (const r of allRows) {
    const rPhone = r.whatsapp_number || r.phone || '';
    if (phoneTail(rPhone) === senderTail) {
      return { id: r.id, name: r.name, role: r.role, phone: rPhone };
    }
  }

  return null;
}

// ─── _findQuestionById ──────────────────────────────────────────────────────

/**
 * מחפש שאלה לפי מזהה (UUID או מספרי).
 * מחזיר את השאלה רק אם היא בסטטוס שניתן לענות עליו.
 *
 * @param {string} questionId
 * @returns {Promise<object|null>}
 */
async function _findQuestionById(questionId) {
  const { rows } = await query(
    `SELECT id, title, content, status, assigned_rabbi_id, category_id
     FROM   questions
     WHERE  id = $1
     LIMIT  1`,
    [questionId]
  );

  return rows[0] || null;
}

// ─── _findInProcessQuestion ─────────────────────────────────────────────────

/**
 * מוצא את השאלה הפתוחה (in_process) האחרונה שמוקצית לרב.
 *
 * @param {string} rabbiId
 * @returns {Promise<object|null>}
 */
async function _findInProcessQuestion(rabbiId) {
  const { rows } = await query(
    `SELECT id, title, content, status, assigned_rabbi_id, category_id
     FROM   questions
     WHERE  assigned_rabbi_id = $1
       AND  status = 'in_process'
     ORDER  BY updated_at DESC
     LIMIT  1`,
    [rabbiId]
  );

  return rows[0] || null;
}

// ─── _findLatestPendingQuestion ─────────────────────────────────────────────

/**
 * מוצא את השאלה הממתינה (pending) האחרונה שעדיין לא נתפסה.
 * זו השאלה ששודרה אחרונה לכל הרבנים.
 *
 * @returns {Promise<object|null>}
 */
async function _findLatestPendingQuestion() {
  const { rows } = await query(
    `SELECT id, title, content, status, assigned_rabbi_id, category_id
     FROM   questions
     WHERE  status = 'pending'
       AND  assigned_rabbi_id IS NULL
     ORDER  BY created_at DESC
     LIMIT  1`
  );

  return rows[0] || null;
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
    console.debug(TAG, 'לא ניתן לשמור whatsapp_inbound_log:', dbErr.message);
  }
}

// ─── Exports ───────────────────────────────────────────────────────────────────

module.exports = router;
