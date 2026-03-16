'use strict';

/**
 * Authentication & Authorization Middleware
 *
 * Exports:
 *   authenticate      – verify Bearer JWT access token; attach req.rabbi
 *   requireAdmin      – assert req.rabbi.role === 'admin'
 *   optionalAuth      – like authenticate but never blocks; req.rabbi may be null
 *   verifyActionLink  – verify ?token= action JWT from query string;
 *                       attach req.actionPayload (no auth required)
 */

const jwt = require('jsonwebtoken');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the Bearer token from the Authorization header.
 * Returns null when the header is absent or malformed.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractBearerToken(req) {
  const authHeader =
    req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7).trim() || null;
}

/**
 * Decode and verify a JWT access token.
 * Returns the decoded payload or throws with a Hebrew message + HTTP status.
 *
 * @param {string} token
 * @returns {{ sub: string, role: string, iat: number, exp: number }}
 */
function decodeAccessToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'aneh-hashoel',
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      const e = new Error('פג תוקף ההתחברות. נא להתחבר מחדש');
      e.status = 401;
      throw e;
    }
    const e = new Error('טוקן אימות אינו תקין');
    e.status = 401;
    throw e;
  }
}

// ─── authenticate ─────────────────────────────────────────────────────────────

/**
 * Strict authentication middleware.
 * Verifies the Bearer JWT and attaches `req.rabbi = { id, role }`.
 * Returns 401 if the token is absent, expired, or invalid.
 *
 * @type {import('express').RequestHandler}
 */
function authenticate(req, res, next) {
  const token = extractBearerToken(req);

  if (!token) {
    return res.status(401).json({ error: 'נדרשת התחברות' });
  }

  let payload;
  try {
    payload = decodeAccessToken(token);
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message });
  }

  req.rabbi = {
    id:   payload.sub,
    role: payload.role,
  };

  return next();
}

// ─── requireAdmin ─────────────────────────────────────────────────────────────

/**
 * Authorization middleware — must run **after** `authenticate`.
 * Returns 403 if the authenticated rabbi does not have the 'admin' role.
 *
 * @type {import('express').RequestHandler}
 */
function requireAdmin(req, res, next) {
  if (!req.rabbi) {
    // Defensive: authenticate was not chained before this middleware
    return res.status(401).json({ error: 'נדרשת התחברות' });
  }

  if (req.rabbi.role !== 'admin') {
    return res.status(403).json({ error: 'אין הרשאה לבצע פעולה זו' });
  }

  return next();
}

// ─── optionalAuth ─────────────────────────────────────────────────────────────

/**
 * Optional authentication middleware.
 * Behaves identically to `authenticate` when a valid token is present,
 * but silently continues without setting `req.rabbi` when no token is provided
 * or the token is invalid — never returns an error response.
 *
 * @type {import('express').RequestHandler}
 */
function optionalAuth(req, res, next) {
  const token = extractBearerToken(req);

  if (!token) {
    return next();
  }

  try {
    const payload = decodeAccessToken(token);
    req.rabbi = {
      id:   payload.sub,
      role: payload.role,
    };
  } catch {
    // Invalid / expired token — treat as unauthenticated, do not block
  }

  return next();
}

// ─── verifyActionLink ─────────────────────────────────────────────────────────

/**
 * Middleware for action-link endpoints (email / WhatsApp buttons).
 *
 * Reads the signed JWT from the `?token=` query parameter, verifies it with
 * ACTION_TOKEN_SECRET, and attaches the decoded payload to `req.actionPayload`.
 *
 * This middleware does NOT require a user session — action links are designed
 * to work without authentication (the rabbi clicks a link in their email).
 * The payload carries enough context (questionId, rabbiId, action) for the
 * route handler to perform the operation directly.
 *
 * On failure, the middleware redirects to the frontend /link-expired page
 * rather than returning a JSON error, since callers are browsers following links.
 *
 * @type {import('express').RequestHandler}
 */
function verifyActionLink(req, res, next) {
  const { token } = req.query;

  if (!token) {
    return _redirectExpired(res);
  }

  const secret = process.env.ACTION_TOKEN_SECRET;
  if (!secret) {
    console.error('[authenticate] ACTION_TOKEN_SECRET לא מוגדר');
    return _redirectExpired(res);
  }

  try {
    const payload = jwt.verify(token, secret, { issuer: 'aneh-hashoel' });
    req.actionPayload = payload;
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      // Expired token — redirect to expired page
      return _redirectExpired(res);
    }
    // Malformed / invalid signature
    return _redirectExpired(res);
  }
}

/**
 * Redirect to the frontend "link expired / invalid" page.
 * Falls back to a safe default if FRONTEND_URL is not set.
 *
 * @param {import('express').Response} res
 */
function _redirectExpired(res) {
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  return res.redirect(`${frontendUrl}/link-expired`);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  authenticate,
  requireAdmin,
  optionalAuth,
  verifyActionLink,
};
