'use strict';

/**
 * Audit Logging Middleware & Service
 *
 * Every mutation that passes through the API can be recorded in the
 * `audit_log` table.  Three surfaces are provided:
 *
 *   createAuditEntry(actorId, action, entityType, entityId, oldValue, newValue, ip)
 *     – Direct async function for service-layer use when you have all values
 *       at hand without an Express req object.
 *
 *   auditMiddleware(action, entityType)
 *     – Express middleware factory.  Attach AFTER the route handler so the
 *       response has already been prepared.  Fires non-blocking (setImmediate)
 *       so a DB failure never disrupts the request.
 *
 *   logAction(actorId, action, entityType, entityId, oldValue, newValue, ip, userAgent)
 *     – Alias of createAuditEntry, kept for backward-compatibility.
 *       Also includes userAgent as an extra parameter.
 *
 *   ACTIONS  – named constants for all auditable operations
 *
 * Depends on:
 *   ../db/pool  – query()
 */

const { query } = require('../db/pool');

// ─── Action constants ─────────────────────────────────────────────────────────

/**
 * Canonical audit action identifiers.
 * Use these constants everywhere instead of raw strings to prevent typos
 * and to provide a single place to see all auditable operations.
 */
const ACTIONS = Object.freeze({
  // Question lifecycle
  QUESTION_CLAIMED:       'question.claimed',
  QUESTION_RELEASED:      'question.released',
  QUESTION_ANSWERED:      'question.answered',
  QUESTION_HIDDEN:        'question.hidden',
  QUESTION_UNHIDDEN:      'question.unhidden',
  QUESTION_REASSIGNED:    'question.reassigned',
  QUESTION_DELETED:       'question.deleted',

  // Answer lifecycle
  ANSWER_EDITED:          'answer.edited',
  ANSWER_DELETED:         'answer.deleted',
  ANSWER_PUBLISHED:       'answer.published',

  // Rabbi management
  RABBI_CREATED:          'rabbi.created',
  RABBI_UPDATED:          'rabbi.updated',
  RABBI_DELETED:          'rabbi.deleted',
  RABBI_DEACTIVATED:      'rabbi.deactivated',
  RABBI_REACTIVATED:      'rabbi.reactivated',

  // Authentication
  AUTH_LOGIN:             'auth.login',
  AUTH_LOGOUT:            'auth.logout',
  AUTH_LOGIN_FAILED:      'auth.login_failed',
  AUTH_2FA_ENABLED:       'auth.2fa_enabled',
  AUTH_2FA_DISABLED:      'auth.2fa_disabled',
  AUTH_PASSWORD_CHANGED:  'auth.password_changed',
  AUTH_PASSWORD_RESET:    'auth.password_reset',

  // Admin / configuration
  ADMIN_CONFIG_CHANGED:   'admin.config_changed',
  ADMIN_ROLE_CHANGED:     'admin.role_changed',
  ADMIN_BULK_EXPORT:      'admin.bulk_export',
});

// ─── Sensitive-field scrubbing ────────────────────────────────────────────────

/** Fields that must never appear in audit records. */
const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'passwordHash',
  'current_password',
  'new_password',
  'confirmPassword',
  'confirm_password',
  'token',
  'secret',
  'otp',
  'totp_secret',
  'totpSecret',
  'api_key',
  'apiKey',
  'credit_card',
  'creditCard',
  'encryption_key',
  'encryptionKey',
]);

/**
 * Return a shallow copy of obj with sensitive keys removed.
 * Handles null, non-object, and array values gracefully.
 *
 * @param {object|null|undefined} obj
 * @returns {object|null}
 */
function scrubSensitiveFields(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj ?? null;
  }

  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!SENSITIVE_KEYS.has(key)) {
      clean[key] = value;
    }
  }
  return clean;
}

// ─── Core insert ─────────────────────────────────────────────────────────────

const INSERT_SQL = `
  INSERT INTO audit_log
    (actor_id, action, entity_type, entity_id, old_value, new_value, ip, user_agent)
  VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8)
`;

/**
 * Persist one audit record.
 * Swallows all errors so callers are never disrupted by audit-log failures.
 *
 * @param {string|null}  actorId
 * @param {string}       action
 * @param {string|null}  entityType
 * @param {string|null}  entityId
 * @param {object|null}  oldValue
 * @param {object|null}  newValue
 * @param {string|null}  ip
 * @param {string|null}  userAgent
 * @returns {Promise<void>}
 */
async function _persist(
  actorId,
  action,
  entityType,
  entityId,
  oldValue,
  newValue,
  ip,
  userAgent
) {
  try {
    await query(INSERT_SQL, [
      actorId    || null,
      action,
      entityType || null,
      entityId != null ? String(entityId) : null,
      oldValue   ? JSON.stringify(scrubSensitiveFields(oldValue))  : null,
      newValue   ? JSON.stringify(scrubSensitiveFields(newValue))  : null,
      ip         || null,
      userAgent  || null,
    ]);
  } catch (err) {
    // Audit failures must never bubble up to the caller
    console.error('[auditLog] שגיאה בשמירת רשומת ביקורת:', err.message, {
      action,
      entityType,
      entityId,
    });
  }
}

// ─── createAuditEntry ─────────────────────────────────────────────────────────

/**
 * Insert one audit record.  Returns a Promise that never rejects.
 *
 * @param {string|null}  actorId     – rabbi/admin who triggered the action
 * @param {string}       action      – one of ACTIONS.* (e.g. 'question.claimed')
 * @param {string|null}  entityType  – e.g. 'question', 'rabbi'
 * @param {string|null}  entityId    – primary key of the affected row
 * @param {object|null}  oldValue    – snapshot before the change (can be null)
 * @param {object|null}  newValue    – snapshot after  the change (can be null)
 * @param {string|null}  ip          – requester IP address
 * @returns {Promise<void>}
 */
function createAuditEntry(
  actorId,
  action,
  entityType,
  entityId,
  oldValue,
  newValue,
  ip
) {
  return _persist(actorId, action, entityType, entityId, oldValue, newValue, ip, null);
}

// ─── auditMiddleware ──────────────────────────────────────────────────────────

/**
 * Express middleware factory that records an audit event AFTER the route
 * handler has run.
 *
 * Usage:
 *   router.post(
 *     '/questions/:id/claim',
 *     authMiddleware,
 *     claimController,
 *     auditMiddleware(ACTIONS.QUESTION_CLAIMED, 'question')
 *   );
 *
 * The middleware resolves the entity ID from req.params.id by default.
 * Pass a custom getter as the optional third argument if needed:
 *   auditMiddleware(ACTIONS.RABBI_CREATED, 'rabbi', (req) => req.createdRabbiId)
 *
 * @param {string}                   action
 * @param {string}                   entityType
 * @param {function(req):string|null} [getEntityId]  – defaults to req.params.id
 * @returns {import('express').RequestHandler}
 */
function auditMiddleware(action, entityType, getEntityId) {
  return function _auditMiddleware(req, _res, next) {
    // Resolve synchronously while req is in scope
    const actorId = req.rabbi?.id ?? null;

    const entityId =
      typeof getEntityId === 'function'
        ? (getEntityId(req) ?? null)
        : (req.params?.id ?? null);

    const newValue   = scrubSensitiveFields(req.body  ?? null);
    const ip         = (req.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
                       || req.ip
                       || null;
    const userAgent  = req.headers?.['user-agent'] || null;

    // Fire-and-forget: do not await, never block the response pipeline
    setImmediate(() => {
      _persist(actorId, action, entityType, entityId, null, newValue, ip, userAgent)
        .catch(() => { /* already swallowed inside _persist */ });
    });

    next();
  };
}

// ─── logAction (backward-compatible alias) ────────────────────────────────────

/**
 * Log an audit event directly from a service (no Express req object needed).
 * Fire-and-forget: returns a Promise that never rejects.
 *
 * @param {string|null}  actorId
 * @param {string}       action
 * @param {string|null}  entityType
 * @param {string|null}  entityId
 * @param {object|null}  oldValue
 * @param {object|null}  newValue
 * @param {string|null}  ip
 * @param {string|null}  userAgent
 * @returns {Promise<void>}
 */
function logAction(
  actorId,
  action,
  entityType,
  entityId,
  oldValue,
  newValue,
  ip,
  userAgent
) {
  return _persist(
    actorId,
    action,
    entityType,
    entityId,
    oldValue,
    newValue,
    ip,
    userAgent
  );
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  ACTIONS,
  createAuditEntry,
  auditMiddleware,
  // Backward-compatible alias
  auditLog: auditMiddleware,
  logAction,
};
