'use strict';

const crypto = require('crypto');
// pool.js exports { pool, query, getClient, ... }
const { query: dbQuery } = require('../db/pool');

// Notification service is resolved lazily to avoid circular dependency issues.
let _notificationService = null;
function getNotificationService() {
  if (!_notificationService) {
    _notificationService = require('./notificationService');
  }
  return _notificationService;
}

// ─── Fingerprint computation ──────────────────────────────────────────────────

/**
 * Compute a stable device fingerprint from request metadata.
 * Deliberately coarse-grained (UA + Accept-Language + IP) so that minor
 * browser version bumps do not create false positives.
 *
 * @param {import('express').Request} req
 * @returns {string}  SHA-256 hex digest (64 chars — fits device_fingerprint VARCHAR(64))
 */
function computeFingerprint(req) {
  const userAgent = req.headers['user-agent'] || '';
  const acceptLanguage = req.headers['accept-language'] || '';
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    '';

  const raw = [userAgent, acceptLanguage, ip].join('||');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ─── checkDevice ─────────────────────────────────────────────────────────────

/**
 * Check whether the current request originates from a known device for the rabbi.
 *
 * - New device  → INSERT row in `device_sessions`, send alert, return `{ isNew: true, fingerprint }`.
 * - Known device → UPDATE `last_seen`, return `{ isNew: false, fingerprint }`.
 *
 * Never throws — device detection is advisory and must not break the login flow.
 *
 * Schema reference (migration 001_initial.sql):
 *   device_sessions(id UUID, rabbi_id UUID, device_fingerprint VARCHAR(64),
 *                   ip VARCHAR(45), user_agent TEXT,
 *                   created_at TIMESTAMPTZ, last_seen TIMESTAMPTZ)
 *
 * @param {string|number} rabbiId
 * @param {import('express').Request} req
 * @returns {Promise<{ isNew: boolean, fingerprint: string }>}
 */
async function checkDevice(rabbiId, req) {
  const fingerprint = computeFingerprint(req);

  try {
    const { rows } = await dbQuery(
      `SELECT id FROM device_sessions
       WHERE rabbi_id = $1 AND device_fingerprint = $2`,
      [rabbiId, fingerprint]
    );

    if (rows[0]) {
      // Known device — refresh last_seen
      await dbQuery(
        `UPDATE device_sessions
         SET last_seen = NOW()
         WHERE id = $1`,
        [rows[0].id]
      );
      return { isNew: false, fingerprint };
    }

    // New device — record it
    const userAgent = req.headers['user-agent'] || 'לא ידוע';
    const ip =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      'לא ידוע';

    await dbQuery(
      `INSERT INTO device_sessions
         (rabbi_id, device_fingerprint, user_agent, ip, created_at, last_seen)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [rabbiId, fingerprint, userAgent, ip]
    );

    // Send alert — fire and forget; errors are logged but not surfaced
    setImmediate(async () => {
      try {
        const notificationService = getNotificationService();
        const { rows: rabbiRows } = await dbQuery(
          `SELECT email, name FROM rabbis WHERE id = $1`,
          [rabbiId]
        );

        if (rabbiRows[0]) {
          await notificationService.sendNewDeviceAlert(
            rabbiRows[0].email,
            rabbiRows[0].name,
            {
              userAgent,
              ip,
              timestamp: new Date().toLocaleString('he-IL', {
                timeZone: 'Asia/Jerusalem',
              }),
            }
          );
        }
      } catch (alertErr) {
        console.error('[deviceDetection] שגיאה בשליחת התראת מכשיר חדש:', alertErr.message);
      }
    });

    return { isNew: true, fingerprint };
  } catch (err) {
    // Never let device detection break the login flow
    console.error('[deviceDetection] שגיאה בבדיקת מכשיר:', err.message);
    return { isNew: false, fingerprint };
  }
}

module.exports = { checkDevice, computeFingerprint };
