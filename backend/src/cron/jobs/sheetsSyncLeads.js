'use strict';

/**
 * sheetsSyncLeads.js
 * ─────────────────────────────────────────────────────────────────────────────
 * מסנכרן לידים חדשים מטבלת leads_log ל-Google Sheets.
 * רץ כל 15 דקות ומעדכן שורות בגיליון.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { google } = require('googleapis');
const { query }  = require('../../db/pool');
const { decrypt } = require('../../utils/encryption');

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const SHEET_NAME     = process.env.GOOGLE_SHEETS_SHEET_NAME || 'לידים';
const CREDENTIALS_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;

const MAX_SYNC_PER_RUN = 100;

/**
 * מסנכרן לידים שטרם סונכרנו ל-Google Sheets.
 */
async function runSheetsSyncLeads() {
  if (!SPREADSHEET_ID) {
    console.info('[sheets-sync] GOOGLE_SHEETS_SPREADSHEET_ID לא הוגדר — מדלג.');
    return;
  }

  if (!CREDENTIALS_PATH) {
    console.info('[sheets-sync] GOOGLE_APPLICATION_CREDENTIALS לא הוגדר — מדלג.');
    return;
  }

  // ── אימות מול Google ──────────────────────────────────────────────────
  let auth;
  try {
    auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } catch (err) {
    console.error('[sheets-sync] שגיאה באימות Google:', err.message);
    return;
  }

  const sheets = google.sheets({ version: 'v4', auth });

  // ── שליפת לידים שלא סונכרנו ────────────────────────────────────────────
  const result = await query(
    `SELECT l.id,
            l.asker_email_encrypted,
            l.asker_email_iv,
            l.asker_phone_encrypted,
            l.asker_phone_iv,
            l.interaction_score,
            l.is_hot,
            l.created_at,
            c.name AS category_name,
            q.title AS question_title
     FROM   leads_log l
     LEFT JOIN categories c ON c.id = l.category_id
     LEFT JOIN questions  q ON q.id = l.question_id
     WHERE  l.gs_synced = FALSE
     ORDER BY l.created_at ASC
     LIMIT  $1`,
    [MAX_SYNC_PER_RUN]
  );

  if (result.rowCount === 0) {
    console.info('[sheets-sync] אין לידים חדשים לסנכרון.');
    return;
  }

  console.info(`[sheets-sync] נמצאו ${result.rowCount} לידים לסנכרון.`);

  // ── בניית שורות לגיליון ────────────────────────────────────────────────
  const rows = [];
  const syncedIds = [];

  for (const lead of result.rows) {
    let email = '';
    let phone = '';

    // פענוח מידע מוצפן
    try {
      if (lead.asker_email_encrypted && lead.asker_email_iv) {
        email = decrypt(lead.asker_email_encrypted, lead.asker_email_iv);
      }
    } catch (err) {
      console.warn(`[sheets-sync] שגיאה בפענוח אימייל ליד ${lead.id}: ${err.message}`);
    }

    try {
      if (lead.asker_phone_encrypted && lead.asker_phone_iv) {
        phone = decrypt(lead.asker_phone_encrypted, lead.asker_phone_iv);
      }
    } catch (err) {
      console.warn(`[sheets-sync] שגיאה בפענוח טלפון ליד ${lead.id}: ${err.message}`);
    }

    const createdDate = new Date(lead.created_at).toLocaleDateString('he-IL', {
      timeZone: 'Asia/Jerusalem',
    });

    rows.push([
      lead.id,
      email,
      phone,
      lead.category_name || '',
      lead.question_title || '',
      lead.interaction_score,
      lead.is_hot ? 'כן' : 'לא',
      createdDate,
    ]);

    syncedIds.push(lead.id);
  }

  // ── כתיבה ל-Google Sheets ─────────────────────────────────────────────
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:H`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: rows,
      },
    });

    console.info(`[sheets-sync] נכתבו ${rows.length} שורות ל-Google Sheets.`);
  } catch (err) {
    console.error(`[sheets-sync] שגיאה בכתיבה ל-Google Sheets: ${err.message}`);

    // רישום ביומן ביקורת
    await query(
      `INSERT INTO audit_log (action, entity_type, new_value)
       VALUES ($1, $2, $3)`,
      [
        'sheets_sync_failed',
        'leads_log',
        JSON.stringify({ error: err.message, lead_count: rows.length }),
      ]
    );

    return;
  }

  // ── עדכון סטטוס סנכרון בבסיס הנתונים ──────────────────────────────────
  if (syncedIds.length > 0) {
    await query(
      `UPDATE leads_log
       SET    gs_synced = TRUE,
              gs_synced_at = NOW(),
              updated_at = NOW()
       WHERE  id = ANY($1)`,
      [syncedIds]
    );

    console.info(`[sheets-sync] עודכנו ${syncedIds.length} לידים כמסונכרנים.`);
  }

  console.info('[sheets-sync] סנכרון לידים הושלם בהצלחה.');
}

module.exports = { runSheetsSyncLeads };
