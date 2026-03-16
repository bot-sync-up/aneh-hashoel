'use strict';

/**
 * Mailgun Webhook Signature Verification
 *
 * Mailgun signs every webhook POST with an HMAC-SHA256 signature so we can
 * verify authenticity.  The three components arrive as form fields:
 *   - timestamp  (Unix epoch string)
 *   - token      (random string)
 *   - signature  (hex-encoded HMAC)
 *
 * Verification:  HMAC-SHA256(timestamp + token, MAILGUN_API_KEY) === signature
 *
 * Additionally we reject timestamps older than 5 minutes to prevent replay
 * attacks (Mailgun recommends this).
 *
 * Environment variable required:
 *   MAILGUN_API_KEY  – your Mailgun account API key
 *
 * Export surface:
 *   verifyMailgunSignature(timestamp, token, signature) → boolean
 */

const crypto = require('crypto');

/** Maximum age (in seconds) of a webhook before we consider it stale. */
const MAX_AGE_SECONDS = 5 * 60; // 5 minutes

/**
 * Return the Mailgun API key from the environment.
 * Throws at call-time (not module-load) so tests can set the env var later.
 *
 * @returns {string}
 */
function getApiKey() {
  const key = process.env.MAILGUN_API_KEY;
  if (!key) {
    throw new Error('[mailgunVerify] MAILGUN_API_KEY לא מוגדר בסביבה');
  }
  return key;
}

/**
 * Verify Mailgun webhook authenticity using HMAC-SHA256.
 *
 * @param {string} timestamp  – Unix epoch string from the webhook payload
 * @param {string} token      – random string from the webhook payload
 * @param {string} signature  – hex-encoded HMAC from the webhook payload
 * @returns {boolean}           true if the signature is valid and fresh
 */
function verifyMailgunSignature(timestamp, token, signature) {
  if (!timestamp || !token || !signature) {
    return false;
  }

  // ── Replay-attack guard ──
  const now = Math.floor(Date.now() / 1000);
  const ts  = parseInt(timestamp, 10);

  if (Number.isNaN(ts) || Math.abs(now - ts) > MAX_AGE_SECONDS) {
    return false;
  }

  // ── HMAC verification ──
  const apiKey       = getApiKey();
  const data         = timestamp + token;
  const expectedHmac = crypto
    .createHmac('sha256', apiKey)
    .update(data)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedHmac, 'hex'),
      Buffer.from(signature, 'hex')
    );
  } catch {
    // Buffers with different lengths throw — that means mismatch
    return false;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  verifyMailgunSignature,
};
