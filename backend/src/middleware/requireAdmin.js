'use strict';

/**
 * requireAdmin middleware
 *
 * Authorization guard that asserts req.rabbi.role === 'admin'.
 * Must be chained AFTER the authenticate middleware from middleware/auth.js,
 * which populates req.rabbi = { id, role, name, email }.
 *
 * Usage:
 *   const { authenticate }  = require('./auth');
 *   const requireAdmin      = require('./requireAdmin');
 *
 *   router.delete('/rabbis/:id', authenticate, requireAdmin, handler);
 *
 * Responses:
 *   401  – req.rabbi is missing (authenticate middleware was not applied)
 *   403  – authenticated but role is not 'admin'
 */

/**
 * @type {import('express').RequestHandler}
 */
function requireAdmin(req, res, next) {
  // Defensive: authenticate must run before this middleware
  if (!req.rabbi) {
    return res.status(401).json({ error: 'נדרשת התחברות' });
  }

  if (req.rabbi.role !== 'admin') {
    return res
      .status(403)
      .json({ error: 'אין הרשאה לבצע פעולה זו — נדרש מנהל מערכת' });
  }

  return next();
}

module.exports = requireAdmin;
