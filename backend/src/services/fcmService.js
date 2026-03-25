'use strict';

/**
 * FCM Push Notification Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Sends Firebase Cloud Messaging push notifications to rabbis.
 *
 * Feature-flagged: if FIREBASE_PROJECT_ID is not set, all sends are skipped
 * silently.  This allows the infrastructure to be deployed and activated later
 * by adding Firebase credentials to the environment.
 *
 * Required env vars (when active):
 *   FIREBASE_PROJECT_ID       – Firebase project ID
 *   FIREBASE_CLIENT_EMAIL     – Service account email
 *   FIREBASE_PRIVATE_KEY      – Service account private key (PEM, \n escaped)
 */

const { query } = require('../db/pool');

// ── Firebase Admin SDK (lazy-loaded) ─────────────────────────────────────────

let _admin = null;

function _getAdmin() {
  if (_admin) return _admin;

  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    return null; // Not configured — silently disabled
  }

  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      });
    }
    _admin = admin;
    return _admin;
  } catch (err) {
    console.warn('[fcmService] firebase-admin not available:', err.message);
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send a push notification to all rabbis who have registered a FCM token.
 *
 * @param {object} question – question row from DB
 * @returns {Promise<void>}
 */
async function notifyNewQuestion(question) {
  const admin = _getAdmin();
  if (!admin) {
    // FCM not configured — skip silently
    return;
  }

  // Fetch all non-null FCM tokens
  let tokens;
  try {
    const { rows } = await query(
      `SELECT fcm_token FROM rabbis WHERE fcm_token IS NOT NULL AND is_active = true`
    );
    tokens = rows.map((r) => r.fcm_token).filter(Boolean);
  } catch (err) {
    console.warn('[fcmService] failed to fetch FCM tokens:', err.message);
    return;
  }

  if (!tokens.length) return;

  const isUrgent = question.urgency === 'critical' || question.urgency === 'high' || question.is_urgent;
  const body     = isUrgent
    ? `\u26A1 דחוף: ${question.title || 'שאלה חדשה'}`
    : (question.title || 'שאלה חדשה');

  const message = {
    notification: {
      title: 'שאלה חדשה',
      body,
    },
    data: {
      type:       'new_question',
      questionId: String(question.id || ''),
      url:        `/questions/${question.id || ''}`,
    },
    tokens,
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(
      `[fcmService] sent to ${tokens.length} tokens — ` +
      `success=${response.successCount} fail=${response.failureCount}`
    );

    // Clean up invalid tokens
    if (response.failureCount > 0) {
      const invalidTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const code = resp.error?.code;
          if (
            code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token'
          ) {
            invalidTokens.push(tokens[idx]);
          }
        }
      });
      if (invalidTokens.length) {
        await query(
          `UPDATE rabbis SET fcm_token = NULL WHERE fcm_token = ANY($1::text[])`,
          [invalidTokens]
        ).catch((e) => console.warn('[fcmService] token cleanup failed:', e.message));
      }
    }
  } catch (err) {
    console.warn('[fcmService] sendEachForMulticast failed:', err.message);
  }
}

/**
 * Register (or update) a FCM token for the given rabbi.
 *
 * @param {string} rabbiId
 * @param {string} token
 * @returns {Promise<void>}
 */
async function registerToken(rabbiId, token) {
  await query(
    `UPDATE rabbis SET fcm_token = $1, updated_at = NOW() WHERE id = $2`,
    [token || null, rabbiId]
  );
}

module.exports = { notifyNewQuestion, registerToken };
