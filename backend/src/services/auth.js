'use strict';

/**
 * Auth Business Logic
 *
 * Exports:
 *   loginWithEmail(email, password)
 *   loginWithGoogle(googleId, email, name, photo)
 *   refreshAccessToken(rawRefreshToken)
 *   revokeRefreshToken(tokenHash)
 *   requestPasswordReset(email)
 *   resetPassword(rawToken, newPassword)
 *   setup2FA(rabbiId)
 *   verify2FA(rabbiId, totpToken, secret)   – enable 2FA after setup
 *   check2FA(rabbiId, totpToken)            – verify during login
 *   disable2FA(rabbiId, actorId, actorRole) – disable 2FA (self or admin)
 *   storeRefreshToken(rabbiId, rawToken)    – persist to DB + Redis
 *   hashToken(rawToken)                     – SHA-256 hex hash helper
 */

const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const speakeasy = require('speakeasy');
const QRCode  = require('qrcode');

const { query: dbQuery, getClient } = require('../db/pool');
const {
  generateAccessToken,
  generatePasswordResetToken,
  verifyPasswordResetToken,
  storeRefreshTokenInRedis,
  revokeRefreshTokenInRedis,
} = require('../utils/tokens');

// Notification service resolved lazily to prevent circular dependency issues.
let _notificationService = null;
function getNotificationService() {
  if (!_notificationService) {
    _notificationService = require('./notificationService');
  }
  return _notificationService;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * SHA-256 hex hash of a token string.
 * Used so raw JWTs are never persisted in the DB.
 * @param {string} token
 * @returns {string}
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Persist a new refresh token to the `refresh_tokens` table (primary store)
 * and mirror it to Redis (fast-path cache).
 *
 * @param {string|number} rabbiId
 * @param {string}        rawToken  Raw (unhashed) refresh JWT
 * @param {{ query: Function }} [db]  Optional pg client for transaction context
 */
async function storeRefreshToken(rabbiId, rawToken, db = { query: dbQuery }) {
  const hash      = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.query(
    `INSERT INTO refresh_tokens (rabbi_id, token_hash, expires_at, revoked)
     VALUES ($1, $2, $3, false)`,
    [rabbiId, hash, expiresAt]
  );

  // Mirror to Redis for fast /refresh look-aside (non-fatal if Redis is down)
  await storeRefreshTokenInRedis(rabbiId, rawToken);
}

// ─── loginWithEmail ───────────────────────────────────────────────────────────

/**
 * Authenticate a rabbi by email and password.
 * Returns the rabbi row (without password_hash) on success.
 * Throws with a Hebrew message and HTTP status on failure.
 *
 * @param {string} email
 * @param {string} password  Plain-text password
 * @returns {Promise<object>}
 */
async function loginWithEmail(email, password) {
  if (!email || !password) {
    const e = new Error('אימייל וסיסמה נדרשים');
    e.status = 400;
    throw e;
  }

  const { rows } = await dbQuery(
    `SELECT id, email, name, role, password_hash,
            two_fa_enabled, two_fa_secret, photo_url
     FROM   rabbis
     WHERE  email = $1`,
    [email.toLowerCase().trim()]
  );

  const rabbi = rows[0];

  if (!rabbi) {
    const e = new Error('אימייל או סיסמה שגויים');
    e.status = 401;
    throw e;
  }

  if (!rabbi.password_hash) {
    // Account was created via Google OAuth — no password set
    const e = new Error('חשבון זה מחייב כניסה עם Google');
    e.status = 401;
    throw e;
  }

  const passwordMatch = await bcrypt.compare(password, rabbi.password_hash);
  if (!passwordMatch) {
    const e = new Error('אימייל או סיסמה שגויים');
    e.status = 401;
    throw e;
  }

  // Return rabbi data without the password hash
  const { password_hash, ...rabbiData } = rabbi;
  return rabbiData;
}

// ─── loginWithGoogle ──────────────────────────────────────────────────────────

/**
 * Find an existing rabbi linked to a Google profile.
 *
 * Per platform policy rabbis are added manually by admins — this function
 * does NOT auto-create accounts.  If no matching account is found it throws
 * with status 403 so the caller can surface an appropriate error.
 *
 * Matching order:
 *   1. google_id exact match
 *   2. email match (account may have been created before Google login was set up)
 *
 * On match, google_id and photo_url are updated if they differ from what is
 * stored so the account stays in sync without a separate profile-sync job.
 *
 * @param {string}      googleId
 * @param {string}      email
 * @param {string}      name      Display name from Google (used only for logging)
 * @param {string|null} photo     Profile picture URL from Google
 * @returns {Promise<object>}     Rabbi row without sensitive fields
 */
async function loginWithGoogle(googleId, email, name, photo) {
  if (!googleId || !email) {
    const e = new Error('נתוני Google חסרים');
    e.status = 400;
    throw e;
  }

  // 1. Look up by google_id
  let { rows } = await dbQuery(
    `SELECT id, email, name, role, two_fa_enabled, two_fa_secret, photo_url, google_id
     FROM   rabbis
     WHERE  google_id = $1`,
    [googleId]
  );

  if (!rows[0]) {
    // 2. Fall back to email match (account may have been created manually)
    ({ rows } = await dbQuery(
      `SELECT id, email, name, role, two_fa_enabled, two_fa_secret, photo_url, google_id
       FROM   rabbis
       WHERE  email = $1`,
      [email.toLowerCase().trim()]
    ));
  }

  if (!rows[0]) {
    // No account found — admins must add rabbis manually
    const e = new Error('אין חשבון רשום עם אימייל זה. יש לפנות למנהל המערכת');
    e.status = 403;
    throw e;
  }

  const rabbi = rows[0];

  // Keep google_id and photo in sync
  if (!rabbi.google_id || rabbi.photo_url !== photo) {
    await dbQuery(
      `UPDATE rabbis
       SET    google_id = $1,
              photo_url = COALESCE($2, photo_url),
              updated_at = NOW()
       WHERE  id = $3`,
      [googleId, photo, rabbi.id]
    );
  }

  const { google_id, ...rabbiData } = rabbi;
  return rabbiData;
}

// ─── refreshAccessToken ───────────────────────────────────────────────────────

/**
 * Exchange a valid, non-revoked refresh token for a new access token.
 *
 * @param {string} rawRefreshToken
 * @returns {Promise<{ accessToken: string, rabbi: { id: string, role: string } }>}
 */
async function refreshAccessToken(rawRefreshToken) {
  if (!rawRefreshToken) {
    const e = new Error('טוקן רענון נדרש');
    e.status = 400;
    throw e;
  }

  const jwt = require('jsonwebtoken');
  let payload;
  try {
    payload = jwt.verify(rawRefreshToken, process.env.JWT_REFRESH_SECRET, {
      issuer: 'aneh-hashoel',
    });
  } catch (err) {
    const e = new Error(
      err.name === 'TokenExpiredError'
        ? 'פג תוקף ההתחברות. נא להתחבר מחדש'
        : 'טוקן רענון אינו תקין'
    );
    e.status = 401;
    throw e;
  }

  const hash = hashToken(rawRefreshToken);

  const { rows } = await dbQuery(
    `SELECT rt.id, r.id AS rabbi_id, r.role
     FROM   refresh_tokens rt
     JOIN   rabbis r ON r.id = rt.rabbi_id
     WHERE  rt.token_hash = $1
       AND  rt.revoked     = false
       AND  rt.expires_at  > NOW()`,
    [hash]
  );

  if (!rows[0]) {
    const e = new Error('טוקן רענון אינו תקין או שבוטל');
    e.status = 401;
    throw e;
  }

  const { rabbi_id, role } = rows[0];
  const accessToken = generateAccessToken(rabbi_id, role);

  return { accessToken, rabbi: { id: String(rabbi_id), role } };
}

// ─── revokeRefreshToken ───────────────────────────────────────────────────────

/**
 * Mark a refresh token as revoked in the DB and remove it from Redis.
 * Silently succeeds if the token is already revoked or unknown.
 *
 * @param {string} tokenHashOrRaw  SHA-256 hex hash of the raw refresh JWT,
 *                                  OR the raw token itself (auto-detected by length)
 * @param {string} [rawToken]      If provided, also evicts from Redis cache
 */
async function revokeRefreshToken(tokenHashOrRaw, rawToken) {
  if (!tokenHashOrRaw) return;

  const hash = tokenHashOrRaw.length === 64 && /^[0-9a-f]+$/.test(tokenHashOrRaw)
    ? tokenHashOrRaw   // already a SHA-256 hex hash
    : hashToken(tokenHashOrRaw);

  await dbQuery(
    `UPDATE refresh_tokens SET revoked = true
     WHERE  token_hash = $1`,
    [hash]
  );

  // Also evict from Redis if we have the raw token
  const raw = rawToken || (tokenHashOrRaw.length !== 64 ? tokenHashOrRaw : null);
  if (raw) {
    await revokeRefreshTokenInRedis(raw);
  }
}

// ─── requestPasswordReset ─────────────────────────────────────────────────────

/**
 * Initiate a password-reset flow for the given email address.
 * Always resolves — does not reveal whether the email exists (prevents enumeration).
 *
 * @param {string} email
 */
async function requestPasswordReset(email) {
  if (!email) {
    const e = new Error('אימייל נדרש');
    e.status = 400;
    throw e;
  }

  const { rows } = await dbQuery(
    `SELECT id, name, email FROM rabbis WHERE email = $1`,
    [email.toLowerCase().trim()]
  );

  // Do not leak whether this email exists in the system
  if (!rows[0]) return;

  const rabbi    = rows[0];
  const rawToken = await generatePasswordResetToken(rabbi.id);
  const resetUrl = `${process.env.APP_URL}/reset-password?token=${rawToken}`;

  try {
    const notificationService = getNotificationService();
    await notificationService.sendPasswordResetEmail(rabbi.email, rabbi.name, resetUrl);
  } catch (err) {
    // Log but do not surface — prevents timing side-channel
    console.error('[auth] שגיאה בשליחת מייל איפוס סיסמה:', err.message);
  }
}

// ─── resetPassword ────────────────────────────────────────────────────────────

/**
 * Complete the password-reset flow.
 * Verifies the token (single-use, Redis-backed), hashes the new password,
 * updates the DB, and revokes all existing refresh tokens for this rabbi.
 *
 * @param {string} rawToken
 * @param {string} newPassword
 */
async function resetPassword(rawToken, newPassword) {
  if (!rawToken || !newPassword) {
    const e = new Error('טוקן וסיסמה חדשה נדרשים');
    e.status = 400;
    throw e;
  }

  if (newPassword.length < 8) {
    const e = new Error('הסיסמה חייבת להכיל לפחות 8 תווים');
    e.status = 400;
    throw e;
  }

  // Will throw 400 if invalid / expired / already used
  const rabbiId = await verifyPasswordResetToken(rawToken);

  const BCRYPT_ROUNDS = 12;
  const passwordHash  = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  const { client, release } = await getClient();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE rabbis SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [passwordHash, rabbiId]
    );

    // Revoke ALL refresh tokens for this rabbi — forces re-login on all devices
    await client.query(
      `UPDATE refresh_tokens SET revoked = true
       WHERE rabbi_id = $1 AND revoked = false`,
      [rabbiId]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    release();
  }
}

// ─── setup2FA ─────────────────────────────────────────────────────────────────

/**
 * Generate a new TOTP secret for the rabbi and return the otpauth URL
 * and a base64-encoded QR code PNG.
 *
 * The secret is NOT saved to the DB yet — call verify2FA() to confirm and persist.
 *
 * @param {string|number} rabbiId
 * @returns {Promise<{ secret: string, otpauthUrl: string, qrCodeBase64: string }>}
 */
async function setup2FA(rabbiId) {
  const { rows } = await dbQuery(
    `SELECT email FROM rabbis WHERE id = $1`,
    [rabbiId]
  );

  if (!rows[0]) {
    const e = new Error('רב לא נמצא');
    e.status = 404;
    throw e;
  }

  const { email } = rows[0];

  const secret = speakeasy.generateSecret({
    length: 20,
    name:   `ענה את השואל (${email})`,
    issuer: 'ענה את השואל',
  });

  const otpauthUrl    = secret.otpauth_url;
  const qrCodeBase64  = await QRCode.toDataURL(otpauthUrl);

  return {
    secret:       secret.base32,
    otpauthUrl,
    qrCodeBase64,
  };
}

// ─── verify2FA (enable) ───────────────────────────────────────────────────────

/**
 * Verify a TOTP code against the provided secret (from setup2FA).
 * If valid, persist the secret in the DB and enable 2FA for the rabbi.
 *
 * Also aliased as `enable2FA(rabbiId, secret, token)` per the spec.
 *
 * @param {string|number} rabbiId
 * @param {string}        totpToken  6-digit code from authenticator app
 * @param {string}        secret     base32 secret returned by setup2FA
 */
async function verify2FA(rabbiId, totpToken, secret) {
  if (!totpToken || !secret) {
    const e = new Error('קוד אימות וסוד נדרשים');
    e.status = 400;
    throw e;
  }

  const verified = speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token:    totpToken,
    window:   1, // Allow ±1 step (30 sec) drift
  });

  if (!verified) {
    const e = new Error('קוד האימות שגוי');
    e.status = 400;
    throw e;
  }

  await dbQuery(
    `UPDATE rabbis
     SET    two_fa_enabled = true, two_fa_secret = $1, updated_at = NOW()
     WHERE  id = $2`,
    [secret, rabbiId]
  );
}

// ─── check2FA (login verification) ───────────────────────────────────────────

/**
 * Verify a TOTP code for a rabbi during the login flow.
 * Reads the stored secret from the DB.
 *
 * @param {string|number} rabbiId
 * @param {string}        totpToken
 */
async function check2FA(rabbiId, totpToken) {
  if (!totpToken) {
    const e = new Error('קוד אימות נדרש');
    e.status = 400;
    throw e;
  }

  const { rows } = await dbQuery(
    `SELECT two_fa_secret, two_fa_enabled
     FROM   rabbis
     WHERE  id = $1`,
    [rabbiId]
  );

  const rabbi = rows[0];

  if (!rabbi || !rabbi.two_fa_enabled || !rabbi.two_fa_secret) {
    const e = new Error('אימות דו-שלבי אינו מופעל עבור חשבון זה');
    e.status = 400;
    throw e;
  }

  const verified = speakeasy.totp.verify({
    secret:   rabbi.two_fa_secret,
    encoding: 'base32',
    token:    totpToken,
    window:   1,
  });

  if (!verified) {
    const e = new Error('קוד האימות שגוי');
    e.status = 401;
    throw e;
  }
}

// ─── disable2FA ───────────────────────────────────────────────────────────────

/**
 * Disable two-factor authentication for a rabbi.
 *
 * Authorization rules:
 *   - A rabbi may disable their own 2FA.
 *   - An admin may disable 2FA for any rabbi.
 *   - Anyone else receives a 403.
 *
 * The stored TOTP secret is cleared from the DB alongside the enabled flag.
 *
 * @param {string|number} rabbiId    Target rabbi whose 2FA will be disabled
 * @param {string|number} actorId    The authenticated user making the request
 * @param {string}        actorRole  Role of the authenticated user ('rabbi' | 'admin')
 */
async function disable2FA(rabbiId, actorId, actorRole) {
  const isSelf  = String(rabbiId) === String(actorId);
  const isAdmin = actorRole === 'admin';

  if (!isSelf && !isAdmin) {
    const e = new Error('אין הרשאה לבטל אימות דו-שלבי עבור רב אחר');
    e.status = 403;
    throw e;
  }

  const { rows } = await dbQuery(
    `SELECT id, two_fa_enabled FROM rabbis WHERE id = $1`,
    [rabbiId]
  );

  if (!rows[0]) {
    const e = new Error('רב לא נמצא');
    e.status = 404;
    throw e;
  }

  if (!rows[0].two_fa_enabled) {
    const e = new Error('אימות דו-שלבי אינו מופעל עבור חשבון זה');
    e.status = 400;
    throw e;
  }

  await dbQuery(
    `UPDATE rabbis
     SET    two_fa_enabled = false,
            two_fa_secret  = NULL,
            updated_at     = NOW()
     WHERE  id = $1`,
    [rabbiId]
  );
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  loginWithEmail,
  loginWithGoogle,
  refreshAccessToken,
  revokeRefreshToken,
  requestPasswordReset,
  resetPassword,
  setup2FA,
  verify2FA,
  enable2FA: verify2FA,  // alias per spec
  check2FA,
  disable2FA,
  // Exported for use in routes/auth.js
  storeRefreshToken,
  hashToken,
};
