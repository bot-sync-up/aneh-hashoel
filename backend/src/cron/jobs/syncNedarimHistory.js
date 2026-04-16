'use strict';

/**
 * syncNedarimHistory.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pulls transactions from Nedarim Plus `GetHistoryJson` as a safety net for
 * missed webhooks (Nedarim does NOT retry on failure).
 *
 * Runs hourly. Tracks progress via `system_config.nedarim_sync_last_id`.
 * Upserts into donations via `upsertDonation()` — duplicates are skipped
 * on `transaction_id`.
 *
 * Disabled by setting `system_config.nedarim_sync_enabled = false`, or if
 * the required env vars are missing (NEDARIM_MOSAD_ID, NEDARIM_API_PASSWORD).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { query } = require('../../db/pool');
const { logger } = require('../../utils/logger');
const { fetchHistory, mapNedarimPayload, upsertDonation } = require('../../services/nedarimService');

const log = logger.child({ module: 'syncNedarimHistory' });

const BATCH_SIZE = 500; // Nedarim caps at 2000 — we use 500 for friendlier latency

async function _loadLastId() {
  try {
    const { rows } = await query(
      "SELECT value FROM system_config WHERE key = 'nedarim_sync_last_id'"
    );
    const raw = rows[0]?.value;
    const n = typeof raw === 'number' ? raw : parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (err) {
    log.warn({ err }, 'Failed to load nedarim_sync_last_id — starting from 0');
    return 0;
  }
}

async function _saveLastId(newLastId) {
  await query(
    `INSERT INTO system_config (key, value, updated_at)
     VALUES ('nedarim_sync_last_id', $1::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = $1::jsonb, updated_at = NOW()`,
    [JSON.stringify(newLastId)]
  );
}

async function _isEnabled() {
  try {
    const { rows } = await query(
      "SELECT value FROM system_config WHERE key = 'nedarim_sync_enabled'"
    );
    const v = rows[0]?.value;
    // Default to true when key missing
    return v === true || v === 'true' || v === undefined || v === null;
  } catch {
    return true;
  }
}

/**
 * Entry point — called hourly from cron/index.js.
 * @returns {Promise<{ success: boolean, fetched: number, stored: number, lastId: number, disabled?: boolean }>}
 */
async function runSyncNedarimHistory() {
  // Guard: config toggle
  if (!(await _isEnabled())) {
    log.debug('nedarim sync disabled — skipping');
    return { success: true, fetched: 0, stored: 0, lastId: 0, disabled: true };
  }

  // Guard: credentials
  if (!process.env.NEDARIM_MOSAD_ID || !process.env.NEDARIM_API_PASSWORD) {
    log.warn('NEDARIM_MOSAD_ID / NEDARIM_API_PASSWORD not set — skipping');
    return { success: true, fetched: 0, stored: 0, lastId: 0, disabled: true };
  }

  let lastId = await _loadLastId();
  let totalFetched = 0;
  let totalStored = 0;

  // Loop until Nedarim returns less than BATCH_SIZE (end of history)
  // Cap at 4 pages per run to avoid hammering on first run.
  for (let page = 0; page < 4; page++) {
    let rows;
    try {
      rows = await fetchHistory({ lastId, maxId: BATCH_SIZE });
    } catch (err) {
      log.error({ err, lastId }, 'nedarim fetchHistory failed');
      return { success: false, fetched: totalFetched, stored: totalStored, lastId, error: err.message };
    }

    if (!rows || rows.length === 0) break;
    totalFetched += rows.length;

    for (const raw of rows) {
      // Track the max TransactionId we've seen so we can resume next run.
      // Nedarim returns TransactionId as a numeric string.
      const txIdNum = parseInt(raw.TransactionId, 10);
      if (Number.isFinite(txIdNum) && txIdNum > lastId) lastId = txIdNum;

      const mapped = mapNedarimPayload(raw);
      if (!mapped) continue;

      try {
        const inserted = await upsertDonation(mapped, 'api_sync');
        if (inserted) totalStored++;
      } catch (err) {
        log.error({ err, transactionId: mapped.transaction_id }, 'upsertDonation failed');
      }
    }

    if (rows.length < BATCH_SIZE) break; // reached tail
  }

  await _saveLastId(lastId);
  log.info(
    { fetched: totalFetched, stored: totalStored, lastId },
    'nedarim history sync complete'
  );
  return { success: true, fetched: totalFetched, stored: totalStored, lastId };
}

module.exports = { runSyncNedarimHistory };
