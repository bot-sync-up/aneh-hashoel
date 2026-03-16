'use strict';

/**
 * Token utilities
 *
 * Exports:
 *   generateAccessToken(rabbi)           – short-lived JWT (15 m)
 *   generateRefreshToken(rabbi)          – long-lived JWT (7 d)
 *   storeRefreshTokenInRedis(id, token)  – mirror refresh token to Redis (7 d TTL)
 *   revokeRefreshTokenInRedis(token)     – delete from Redis cache
 *   generateActionToken(payload)         – signed JWT for email action buttons (24 h)
 *   verifyActionToken(token)             – verify action token
 *   generatePasswordResetToken(rabbiId)  – crypto random 32-byte hex, stored in Redis (15 m)
 *   verifyPasswordResetToken(rawToken)   – verify + consume reset token from Redis
 *
 * Redis key conventions:
 *   refresh:<sha256-hash>   → rabbiId string   (TTL 7 days)
 *   pwd_reset:<sha256-hash> → rabbiId string   (TTL 15 minutes)
 *
 * Note on refresh token storage:
 *   Refresh tokens are stored in both the `refresh_tokens` PostgreSQL table
 *   (primary store, enables explicit revocation and per-device audit) AND in
 *   Redis (secondary cache, allows fast token existence checks without a DB
 *   round-trip on every /refresh call).  The DB remains the source of truth;
 *   Redis serves as a fast-path look-aside cache.
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// ─── Redis lazy loader ───────────────────────────────────────────────────────
// Resolved on first use to avoid circular dependency issues at module load time.

let _redisModule = null;
function getRedis() {
  if (!_redisModule) {
    _redisModule = require('../services/redis');
  }
  return _redisModule;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ISSUER = 'aneh-hashoel';
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;  // 7 days
const RESET_TOKEN_TTL_SECONDS   = 15 * 60;            // 15 minutes
const REFRESH_KEY_PREFIX        = 'refresh:';
const RESET_KEY_PREFIX          = 'pwd_reset:';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * SHA-256 hex digest of a string.  Used so raw tokens are never stored in Redis.
 * @param {string} value
 * @returns {string}
 */
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Return the required JWT_SECRET env var, throwing early if it is missing.
 * @returns {string}
 */
function getJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET לא מוגדר במשתני הסביבה');
  return s;
}

/**
 * Return the required JWT_REFRESH_SECRET env var.
 * @returns {string}
 */
function getJwtRefreshSecret() {
  const s = process.env.JWT_REFRESH_SECRET;
  if (!s) throw new Error('JWT_REFRESH_SECRET לא מוגדר במשתני הסביבה');
  return s;
}

/**
 * Return the required ACTION_TOKEN_SECRET env var.
 * @returns {string}
 */
function getActionSecret() {
  const s = process.env.ACTION_TOKEN_SECRET;
  if (!s) throw new Error('ACTION_TOKEN_SECRET לא מוגדר במשתני הסביבה');
  return s;
}

// ─── Access Token (15 min) ───────────────────────────────────────────────────

/**
 * Generate a short-lived access JWT (15 m).
 *
 * Accepts either a rabbi object `{ id, role }` OR positional args
 * `(rabbiId, role)` so callers can use either convention.
 *
 * @param {object|string|number} rabbiOrId  Rabbi object or rabbi ID
 * @param {string}               [role]     Required when first arg is a plain ID
 * @returns {string}
 */
function generateAccessToken(rabbiOrId, role) {
  let rabbiId, rabbiRole;

  if (rabbiOrId && typeof rabbiOrId === 'object') {
    rabbiId   = rabbiOrId.id;
    rabbiRole = rabbiOrId.role;
  } else {
    rabbiId   = rabbiOrId;
    rabbiRole = role;
  }

  if (!rabbiId || !rabbiRole) {
    throw new Error('generateAccessToken: rabbiId ו-role נדרשים');
  }

  return jwt.sign(
    { sub: String(rabbiId), role: rabbiRole },
    getJwtSecret(),
    { expiresIn: '15m', issuer: ISSUER }
  );
}

// ─── Refresh Token (7 days) ──────────────────────────────────────────────────

/**
 * Generate a long-lived refresh JWT (7 d).
 *
 * Accepts either a rabbi object `{ id }` OR a plain rabbi ID.
 *
 * @param {object|string|number} rabbiOrId
 * @returns {string}
 */
function generateRefreshToken(rabbiOrId) {
  const rabbiId = (rabbiOrId && typeof rabbiOrId === 'object')
    ? rabbiOrId.id
    : rabbiOrId;

  if (!rabbiId) {
    throw new Error('generateRefreshToken: rabbiId נדרש');
  }

  return jwt.sign(
    { sub: String(rabbiId) },
    getJwtRefreshSecret(),
    { expiresIn: '7d', issuer: ISSUER }
  );
}

// ─── Refresh Token Redis helpers ─────────────────────────────────────────────

/**
 * Mirror a refresh token in Redis (fast-path existence cache).
 * Key  = refresh:<sha256(rawToken)>
 * Value = rabbiId string
 * TTL  = 7 days
 *
 * This is a secondary cache; the PostgreSQL `refresh_tokens` table remains
 * the authoritative store and is used for explicit revocation and auditing.
 *
 * @param {string|number} rabbiId
 * @param {string}        rawToken  The raw (unhashed) refresh JWT
 * @returns {Promise<void>}
 */
async function storeRefreshTokenInRedis(rabbiId, rawToken) {
  if (!rabbiId || !rawToken) return;
  try {
    const key = `${REFRESH_KEY_PREFIX}${sha256(rawToken)}`;
    await getRedis().setEx(key, REFRESH_TOKEN_TTL_SECONDS, String(rabbiId));
  } catch (err) {
    // Non-fatal — primary store is the DB
    console.error('[tokens] שגיאה בשמירת refresh token ב-Redis:', err.message);
  }
}

/**
 * Remove a refresh token from the Redis cache.
 * Called during logout or rotation so the cache does not serve stale entries.
 *
 * @param {string} rawToken
 * @returns {Promise<void>}
 */
async function revokeRefreshTokenInRedis(rawToken) {
  if (!rawToken) return;
  try {
    const key = `${REFRESH_KEY_PREFIX}${sha256(rawToken)}`;
    await getRedis().del(key);
  } catch (err) {
    console.error('[tokens] שגיאה בביטול refresh token ב-Redis:', err.message);
  }
}

// ─── Action Token (email / WhatsApp buttons, 24 h) ───────────────────────────

/**
 * Generate a signed action JWT (24 h) for embedding in email action links.
 * Payload should contain at minimum: { action, questionId } and optionally rabbiId.
 *
 * @param {object} payload  Any serialisable data
 * @returns {string}
 */
function generateActionToken(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('generateActionToken: payload אובייקט נדרש');
  }
  return jwt.sign(
    payload,
    getActionSecret(),
    { expiresIn: '24h', issuer: ISSUER }
  );
}

/**
 * Verify an action token and return its decoded payload.
 * Throws with a Hebrew message and `.status` if expired or invalid.
 *
 * @param {string} token
 * @returns {object}
 */
function verifyActionToken(token) {
  if (!token) {
    const e = new Error('verifyActionToken: טוקן נדרש');
    e.status = 401;
    throw e;
  }
  try {
    return jwt.verify(token, getActionSecret(), { issuer: ISSUER });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      const e = new Error('קישור הפעולה פג תוקף');
      e.status = 401;
      throw e;
    }
    const e = new Error('קישור הפעולה אינו תקין');
    e.status = 401;
    throw e;
  }
}

// ─── Password-Reset Token (Redis-backed, single-use, 15 min) ─────────────────

/**
 * Generate a secure random password-reset token.
 * Stores SHA-256(token) → rabbiId in Redis with a 15-minute TTL.
 * Returns the raw hex token to embed in the reset URL.
 *
 * @param {string|number} rabbiId
 * @returns {Promise<string>}  Raw 64-char hex token
 */
async function generatePasswordResetToken(rabbiId) {
  if (!rabbiId) {
    throw new Error('generatePasswordResetToken: rabbiId נדרש');
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const key      = `${RESET_KEY_PREFIX}${sha256(rawToken)}`;

  await getRedis().setEx(key, RESET_TOKEN_TTL_SECONDS, String(rabbiId));

  return rawToken;
}

/**
 * Verify a password-reset token.
 * On success: deletes the token from Redis (single-use) and returns the rabbiId.
 * On failure: throws with a Hebrew message and status 400.
 *
 * @param {string} rawToken
 * @returns {Promise<string>}  The rabbiId stored for this token
 */
async function verifyPasswordResetToken(rawToken) {
  if (!rawToken) {
    const e = new Error('טוקן איפוס סיסמה נדרש');
    e.status = 400;
    throw e;
  }

  const key     = `${RESET_KEY_PREFIX}${sha256(rawToken)}`;
  const rabbiId = await getRedis().get(key);

  if (!rabbiId) {
    const e = new Error('קישור איפוס הסיסמה אינו תקין או שפג תוקפו');
    e.status = 400;
    throw e;
  }

  // Single-use: delete immediately after successful verification
  await getRedis().del(key);

  return rabbiId;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Token generators
  generateAccessToken,
  generateRefreshToken,
  generateActionToken,
  verifyActionToken,
  generatePasswordResetToken,
  verifyPasswordResetToken,
  // Redis helpers (used by services/auth.js)
  storeRefreshTokenInRedis,
  revokeRefreshTokenInRedis,
  // Exposed for tests / internal use
  sha256,
};
