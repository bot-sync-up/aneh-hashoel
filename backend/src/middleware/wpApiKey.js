'use strict';

/**
 * WordPress API Key Verification Middleware
 *
 * Verifies that incoming webhook requests from WordPress carry a valid
 * API key in the `x-api-key` header.  The expected key is read from
 * the WP_API_KEY environment variable.
 *
 * Usage:
 *   const { verifyWpApiKey } = require('../middleware/wpApiKey');
 *   router.post('/webhook', verifyWpApiKey, handler);
 */

/**
 * Express middleware that rejects requests whose `x-api-key` header
 * does not match the configured WP_API_KEY environment variable.
 *
 * @type {import('express').RequestHandler}
 */
function verifyWpApiKey(req, res, next) {
  const expectedKey = process.env.WP_API_KEY;

  if (!expectedKey) {
    console.error('[wpApiKey] WP_API_KEY לא מוגדר בסביבת הריצה');
    return res.status(500).json({ error: 'שגיאת תצורת שרת' });
  }

  const providedKey = req.headers['x-api-key'];

  if (!providedKey) {
    return res.status(401).json({ error: 'מפתח API חסר' });
  }

  if (providedKey !== expectedKey) {
    return res.status(403).json({ error: 'מפתח API אינו תקין' });
  }

  return next();
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  verifyWpApiKey,
};
