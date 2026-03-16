'use strict';

/**
 * Audit Service
 *
 * High-level service layer over the audit_log table.
 * Complements middleware/auditLog.js (which provides Express-integrated helpers)
 * by exposing clean, paginated query functions for the admin UI.
 *
 * Exports (named):
 *   logAction(rabbiId, action, entityType, entityId, details) – insert a record
 *   getAuditLog(filters)                                      – paginated query
 *   ACTION_TYPES                                              – common action constants
 *
 * Common action type strings (ACTION_TYPES):
 *   question.claim      question.release     question.answer
 *   question.transfer   question.hidden      question.urgent
 *   rabbi.login         rabbi.logout         rabbi.created
 *   settings.changed
 *
 * Depends on:
 *   ../db/pool  – query()
 */

const { query } = require('../db/pool');

// ─── ACTION_TYPES ─────────────────────────────────────────────────────────────

/**
 * Canonical action type identifiers for use with logAction().
 * These are the strings stored in audit_log.action.
 * They deliberately mirror (and extend) the ACTIONS constants in
 * middleware/auditLog.js so callers can use either source.
 */
const ACTION_TYPES = Object.freeze({
  // Question lifecycle
  QUESTION_CLAIM:    'question.claim',
  QUESTION_RELEASE:  'question.release',
  QUESTION_ANSWER:   'question.answer',
  QUESTION_TRANSFER: 'question.transfer',
  QUESTION_HIDDEN:   'question.hidden',
  QUESTION_URGENT:   'question.urgent',

  // Rabbi management
  RABBI_LOGIN:       'rabbi.login',
  RABBI_LOGOUT:      'rabbi.logout',
  RABBI_CREATED:     'rabbi.created',

  // Settings
  SETTINGS_CHANGED:  'settings.changed',
});

// ─── logAction ────────────────────────────────────────────────────────────────

/**
 * Insert a single audit record into audit_log.
 *
 * This is a fire-and-forget function: it swallows all errors so that a
 * database failure can never disrupt the caller's main operation.
 *
 * @param {string|null}  rabbiId     – UUID of the rabbi/admin who acted
 * @param {string}       action      – one of ACTION_TYPES.* or any custom string
 * @param {string|null}  entityType  – 'question' | 'rabbi' | 'setting' | ...
 * @param {string|null}  entityId    – primary key of the affected row
 * @param {object|null}  details     – additional context merged into new_value JSON
 * @returns {Promise<void>}           – always resolves, never rejects
 */
async function logAction(rabbiId, action, entityType, entityId, details) {
  try {
    if (!action) {
      console.warn('[auditService] logAction: action לא סופק');
      return;
    }

    const newValue = details && typeof details === 'object'
      ? JSON.stringify(_scrub(details))
      : null;

    await query(
      `INSERT INTO audit_log
         (actor_id, action, entity_type, entity_id, new_value)
       VALUES
         ($1, $2, $3, $4, $5)`,
      [
        rabbiId    || null,
        action,
        entityType || null,
        entityId   != null ? String(entityId) : null,
        newValue,
      ]
    );
  } catch (err) {
    // Audit failures must never disrupt the caller
    console.error('[auditService] כישלון שמירת רשומת ביקורת:', err.message, {
      action,
      entityType,
      entityId,
    });
  }
}

// ─── getAuditLog ──────────────────────────────────────────────────────────────

/**
 * Return a paginated slice of audit_log with optional filters.
 *
 * @param {object}  filters
 * @param {string}  [filters.rabbiId]    – filter by actor_id (UUID)
 * @param {string}  [filters.action]     – exact action string match, or prefix match
 *                                         (e.g. 'question' matches all question.* actions)
 * @param {string}  [filters.entityType] – exact entity_type match
 * @param {string}  [filters.dateFrom]   – ISO timestamp — entries on/after this date
 * @param {string}  [filters.dateTo]     – ISO timestamp — entries on/before this date
 * @param {number}  [filters.page]       – 1-based page number (default 1)
 * @param {number}  [filters.limit]      – rows per page (default 50, max 200)
 *
 * @returns {Promise<{
 *   entries: Array<{
 *     id: string,
 *     actorId: string|null,
 *     actorName: string|null,
 *     action: string,
 *     entityType: string|null,
 *     entityId: string|null,
 *     oldValue: object|null,
 *     newValue: object|null,
 *     ip: string|null,
 *     userAgent: string|null,
 *     createdAt: string
 *   }>,
 *   total: number,
 *   page: number,
 *   limit: number
 * }>}
 */
async function getAuditLog(filters = {}) {
  const conditions = [];
  const params     = [];
  let   idx        = 0;

  if (filters.rabbiId) {
    conditions.push(`al.actor_id = $${++idx}`);
    params.push(filters.rabbiId);
  }

  if (filters.action) {
    // Support both exact match and prefix match (e.g. 'question' matches 'question.claim')
    if (filters.action.includes('.')) {
      // Exact action string
      conditions.push(`al.action = $${++idx}`);
      params.push(filters.action);
    } else {
      // Prefix match — useful for filtering by category (e.g. 'question', 'rabbi')
      conditions.push(`al.action LIKE $${++idx}`);
      params.push(`${filters.action}.%`);
    }
  }

  if (filters.entityType) {
    conditions.push(`al.entity_type = $${++idx}`);
    params.push(filters.entityType);
  }

  if (filters.dateFrom) {
    conditions.push(`al.created_at >= $${++idx}`);
    params.push(filters.dateFrom);
  }

  if (filters.dateTo) {
    conditions.push(`al.created_at <= $${++idx}`);
    params.push(filters.dateTo);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count total for pagination metadata
  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS total FROM audit_log al ${where}`,
    params
  );
  const total  = countRows[0].total;
  const page   = Math.max(1, parseInt(filters.page,  10) || 1);
  const limit  = Math.min(200, Math.max(1, parseInt(filters.limit, 10) || 50));
  const offset = (page - 1) * limit;

  // Fetch page — JOIN rabbis for actor name
  const { rows } = await query(
    `SELECT
       al.id,
       al.actor_id,
       r.name        AS actor_name,
       al.action,
       al.entity_type,
       al.entity_id,
       al.old_value,
       al.new_value,
       al.ip,
       al.user_agent,
       al.created_at
     FROM   audit_log al
     LEFT JOIN rabbis r ON r.id = al.actor_id
     ${where}
     ORDER  BY al.created_at DESC
     LIMIT  $${++idx} OFFSET $${++idx}`,
    [...params, limit, offset]
  );

  const entries = rows.map((r) => ({
    id:         r.id,
    actorId:    r.actor_id,
    actorName:  r.actor_name || null,
    action:     r.action,
    entityType: r.entity_type,
    entityId:   r.entity_id,
    oldValue:   _parseJson(r.old_value),
    newValue:   _parseJson(r.new_value),
    ip:         r.ip,
    userAgent:  r.user_agent,
    createdAt:  r.created_at,
  }));

  return { entries, total, page, limit };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/** Fields that must never appear in audit records. */
const _SENSITIVE_KEYS = new Set([
  'password', 'password_hash', 'passwordHash',
  'current_password', 'new_password', 'confirmPassword',
  'token', 'secret', 'otp', 'totp_secret', 'totpSecret',
  'api_key', 'apiKey', 'credit_card', 'creditCard',
  'encryption_key', 'encryptionKey',
]);

/**
 * Return a shallow copy of obj with sensitive keys removed.
 * @param {object} obj
 * @returns {object}
 * @private
 */
function _scrub(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!_SENSITIVE_KEYS.has(k)) clean[k] = v;
  }
  return clean;
}

/**
 * Parse a JSON string returned from the DB. Returns null on failure.
 * @param {string|null} val
 * @returns {object|null}
 * @private
 */
function _parseJson(val) {
  if (!val) return null;
  try {
    return typeof val === 'string' ? JSON.parse(val) : val;
  } catch {
    return null;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  ACTION_TYPES,
  logAction,
  getAuditLog,
};
