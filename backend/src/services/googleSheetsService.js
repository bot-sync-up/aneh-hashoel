'use strict';

/**
 * Google Sheets CRM Leads Service
 *
 * Syncs anonymized lead data to a Google Sheets spreadsheet for the
 * HaMerkaz LeMoreshet Maran CRM pipeline.
 *
 * Privacy guarantee:
 *   - No full name, no raw email, no question content is ever written to Sheets.
 *   - Email is SHA-256 hashed (irreversible, safe for deduplication).
 *   - Only category, anonymized interaction signals, and priority flags are synced.
 *
 * Hot-lead criteria (any one qualifies):
 *   1. User pressed Thank (thank_count > 0 on any of their questions)
 *   2. User submitted > 3 questions in 30 days
 *   3. Any of the user's questions is marked urgent
 *
 * Spreadsheet columns (A–H):
 *   A: lead_id          B: timestamp         C: email_hash (SHA-256 of decrypted email)
 *   D: category         E: question_count    F: is_hot_lead
 *   G: priority         H: source            I: contacted
 *
 * Environment variables:
 *   GOOGLE_APPLICATION_CREDENTIALS  – path to service-account JSON key file
 *   GOOGLE_SHEETS_SPREADSHEET_ID    – Google Sheets document ID
 *   GOOGLE_SHEETS_LEADS_SHEET       – sheet/tab name (default: 'לידים')
 *
 * Depends on:
 *   googleapis   – npm package
 *   ../db/pool   – query()
 *   ../utils/encryption – decryptField()
 */

const crypto          = require('crypto');
const { google }      = require('googleapis');
const { query }       = require('../db/pool');
const { decryptField } = require('../utils/encryption');

// ─── Config ───────────────────────────────────────────────────────────────────

const SPREADSHEET_ID   = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const SHEET_NAME       = process.env.GOOGLE_SHEETS_LEADS_SHEET || 'לידים';
const CREDENTIALS_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;

// Columns in order: A–I (0-indexed)
const COL = {
  LEAD_ID:        0,  // A
  TIMESTAMP:      1,  // B
  EMAIL_HASH:     2,  // C
  CATEGORY:       3,  // D
  QUESTION_COUNT: 4,  // E
  IS_HOT_LEAD:    5,  // F
  PRIORITY:       6,  // G
  SOURCE:         7,  // H
  CONTACTED:      8,  // I
};

const TOTAL_COLS = Object.keys(COL).length; // 9

// ─── Auth ─────────────────────────────────────────────────────────────────────

/** Cached Google auth client (lazy) */
let _auth = null;

/**
 * Get or create the Google Auth client.
 * @returns {Promise<google.auth.GoogleAuth>}
 * @throws {Error} when credentials are not configured
 */
async function _getAuth() {
  if (_auth) return _auth;

  if (!CREDENTIALS_PATH) {
    throw new Error(
      '[googleSheets] GOOGLE_APPLICATION_CREDENTIALS לא מוגדר'
    );
  }

  _auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes:  ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return _auth;
}

/**
 * Get a configured Google Sheets API client.
 * @returns {Promise<import('googleapis').sheets_v4.Sheets>}
 */
async function _getSheets() {
  const auth = await _getAuth();
  return google.sheets({ version: 'v4', auth });
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Hash an email address with SHA-256 for privacy-safe deduplication.
 * Returns empty string when email is falsy.
 *
 * @param {string|null|undefined} email
 * @returns {string}
 */
function _hashEmail(email) {
  if (!email) return '';
  return crypto
    .createHash('sha256')
    .update(email.toLowerCase().trim())
    .digest('hex');
}

/**
 * Determine priority label from interaction signals.
 *
 * @param {object} lead
 * @param {boolean} lead.is_hot
 * @param {number}  lead.interaction_score
 * @param {boolean} lead.has_urgent
 * @returns {'high'|'medium'|'low'}
 */
function _derivePriority(lead) {
  if (lead.has_urgent || lead.interaction_score >= 5) return 'high';
  if (lead.is_hot    || lead.interaction_score >= 2) return 'medium';
  return 'low';
}

/**
 * Verify the spreadsheet is reachable and the sheet tab exists.
 * Throws with a descriptive message when missing.
 *
 * @param {import('googleapis').sheets_v4.Sheets} sheets
 */
async function _ensureSpreadsheet(sheets) {
  if (!SPREADSHEET_ID) {
    throw new Error(
      '[googleSheets] GOOGLE_SHEETS_SPREADSHEET_ID לא מוגדר'
    );
  }

  try {
    await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  } catch (err) {
    throw new Error(
      `[googleSheets] לא ניתן לגשת לגיליון (${SPREADSHEET_ID}): ${err.message}`
    );
  }
}

/**
 * Build a row array for the Sheets API from a normalised lead object.
 *
 * @param {object} lead
 * @returns {string[]} – 9-element array, A–I
 */
function _buildRow(lead) {
  const row = new Array(TOTAL_COLS).fill('');
  row[COL.LEAD_ID]        = lead.id;
  row[COL.TIMESTAMP]      = new Date(lead.created_at).toISOString();
  row[COL.EMAIL_HASH]     = _hashEmail(lead.email_plain);
  row[COL.CATEGORY]       = lead.category_name || '';
  row[COL.QUESTION_COUNT] = String(lead.question_count || 0);
  row[COL.IS_HOT_LEAD]    = lead.is_hot ? 'כן' : 'לא';
  row[COL.PRIORITY]       = _derivePriority(lead);
  row[COL.SOURCE]         = lead.source || 'web';
  row[COL.CONTACTED]      = '';
  return row;
}

// ─── syncLeadToSheets ─────────────────────────────────────────────────────────

/**
 * Append a single lead row to the Google Sheets leads tab.
 * Marks the lead as synced in the DB on success.
 *
 * @param {object} lead          – normalised lead from the DB (see _buildRow)
 * @returns {Promise<{ appended: boolean, sheetRow?: number }>}
 */
async function syncLeadToSheets(lead) {
  const sheets = await _getSheets();
  await _ensureSpreadsheet(sheets);

  const row = _buildRow(lead);

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId:   SPREADSHEET_ID,
    range:           `${SHEET_NAME}!A:I`,
    valueInputOption:'USER_ENTERED',
    insertDataOption:'INSERT_ROWS',
    requestBody:     { values: [row] },
  });

  const updatedRange = response.data.updates?.updatedRange || '';
  // Parse 1-based row number from range like 'לידים!A42:I42'
  const match = updatedRange.match(/:I(\d+)/);
  const sheetRow = match ? parseInt(match[1], 10) : null;

  // Mark synced in DB
  await query(
    `UPDATE leads_log
     SET synced_to_sheets = TRUE,
         updated_at       = NOW()
     WHERE id = $1`,
    [lead.id]
  );

  console.log(
    `[googleSheets] ליד ${lead.id} נוסף לגיליון (שורה ${sheetRow ?? '?'})`
  );

  return { appended: true, sheetRow };
}

// ─── markLeadAsContacted ─────────────────────────────────────────────────────

/**
 * Update the "contacted" column (column I) in a specific Sheets row.
 * rowIndex is 1-based (as returned by syncLeadToSheets or getHotLeads).
 *
 * @param {number} rowIndex  – 1-based row number in the sheet
 * @returns {Promise<{ updated: boolean }>}
 */
async function markLeadAsContacted(rowIndex) {
  if (!rowIndex || rowIndex < 2) {
    // Row 1 is the header; protect it
    throw Object.assign(
      new Error('rowIndex חייב להיות 2 לפחות (שורה 1 היא כותרת)'),
      { status: 400 }
    );
  }

  const sheets = await _getSheets();
  await _ensureSpreadsheet(sheets);

  const colLetter = 'I'; // COL.CONTACTED
  const range     = `${SHEET_NAME}!${colLetter}${rowIndex}`;
  const timestamp = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });

  await sheets.spreadsheets.values.update({
    spreadsheetId:   SPREADSHEET_ID,
    range,
    valueInputOption:'USER_ENTERED',
    requestBody:     { values: [[timestamp]] },
  });

  console.log(`[googleSheets] שורה ${rowIndex} סומנה כ'נוצר קשר' בגיליון`);
  return { updated: true };
}

// ─── getHotLeads ─────────────────────────────────────────────────────────────

/**
 * Read all hot-lead rows from the Sheets tab where column I (contacted) is empty.
 * Returns an array of objects with sheet row metadata.
 *
 * @returns {Promise<object[]>}
 */
async function getHotLeads() {
  const sheets = await _getSheets();
  await _ensureSpreadsheet(sheets);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range:         `${SHEET_NAME}!A:I`,
  });

  const rows = response.data.values || [];
  // Row 0 is header — skip it
  const hotLeads = [];

  for (let i = 1; i < rows.length; i++) {
    const row       = rows[i];
    const isHot     = (row[COL.IS_HOT_LEAD] || '').trim() === 'כן';
    const contacted = (row[COL.CONTACTED]   || '').trim();

    if (isHot && !contacted) {
      hotLeads.push({
        rowIndex:      i + 1,   // 1-based sheet row
        leadId:        row[COL.LEAD_ID]        || '',
        timestamp:     row[COL.TIMESTAMP]      || '',
        emailHash:     row[COL.EMAIL_HASH]     || '',
        category:      row[COL.CATEGORY]       || '',
        questionCount: parseInt(row[COL.QUESTION_COUNT] || '0', 10),
        isHotLead:     true,
        priority:      row[COL.PRIORITY]       || 'low',
        source:        row[COL.SOURCE]         || '',
        contacted:     false,
      });
    }
  }

  return hotLeads;
}

// ─── syncPendingLeads ─────────────────────────────────────────────────────────

/**
 * Cron-callable function.
 * Identifies leads that meet hot-lead criteria but haven't been synced yet,
 * marks them as hot, then syncs each to Sheets.
 *
 * Hot-lead criteria (any of):
 *   • User's question has thank_count > 0
 *   • User submitted > 3 questions in 30 days (same encrypted email)
 *   • Any question is marked urgency = 'urgent'
 *
 * Only syncs category and anonymised signals — no full name, no question content.
 *
 * @returns {Promise<{ processed: number, synced: number, failed: number }>}
 */
async function syncPendingLeads() {
  if (!SPREADSHEET_ID || !CREDENTIALS_PATH) {
    console.info('[googleSheets] Sheets sync skipped — credentials not configured');
    return { processed: 0, synced: 0, failed: 0 };
  }

  // Find unsynced leads with hot-lead signals
  const { rows: leads } = await query(`
    WITH question_stats AS (
      SELECT
        q.asker_email_encrypted,
        MAX(q.category_id)                   AS primary_category_id,
        COUNT(*)::int                        AS question_count,
        BOOL_OR(q.thank_count > 0)           AS has_thanks,
        BOOL_OR(q.urgency = 'urgent')        AS has_urgent,
        BOOL_OR(q.newsletter_featured)       AS is_featured
      FROM   questions q
      WHERE  q.asker_email_encrypted IS NOT NULL
        AND  q.status != 'hidden'
        AND  q.created_at >= NOW() - INTERVAL '30 days'
      GROUP  BY q.asker_email_encrypted
    ),
    hot_candidates AS (
      SELECT
        qs.*,
        (qs.has_thanks OR qs.question_count > 3 OR qs.has_urgent) AS is_hot
      FROM question_stats qs
    ),
    existing_synced AS (
      SELECT asker_email_encrypted FROM leads_log WHERE synced_to_sheets = TRUE
    )
    SELECT
      hc.asker_email_encrypted,
      hc.primary_category_id,
      hc.question_count,
      hc.has_thanks,
      hc.has_urgent,
      hc.is_featured,
      hc.is_hot,
      c.name AS category_name,
      ll.id  AS leads_log_id,
      ll.created_at
    FROM   hot_candidates hc
    LEFT JOIN categories c ON c.id = hc.primary_category_id
    LEFT JOIN leads_log ll  ON ll.asker_email_encrypted = hc.asker_email_encrypted
                           AND ll.synced_to_sheets = FALSE
    WHERE  hc.is_hot = TRUE
      AND  hc.asker_email_encrypted NOT IN (SELECT asker_email_encrypted FROM existing_synced)
      AND  ll.id IS NOT NULL
    LIMIT  100
  `);

  if (leads.length === 0) {
    console.info('[googleSheets] syncPendingLeads: אין לידים חמים חדשים לסנכרון');
    return { processed: 0, synced: 0, failed: 0 };
  }

  console.info(`[googleSheets] syncPendingLeads: נמצאו ${leads.length} לידים לסנכרון`);

  let synced = 0;
  let failed = 0;

  for (const lead of leads) {
    try {
      // Decrypt email for hashing only — never store plaintext
      let emailPlain = '';
      try {
        emailPlain = decryptField(lead.asker_email_encrypted) || '';
      } catch {
        // Leave empty if decryption fails — hash will be empty string
      }

      // Mark as hot in DB before syncing
      if (lead.leads_log_id) {
        await query(
          `UPDATE leads_log SET is_hot = TRUE, updated_at = NOW() WHERE id = $1`,
          [lead.leads_log_id]
        );
      }

      const normalised = {
        id:             lead.leads_log_id,
        created_at:     lead.created_at || new Date().toISOString(),
        email_plain:    emailPlain,
        category_name:  lead.category_name || '',
        question_count: lead.question_count,
        is_hot:         lead.is_hot,
        has_urgent:     lead.has_urgent,
        interaction_score: (lead.has_thanks ? 3 : 0) +
                           (lead.question_count > 3 ? 2 : 0) +
                           (lead.has_urgent ? 5 : 0),
        source: 'web',
      };

      await syncLeadToSheets(normalised);
      synced++;
    } catch (err) {
      failed++;
      console.error(
        `[googleSheets] כישלון סנכרון ליד ${lead.leads_log_id}: ${err.message}`
      );

      // Log to audit
      await query(
        `INSERT INTO audit_log (action, entity_type, new_value)
         VALUES ($1, $2, $3)`,
        [
          'sheets_sync_failed',
          'leads_log',
          JSON.stringify({ lead_id: lead.leads_log_id, error: err.message }),
        ]
      ).catch(() => {});
    }
  }

  console.info(
    `[googleSheets] syncPendingLeads הושלם: ${synced} הצליחו, ${failed} נכשלו`
  );

  return { processed: leads.length, synced, failed };
}

// ─── createSheetsClient ───────────────────────────────────────────────────────

/**
 * Initialise and return a Google Sheets API v4 client using a service account.
 *
 * Credentials are resolved in this order:
 *   1. GOOGLE_SHEETS_CREDENTIALS env var (JSON string, highest priority)
 *   2. GOOGLE_APPLICATION_CREDENTIALS env var (file path, backward-compatible)
 *
 * @returns {Promise<import('googleapis').sheets_v4.Sheets>}
 * @throws {Error} when no credentials are configured
 */
async function createSheetsClient() {
  const credsJson = process.env.GOOGLE_SHEETS_CREDENTIALS;
  const credsFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!credsJson && !credsFile) {
    throw Object.assign(
      new Error('[googleSheets] GOOGLE_SHEETS_CREDENTIALS אינו מוגדר'),
      { status: 503 }
    );
  }

  let auth;

  if (credsJson && credsJson.trimStart().startsWith('{')) {
    // Inline JSON credentials (e.g. injected by container secrets manager)
    let credentials;
    try {
      credentials = JSON.parse(credsJson);
    } catch {
      throw Object.assign(
        new Error('[googleSheets] GOOGLE_SHEETS_CREDENTIALS אינו JSON תקין'),
        { status: 503 }
      );
    }
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } else {
    // File-path credentials (GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_SHEETS_CREDENTIALS as path)
    auth = new google.auth.GoogleAuth({
      keyFile: credsJson || credsFile,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }

  return google.sheets({ version: 'v4', auth });
}

// ─── syncLead ─────────────────────────────────────────────────────────────────

/**
 * Append a single enriched lead record to Google Sheets.
 * This is the high-level wrapper used by route handlers and cron jobs.
 *
 * The lead object shape matches the Admin & Analytics module contract:
 * {
 *   name, email, phone, questionCategory, questionCount, isHot, createdAt
 * }
 *
 * @param {object} lead
 * @param {string}       lead.name
 * @param {string}       lead.email
 * @param {string}       [lead.phone]
 * @param {string}       [lead.questionCategory]
 * @param {number}       [lead.questionCount]
 * @param {boolean}      [lead.isHot]
 * @param {string|Date}  [lead.createdAt]
 * @returns {Promise<void>}
 */
async function syncLead(lead) {
  if (!SPREADSHEET_ID) {
    console.warn('[googleSheets] GOOGLE_SHEETS_SPREADSHEET_ID לא הוגדר — מדלג על syncLead');
    return;
  }
  if (!lead || !lead.email) {
    throw Object.assign(new Error('lead.email נדרש'), { status: 400 });
  }

  const sheets = await createSheetsClient();
  await _ensureSpreadsheet(sheets);

  const createdAt = lead.createdAt
    ? new Date(lead.createdAt).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' })
    : new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });

  const priority = lead.isHot ? 'high' : 'low';

  const row = [
    lead.email            || '',   // A – email (plain — caller is responsible for masking)
    lead.name             || '',   // B – name
    lead.phone            || '',   // C – phone
    lead.questionCategory || '',   // D – category
    lead.questionCount    ?? 0,    // E – question count
    lead.isHot ? 'כן' : 'לא',     // F – isHot
    priority,                      // G – priority
    createdAt,                     // H – createdAt
    '',                            // I – contacted (blank)
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId:   SPREADSHEET_ID,
    range:           `${SHEET_NAME}!A:I`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody:     { values: [row] },
  });

  console.info(`[googleSheets] ליד (${lead.email}) נוסף לגיליון.`);
}

// ─── markLeadHot ─────────────────────────────────────────────────────────────

/**
 * Find an existing lead row by email address and update its priority/isHot columns.
 *
 * Scans column A (email) for a match.  Updates the first match found.
 * If the email does not exist in the sheet, a warning is logged and the
 * function returns without error.
 *
 * @param {string} email   – lead email to locate
 * @param {string} reason  – reason for hot classification (written to priority cell)
 * @returns {Promise<{ updated: boolean, rowIndex: number|null }>}
 */
async function markLeadHot(email, reason) {
  if (!SPREADSHEET_ID) {
    console.warn('[googleSheets] GOOGLE_SHEETS_SPREADSHEET_ID לא הוגדר — מדלג על markLeadHot');
    return { updated: false, rowIndex: null };
  }
  if (!email) {
    throw Object.assign(new Error('email נדרש'), { status: 400 });
  }

  const sheets = await createSheetsClient();
  await _ensureSpreadsheet(sheets);

  // Read column A (email) to find the matching row
  const readResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range:         `${SHEET_NAME}!A:A`,
  });

  const emailColumn = readResp.data.values || [];
  let targetRow = null;

  for (let i = 0; i < emailColumn.length; i++) {
    const cell = (emailColumn[i][0] || '').trim().toLowerCase();
    if (cell === email.trim().toLowerCase()) {
      targetRow = i + 1; // 1-based sheet row
      break;
    }
  }

  if (targetRow === null) {
    console.warn(`[googleSheets] markLeadHot: לא נמצא ליד עם אימייל ${email}`);
    return { updated: false, rowIndex: null };
  }

  // F = isHot, G = priority
  await sheets.spreadsheets.values.update({
    spreadsheetId:   SPREADSHEET_ID,
    range:           `${SHEET_NAME}!F${targetRow}:G${targetRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [['כן', `high — ${reason || 'סומן ידנית'}`]],
    },
  });

  console.info(`[googleSheets] ליד ${email} (שורה ${targetRow}) סומן כחם — ${reason}`);
  return { updated: true, rowIndex: targetRow };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Original exports — preserved
  syncLeadToSheets,
  markLeadAsContacted,
  getHotLeads,
  syncPendingLeads,
  // New named exports required by Admin & Analytics module spec
  createSheetsClient,
  syncLead,
  markLeadHot,
};
