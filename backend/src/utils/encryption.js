'use strict';

/**
 * PII Encryption / Decryption  –  AES-256-GCM
 *
 * AES-256-GCM provides both confidentiality and authenticity (AEAD).
 * Each encryption produces a unique random IV and a 16-byte authentication
 * tag.  All three components are stored together as a colon-separated string:
 *
 *   <iv_hex>:<authTag_hex>:<ciphertext_hex>
 *
 * Environment variable required:
 *   ENCRYPTION_KEY  – exactly 32 ASCII characters (256-bit key)
 *
 * Export surface:
 *   encrypt(text)              → "iv:authTag:ciphertext"  string
 *   decrypt(encrypted)         → plaintext string
 *   encryptField(value)        → null-safe encrypt
 *   decryptField(encrypted)    → null-safe decrypt
 */

const crypto = require('crypto');

const ALGORITHM    = 'aes-256-gcm';
const IV_LENGTH    = 12;  // 96-bit IV is the GCM standard / NIST recommendation
const TAG_LENGTH   = 16;  // 128-bit authentication tag

// ─── Key resolution ──────────────────────────────────────────────────────────

/**
 * Resolve and validate ENCRYPTION_KEY from the environment.
 * Throws early with a descriptive Hebrew message rather than crashing later.
 *
 * @returns {Buffer} 32-byte key buffer
 */
function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || raw.length !== 32) {
    throw new Error(
      'ENCRYPTION_KEY חייב להיות בדיוק 32 תווים (256 סיביות). ' +
      'ערך חסר או באורך שגוי.'
    );
  }
  return Buffer.from(raw, 'utf8');
}

// ─── encrypt ─────────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * @param {string} text  – the value to encrypt (must be a non-null string)
 * @returns {string}     – "iv_hex:authTag_hex:ciphertext_hex"
 * @throws {TypeError}   when text is not a string
 * @throws {Error}       when ENCRYPTION_KEY is not configured
 */
function encrypt(text) {
  if (typeof text !== 'string') {
    throw new TypeError('encrypt: הערך חייב להיות מחרוזת');
  }

  const key    = getKey();
  const iv     = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':');
}

// ─── decrypt ─────────────────────────────────────────────────────────────────

/**
 * Decrypt a value produced by encrypt().
 *
 * @param {string} encrypted  – "iv_hex:authTag_hex:ciphertext_hex"
 * @returns {string}          – the original plaintext
 * @throws {TypeError}        when the argument is not a properly formatted string
 * @throws {Error}            when authentication fails (data tampered) or key is wrong
 */
function decrypt(encrypted) {
  if (typeof encrypted !== 'string') {
    throw new TypeError('decrypt: הערך המוצפן חייב להיות מחרוזת');
  }

  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new TypeError(
      'decrypt: פורמט לא תקין — נדרש "iv:authTag:ciphertext"'
    );
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;

  let iv, authTag, ciphertextBuffer;
  try {
    iv               = Buffer.from(ivHex,         'hex');
    authTag          = Buffer.from(authTagHex,    'hex');
    ciphertextBuffer = Buffer.from(ciphertextHex, 'hex');
  } catch {
    throw new TypeError('decrypt: הערכים המוצפנים מכילים תווים לא-חוקיים');
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

  const key      = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });

  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertextBuffer),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    // GCM auth failure surfaces here — do NOT expose key details
    throw new Error(
      'decrypt: אימות הצפנה נכשל — הנתונים עלולים להיות פגומים או שונו'
    );
  }
}

// ─── Null-safe wrappers ───────────────────────────────────────────────────────

/**
 * Null-safe encryption wrapper for optional PII fields.
 * Returns null when the value is absent or an empty string.
 *
 * @param {string|null|undefined} value
 * @returns {string|null}  – "iv:authTag:ciphertext" or null
 */
function encryptField(value) {
  if (value == null || value === '') {
    return null;
  }
  return encrypt(String(value));
}

/**
 * Null-safe decryption wrapper.
 * Returns null when the argument is absent (field was never set).
 *
 * @param {string|null|undefined} encrypted  – "iv:authTag:ciphertext" or null
 * @returns {string|null}
 */
function decryptField(encrypted) {
  if (encrypted == null) {
    return null;
  }
  return decrypt(encrypted);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  encrypt,
  decrypt,
  encryptField,
  decryptField,
};
