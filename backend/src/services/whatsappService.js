'use strict';

/**
 * WhatsApp Service — GreenAPI Integration
 *
 * שולח הודעות WhatsApp לרבנים ולשואלים דרך GreenAPI.
 * כל השגיאות נבלעות ומתועדות; כישלון WhatsApp לא קורס את הזרימה הראשית.
 *
 * WhatsApp משמש אך ורק:
 *   1. שליחת התראות לרבנים (שידורים, תפיסת שאלה וכו')
 *   2. שליחת התראת תשובה לשואל (קישור בלבד)
 * אין ב-v1 ערוץ תשובה דו-כיווני דרך WhatsApp.
 *
 * משתני סביבה:
 *   GREENAPI_INSTANCE_ID  – מזהה המופע ב-GreenAPI
 *   GREENAPI_TOKEN        – טוקן API של GreenAPI
 *   GREENAPI_BASE_URL     – בסיס ה-URL (ברירת מחדל: https://api.green-api.com)
 *   APP_URL               – כתובת האתר הראשית (לבניית קישורי פעולה)
 *
 * GreenAPI REST:
 *   POST /waInstance{instanceId}/sendMessage/{token}
 *   Body: { chatId: "972XXXXXXXXX@c.us", message: "..." }
 *
 *   POST /waInstance{instanceId}/sendFileByUrl/{token}
 *   Body: { chatId, urlFile, fileName, caption }
 */

const axios = require('axios');

// ─── Config helpers ────────────────────────────────────────────────────────────

/**
 * בסיס ה-URL של GreenAPI.
 * @returns {string}
 */
function _greenApiBase() {
  return (process.env.GREENAPI_BASE_URL || 'https://api.green-api.com').replace(/\/$/, '');
}

/**
 * מזהה המופע וה-token של GreenAPI.
 * @returns {{ instanceId: string, token: string }|null}
 */
function _greenApiCreds() {
  const instanceId = process.env.GREENAPI_INSTANCE_ID;
  const token      = process.env.GREENAPI_TOKEN;

  if (!instanceId || !token) {
    console.warn('[whatsapp] GREENAPI_INSTANCE_ID או GREENAPI_TOKEN לא מוגדרים — דילוג על WhatsApp');
    return null;
  }

  return { instanceId, token };
}

/**
 * כתובת בסיס האתר (ללא / סופי).
 * @returns {string}
 */
function _appUrl() {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

// ─── Phone normalisation ───────────────────────────────────────────────────────

/**
 * ממיר מספר טלפון לפורמט chatId של WhatsApp: 972XXXXXXXXX@c.us
 *
 * קלטים נתמכים:
 *   05X-XXXXXXX   →  972XXXXXXXXX@c.us
 *   +9725XXXXXXX  →  972XXXXXXXXX@c.us
 *   9725XXXXXXXX  →  972XXXXXXXXX@c.us
 *
 * @param {string} phone
 * @returns {string|null}  chatId או null אם המספר לא תקין
 */
function formatPhoneNumber(phone) {
  if (!phone) return null;

  // הסר כל תו שאינו ספרה
  let digits = String(phone).replace(/\D/g, '');

  if (!digits) return null;

  // ישראל: החלף קידומת 0 בקוד מדינה 972
  if (digits.startsWith('0')) {
    digits = '972' + digits.slice(1);
  }

  // אם המספר כבר מתחיל ב-972 — השאר כך
  // אם הוא מספר 9 ספרות בלי קידומת (למשל 501234567) — הוסף 972
  if (!digits.startsWith('972')) {
    digits = '972' + digits;
  }

  // מספר ישראלי תקין: 972 + 9 ספרות = 12 ספרות סה"כ
  if (digits.length < 10 || digits.length > 15) {
    console.warn(`[whatsapp] מספר טלפון לא תקין: ${phone} (לאחר נורמליזציה: ${digits})`);
    return null;
  }

  return `${digits}@c.us`;
}

// ─── Low-level send with retry ─────────────────────────────────────────────────

/**
 * המתנה אסינכרונית.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * שולח הודעת טקסט בודדת דרך GreenAPI.
 * מנסה שוב פעם אחת בעיכוב של 2 שניות אם קיבל 429 או שגיאת 5xx.
 *
 * @param {string} phone    מספר טלפון (כל פורמט נתמך)
 * @param {string} message  תוכן ההודעה
 * @returns {Promise<{ success: boolean, messageId: string|null, error?: string }>}
 */
async function sendMessage(phone, message) {
  const creds = _greenApiCreds();
  if (!creds) {
    return { success: false, messageId: null, error: 'GreenAPI לא מוגדר' };
  }

  const chatId = formatPhoneNumber(phone);
  if (!chatId) {
    return { success: false, messageId: null, error: `מספר טלפון לא תקין: ${phone}` };
  }

  if (!message || !String(message).trim()) {
    return { success: false, messageId: null, error: 'הודעה ריקה' };
  }

  const url = `${_greenApiBase()}/waInstance${creds.instanceId}/sendMessage/${creds.token}`;
  const body = { chatId, message: String(message).trim() };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await axios.post(url, body, {
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' },
      });

      const messageId = response.data?.idMessage || null;
      console.info(`[whatsapp] הודעה נשלחה אל ${chatId} — messageId: ${messageId}`);
      return { success: true, messageId };

    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data || err.message;
      const errMsg = `GreenAPI שגיאה ${status || 'NETWORK'}: ${JSON.stringify(detail)}`;

      const isRetryable = status === 429 || (status >= 500 && status <= 599);

      if (attempt === 1 && isRetryable) {
        console.warn(`[whatsapp] ניסיון 1 נכשל (${status}) — מנסה שוב בעוד 2 שניות... chatId: ${chatId}`);
        await _sleep(2000);
        continue;
      }

      console.error(`[whatsapp] שגיאה בשליחה אל ${chatId} (ניסיון ${attempt}):`, errMsg);
      return { success: false, messageId: null, error: errMsg };
    }
  }

  // לא אמור להגיע לכאן
  return { success: false, messageId: null, error: 'שגיאה לא צפויה' };
}

/**
 * שולח קובץ דרך URL דרך GreenAPI (sendFileByUrl).
 * מנסה שוב פעם אחת בעיכוב של 2 שניות אם קיבל 429 או שגיאת 5xx.
 *
 * @param {string} phone    מספר טלפון (כל פורמט נתמך)
 * @param {string} fileUrl  כתובת URL ציבורית של הקובץ
 * @param {string} fileName שם הקובץ (כולל סיומת)
 * @param {string} [caption] כיתוב אופציונלי
 * @returns {Promise<{ success: boolean, messageId: string|null, error?: string }>}
 */
async function sendFileByUrl(phone, fileUrl, fileName, caption) {
  const creds = _greenApiCreds();
  if (!creds) {
    return { success: false, messageId: null, error: 'GreenAPI לא מוגדר' };
  }

  const chatId = formatPhoneNumber(phone);
  if (!chatId) {
    return { success: false, messageId: null, error: `מספר טלפון לא תקין: ${phone}` };
  }

  if (!fileUrl) {
    return { success: false, messageId: null, error: 'כתובת URL של הקובץ לא סופקה' };
  }

  const url  = `${_greenApiBase()}/waInstance${creds.instanceId}/sendFileByUrl/${creds.token}`;
  const body = {
    chatId,
    urlFile:  fileUrl,
    fileName: fileName || 'file',
    ...(caption ? { caption } : {}),
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await axios.post(url, body, {
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' },
      });

      const messageId = response.data?.idMessage || null;
      console.info(`[whatsapp] קובץ נשלח אל ${chatId} — messageId: ${messageId}`);
      return { success: true, messageId };

    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data || err.message;
      const errMsg = `GreenAPI שגיאה ${status || 'NETWORK'}: ${JSON.stringify(detail)}`;

      const isRetryable = status === 429 || (status >= 500 && status <= 599);

      if (attempt === 1 && isRetryable) {
        console.warn(`[whatsapp] ניסיון 1 נכשל (${status}) — מנסה שוב בעוד 2 שניות... chatId: ${chatId}`);
        await _sleep(2000);
        continue;
      }

      console.error(`[whatsapp] שגיאה בשליחת קובץ אל ${chatId} (ניסיון ${attempt}):`, errMsg);
      return { success: false, messageId: null, error: errMsg };
    }
  }

  return { success: false, messageId: null, error: 'שגיאה לא צפויה' };
}

// ─── Token builders (lazy-loaded to avoid crashing if module is absent) ────────

function _buildClaimToken(questionId) {
  try {
    const { createClaimToken } = require('../utils/actionTokens');
    return createClaimToken(questionId);
  } catch {
    return null;
  }
}

function _buildAnswerToken(questionId, rabbiId) {
  try {
    const { createAnswerToken } = require('../utils/actionTokens');
    return createAnswerToken(questionId, rabbiId);
  } catch {
    return null;
  }
}

function _buildFollowUpToken(questionId, rabbiId) {
  try {
    const { createFollowUpToken } = require('../utils/actionTokens');
    return createFollowUpToken(questionId, rabbiId);
  } catch {
    return null;
  }
}

// ─── Broadcast helpers ─────────────────────────────────────────────────────────

/**
 * מסנן מתוך רשימת רבנים את אלה שהפעילו התראות WhatsApp ויש להם מספר טלפון.
 *
 * @param {Array<object>} rabbis
 * @returns {Array<object>}
 */
function _eligibleForWhatsApp(rabbis) {
  return (rabbis || []).filter((r) => {
    if (!r.phone && !r.whatsapp_number) return false;

    const pref = r.notification_pref;
    if (!pref) return false;

    // notification_pref יכול להיות אובייקט (JSON) או מחרוזת
    if (typeof pref === 'object') {
      return pref.whatsapp === true || pref.whatsapp === 'true';
    }
    if (typeof pref === 'string') {
      return pref.includes('whatsapp');
    }
    return false;
  });
}

/**
 * מחזיר את מספר הטלפון מהרב — מעדיף whatsapp_number על phone.
 * @param {object} rabbi
 * @returns {string|null}
 */
function _rabbiPhone(rabbi) {
  return rabbi.whatsapp_number || rabbi.phone || null;
}

// ─── Public notification functions ────────────────────────────────────────────

/**
 * שידור שאלה חדשה לכל הרבנים עם WhatsApp פעיל.
 * שולח לכל רב סיכום השאלה + קישור תפיסה.
 *
 * @param {object}        question  { id, title, content, category_name, category, urgency }
 * @param {Array<object>} rabbis    רשימת רבנים — כל אחד עם { id, phone|whatsapp_number, notification_pref }
 * @returns {Promise<Array<{ rabbiId, success, messageId, error }>>}
 */
async function sendQuestionBroadcast(question, rabbis) {
  const eligible = _eligibleForWhatsApp(rabbis);

  if (!eligible.length) {
    console.info('[whatsapp] sendQuestionBroadcast: אין רבנים עם WhatsApp פעיל');
    return [];
  }

  const claimToken = _buildClaimToken(question.id);
  const claimUrl   = claimToken
    ? `${_appUrl()}/api/action/claim?token=${claimToken}`
    : `${_appUrl()}/questions/${question.id}`;

  const category = question.category_name || question.category || 'כללי';
  const title    = question.title || 'שאלה חדשה';
  const preview  = (question.content || '').slice(0, 200);

  const message = [
    'שאלה חדשה התקבלה 📖',
    '',
    `קטגוריה: ${category}`,
    `נושא: ${title}`,
    ...(preview ? [`\n${preview}${(question.content || '').length > 200 ? '...' : ''}`] : []),
    '',
    `לתפיסת השאלה: ${claimUrl}`,
  ].join('\n');

  const results = [];

  for (const rabbi of eligible) {
    if (results.length > 0) await _sleep(500);

    const phone  = _rabbiPhone(rabbi);
    const result = await sendMessage(phone, message);
    results.push({ rabbiId: rabbi.id, ...result });
  }

  return results;
}

/**
 * אישור תפיסה לרב — פרטי שאלה מלאים + קישור לדף מענה.
 *
 * @param {object} question  { id, title, content, asker_name }
 * @param {object} rabbi     { id, phone|whatsapp_number }
 * @returns {Promise<{ success, messageId, error? }>}
 */
async function sendClaimConfirmation(question, rabbi) {
  const phone = _rabbiPhone(rabbi);
  if (!phone) {
    console.warn(`[whatsapp] sendClaimConfirmation: אין מספר טלפון לרב ${rabbi?.id}`);
    return { success: false, messageId: null, error: 'אין מספר טלפון לרב' };
  }

  const answerToken = _buildAnswerToken(question.id, rabbi.id);
  const answerUrl   = answerToken
    ? `${_appUrl()}/api/action/answer?token=${answerToken}`
    : `${_appUrl()}/questions/${question.id}`;

  const content = (question.content || question.title || '').slice(0, 500);

  const message = [
    'השאלה נתפסה בהצלחה ✅',
    '',
    `שאלה #${question.id}${question.title ? ` — ${question.title}` : ''}:`,
    content,
    ...(question.asker_name ? [`\nשואל/ת: ${question.asker_name}`] : []),
    '',
    `לדף המענה: ${answerUrl}`,
  ].join('\n');

  return sendMessage(phone, message);
}

/**
 * הודעה לשואל שהתשובה מוכנה.
 * "יש לך תשובה! 🎉" + קישור לתשובה באתר WordPress.
 *
 * @param {string} askerPhone  מספר טלפון של השואל
 * @param {object} question    { id, title }
 * @param {string} answerUrl   קישור מלא לתשובה באתר
 * @returns {Promise<{ success, messageId, error? }>}
 */
async function sendAnswerNotification(askerPhone, question, answerUrl) {
  if (!askerPhone) {
    return { success: false, messageId: null, error: 'אין מספר טלפון לשואל' };
  }

  const title = question?.title || `שאלה #${question?.id}`;

  const message = [
    'יש לך תשובה! 🎉',
    '',
    `הרב ענה על שאלתך: "${title}"`,
    '',
    `לקריאת התשובה: ${answerUrl}`,
  ].join('\n');

  return sendMessage(askerPhone, message);
}

/**
 * הודעת תודה לרב שענה.
 *
 * @param {object} rabbi     { id, phone|whatsapp_number }
 * @param {object} question  { id, title }
 * @returns {Promise<{ success, messageId, error? }>}
 */
async function sendThankYouToRabbi(rabbi, question) {
  const phone = _rabbiPhone(rabbi);
  if (!phone) {
    console.warn(`[whatsapp] sendThankYouToRabbi: אין מספר טלפון לרב ${rabbi?.id}`);
    return { success: false, messageId: null, error: 'אין מספר טלפון לרב' };
  }

  const title   = question?.title || `שאלה #${question?.id}`;
  const message = [
    'כבוד הרב, גולש הודה לך על תשובתך 🙏',
    '',
    `שאלה: "${title}"`,
    '',
    'ישר כוח על הפעילות!',
  ].join('\n');

  return sendMessage(phone, message);
}

/**
 * אזהרת פג-תוקף לרב — N דקות נותרו לפני שהשאלה תשוחרר.
 *
 * @param {object} rabbi        { id, phone|whatsapp_number }
 * @param {object} question     { id, title }
 * @param {number} minutesLeft  דקות שנותרו
 * @returns {Promise<{ success, messageId, error? }>}
 */
async function sendTimeoutWarning(rabbi, question, minutesLeft) {
  const phone = _rabbiPhone(rabbi);
  if (!phone) {
    console.warn(`[whatsapp] sendTimeoutWarning: אין מספר טלפון לרב ${rabbi?.id}`);
    return { success: false, messageId: null, error: 'אין מספר טלפון לרב' };
  }

  const title = question?.title || `שאלה #${question?.id}`;

  const answerToken = _buildAnswerToken(question.id, rabbi.id);
  const answerUrl   = answerToken
    ? `${_appUrl()}/api/action/answer?token=${answerToken}`
    : `${_appUrl()}/questions/${question.id}`;

  const message = [
    `⏰ תזכורת: נותרו ${minutesLeft} דקות!`,
    '',
    `שאלה: "${title}"`,
    '',
    'אם לא תענה בזמן, השאלה תשוחרר לרבנים אחרים.',
    '',
    `לדף המענה: ${answerUrl}`,
  ].join('\n');

  return sendMessage(phone, message);
}

/**
 * שידור דחוף לכל הרבנים עם WhatsApp פעיל.
 *
 * @param {object}        question  { id, title, content }
 * @param {Array<object>} rabbis    רשימת רבנים
 * @returns {Promise<Array<{ rabbiId, success, messageId, error }>>}
 */
async function sendUrgentBroadcast(question, rabbis) {
  const eligible = _eligibleForWhatsApp(rabbis);

  if (!eligible.length) {
    console.info('[whatsapp] sendUrgentBroadcast: אין רבנים עם WhatsApp פעיל לשידור דחוף');
    return [];
  }

  const claimToken = _buildClaimToken(question.id);
  const claimUrl   = claimToken
    ? `${_appUrl()}/api/action/claim?token=${claimToken}`
    : `${_appUrl()}/questions/${question.id}`;

  const title   = question.title || `שאלה #${question.id}`;
  const message = [
    '⚠️ שאלה דחופה! נדרש מענה מיידי',
    '',
    `שאלה: "${title}"`,
    '',
    `לתפיסת השאלה: ${claimUrl}`,
  ].join('\n');

  const results = [];

  for (const rabbi of eligible) {
    if (results.length > 0) await _sleep(300);

    const phone  = _rabbiPhone(rabbi);
    const result = await sendMessage(phone, message);
    results.push({ rabbiId: rabbi.id, ...result });
  }

  return results;
}

/**
 * העברת שאלת המשך לרב שענה לשאלה.
 *
 * @param {object} rabbi          { id, phone|whatsapp_number }
 * @param {object} question       { id, title }
 * @param {string} followUpContent תוכן שאלת ההמשך
 * @returns {Promise<{ success, messageId, error? }>}
 */
async function sendFollowUpToRabbi(rabbi, question, followUpContent) {
  const phone = _rabbiPhone(rabbi);
  if (!phone) {
    console.warn(`[whatsapp] sendFollowUpToRabbi: אין מספר טלפון לרב ${rabbi?.id}`);
    return { success: false, messageId: null, error: 'אין מספר טלפון לרב' };
  }

  const content = (followUpContent || '').slice(0, 500);
  const title   = question?.title || `שאלה #${question?.id}`;

  const followUpToken = _buildFollowUpToken(question.id, rabbi.id);
  const answerUrl     = followUpToken
    ? `${_appUrl()}/api/action/answer?token=${followUpToken}`
    : `${_appUrl()}/questions/${question.id}`;

  const message = [
    `📩 שאלת המשך לשאלה: "${title}"`,
    '',
    content,
    '',
    `לתשובה: ${answerUrl}`,
  ].join('\n');

  return sendMessage(phone, message);
}

/**
 * התראת אבטחה — התחברות ממכשיר חדש.
 *
 * @param {object} rabbi       { id, phone|whatsapp_number }
 * @param {object} deviceInfo  { ip, userAgent, timestamp }
 * @returns {Promise<{ success, messageId, error? }>}
 */
async function sendNewDeviceAlert(rabbi, deviceInfo) {
  const phone = _rabbiPhone(rabbi);
  if (!phone) {
    console.warn(`[whatsapp] sendNewDeviceAlert: אין מספר טלפון לרב ${rabbi?.id}`);
    return { success: false, messageId: null, error: 'אין מספר טלפון לרב' };
  }

  const ts      = deviceInfo?.timestamp || new Date().toISOString();
  const ip      = deviceInfo?.ip        || 'לא ידוע';
  const browser = deviceInfo?.userAgent || 'לא ידוע';

  const message = [
    '🔐 התראת אבטחה: התחברות ממכשיר חדש',
    '',
    `זמן: ${ts}`,
    `כתובת IP: ${ip}`,
    `דפדפן: ${browser}`,
    '',
    'אם לא אתה התחברת — שנה את הסיסמה מיד.',
  ].join('\n');

  return sendMessage(phone, message);
}

/**
 * דו"ח שבועי לרב — טקסט בלבד (ללא HTML).
 *
 * @param {object} rabbi  { id, phone|whatsapp_number }
 * @param {object} stats  { weekStart, weekEnd, answersCount, avgResponseHours, totalThanks, urgentAnswered }
 * @returns {Promise<{ success, messageId, error? }>}
 */
async function sendWeeklyReport(rabbi, stats) {
  const phone = _rabbiPhone(rabbi);
  if (!phone) {
    console.warn(`[whatsapp] sendWeeklyReport: אין מספר טלפון לרב ${rabbi?.id}`);
    return { success: false, messageId: null, error: 'אין מספר טלפון לרב' };
  }

  const message = [
    `📊 דו"ח שבועי — ${stats.weekStart || ''} עד ${stats.weekEnd || ''}`,
    '',
    `תשובות: ${stats.answersCount || 0}`,
    `זמן מענה ממוצע: ${stats.avgResponseHours != null ? stats.avgResponseHours : '—'} שעות`,
    `תודות שהתקבלו: ${stats.totalThanks || 0}`,
    `שאלות דחופות שנענו: ${stats.urgentAnswered || 0}`,
    '',
    'ישר כוח על הפעילות!',
  ].join('\n');

  return sendMessage(phone, message);
}

/**
 * תקציר בוקר יומי — כמה שאלות ממתינות למענה.
 *
 * @param {object} rabbi        { id, phone|whatsapp_number }
 * @param {number} pendingCount מספר שאלות ממתינות
 * @returns {Promise<{ success, messageId, error? }>}
 */
async function sendDailyDigest(rabbi, pendingCount) {
  const phone = _rabbiPhone(rabbi);
  if (!phone) {
    console.warn(`[whatsapp] sendDailyDigest: אין מספר טלפון לרב ${rabbi?.id}`);
    return { success: false, messageId: null, error: 'אין מספר טלפון לרב' };
  }

  const dashUrl = `${_appUrl()}/dashboard`;

  const message = pendingCount > 0
    ? [
        `☀️ בוקר טוב! יש ${pendingCount} שאל${pendingCount === 1 ? 'ה' : 'ות'} הממתינ${pendingCount === 1 ? 'ה' : 'ות'} למענה.`,
        '',
        `למעבר ללוח הבקרה: ${dashUrl}`,
      ].join('\n')
    : [
        '☀️ בוקר טוב! אין כרגע שאלות ממתינות. המשך יום טוב!',
      ].join('\n');

  return sendMessage(phone, message);
}

// ─── Legacy aliases (backwards compat) ────────────────────────────────────────

/**
 * @deprecated השתמש ב-sendQuestionBroadcast
 */
async function sendNewQuestionBroadcast(rabbis, question) {
  return sendQuestionBroadcast(question, rabbis);
}

/**
 * @deprecated השתמש ב-sendClaimConfirmation
 */
async function sendQuestionAssigned(rabbi, question) {
  return sendClaimConfirmation(question, rabbi);
}

/**
 * @deprecated השתמש ב-sendAnswerNotification
 */
async function sendAnswerNotificationToAsker(phone, askerName, answerUrl) {
  const question = { id: null, title: askerName ? `תשובה עבור ${askerName}` : 'התשובה שלך' };
  return sendAnswerNotification(phone, question, answerUrl);
}

/**
 * @deprecated השתמש ב-sendThankYouToRabbi
 */
async function sendThankNotification(rabbi, question) {
  return sendThankYouToRabbi(rabbi, question);
}

/**
 * @deprecated השתמש ב-sendUrgentBroadcast
 */
async function sendUrgentAlert(rabbis, question) {
  return sendUrgentBroadcast(question, rabbis);
}

/**
 * @deprecated השתמש ב-sendNewDeviceAlert
 */
async function sendHolidayGreeting(recipients, message) {
  const results = [];
  for (const recipient of (recipients || [])) {
    if (!recipient?.phone) continue;
    if (results.length > 0) await _sleep(500);
    const result = await sendMessage(recipient.phone, message);
    results.push({ phone: recipient.phone, ...result });
  }
  return results;
}

async function sendEmergency(rabbis, message) {
  const results = [];
  for (const rabbi of (rabbis || [])) {
    if (!rabbi?.phone && !rabbi?.whatsapp_number) continue;
    if (results.length > 0) await _sleep(500);
    const phone  = _rabbiPhone(rabbi);
    const result = await sendMessage(phone, message);
    results.push({ rabbiId: rabbi.id, ...result });
  }
  return results;
}

// ─── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Primary API (spec-aligned)
  sendMessage,
  sendFileByUrl,
  sendQuestionBroadcast,
  sendClaimConfirmation,
  sendAnswerNotification,
  sendThankYouToRabbi,
  sendTimeoutWarning,
  sendUrgentBroadcast,
  sendFollowUpToRabbi,
  sendNewDeviceAlert,
  sendWeeklyReport,
  sendDailyDigest,
  formatPhoneNumber,

  // Legacy aliases kept for backwards compatibility
  sendNewQuestionBroadcast,
  sendQuestionAssigned,
  sendAnswerNotificationToAsker,
  sendThankNotification,
  sendUrgentAlert,
  sendHolidayGreeting,
  sendEmergency,

  // Exported for tests
  _eligibleForWhatsApp,
};
