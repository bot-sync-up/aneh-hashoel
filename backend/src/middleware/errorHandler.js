/**
 * Global Error Handler Middleware  –  src/middleware/errorHandler.js
 *
 * Must be registered LAST in the Express middleware chain:
 *   app.use(errorHandler);
 *
 * Handled error categories:
 *   - express-validator ValidationError array  → 400 with Hebrew field messages
 *   - JsonWebTokenError / TokenExpiredError    → 401
 *   - PostgreSQL unique_violation (23505)      → 409 "כבר קיים ברשומות"
 *   - Everything else                          → 500 "אירעה שגיאה פנימית, נסה שוב"
 *
 * In development mode the stack trace is included in the response body.
 * DB error details (table names, constraints) are never forwarded to the client.
 */

import { logger } from '../utils/logger.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return true when the value looks like an express-validator errors array.
 * express-validator's validationResult().array() produces an array of objects
 * each containing at minimum { type, msg, path }.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidationErrorArray(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === 'object' &&
    value[0] !== null &&
    'msg' in value[0]
  );
}

/**
 * Extract a safe, Hebrew-friendly message from a validation error entry.
 *
 * @param {{ msg: string, path?: string, location?: string }} ve
 * @returns {{ field: string, message: string }}
 */
function formatValidationError(ve) {
  return {
    field:   ve.path || ve.param || 'unknown',
    message: String(ve.msg),
  };
}

// ─── Error handler ────────────────────────────────────────────────────────────

/**
 * Express 4-argument error handler.
 * Catches every error passed via next(err) or thrown inside async route handlers
 * that are wrapped with a try/catch forwarding to next.
 *
 * @param {Error & { status?: number; errors?: unknown[]; code?: string }} err
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next  – must be declared even if unused
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const isDev = process.env.NODE_ENV === 'development';

  // ── 1. express-validator: errors array ──────────────────────────────────────
  // Callers should attach the array as err.errors before calling next(err),
  // or they can throw/pass an object with { errors: [...] }.
  if (isValidationErrorArray(err.errors)) {
    const formatted = err.errors.map(formatValidationError);

    logger.warn('Validation error', {
      method:  req.method,
      url:     req.originalUrl,
      errors:  formatted,
    });

    return res.status(400).json({
      ok:     false,
      errors: formatted,
    });
  }

  // ── 2. JWT errors ────────────────────────────────────────────────────────────
  if (
    err.name === 'JsonWebTokenError' ||
    err.name === 'TokenExpiredError' ||
    err.name === 'NotBeforeError'
  ) {
    logger.warn('JWT error', {
      name:    err.name,
      method:  req.method,
      url:     req.originalUrl,
    });

    return res.status(401).json({
      ok:    false,
      error: 'אימות נכשל — אנא התחבר מחדש',
    });
  }

  // ── 3. PostgreSQL unique constraint violation (code 23505) ───────────────────
  if (err.code === '23505') {
    logger.warn('DB unique constraint violation', {
      method:  req.method,
      url:     req.originalUrl,
      detail:  err.detail,   // logged server-side only, never sent to client
    });

    return res.status(409).json({
      ok:    false,
      error: 'כבר קיים ברשומות',
    });
  }

  // ── 4. Explicit HTTP status attached by route code ───────────────────────────
  // Routes may do:  const e = new Error('...'); e.status = 403; next(e);
  const explicitStatus = err.status || err.statusCode;
  if (explicitStatus && explicitStatus >= 400 && explicitStatus < 500) {
    logger.warn('Client error', {
      status:  explicitStatus,
      message: err.message,
      method:  req.method,
      url:     req.originalUrl,
    });

    return res.status(explicitStatus).json({
      ok:    false,
      error: err.message || 'בקשה לא תקינה',
    });
  }

  // ── 5. Fallback: unexpected server error ─────────────────────────────────────
  logger.error('Unhandled server error', {
    message: err.message,
    stack:   err.stack,
    method:  req.method,
    url:     req.originalUrl,
    // DB-specific fields logged server-side only
    dbCode:   err.code,
    dbDetail: err.detail,
    dbTable:  err.table,
  });

  const body = {
    ok:    false,
    error: 'אירעה שגיאה פנימית, נסה שוב',
  };

  // Include stack in development responses only.
  // NEVER include err.detail / err.table / err.constraint (DB leakage).
  if (isDev) {
    body.stack = err.stack;
  }

  return res.status(500).json(body);
}
