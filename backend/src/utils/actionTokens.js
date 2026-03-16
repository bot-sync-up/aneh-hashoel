'use strict';

/**
 * Action Tokens
 *
 * Signed JWT tokens embedded in email / WhatsApp action buttons.
 * Each token encodes an `action` discriminant and the IDs needed to perform
 * that action without an additional DB lookup at the click handler.
 *
 * All tokens are issued with process.env.ACTION_TOKEN_SECRET and the
 * 'aneh-hashoel' issuer claim so they cannot be confused with auth JWTs.
 *
 * Token lifetimes:
 *   claim       – 24 h  (questions expire quickly to avoid stale claims)
 *   release     – 48 h
 *   answer      – 48 h
 *   followup    – 48 h
 *   discussion  – 48 h
 *
 * Dependency: jsonwebtoken (already in package.json)
 */

const jwt = require('jsonwebtoken');

const ISSUER = 'aneh-hashoel';

// ─── Secret helper ────────────────────────────────────────────────────────────

function getSecret() {
  const secret = process.env.ACTION_TOKEN_SECRET;
  if (!secret) {
    throw new Error('ACTION_TOKEN_SECRET לא מוגדר במשתני הסביבה');
  }
  return secret;
}

// ─── Token creators ───────────────────────────────────────────────────────────

/**
 * Create a claim token — lets a rabbi claim an unclaimed question.
 *
 * @param {string|number} questionId
 * @returns {string}  signed JWT (24 h)
 */
function createClaimToken(questionId) {
  if (!questionId) {
    throw new Error('createClaimToken: questionId נדרש');
  }
  return jwt.sign(
    { action: 'claim', questionId: String(questionId) },
    getSecret(),
    { expiresIn: '24h', issuer: ISSUER }
  );
}

/**
 * Create a release token — lets the owning rabbi release a claimed question.
 *
 * @param {string|number} questionId
 * @param {string|number} rabbiId
 * @returns {string}  signed JWT (48 h)
 */
function createReleaseToken(questionId, rabbiId) {
  if (!questionId || !rabbiId) {
    throw new Error('createReleaseToken: questionId ו-rabbiId נדרשים');
  }
  return jwt.sign(
    { action: 'release', questionId: String(questionId), rabbiId: String(rabbiId) },
    getSecret(),
    { expiresIn: '48h', issuer: ISSUER }
  );
}

/**
 * Create an answer token — deep-links the rabbi to the answer editor.
 *
 * @param {string|number} questionId
 * @param {string|number} rabbiId
 * @returns {string}  signed JWT (48 h)
 */
function createAnswerToken(questionId, rabbiId) {
  if (!questionId || !rabbiId) {
    throw new Error('createAnswerToken: questionId ו-rabbiId נדרשים');
  }
  return jwt.sign(
    { action: 'answer', questionId: String(questionId), rabbiId: String(rabbiId) },
    getSecret(),
    { expiresIn: '48h', issuer: ISSUER }
  );
}

/**
 * Create a follow-up token — deep-links the rabbi to the follow-up reply UI.
 *
 * @param {string|number} questionId
 * @param {string|number} rabbiId
 * @returns {string}  signed JWT (48 h)
 */
function createFollowUpToken(questionId, rabbiId) {
  if (!questionId || !rabbiId) {
    throw new Error('createFollowUpToken: questionId ו-rabbiId נדרשים');
  }
  return jwt.sign(
    { action: 'followup', questionId: String(questionId), rabbiId: String(rabbiId) },
    getSecret(),
    { expiresIn: '48h', issuer: ISSUER }
  );
}

/**
 * Create a discussion token — opens the internal discussion thread for a question.
 *
 * @param {string|number} questionId
 * @returns {string}  signed JWT (48 h)
 */
function createDiscussionToken(questionId) {
  if (!questionId) {
    throw new Error('createDiscussionToken: questionId נדרש');
  }
  return jwt.sign(
    { action: 'discussion', questionId: String(questionId) },
    getSecret(),
    { expiresIn: '48h', issuer: ISSUER }
  );
}

// ─── Token verifier ───────────────────────────────────────────────────────────

/**
 * Verify an action token and return its decoded payload.
 * Throws with a Hebrew message and a `status` property if invalid or expired.
 *
 * @param {string} token
 * @returns {object}  decoded JWT payload
 * @throws {Error}    with .status = 401
 */
function verifyActionToken(token) {
  if (!token) {
    const err = new Error('טוקן פעולה נדרש');
    err.status = 401;
    throw err;
  }

  try {
    return jwt.verify(token, getSecret(), { issuer: ISSUER });
  } catch (jwtErr) {
    if (jwtErr.name === 'TokenExpiredError') {
      const err = new Error('קישור הפעולה פג תוקף');
      err.status = 401;
      throw err;
    }
    const err = new Error('קישור הפעולה אינו תקין');
    err.status = 401;
    throw err;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  createClaimToken,
  createReleaseToken,
  createAnswerToken,
  createFollowUpToken,
  createDiscussionToken,
  verifyActionToken,
};
