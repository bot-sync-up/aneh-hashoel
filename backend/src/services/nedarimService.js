'use strict';

/**
 * Nedarim Plus integration service
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin wrapper around the two Nedarim Plus APIs we use:
 *
 *   1. Callback/Webhook (PUSH)
 *      Nedarim sends POST to /webhook/nedarim after each completed
 *      credit-card transaction. Parsed by `mapNedarimPayload()`.
 *      Nedarim does NOT retry on failure — so we also pull.
 *
 *   2. GetHistoryJson (PULL)
 *      GET https://matara.pro/nedarimplus/Reports/Manage3.aspx
 *        ?Action=GetHistoryJson&MosadId=…&ApiPassword=…&LastId=…&MaxId=2000
 *      Returns JSON array of transactions since LastId (exclusive).
 *
 * Config (env):
 *   NEDARIM_MOSAD_ID      – 7-digit מוסד number in Nedarim
 *   NEDARIM_API_PASSWORD  – API password (request from Nedarim support)
 *   NEDARIM_WEBHOOK_SECRET – shared secret for webhook auth (optional)
 *
 * Notes:
 *   Nedarim's Currency field is 1=ILS / 2=USD (we map to ISO strings).
 *   The `Comments` field is how we correlate a donation to a specific
 *   question+rabbi: the WP thank-you iframe embeds "q:<id>:r:<id>".
 * ─────────────────────────────────────────────────────────────────────────────
 */

const axios = require('axios');
const { query } = require('../db/pool');

const NEDARIM_HISTORY_URL = 'https://matara.pro/nedarimplus/Reports/Manage3.aspx';

// ─── Currency code mapping ───────────────────────────────────────────────────

/**
 * Nedarim encodes currency as integer: 1 = ILS, 2 = USD.
 * Returns ISO 4217 uppercase string. Defaults to 'ILS'.
 */
function mapCurrency(v) {
  const n = parseInt(v, 10);
  if (n === 2) return 'USD';
  return 'ILS';
}

// ─── Transaction type mapping ────────────────────────────────────────────────

/**
 * Nedarim sends Hebrew values ("רגיל"/"תשלומים"/"הו"ק") or English.
 * Normalise to canonical English tokens for our DB.
 */
function mapTransactionType(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/תשלומים|installments/i.test(s)) return 'installments';
  if (/הו[״"]?ק|standing|keva/i.test(s)) return 'standing_order';
  if (/רגיל|regular|one[ _-]?time/i.test(s)) return 'regular';
  return s.slice(0, 30);
}

// ─── Comments parser (correlates donation → question/rabbi) ──────────────────

/**
 * Our WP snippet embeds correlation metadata in Nedarim's Comments field
 * using the format: "q:<questionId>[:r:<rabbiId>][ | free-text]".
 * This parses it out without disturbing anything else the user typed.
 *
 * @param {string|null} commentsRaw
 * @returns {{ questionId: string|null, rabbiId: string|null, cleanComment: string }}
 */
function parseComments(commentsRaw) {
  const out = { questionId: null, rabbiId: null, cleanComment: '' };
  if (!commentsRaw) return out;

  const s = String(commentsRaw);
  // UUID is 36 chars; integers also acceptable for legacy question ids.
  const qMatch = s.match(/\bq:([0-9a-f-]{6,36})\b/i);
  const rMatch = s.match(/\br:([0-9a-f-]{6,36})\b/i);
  if (qMatch) out.questionId = qMatch[1];
  if (rMatch) out.rabbiId = rMatch[1];

  // Strip our markers from the comment so it's presentable
  out.cleanComment = s
    .replace(/\bq:[0-9a-f-]{6,36}\b/gi, '')
    .replace(/\br:[0-9a-f-]{6,36}\b/gi, '')
    .replace(/\s*\|\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return out;
}

// ─── mapNedarimPayload ───────────────────────────────────────────────────────

/**
 * Convert a Nedarim payload (either from webhook or GetHistoryJson)
 * into the shape our `donations` table expects.
 *
 * Handles BOTH the PascalCase fields from Nedarim AND the legacy
 * snake_case fields used by older clients/tests.
 */
function mapNedarimPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const amount = parseFloat(
    raw.Amount ?? raw.amount ?? '0'
  );
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const { questionId, rabbiId, cleanComment } =
    parseComments(raw.Comments ?? raw.comments ?? raw.reference);

  return {
    transaction_id:   String(raw.TransactionId ?? raw.transaction_id ?? '').slice(0, 100) || null,
    question_id:      questionId,
    rabbi_id:         rabbiId,
    amount,
    currency:         mapCurrency(raw.Currency ?? raw.currency),
    donor_name:       raw.ClientName ?? raw.donor_name ?? null,
    donor_email:      raw.Mail ?? raw.donor_email ?? null,
    donor_phone:      raw.Phone ?? raw.donor_phone ?? null,
    last_num:         raw.LastNum ?? raw.last_num ?? null,
    confirmation:     raw.Confirmation ?? raw.confirmation ?? null,
    transaction_type: mapTransactionType(raw.TransactionType ?? raw.transaction_type),
    tashloumim:       raw.Tashloumim ? parseInt(raw.Tashloumim, 10) : null,
    first_tashloum:   raw.FirstTashloum ? parseFloat(raw.FirstTashloum) : null,
    keva_id:          String(raw.KevaId ?? raw.keva_id ?? '').slice(0, 100) || null,
    nedarim_reference: String(raw.TransactionId ?? raw.reference ?? '').slice(0, 255) || null,
    payment_method:   raw.CompagnyCard ?? raw.payment_method ?? null,
    notes:            cleanComment || raw.notes || null,
    raw_payload:      raw,
  };
}

// ─── upsertDonation ──────────────────────────────────────────────────────────

/**
 * Best-effort lead lookup for a donation's donor email/phone so we can
 * attribute the donation to an existing lead automatically.
 * Returns UUID or null. Never throws.
 */
async function _findLeadIdForDonation({ donor_email, donor_phone }) {
  try {
    if (donor_email) {
      const { findLeadByEmail } = require('./leadsService');
      const lead = await findLeadByEmail(donor_email);
      if (lead?.id) return lead.id;
    }
  } catch (_) { /* non-fatal */ }

  // Phone fallback — match on last 9 digits (Israeli-style normalisation)
  try {
    if (donor_phone) {
      const digits = String(donor_phone).replace(/\D/g, '');
      if (digits.length >= 7) {
        const { rows } = await query(
          `SELECT l.id FROM leads l
            WHERE l.phone_hash = encode(digest($1, 'sha256'), 'hex')
            LIMIT 1`,
          [digits.slice(-9)]
        );
        if (rows[0]?.id) return rows[0].id;
      }
    }
  } catch (_) { /* pgcrypto not installed — swallow */ }

  return null;
}

/**
 * Insert a donation row (idempotent on transaction_id). Returns the row
 * that was inserted, or null if it was a duplicate.
 *
 * Auto-attributes to an existing lead (by email or phone hash) when possible.
 *
 * @param {object} mapped   – output of mapNedarimPayload
 * @param {'webhook'|'api_sync'|'manual'} source
 */
async function upsertDonation(mapped, source = 'webhook') {
  if (!mapped) return null;

  // Resolve lead attribution in parallel with the insert preparation.
  const leadId = await _findLeadIdForDonation({
    donor_email: mapped.donor_email,
    donor_phone: mapped.donor_phone,
  });

  const result = await query(
    `INSERT INTO donations (
       transaction_id, question_id, rabbi_id, lead_id,
       amount, currency,
       donor_name, donor_email, donor_phone,
       last_num, confirmation,
       transaction_type, tashloumim, first_tashloum, keva_id,
       nedarim_reference, payment_method, notes,
       source, raw_payload
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb
     )
     ON CONFLICT (transaction_id)
       WHERE transaction_id IS NOT NULL
       DO NOTHING
     RETURNING id, amount, currency, transaction_id, lead_id`,
    [
      mapped.transaction_id,
      mapped.question_id,
      mapped.rabbi_id,
      leadId,
      mapped.amount,
      mapped.currency,
      mapped.donor_name,
      mapped.donor_email,
      mapped.donor_phone,
      mapped.last_num,
      mapped.confirmation,
      mapped.transaction_type,
      mapped.tashloumim,
      mapped.first_tashloum,
      mapped.keva_id,
      mapped.nedarim_reference,
      mapped.payment_method,
      mapped.notes,
      source,
      JSON.stringify(mapped.raw_payload || {}),
    ]
  );

  return result.rows[0] || null;
}

// ─── fetchHistory ────────────────────────────────────────────────────────────

/**
 * Pull transactions from Nedarim's GetHistoryJson since `lastId`.
 *
 * @param {object} opts
 * @param {number} [opts.lastId=0]  – exclusive: only records with id > lastId
 * @param {number} [opts.maxId=2000] – max batch (Nedarim caps at 2000)
 * @returns {Promise<Array<object>>}
 */
async function fetchHistory({ lastId = 0, maxId = 2000 } = {}) {
  const MosadId = process.env.NEDARIM_MOSAD_ID;
  const ApiPassword = process.env.NEDARIM_API_PASSWORD;

  if (!MosadId || !ApiPassword) {
    throw new Error('NEDARIM_MOSAD_ID and NEDARIM_API_PASSWORD env vars are required');
  }

  const resp = await axios.get(NEDARIM_HISTORY_URL, {
    params: {
      Action: 'GetHistoryJson',
      MosadId,
      ApiPassword,
      LastId: lastId,
      MaxId: maxId,
    },
    timeout: 30_000,
  });

  // Nedarim returns a plain JSON array on success, or a string on error.
  if (Array.isArray(resp.data)) return resp.data;

  // Some endpoints return a JSON-encoded string (response.data is string)
  if (typeof resp.data === 'string') {
    try {
      const parsed = JSON.parse(resp.data);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      throw new Error(`Unexpected Nedarim response: ${resp.data.slice(0, 200)}`);
    }
  }

  return [];
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  mapCurrency,
  mapTransactionType,
  parseComments,
  mapNedarimPayload,
  upsertDonation,
  fetchHistory,
};
