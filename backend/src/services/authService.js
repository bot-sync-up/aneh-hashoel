'use strict';

/**
 * Auth Service — Business Logic
 *
 * All auth operations for the "ענה את השואל" rabbi Q&A platform.
 *
 * Exports:
 *   loginRabbi(email, password, deviceInfo)      – validate credentials, create session, return tokens
 *   createTokens(rabbiId, role, deviceInfo)      – sign JWT access + refresh, persist session
 *   refreshTokens(rawRefreshToken, deviceInfo)   – rotate refresh token, issue new access token
 *   handleGoogleOAuth(googleProfile, deviceInfo) – find/associate google_id, issue tokens
 *   sendPasswordReset(email)                     – generate token, store in Redis, send email
 *   resetPassword(rawToken, newPassword)         – validate Redis token, zxcvbn check, update DB
 *   detectNewDevice(rabbiId, deviceInfo)         – compare against last 5 sessions
 *   revokeSession(sessionId, rabbiId)            – revoke a specific session by ID (ownership check)
 *   revokeSessionByTokenHash(tokenHash)          – revoke session by token hash
 *   revokeAllSessions(rabbiId)                   – revoke all sessions for a rabbi
 *   listActiveSessions(rabbiId)                  – list non-expired, non-revoked sessions
 *   getSessionById(sessionId, rabbiId)           – fetch one session (ownership check)
 *   updateLastLogin(rabbiId)                     – stamp last_login in rabbis table
 *   hashToken(raw)                               – SHA-256 hex helper (exported for routes)
 *   validatePasswordPolicy(password)             – enforce min length / complexity rules
 *   BCRYPT_ROUNDS                                – bcrypt cost factor constant
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt    = require('jsonwebtoken');
const zxcvbn = require('zxcvbn');

const { query: db, getClient }                = require('../db/pool');
const redis                                   = require('../services/redis');
const { sendEmail }                           = require('./email');
const { createEmailHTML, BRAND_NAVY, BRAND_GOLD } = require('../templates/emailBase');

// ─── Constants ────────────────────────────────────────────────────────────────

const BCRYPT_ROUNDS        = 12;
const ISSUER               = 'aneh-hashoel';
const ACCESS_TOKEN_EXPIRY  = '15m';
const REFRESH_TOKEN_EXPIRY = '30d';
const REFRESH_TTL_MS       = 30 * 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_SEC  = 60 * 60;          // 1 hour Redis TTL
const RESET_TOKEN_PREFIX   = 'pwd_reset:';     // Redis key namespace
const DEVICE_HISTORY_WINDOW = 5;               // sessions to inspect for novelty detection

// ─── hashToken ────────────────────────────────────────────────────────────────

/**
 * SHA-256 hex digest of a raw token string.
 * Raw tokens are never persisted in the DB or Redis.
 *
 * @param {string} raw
 * @returns {string}  64-char hex string
 */
function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ─── validatePasswordPolicy ───────────────────────────────────────────────────

/**
 * Enforce password policy:
 *   - At least 8 characters
 *   - At least one uppercase letter
 *   - At least one digit
 *   - At least one special character (!@#$%^&*…)
 *
 * @param {string} password
 * @returns {{ valid: boolean, error?: string }}
 */
function validatePasswordPolicy(password) {
  if (!password || password.length < 8) {
    return { valid: false, error: 'הסיסמה חייבת להכיל לפחות 8 תווים' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'הסיסמה חייבת להכיל לפחות אות גדולה אחת באנגלית' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'הסיסמה חייבת להכיל לפחות ספרה אחת' };
  }
  if (!/[!@#$%^&*()\-_=+\[\]{}|;:'",.<>/?`~\\]/.test(password)) {
    return { valid: false, error: 'הסיסמה חייבת להכיל לפחות תו מיוחד אחד (למשל: !@#$%)' };
  }
  return { valid: true };
}

// ─── createTokens ─────────────────────────────────────────────────────────────

/**
 * Sign a JWT access token (15 min) and a raw refresh token (30 days).
 * Persists the refresh token hash to the sessions table.
 *
 * @param {string|number}  rabbiId
 * @param {string}         role         'rabbi' | 'admin'
 * @param {object}         [deviceInfo] { ip, userAgent }
 * @returns {Promise<{ accessToken: string, refreshToken: string, sessionId: string }>}
 */
async function createTokens(rabbiId, role, deviceInfo = {}) {
  if (!rabbiId || !role) {
    const e = new Error('createTokens: rabbiId ו-role נדרשים');
    e.status = 500;
    throw e;
  }

  const jwtSecret = _requireEnv('JWT_SECRET');

  const accessToken = jwt.sign(
    { sub: String(rabbiId), role },
    jwtSecret,
    { expiresIn: ACCESS_TOKEN_EXPIRY, issuer: ISSUER }
  );

  const rawRefresh  = crypto.randomBytes(48).toString('hex');
  const tokenHash   = hashToken(rawRefresh);
  const expiresAt   = new Date(Date.now() + REFRESH_TTL_MS);

  const deviceInfoPayload = {
    ip:          deviceInfo.ip        || null,
    ua:          deviceInfo.userAgent || null,
    location:    deviceInfo.location  || null,
    lastSeenAt:  new Date().toISOString(),
  };

  const { rows } = await db(
    `INSERT INTO sessions
       (rabbi_id, refresh_token_hash, device_info, created_at, expires_at, is_revoked)
     VALUES ($1, $2, $3::jsonb, NOW(), $4, false)
     RETURNING id`,
    [
      rabbiId,
      tokenHash,
      JSON.stringify(deviceInfoPayload),
      expiresAt,
    ]
  );

  return { accessToken, refreshToken: rawRefresh, sessionId: rows[0].id };
}

// ─── loginRabbi ───────────────────────────────────────────────────────────────

/**
 * Validate email + password credentials, enforce account status checks,
 * create a session, and return tokens.
 *
 * If the login originates from a new device (detectNewDevice = true), emits
 * notification:newDeviceAlert via the Socket.IO instance stored on the app
 * and sends a security alert email.
 *
 * @param {string} email
 * @param {string} password
 * @param {object} [deviceInfo]   { ip, userAgent }
 * @param {object} [app]          Express app instance (for Socket.IO io access)
 * @returns {Promise<{ accessToken: string, refreshToken: string, sessionId: string, rabbi: object }>}
 */
async function loginRabbi(email, password, deviceInfo = {}, app = null) {
  if (!email || !password) {
    const e = new Error('אימייל וסיסמה נדרשים');
    e.status = 400;
    throw e;
  }

  const { rows } = await db(
    `SELECT id, email, name, role, password_hash, status,
            is_vacation, must_change_password, two_fa_enabled,
            signature, photo_url, last_login
     FROM   rabbis
     WHERE  email = $1
     LIMIT  1`,
    [email.toLowerCase().trim()]
  );

  const rabbi = rows[0];

  // Constant-time-ish: always run bcrypt to avoid timing oracle even on miss
  const dummyHash = '$2a$12$invalidhashfortimingprotection00000000000000000000000000';
  const candidateHash = rabbi ? (rabbi.password_hash || dummyHash) : dummyHash;
  const passwordMatch = await bcrypt.compare(password, candidateHash);

  if (!rabbi || !passwordMatch) {
    const e = new Error('אימייל או סיסמה שגויים');
    e.status = 401;
    throw e;
  }

  if (rabbi.status !== 'active') {
    const e = new Error('החשבון אינו פעיל — פנה למנהל המערכת');
    e.status = 403;
    throw e;
  }

  const isNewDevice = await detectNewDevice(rabbi.id, deviceInfo);

  const { accessToken, refreshToken, sessionId } = await createTokens(
    rabbi.id,
    rabbi.role,
    deviceInfo
  );

  // Fire-and-forget: update last_login, emit new-device alert
  updateLastLogin(rabbi.id).catch((err) =>
    console.error('[authService] updateLastLogin error:', err.message)
  );

  if (isNewDevice) {
    _emitNewDeviceAlert(app, rabbi, deviceInfo);
  }

  return {
    accessToken,
    refreshToken,
    sessionId,
    rabbi: _safeProfile(rabbi),
    isNewDevice,
  };
}

// ─── refreshTokens ────────────────────────────────────────────────────────────

/**
 * Validate a raw refresh token, rotate it (delete old session, create new),
 * and issue a new access token.
 *
 * Implements full rotation: each refresh token can be used exactly once.
 * Detected reuse (token already revoked) revokes all sessions for the rabbi
 * as a theft-response.
 *
 * @param {string} rawRefreshToken
 * @param {object} [deviceInfo]
 * @returns {Promise<{ accessToken: string, refreshToken: string, sessionId: string }>}
 */
async function refreshTokens(rawRefreshToken, deviceInfo = {}) {
  if (!rawRefreshToken) {
    const e = new Error('טוקן רענון נדרש');
    e.status = 400;
    throw e;
  }

  const tokenHash = hashToken(rawRefreshToken);

  const { rows } = await db(
    `SELECT s.id AS session_id, s.rabbi_id, s.is_revoked, s.expires_at, r.role
     FROM   sessions s
     JOIN   rabbis   r ON r.id = s.rabbi_id
     WHERE  s.refresh_token_hash = $1
     LIMIT  1`,
    [tokenHash]
  );

  const session = rows[0];

  if (!session) {
    const e = new Error('טוקן רענון אינו תקין');
    e.status = 401;
    throw e;
  }

  // Reuse detection: token was already revoked → possible theft → nuke all sessions
  if (session.is_revoked) {
    await revokeAllSessions(session.rabbi_id);
    const e = new Error('טוקן רענון שומש כבר — כל ההתחברויות בוטלו מטעמי אבטחה');
    e.status = 401;
    throw e;
  }

  if (new Date(session.expires_at) < new Date()) {
    const e = new Error('פג תוקף טוקן הרענון — נדרשת התחברות מחדש');
    e.status = 401;
    throw e;
  }

  // Revoke the old session token (rotation)
  await db(
    `UPDATE sessions SET is_revoked = true WHERE id = $1`,
    [session.session_id]
  );

  // Issue a new token pair
  const { accessToken, refreshToken: newRefresh, sessionId } = await createTokens(
    session.rabbi_id,
    session.role,
    deviceInfo
  );

  return { accessToken, refreshToken: newRefresh, sessionId };
}

// ─── handleGoogleOAuth ────────────────────────────────────────────────────────

/**
 * Find or associate a rabbi account by Google profile.
 * Does NOT auto-create accounts — an admin must first register the rabbi.
 * On first Google sign-in, associates the google_id with the existing account
 * (matched by email). Subsequent logins use google_id directly.
 *
 * @param {{ id: string, email: string, displayName: string, photo?: string }} googleProfile
 * @param {object} [deviceInfo]
 * @param {object} [app]
 * @returns {Promise<{ accessToken: string, refreshToken: string, sessionId: string, rabbi: object }>}
 */
async function handleGoogleOAuth(googleProfile, deviceInfo = {}, app = null) {
  if (!googleProfile || !googleProfile.id) {
    const e = new Error('פרופיל Google אינו תקין');
    e.status = 400;
    throw e;
  }

  // Try to find by google_id first (returning user)
  let { rows } = await db(
    `SELECT id, email, name, role, status, is_vacation,
            must_change_password, signature, photo_url, last_login
     FROM   rabbis
     WHERE  google_id = $1
     LIMIT  1`,
    [googleProfile.id]
  );

  let rabbi = rows[0];

  // First-time Google login: associate by email
  if (!rabbi && googleProfile.email) {
    const emailResult = await db(
      `UPDATE rabbis
       SET    google_id = $1,
              photo_url = COALESCE(photo_url, $2)
       WHERE  email     = $3
         AND  google_id IS NULL
       RETURNING id, email, name, role, status, is_vacation,
                 must_change_password, signature, photo_url, last_login`,
      [googleProfile.id, googleProfile.photo || null, googleProfile.email.toLowerCase()]
    );
    rabbi = emailResult.rows[0];
  }

  if (!rabbi) {
    const e = new Error('חשבון Google זה אינו מקושר לרב במערכת — פנה למנהל');
    e.status = 403;
    throw e;
  }

  if (rabbi.status !== 'active') {
    const e = new Error('החשבון אינו פעיל — פנה למנהל המערכת');
    e.status = 403;
    throw e;
  }

  const isNewDevice = await detectNewDevice(rabbi.id, deviceInfo);

  const { accessToken, refreshToken, sessionId } = await createTokens(
    rabbi.id,
    rabbi.role,
    deviceInfo
  );

  updateLastLogin(rabbi.id).catch(() => {});

  if (isNewDevice) {
    _emitNewDeviceAlert(app, rabbi, deviceInfo);
  }

  return {
    accessToken,
    refreshToken,
    sessionId,
    rabbi: _safeProfile(rabbi),
    isNewDevice,
  };
}

// ─── sendPasswordReset ────────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure password-reset token, store its hash
 * in Redis with a 1-hour TTL, and send the reset email.
 *
 * The caller receives no indication of whether the email was found (prevents
 * email enumeration) — always resolves successfully.
 *
 * @param {string} email
 * @returns {Promise<void>}
 */
async function sendPasswordReset(email) {
  if (!email) return;

  const normalizedEmail = email.toLowerCase().trim();

  const { rows } = await db(
    `SELECT id, name, email FROM rabbis WHERE email = $1 LIMIT 1`,
    [normalizedEmail]
  );

  const rabbi = rows[0];
  if (!rabbi) {
    // Anti-enumeration: silently return
    return;
  }

  // Generate 32-byte (256-bit) token
  const rawToken  = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const redisKey  = `${RESET_TOKEN_PREFIX}${tokenHash}`;

  // Store rabbi_id in Redis, keyed by token hash, with 1-hour TTL
  await redis.setEx(redisKey, RESET_TOKEN_TTL_SEC, String(rabbi.id));

  const resetUrl = `${_frontendUrl()}/reset-password?token=${rawToken}`;

  // Send email — errors are logged but not re-thrown (anti-enumeration)
  try {
    await _sendResetEmail(rabbi, resetUrl);
  } catch (emailErr) {
    console.error('[authService] sendPasswordReset email error:', emailErr.message);
  }
}

// ─── resetPassword ────────────────────────────────────────────────────────────

/**
 * Validate a raw password-reset token from Redis, enforce zxcvbn strength
 * (score >= 3), hash the new password, update the DB, revoke all sessions,
 * and delete the Redis key.
 *
 * @param {string} rawToken
 * @param {string} newPassword
 * @returns {Promise<void>}
 */
async function resetPassword(rawToken, newPassword) {
  if (!rawToken || !newPassword) {
    const e = new Error('טוקן וסיסמה חדשה נדרשים');
    e.status = 400;
    throw e;
  }

  // Enforce password policy (length + complexity)
  const policyCheck = validatePasswordPolicy(newPassword);
  if (!policyCheck.valid) {
    const e = new Error(policyCheck.error);
    e.status = 400;
    throw e;
  }

  // zxcvbn strength check (score 0-4, require >= 3)
  const strength = zxcvbn(newPassword);
  if (strength.score < 3) {
    const feedback =
      (strength.feedback.warning ? `${strength.feedback.warning}. ` : '') +
      (strength.feedback.suggestions.join(' ') || 'בחר סיסמה חזקה יותר');
    const e = new Error(`הסיסמה חלשה מדי — ${feedback}`);
    e.status = 400;
    throw e;
  }

  // Look up token hash in Redis
  const tokenHash = hashToken(rawToken);
  const redisKey  = `${RESET_TOKEN_PREFIX}${tokenHash}`;
  const rabbiId   = await redis.get(redisKey);

  if (!rabbiId) {
    const e = new Error('קישור איפוס הסיסמה אינו תקין או שפג תוקפו');
    e.status = 400;
    throw e;
  }

  const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  // Atomic: update password + revoke all sessions
  const { client, release } = await getClient();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE rabbis
       SET    password_hash        = $1,
              must_change_password = false,
              updated_at           = NOW()
       WHERE  id = $2`,
      [newHash, rabbiId]
    );

    await client.query(
      `UPDATE sessions
       SET    is_revoked = true
       WHERE  rabbi_id  = $1 AND is_revoked = false`,
      [rabbiId]
    );

    await client.query('COMMIT');
  } catch (txErr) {
    await client.query('ROLLBACK');
    throw txErr;
  } finally {
    release();
  }

  // Delete the Redis key so the token cannot be reused
  await redis.del(redisKey);
}

// ─── detectNewDevice ──────────────────────────────────────────────────────────

/**
 * Determine whether the current request is from a device new to this rabbi.
 * Compares the request's User-Agent against the last DEVICE_HISTORY_WINDOW
 * sessions stored in the DB.
 *
 * Never throws — detection is advisory and must not break the login flow.
 *
 * @param {string|number} rabbiId
 * @param {{ ip: string, userAgent: string }} deviceInfo
 * @returns {Promise<boolean>}  true when the device appears new
 */
async function detectNewDevice(rabbiId, deviceInfo) {
  try {
    const { rows } = await db(
      `SELECT device_info
       FROM   sessions
       WHERE  rabbi_id = $1
       ORDER  BY created_at DESC
       LIMIT  $2`,
      [rabbiId, DEVICE_HISTORY_WINDOW]
    );

    if (rows.length === 0) {
      // First-ever session — considered new
      return true;
    }

    const currentUa = (deviceInfo.userAgent || '').trim();
    const currentIp = (deviceInfo.ip || '').trim();

    const isKnown = rows.some((row) => {
      const info = row.device_info || {};
      return (
        (info.ua   || '').trim() === currentUa &&
        (info.ip   || '').trim() === currentIp
      );
    });

    return !isKnown;
  } catch (err) {
    console.error('[authService] detectNewDevice error:', err.message);
    return false;
  }
}

// ─── Session management ───────────────────────────────────────────────────────

/**
 * Revoke a single session by its ID, scoped to a rabbi for ownership safety.
 *
 * @param {string} sessionId
 * @param {string|number} rabbiId
 * @returns {Promise<boolean>}  true if a session was actually revoked
 */
async function revokeSession(sessionId, rabbiId) {
  if (!sessionId || !rabbiId) return false;
  const { rowCount } = await db(
    `UPDATE sessions
     SET    is_revoked = true
     WHERE  id        = $1
       AND  rabbi_id  = $2
       AND  is_revoked = false`,
    [sessionId, rabbiId]
  );
  return (rowCount || 0) > 0;
}

/**
 * Revoke a single session by its token hash.
 * Used during logout when only the raw refresh token is available.
 *
 * @param {string} tokenHash  SHA-256 hex hash of the raw refresh token
 * @returns {Promise<void>}
 */
async function revokeSessionByTokenHash(tokenHash) {
  if (!tokenHash) return;
  await db(
    `UPDATE sessions SET is_revoked = true WHERE refresh_token_hash = $1`,
    [tokenHash]
  );
}

/**
 * Revoke every active session for a rabbi.
 *
 * @param {string|number} rabbiId
 * @returns {Promise<number>}  Number of sessions revoked
 */
async function revokeAllSessions(rabbiId) {
  if (!rabbiId) return 0;
  const { rowCount } = await db(
    `UPDATE sessions
     SET    is_revoked = true
     WHERE  rabbi_id  = $1
       AND  is_revoked = false`,
    [rabbiId]
  );
  return rowCount || 0;
}

/**
 * Return all non-revoked, non-expired sessions for a rabbi.
 *
 * @param {string|number} rabbiId
 * @returns {Promise<Array>}
 */
async function listActiveSessions(rabbiId) {
  const { rows } = await db(
    `SELECT id, device_info, created_at, expires_at
     FROM   sessions
     WHERE  rabbi_id   = $1
       AND  is_revoked = false
       AND  expires_at > NOW()
     ORDER  BY created_at DESC`,
    [rabbiId]
  );
  return rows.map((s) => ({
    id:         s.id,
    deviceInfo: s.device_info || {},
    ip:         (s.device_info || {}).ip   || null,
    userAgent:  (s.device_info || {}).ua   || null,
    createdAt:  s.created_at,
    expiresAt:  s.expires_at,
  }));
}

/**
 * Fetch a specific session by ID, scoped to a rabbi (ownership check).
 *
 * @param {string} sessionId
 * @param {string|number} rabbiId
 * @returns {Promise<object|null>}
 */
async function getSessionById(sessionId, rabbiId) {
  const { rows } = await db(
    `SELECT id, device_info, created_at, expires_at, is_revoked
     FROM   sessions
     WHERE  id       = $1
       AND  rabbi_id = $2`,
    [sessionId, rabbiId]
  );
  return rows[0] || null;
}

// ─── updateLastLogin ──────────────────────────────────────────────────────────

/**
 * Stamp the rabbi's last_login column with the current UTC time.
 *
 * @param {string|number} rabbiId
 * @returns {Promise<void>}
 */
async function updateLastLogin(rabbiId) {
  try {
    await db(
      `UPDATE rabbis SET last_login = NOW() WHERE id = $1`,
      [rabbiId]
    );
  } catch (err) {
    console.error('[authService] updateLastLogin error:', err.message);
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function _requireEnv(name) {
  const val = process.env[name];
  if (!val) {
    const e = new Error(`[authService] חסר משתנה סביבה: ${name}`);
    e.status = 500;
    throw e;
  }
  return val;
}

function _frontendUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function _appUrl() {
  return (process.env.APP_URL || _frontendUrl()).replace(/\/$/, '');
}

/**
 * Build the safe rabbi profile object returned to clients.
 * Never exposes password_hash, google_id, or other sensitive fields.
 *
 * @param {object} rabbi  DB row
 * @returns {object}
 */
function _safeProfile(rabbi) {
  return {
    id:                 rabbi.id,
    email:              rabbi.email,
    name:               rabbi.name,
    role:               rabbi.role,
    signature:          rabbi.signature           || null,
    photoUrl:           rabbi.photo_url           || null,
    isVacation:         rabbi.is_vacation         ?? false,
    mustChangePassword: rabbi.must_change_password ?? false,
    status:             rabbi.status              || 'active',
    lastLogin:          rabbi.last_login          || null,
  };
}

/**
 * Escape HTML entities so untrusted strings (e.g., user-agent) are safe
 * to embed in email templates.
 *
 * @param {string} str
 * @returns {string}
 */
function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build and send the password-reset email.
 *
 * @param {{ id: string, name: string, email: string }} rabbi
 * @param {string} resetUrl
 */
async function _sendResetEmail(rabbi, resetUrl) {
  const bodyContent = `
    <p style="margin: 0 0 12px; font-size: 15px;">שלום ${_esc(rabbi.name || 'רב')},</p>
    <p style="margin: 0 0 12px; font-size: 15px;">
      קיבלנו בקשה לאיפוס הסיסמה לחשבונך במערכת "ענה את השואל".
    </p>
    <p style="margin: 0 0 12px; font-size: 15px;">
      לחץ/י על הכפתור למטה כדי לבחור סיסמה חדשה. הקישור תקף ל-60 דקות בלבד.
    </p>
    <p style="margin: 20px 0 8px; color: #cc4444; font-size: 13px;">
      אם לא ביקשת איפוס סיסמה, ניתן להתעלם ממייל זה לחלוטין.
    </p>
  `;

  const html = createEmailHTML('איפוס סיסמה', bodyContent, [
    { label: 'איפוס סיסמה', url: resetUrl, color: BRAND_GOLD },
  ]);

  await sendEmail(rabbi.email, 'איפוס סיסמה — ענה את השואל', html);
}

/**
 * Build and send the new-device security alert email.
 *
 * @param {{ id: string, name: string, email: string }} rabbi
 * @param {{ ip: string, userAgent: string }} deviceInfo
 */
async function _sendNewDeviceAlertEmail(rabbi, deviceInfo) {
  const timestamp  = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
  const securityUrl = `${_appUrl()}/settings/security`;

  const bodyContent = `
    <p style="margin: 0 0 12px; font-size: 15px;">שלום ${_esc(rabbi.name || 'רב')},</p>
    <p style="margin: 0 0 16px; font-size: 15px;">
      זוהתה כניסה לחשבונך ממכשיר שלא היה מוכר עד כה:
    </p>
    <div style="
      background-color: #fff8f0;
      border-right: 4px solid #e67e22;
      padding: 16px 20px;
      margin: 16px 0;
      border-radius: 4px;
    ">
      <table role="presentation" cellpadding="4" cellspacing="0"
             style="width:100%; font-size:14px;">
        <tr>
          <td style="color:#888; white-space:nowrap; padding-left:12px;">זמן:</td>
          <td style="color:#333; font-weight:500;">${_esc(timestamp)}</td>
        </tr>
        <tr>
          <td style="color:#888; white-space:nowrap; padding-left:12px;">כתובת IP:</td>
          <td style="color:#333; font-weight:500;">${_esc(deviceInfo.ip || 'לא ידוע')}</td>
        </tr>
        <tr>
          <td style="color:#888; white-space:nowrap; padding-left:12px;">דפדפן/מכשיר:</td>
          <td style="color:#333; font-weight:500;">${_esc((deviceInfo.userAgent || 'לא ידוע').slice(0, 120))}</td>
        </tr>
      </table>
    </div>
    <p style="margin: 16px 0 0; color: #cc4444; font-size: 14px; font-weight: bold;">
      אם לא אתה התחברת — שנה את הסיסמה שלך מיד ופנה למנהל המערכת.
    </p>
  `;

  const html = createEmailHTML('כניסה ממכשיר חדש', bodyContent, [
    { label: 'שנה סיסמה', url: securityUrl, color: '#cc4444' },
  ]);

  await sendEmail(rabbi.email, 'התראת אבטחה: כניסה ממכשיר חדש — ענה את השואל', html);
}

/**
 * Fire-and-forget: emit socket notification + send email alert for new device.
 * Never throws — must not disrupt the login flow.
 *
 * @param {object|null} app       Express app (for io access)
 * @param {object}      rabbi     { id, name, email }
 * @param {object}      deviceInfo { ip, userAgent }
 */
function _emitNewDeviceAlert(app, rabbi, deviceInfo) {
  setImmediate(async () => {
    // Socket.IO notification
    try {
      const io = app ? app.get('io') : null;
      if (io) {
        io.to(`rabbi:${rabbi.id}`).emit('notification:newDeviceAlert', {
          rabbiId:   rabbi.id,
          ip:        deviceInfo.ip,
          userAgent: deviceInfo.userAgent,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (socketErr) {
      console.error('[authService] newDeviceAlert socket error:', socketErr.message);
    }

    // Email alert
    try {
      await _sendNewDeviceAlertEmail(rabbi, deviceInfo);
    } catch (emailErr) {
      console.error('[authService] newDeviceAlert email error:', emailErr.message);
    }
  });
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Core auth flows
  loginRabbi,
  createTokens,
  refreshTokens,
  handleGoogleOAuth,

  // Password management
  sendPasswordReset,
  resetPassword,
  validatePasswordPolicy,

  // Device detection
  detectNewDevice,

  // Session management
  revokeSession,
  revokeSessionByTokenHash,
  revokeAllSessions,
  listActiveSessions,
  getSessionById,

  // Profile
  updateLastLogin,

  // Utilities
  hashToken,
  BCRYPT_ROUNDS,
};
