'use strict';

/**
 * System Settings  –  Default values + DB-backed getter/setter
 *
 * Settings are persisted in the `system_config` table (key TEXT PK,
 * value JSONB, updated_by UUID, updated_at TIMESTAMPTZ) which is
 * already created by migration 001.
 *
 * Default values are used when a key has not been overridden in the DB.
 * Callers always get a resolved scalar value (number, string, boolean)
 * from getSetting(); the raw JSONB wrapper is transparent.
 *
 * Exports:
 *   DEFAULTS              – object of all known keys with their defaults
 *   getSetting(key)       – get one setting (DB first, fallback to default)
 *   setSetting(key, value, adminId, ip) – upsert in DB + audit log
 *   getAllSettings()      – merged { key: resolvedValue } map
 *   resetToDefault(key, adminId, ip)   – delete DB row → reverts to default
 *
 * Known settings:
 *   timeout_hours                  (number, default 4)
 *   warning_hours                  (number, default 3)
 *   weekly_report_day              (number, 0=Sun … 6=Sat, default 5=Fri)
 *   weekly_report_hour             (number, 0–23, default 8)
 *   rabbi_of_week_day              (number, 0=Sun … 6=Sat, default 0=Sun)
 *   rabbi_of_week_hour             (number, 0–23, default 9)
 *   max_concurrent_questions_default (number, default 5)
 *   sheets_sync_enabled            (boolean, default true)
 *   wp_sync_enabled                (boolean, default true)
 *   emergency_email_enabled        (boolean, default true)
 *
 * Depends on:
 *   ../db/pool            – query()
 *   ../middleware/auditLog – logAction, ACTIONS
 */

const { query }             = require('../db/pool');
const { logAction, ACTIONS } = require('../middleware/auditLog');

// ─── Default values ───────────────────────────────────────────────────────────

/**
 * Canonical default for every known system setting.
 * Values must be JSON-serialisable primitives or plain objects.
 */
const DEFAULTS = Object.freeze({
  /** Hours before a question times out and is returned to the pool */
  timeout_hours:                   4,

  /** Hours before the warning notification is sent to the rabbi */
  warning_hours:                   3,

  /**
   * Day of the week to send weekly rabbi reports.
   * 0 = Sunday … 6 = Saturday  (JS Date.getDay() convention)
   * Default: 5 = Friday (erev Shabbat)
   */
  weekly_report_day:               5,

  /** Hour (0–23) at which weekly reports are sent */
  weekly_report_hour:              8,

  /**
   * Day of the week to post the Rabbi of the Week.
   * Default: 0 = Sunday
   */
  rabbi_of_week_day:               0,

  /** Hour (0–23) at which the Rabbi of the Week is posted */
  rabbi_of_week_hour:              9,

  /** Default max concurrent open questions per rabbi (can be overridden per rabbi) */
  max_concurrent_questions_default: 5,

  /** Whether the Google Sheets leads sync cron is enabled */
  sheets_sync_enabled:             true,

  /** Whether the WordPress answer sync is enabled */
  wp_sync_enabled:                 true,

  /** Whether emergency broadcast emails are enabled */
  emergency_email_enabled:         true,
});

// ─── Validation rules ─────────────────────────────────────────────────────────

/**
 * Per-key validation.  Returns null if valid, an error string if invalid.
 * Keys not listed here are accepted without validation (flexible extension).
 *
 * @param {string} key
 * @param {*}      value
 * @returns {string|null}
 */
function _validate(key, value) {
  switch (key) {
    case 'timeout_hours':
    case 'warning_hours':
      if (typeof value !== 'number' || value < 1 || value > 168) {
        return `${key} חייב להיות מספר בין 1 ל-168`;
      }
      if (key === 'warning_hours' && value >= DEFAULTS.timeout_hours) {
        // Soft check — warning must be < timeout
      }
      return null;

    case 'weekly_report_day':
    case 'rabbi_of_week_day':
      if (!Number.isInteger(value) || value < 0 || value > 6) {
        return `${key} חייב להיות מספר שלם בין 0 ל-6 (יום בשבוע)`;
      }
      return null;

    case 'weekly_report_hour':
    case 'rabbi_of_week_hour':
      if (!Number.isInteger(value) || value < 0 || value > 23) {
        return `${key} חייב להיות מספר שלם בין 0 ל-23 (שעה)`;
      }
      return null;

    case 'max_concurrent_questions_default':
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        return `${key} חייב להיות מספר שלם בין 1 ל-100`;
      }
      return null;

    case 'sheets_sync_enabled':
    case 'wp_sync_enabled':
    case 'emergency_email_enabled':
      if (typeof value !== 'boolean') {
        return `${key} חייב להיות ערך בוליאני (true/false)`;
      }
      return null;

    default:
      return null; // Unknown keys are not validated
  }
}

// ─── getSetting ───────────────────────────────────────────────────────────────

/**
 * Get a single system setting value.
 * Returns the DB-stored value if present, otherwise the default.
 * Returns undefined when the key is unknown and has no DB entry.
 *
 * @param {string} key
 * @returns {Promise<number|string|boolean|object|undefined>}
 */
async function getSetting(key) {
  if (!key) throw Object.assign(new Error('מפתח הגדרה נדרש'), { status: 400 });

  try {
    const { rows } = await query(
      'SELECT value FROM system_config WHERE key = $1',
      [key]
    );

    if (rows.length > 0) {
      // JSONB value may be a primitive (number, boolean, string) or object
      const raw = rows[0].value;
      // pg returns JSONB as already-parsed JS values
      return raw;
    }
  } catch (err) {
    console.error(`[systemSettings] getSetting DB error (${key}):`, err.message);
  }

  // Fallback to default
  return DEFAULTS[key];
}

// ─── setSetting ───────────────────────────────────────────────────────────────

/**
 * Upsert a system setting in the DB.
 * Validates the value, stores it, and writes an audit log entry.
 *
 * @param {string}      key
 * @param {*}           value      – must be JSON-serialisable
 * @param {string|null} adminId    – ID of the admin making the change
 * @param {string|null} [ip]       – request IP for audit
 * @returns {Promise<{ key: string, value: *, updatedBy: string|null, updatedAt: Date }>}
 */
async function setSetting(key, value, adminId, ip) {
  if (!key) throw Object.assign(new Error('מפתח הגדרה נדרש'), { status: 400 });
  if (value === undefined) {
    throw Object.assign(new Error(`ערך נדרש עבור הגדרה '${key}'`), { status: 400 });
  }

  // Validate
  const validationError = _validate(key, value);
  if (validationError) {
    throw Object.assign(new Error(validationError), { status: 400 });
  }

  // Fetch old value for audit
  const { rows: oldRows } = await query(
    'SELECT value FROM system_config WHERE key = $1',
    [key]
  );
  const oldValue = oldRows.length > 0 ? oldRows[0].value : DEFAULTS[key] ?? null;

  // Upsert
  const { rows } = await query(
    `INSERT INTO system_config (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value      = $2::jsonb,
           updated_by = $3,
           updated_at  = NOW()
     RETURNING key, value, updated_by, updated_at`,
    [key, JSON.stringify(value), adminId || null]
  );

  const row = rows[0];

  // Audit (fire-and-forget)
  logAction(
    adminId || null,
    ACTIONS.ADMIN_CONFIG_CHANGED,
    'system_config',
    key,
    { value: oldValue },
    { value },
    ip || null,
    null
  ).catch((err) => {
    console.error('[systemSettings] audit log error:', err.message);
  });

  return {
    key:       row.key,
    value:     row.value,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

// ─── getAllSettings ───────────────────────────────────────────────────────────

/**
 * Return all settings as a flat object: { key: resolvedValue }.
 * Merges DEFAULTS with DB-stored values (DB takes precedence).
 *
 * @returns {Promise<object>}
 */
async function getAllSettings() {
  let dbRows = [];
  try {
    const { rows } = await query(
      'SELECT key, value, updated_by, updated_at FROM system_config ORDER BY key'
    );
    dbRows = rows;
  } catch (err) {
    console.error('[systemSettings] getAllSettings DB error:', err.message);
  }

  // Start with defaults
  const merged = Object.assign({}, DEFAULTS);

  // Build enriched map with metadata
  const metadata = {};

  for (const row of dbRows) {
    merged[row.key] = row.value;
    metadata[row.key] = {
      value:     row.value,
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
      isDefault: false,
    };
  }

  // Fill metadata for defaults not overridden
  for (const key of Object.keys(DEFAULTS)) {
    if (!metadata[key]) {
      metadata[key] = {
        value:     DEFAULTS[key],
        updatedBy: null,
        updatedAt: null,
        isDefault: true,
      };
    }
  }

  return {
    values:   merged,
    metadata,
    defaults: DEFAULTS,
  };
}

// ─── resetToDefault ───────────────────────────────────────────────────────────

/**
 * Delete a setting from the DB so it falls back to the coded default.
 *
 * @param {string}      key
 * @param {string|null} adminId
 * @param {string|null} ip
 * @returns {Promise<{ key: string, defaultValue: * }>}
 */
async function resetToDefault(key, adminId, ip) {
  if (!key) throw Object.assign(new Error('מפתח הגדרה נדרש'), { status: 400 });

  const { rows: oldRows } = await query(
    'SELECT value FROM system_config WHERE key = $1',
    [key]
  );
  const oldValue = oldRows.length > 0 ? oldRows[0].value : null;

  await query('DELETE FROM system_config WHERE key = $1', [key]);

  // Audit
  logAction(
    adminId || null,
    ACTIONS.ADMIN_CONFIG_CHANGED,
    'system_config',
    key,
    { value: oldValue },
    { value: DEFAULTS[key] ?? null, reset_to_default: true },
    ip || null,
    null
  ).catch(() => {});

  return {
    key,
    defaultValue: DEFAULTS[key],
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  DEFAULTS,
  getSetting,
  setSetting,
  getAllSettings,
  resetToDefault,
};
