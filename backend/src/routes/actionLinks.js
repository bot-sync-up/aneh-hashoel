'use strict';

/**
 * Action Link Handlers
 *
 * Magic-link endpoints embedded in email / WhatsApp notification buttons.
 * All routes are GET requests so they work directly when a rabbi taps a link.
 *
 * Flow:
 *   1. Verify the signed JWT from the `token` query parameter.
 *   2. Perform any server-side side-effects (e.g. releasing a question).
 *   3. Redirect to the frontend with the original token so the SPA can
 *      complete the action after the rabbi authenticates if needed.
 *
 * Redirect targets:
 *   Success  → {FRONTEND_URL}/questions/{questionId}?action={action}&token={token}
 *   Failure  → {FRONTEND_URL}/link-expired
 *
 * Mounted at:  /api/action
 */

const express = require('express');
const {
  verifyActionToken,
  createAnswerToken,
  createReleaseToken,
  createDiscussionToken,
} = require('../utils/actionTokens');
const { query } = require('../db/pool');

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Return the frontend base URL (no trailing slash).
 * Falls back to a safe default so missing env does not crash the process.
 */
function frontendUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
}

/**
 * Redirect to the generic "link expired / invalid" page.
 *
 * @param {import('express').Response} res
 */
function redirectExpired(res) {
  return res.redirect(`${frontendUrl()}/link-expired`);
}

/**
 * Redirect to the question page with the original token so the frontend
 * can pick up and complete the action flow.
 *
 * @param {import('express').Response} res
 * @param {string} questionId
 * @param {string} action
 * @param {string} rawToken  – the original encoded token string from the URL
 */
function redirectToQuestion(res, questionId, action, rawToken) {
  const base = `${frontendUrl()}/questions/${encodeURIComponent(questionId)}`;
  const params = new URLSearchParams({ action, token: rawToken });
  return res.redirect(`${base}?${params.toString()}`);
}

/**
 * Attempt to verify the JWT from req.query.token.
 * Returns the payload on success, or calls redirectExpired and returns null.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {object|null}
 */
function getVerifiedPayload(req, res) {
  const { token } = req.query;
  if (!token) {
    redirectExpired(res);
    return null;
  }
  try {
    return verifyActionToken(token);
  } catch {
    redirectExpired(res);
    return null;
  }
}

// ─── GET /api/action/claim ────────────────────────────────────────────────────

/**
 * Verify claim token.
 *
 * If the token contains a rabbiId (per-rabbi token from email broadcast):
 *   - Claim the question directly in the backend (no frontend login needed)
 *   - Send the full question email to the rabbi
 *   - Redirect to a simple "question claimed" confirmation page
 *
 * If no rabbiId in token (legacy shared token):
 *   - Redirect to the frontend claim flow (requires login)
 */
router.get('/claim', async (req, res) => {
  try {
    const payload = getVerifiedPayload(req, res);
    if (!payload) return;

    const { action, questionId, rabbiId } = payload;
    if (action !== 'claim' || !questionId) {
      return redirectExpired(res);
    }

    // Per-rabbi token: claim directly without login
    if (rabbiId) {
      try {
        const { claimQuestion } = require('../services/questions');
        const result = await claimQuestion(questionId, rabbiId);

        if (!result.success) {
          // Already claimed by someone else
          console.log(`[actionLinks] /claim: שאלה ${questionId} כבר נתפסה (rabbi=${rabbiId})`);
          return res.redirect(`${frontendUrl()}/link-expired?reason=already_claimed`);
        }

        // Send full question email to rabbi
        setImmediate(async () => {
          try {
            const { rows } = await query(
              'SELECT id, name, email FROM rabbis WHERE id = $1 LIMIT 1',
              [rabbiId]
            );
            const rabbi = rows[0];
            if (rabbi && rabbi.email) {
              const answerToken     = createAnswerToken(questionId, rabbiId);
              const releaseToken    = createReleaseToken(questionId, rabbiId);
              const discussionToken = createDiscussionToken(questionId);
              const emailSvc        = require('../services/email');
              await emailSvc.sendFullQuestion(rabbi.email, result.question, {
                answerToken,
                releaseToken,
                discussionToken,
              });
              console.log(`[actionLinks] /claim: מייל שאלה מלאה נשלח לרב ${rabbiId}`);
            }
          } catch (e) {
            console.error('[actionLinks] /claim: שגיאה בשליחת מייל מלא:', e.message);
          }
        });

        // Redirect to simple claimed confirmation page
        return res.redirect(
          `${frontendUrl()}/questions/${encodeURIComponent(questionId)}?action=claimed`
        );
      } catch (claimErr) {
        console.error('[actionLinks] /claim direct error:', claimErr.message);
        // Fall through to frontend redirect
      }
    }

    return redirectToQuestion(res, questionId, 'claim', req.query.token);
  } catch (err) {
    console.error('[actionLinks] /claim error:', err.message);
    return redirectExpired(res);
  }
});

// ─── GET /api/action/release ──────────────────────────────────────────────────

/**
 * Verify release token, validate ownership, release the question from the
 * rabbi's queue, then redirect to the question page.
 */
router.get('/release', async (req, res) => {
  try {
    const payload = getVerifiedPayload(req, res);
    if (!payload) return;

    const { action, questionId, rabbiId } = payload;
    if (action !== 'release' || !questionId || !rabbiId) {
      return redirectExpired(res);
    }

    // Ownership check: only release if this rabbi still holds the question
    const { rows } = await query(
      `SELECT id FROM questions
       WHERE id = $1 AND claimed_by = $2 AND status = 'claimed'
       LIMIT 1`,
      [questionId, rabbiId]
    );

    if (rows.length > 0) {
      await query(
        `UPDATE questions
         SET status = 'open', claimed_by = NULL, claimed_at = NULL, updated_at = NOW()
         WHERE id = $1 AND claimed_by = $2`,
        [questionId, rabbiId]
      );
    }
    // If the question was already released or answered, silently succeed and redirect

    return redirectToQuestion(res, questionId, 'release', req.query.token);
  } catch (err) {
    console.error('[actionLinks] /release error:', err.message);
    return redirectExpired(res);
  }
});

// ─── GET /api/action/answer ───────────────────────────────────────────────────

/**
 * Verify answer token and redirect to the frontend answer editor.
 */
router.get('/answer', async (req, res) => {
  try {
    const payload = getVerifiedPayload(req, res);
    if (!payload) return;

    const { action, questionId, rabbiId } = payload;
    if (action !== 'answer' || !questionId || !rabbiId) {
      return redirectExpired(res);
    }

    return redirectToQuestion(res, questionId, 'answer', req.query.token);
  } catch (err) {
    console.error('[actionLinks] /answer error:', err.message);
    return redirectExpired(res);
  }
});

// ─── GET /api/action/followup ─────────────────────────────────────────────────

/**
 * Verify follow-up token and redirect to the frontend follow-up reply page.
 */
router.get('/followup', async (req, res) => {
  try {
    const payload = getVerifiedPayload(req, res);
    if (!payload) return;

    const { action, questionId, rabbiId } = payload;
    if (action !== 'followup' || !questionId || !rabbiId) {
      return redirectExpired(res);
    }

    return redirectToQuestion(res, questionId, 'followup', req.query.token);
  } catch (err) {
    console.error('[actionLinks] /followup error:', err.message);
    return redirectExpired(res);
  }
});

// ─── GET /api/action/discussion ───────────────────────────────────────────────

/**
 * Verify discussion token and redirect to the frontend discussion thread page.
 */
router.get('/discussion', async (req, res) => {
  try {
    const payload = getVerifiedPayload(req, res);
    if (!payload) return;

    const { action, questionId } = payload;
    if (action !== 'discussion' || !questionId) {
      return redirectExpired(res);
    }

    return redirectToQuestion(res, questionId, 'discussion', req.query.token);
  } catch (err) {
    console.error('[actionLinks] /discussion error:', err.message);
    return redirectExpired(res);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Task-spec path-param variants  GET /action/claim/:token  &  /action/release/:token
// ═══════════════════════════════════════════════════════════════════════════════
//
// The existing routes above accept the token as a query-string parameter
// (?token=…).  The task specification also requires the token to be accepted
// as a URL path segment (/action/claim/:token).  These aliases handle both
// styles so that either form works transparently.

/**
 * Normalise a token that may arrive as a URL path segment.
 * Path segments cannot contain '/' but can contain '+' (URL-encoded spaces)
 * and other base64url characters.  We decode any percent-encoding applied by
 * the browser and then delegate to the existing query-param handler by
 * temporarily injecting req.query.token.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {Function}                   next
 */
function injectPathToken(req, res, next) {
  if (req.params && req.params.token) {
    req.query = req.query || {};
    req.query.token = decodeURIComponent(req.params.token);
  }
  next();
}

// ─── GET /api/action/claim/:token ────────────────────────────────────────────

/**
 * Path-param variant of the claim handler.
 * Rabbi taps "אני רוצה לענות" in the broadcast email.
 * Token contains { action: 'claim', questionId }.
 * Verifies the JWT, then redirects to the frontend claim flow.
 */
router.get('/claim/:token', injectPathToken, async (req, res) => {
  try {
    const payload = getVerifiedPayload(req, res);
    if (!payload) return;

    const { action, questionId } = payload;
    if (action !== 'claim' || !questionId) {
      return redirectExpired(res);
    }

    return redirectToQuestion(res, questionId, 'claim', req.query.token);
  } catch (err) {
    console.error('[actionLinks] /claim/:token error:', err.message);
    return redirectExpired(res);
  }
});

// ─── GET /api/action/release/:token ──────────────────────────────────────────

/**
 * Path-param variant of the release handler.
 * Rabbi taps "ביטול תפיסה" in the claim-confirmation email.
 * Token contains { action: 'release', questionId, rabbiId }.
 * Releases the question back to 'pending' if the rabbi still holds it,
 * then redirects to the frontend.
 */
router.get('/release/:token', injectPathToken, async (req, res) => {
  try {
    const payload = getVerifiedPayload(req, res);
    if (!payload) return;

    const { action, questionId, rabbiId } = payload;
    if (action !== 'release' || !questionId || !rabbiId) {
      return redirectExpired(res);
    }

    // Ownership check — match existing /release handler logic exactly
    const { rows } = await query(
      `SELECT id FROM questions
       WHERE id = $1 AND claimed_by = $2 AND status = 'claimed'
       LIMIT 1`,
      [questionId, rabbiId]
    );

    if (rows.length > 0) {
      await query(
        `UPDATE questions
         SET status = 'open', claimed_by = NULL, claimed_at = NULL, updated_at = NOW()
         WHERE id = $1 AND claimed_by = $2`,
        [questionId, rabbiId]
      );
    }

    // Also handle the 'in_process' status used by claimQuestion()
    const { rows: rows2 } = await query(
      `SELECT id FROM questions
       WHERE id = $1 AND assigned_rabbi_id = $2 AND status = 'in_process'
       LIMIT 1`,
      [questionId, rabbiId]
    );

    if (rows2.length > 0) {
      await query(
        `UPDATE questions
         SET status = 'pending', assigned_rabbi_id = NULL,
             lock_timestamp = NULL, updated_at = NOW()
         WHERE id = $1 AND assigned_rabbi_id = $2`,
        [questionId, rabbiId]
      );
    }

    return redirectToQuestion(res, questionId, 'release', req.query.token);
  } catch (err) {
    console.error('[actionLinks] /release/:token error:', err.message);
    return redirectExpired(res);
  }
});

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = router;
