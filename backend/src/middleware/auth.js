'use strict';

/**
 * Authentication & Authorization Middleware
 *
 * This module is the canonical auth middleware for the "ענה את השואל" platform.
 *
 * Exports:
 *   authenticate       – verify Bearer JWT; attach req.rabbi = { id, role, name, email }
 *   authenticateToken  – alias of authenticate (backward-compatibility)
 *   requireAdmin       – assert req.rabbi.role === 'admin' (must follow authenticate)
 *   optionalAuth       – like authenticate but never blocks; req.rabbi may be null
 *   verifyActionLink   – verify ?token= action JWT from query string
 *
 * Usage:
 *   router.get('/protected',   authenticate, handler);
 *   router.get('/admin-only',  authenticate, requireAdmin, handler);
 */

const jwt            = require('jsonwebtoken');
const { query: db }  = require('../db/pool');

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Extract the Bearer token from the Authorization header.
 * Returns null when the header is absent or malformed.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function _extractBearerToken(req) {
  const header = req.headers['authorization'] || req.headers['Authorization'];
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/**
 * Verify and decode a JWT access token.
 * Throws with .status set on failure.
 *
 * @param {string} token
 * @returns {{ sub: string, role: string, iat: number, exp: number }}
 */
function _decodeAccessToken(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    const e = new Error('JWT_SECRET לא מוגדר — יש להגדיר את משתנה הסביבה');
    e.status = 500;
    throw e;
  }

  try {
    return jwt.verify(token, secret, { issuer: 'aneh-hashoel' });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      const e = new Error('פג תוקף ההתחברות — נא להתחבר מחדש');
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
 *
 * Verifies the Bearer JWT access token from the Authorization header.
 * Fetches the rabbi row from DB to populate the full context object:
 *   req.rabbi = { id, role, name, email }
 *
 * Returns HTTP 401 when:
 *   - Authorization header is absent or not in "Bearer <token>" format.
 *   - Token signature is invalid.
 *   - Token has expired.
 *   - Rabbi is not found or is inactive.
 *
 * @type {import('express').RequestHandler}
 */
async function authenticate(req, res, next) {
  const token = _extractBearerToken(req);

  if (!token) {
    return res.status(401).json({ error: 'נדרשת התחברות' });
  }

  let payload;
  try {
    payload = _decodeAccessToken(token);
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message });
  }

  try {
    const { rows } = await db(
      `SELECT id, role, name, email, status
       FROM   rabbis
       WHERE  id = $1
       LIMIT  1`,
      [payload.sub]
    );

    const rabbi = rows[0];

    if (!rabbi) {
      return res.status(401).json({ error: 'רב לא נמצא — נדרשת התחברות מחדש' });
    }

    if (rabbi.status !== 'active') {
      return res.status(401).json({ error: 'החשבון אינו פעיל — פנה למנהל המערכת' });
    }

    req.rabbi = {
      id:    String(rabbi.id),
      role:  rabbi.role,
      name:  rabbi.name,
      email: rabbi.email,
    };

    return next();
  } catch (dbErr) {
    console.error('[auth] authenticate DB error:', dbErr.message);
    return res.status(500).json({ error: 'שגיאת שרת פנימית' });
  }
}

// ─── authenticateToken — backward-compatibility alias ─────────────────────────

/**
 * Alias for authenticate — kept so existing route files importing
 * `authenticateToken` continue to work without changes.
 *
 * @type {import('express').RequestHandler}
 */
const authenticateToken = authenticate;

// ─── requireAdmin ─────────────────────────────────────────────────────────────

/**
 * Authorization guard — must be chained **after** `authenticate`.
 *
 * Passes when req.rabbi.role === 'admin'.
 * Returns HTTP 403 otherwise.
 * Returns HTTP 401 if authenticate was accidentally omitted.
 *
 * @type {import('express').RequestHandler}
 */
function requireAdmin(req, res, next) {
  if (!req.rabbi) {
    return res.status(401).json({ error: 'נדרשת התחברות' });
  }

  if (req.rabbi.role !== 'admin') {
    return res.status(403).json({ error: 'אין הרשאה לבצע פעולה זו — נדרש מנהל מערכת' });
  }

  return next();
}

// ─── optionalAuth ─────────────────────────────────────────────────────────────

/**
 * Optional authentication middleware.
 * Behaves identically to authenticate when a valid token is present,
 * but silently continues without setting req.rabbi when no token is
 * provided or the token is invalid — never returns an error response.
 *
 * @type {import('express').RequestHandler}
 */
async function optionalAuth(req, res, next) {
  const token = _extractBearerToken(req);

  if (!token) {
    return next();
  }

  let payload;
  try {
    payload = _decodeAccessToken(token);
  } catch {
    return next();
  }

  try {
    const { rows } = await db(
      `SELECT id, role, name, email, status FROM rabbis WHERE id = $1 LIMIT 1`,
      [payload.sub]
    );

    const rabbi = rows[0];

    if (rabbi && rabbi.status === 'active') {
      req.rabbi = {
        id:    String(rabbi.id),
        role:  rabbi.role,
        name:  rabbi.name,
        email: rabbi.email,
      };
    }
  } catch {
    // Non-blocking — treat as unauthenticated
  }

  return next();
}

// ─── verifyActionLink ─────────────────────────────────────────────────────────

/**
 * Middleware for action-link endpoints (email / WhatsApp buttons).
 *
 * Reads the signed JWT from the ?token= query parameter, verifies it with
 * ACTION_TOKEN_SECRET, and attaches the decoded payload to req.actionPayload.
 *
 * On failure, redirects to the frontend /link-expired page.
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
    console.error('[auth] ACTION_TOKEN_SECRET לא מוגדר');
    return _redirectExpired(res);
  }

  try {
    const payload    = jwt.verify(token, secret, { issuer: 'aneh-hashoel' });
    req.actionPayload = payload;
    return next();
  } catch {
    return _redirectExpired(res);
  }
}

function _redirectExpired(res) {
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  return res.redirect(`${frontendUrl}/link-expired`);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  authenticate,
  authenticateToken,   // backward-compat alias
  requireAdmin,
  optionalAuth,
  verifyActionLink,
};
