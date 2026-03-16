/**
 * Crypto Utilities  –  src/utils/crypto.js
 *
 * AES-256-GCM encryption, SHA-256 hashing, secure token generation,
 * and JWT-signed action links.
 *
 * Environment variables required:
 *   ENCRYPTION_KEY      – exactly 32 hex characters (128-bit hex → 64 chars for 256-bit)
 *                         OR exactly 32 UTF-8 characters (256-bit key).
 *                         The value is accepted as-is if it decodes to 32 bytes.
 *   ACTION_LINK_SECRET  – any non-empty string; used to sign action JWTs.
 *
 * Exports:
 *   encrypt(text)                          → base64 encoded "<iv>.<authTag>.<ciphertext>"
 *   decrypt(encryptedStr)                  → original plaintext string
 *   hashToken(token)                       → SHA-256 hex digest
 *   generateToken(bytes?)                  → crypto-random hex string (default 32 bytes)
 *   generateActionToken(payload, expiresIn?) → signed JWT string
 *   verifyActionToken(token)               → decoded payload object
 */

const crypto = require('crypto');
const jwt    = require('jsonwebtoken');

// ─── Constants ────────────────────────────────────────────────────────────────

const ALGORITHM    = 'aes-256-gcm';
const IV_LENGTH    = 12;  // 96-bit IV — NIST recommended length for GCM
const TAG_LENGTH   = 16;  // 128-bit authentication tag
const SEPARATOR    = '.'; // Separates iv / authTag / ciphertext in the encoded string

// ─── Key resolution ───────────────────────────────────────────────────────────

/**
 * Resolve ENCRYPTION_KEY from the environment to a 32-byte Buffer.
 *
 * Acceptance rules (in priority order):
 *   1. If the value is exactly 64 hex characters → treat as hex-encoded 32-byte key
 *   2. If the value is exactly 32 characters      → treat as raw UTF-8 32-byte key
 *   3. Otherwise → throw with a descriptive message
 *
 * The key is computed once and cached for the process lifetime.
 *
 * @returns {Buffer}
 */
let _cachedKey = null;
function getEncryptionKey() {
  if (_cachedKey) return _cachedKey;

  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY אינו מוגדר. ' +
      'הגדר 32 תווי UTF-8 או 64 תווי hex במשתני הסביבה.'
    );
  }

  let key;
  if (raw.length === 64 && /^[0-9a-fA-F]{64}$/.test(raw)) {
    // 64-char hex string → 32 raw bytes
    key = Buffer.from(raw, 'hex');
  } else if (raw.length === 32) {
    // 32 raw UTF-8 characters → 32 bytes
    key = Buffer.from(raw, 'utf8');
  } else {
    throw new Error(
      `ENCRYPTION_KEY באורך לא תקין (${raw.length} תווים). ` +
      'נדרש בדיוק 32 תווי UTF-8 או 64 תווי hex.'
    );
  }

  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY חייב להיות בדיוק 32 בתים (256 סיביות).');
  }

  _cachedKey = key;
  return _cachedKey;
}

/**
 * Return the ACTION_LINK_SECRET, throwing if it is absent.
 *
 * @returns {string}
 */
function getActionLinkSecret() {
  const s = process.env.ACTION_LINK_SECRET;
  if (!s) {
    throw new Error(
      'ACTION_LINK_SECRET אינו מוגדר במשתני הסביבה.'
    );
  }
  return s;
}

// ─── encrypt ──────────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * The output is a single base64-encoded string that encodes three components
 * joined by a period ("."):
 *   <iv_base64>.<authTag_base64>.<ciphertext_base64>
 *
 * A fresh random IV is generated per call, so encrypting the same plaintext
 * twice always yields different output.
 *
 * @param   {string} text   Plaintext to encrypt (must be a non-null string)
 * @returns {string}        Encoded "<iv>.<authTag>.<ciphertext>" in base64
 * @throws  {TypeError}     If text is not a string
 * @throws  {Error}         If ENCRYPTION_KEY is not configured correctly
 */
function encrypt(text) {
  if (typeof text !== 'string') {
    throw new TypeError(`encrypt: הערך חייב להיות מחרוזת, התקבל ${typeof text}`);
  }

  const key    = getEncryptionKey();
  const iv     = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Encode each component as base64 and join with the separator
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(SEPARATOR);
}

// ─── decrypt ──────────────────────────────────────────────────────────────────

/**
 * Decrypt a string produced by `encrypt()`.
 *
 * @param   {string} encryptedStr   "<iv_base64>.<authTag_base64>.<ciphertext_base64>"
 * @returns {string}                Original plaintext
 * @throws  {TypeError}             If encryptedStr is not a string or has wrong format
 * @throws  {Error}                 If GCM authentication fails (data tampered / wrong key)
 */
function decrypt(encryptedStr) {
  if (typeof encryptedStr !== 'string') {
    throw new TypeError(
      `decrypt: הערך המוצפן חייב להיות מחרוזת, התקבל ${typeof encryptedStr}`
    );
  }

  const parts = encryptedStr.split(SEPARATOR);
  if (parts.length !== 3) {
    throw new TypeError(
      `decrypt: פורמט לא תקין — נדרש "<iv>.<authTag>.<ciphertext>", ` +
      `התקבלו ${parts.length} חלקים`
    );
  }

  const [ivB64, authTagB64, ciphertextB64] = parts;

  let iv, authTag, ciphertextBuf;
  try {
    iv            = Buffer.from(ivB64,         'base64');
    authTag       = Buffer.from(authTagB64,    'base64');
    ciphertextBuf = Buffer.from(ciphertextB64, 'base64');
  } catch {
    throw new TypeError('decrypt: נתוני ה-base64 אינם תקינים');
  }

  if (iv.length !== IV_LENGTH) {
    throw new TypeError(
      `decrypt: אורך IV שגוי — נדרש ${IV_LENGTH} בתים, התקבל ${iv.length}`
    );
  }
  if (authTag.length !== TAG_LENGTH) {
    throw new TypeError(
      `decrypt: אורך תג אימות שגוי — נדרש ${TAG_LENGTH} בתים, התקבל ${authTag.length}`
    );
  }

  const key      = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertextBuf),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    // GCM authentication failure — do NOT expose key details or cause
    throw new Error(
      'decrypt: אימות ההצפנה נכשל — הנתונים עלולים להיות פגומים או שונו'
    );
  }
}

// ─── hashToken ────────────────────────────────────────────────────────────────

/**
 * Compute the SHA-256 hex digest of a raw token string.
 *
 * Use this to store refresh tokens, password-reset tokens, and email-
 * verification tokens in the database / Redis without persisting the raw
 * secret.  Always hash before storage; always hash before lookup.
 *
 * @param   {string} token   Raw token value (hex string or arbitrary string)
 * @returns {string}         64-character lowercase hex SHA-256 digest
 * @throws  {TypeError}      If token is not a string
 */
function hashToken(token) {
  if (typeof token !== 'string' || token.length === 0) {
    throw new TypeError('hashToken: הטוקן חייב להיות מחרוזת לא ריקה');
  }
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

// ─── generateToken ────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure random token.
 *
 * @param   {number} [bytes=32]  Number of random bytes (output hex length = bytes * 2)
 * @returns {string}             Hex-encoded random string (64 chars for the default 32 bytes)
 * @throws  {RangeError}         If bytes < 8 or bytes > 512
 */
function generateToken(bytes = 32) {
  if (typeof bytes !== 'number' || bytes < 8 || bytes > 512) {
    throw new RangeError('generateToken: bytes חייב להיות מספר בין 8 ל-512');
  }
  return crypto.randomBytes(bytes).toString('hex');
}

// ─── generateActionToken ──────────────────────────────────────────────────────

/**
 * Sign a payload as a JWT for use in email action links
 * (e.g. "claim question", "accept", "reject" buttons).
 *
 * The token is signed with ACTION_LINK_SECRET and defaults to a 24-hour TTL.
 * Include at minimum: { action, questionId } — add rabbiId where applicable.
 *
 * @param   {object} payload            Any JSON-serialisable payload object
 * @param   {string} [expiresIn='24h']  JWT `expiresIn` value (e.g. '1h', '7d', '30m')
 * @returns {string}                    Signed JWT string
 * @throws  {TypeError}                 If payload is not a plain object
 * @throws  {Error}                     If ACTION_LINK_SECRET is not configured
 */
function generateActionToken(payload, expiresIn = '24h') {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('generateActionToken: payload חייב להיות אובייקט');
  }

  return jwt.sign(payload, getActionLinkSecret(), {
    expiresIn,
    issuer: 'aneh-hashoel',
  });
}

// ─── verifyActionToken ────────────────────────────────────────────────────────

/**
 * Verify an action JWT and return its decoded payload.
 *
 * @param   {string} token   JWT string from an action link
 * @returns {object}         Decoded payload
 * @throws  {Error}          With .status 401 if the token is expired or invalid
 */
function verifyActionToken(token) {
  if (!token || typeof token !== 'string') {
    const err = new Error('verifyActionToken: טוקן נדרש');
    err.status = 401;
    throw err;
  }

  try {
    return jwt.verify(token, getActionLinkSecret(), { issuer: 'aneh-hashoel' });
  } catch (jwtErr) {
    const isExpired = jwtErr.name === 'TokenExpiredError';
    const err       = new Error(
      isExpired ? 'קישור הפעולה פג תוקף' : 'קישור הפעולה אינו תקין'
    );
    err.status = 401;
    throw err;
  }
}

module.exports = {
  encrypt,
  decrypt,
  hashToken,
  generateToken,
  generateActionToken,
  verifyActionToken,
};
