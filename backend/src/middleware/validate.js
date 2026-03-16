/**
 * Validation Middleware  –  src/middleware/validate.js
 *
 * Provides reusable express-validator chains for the platform's main input
 * types plus a shared `handleValidation` middleware that short-circuits the
 * request pipeline with a 400 + Hebrew error messages when validation fails.
 *
 * Exported chains (arrays of ValidationChain):
 *   validateLogin            – email + password present
 *   validateRegister         – name, email, strong password
 *   validateAnswer           – rich-text answer content (min 10 meaningful chars)
 *   validateDiscussionMessage – discussion message (1–5000 chars)
 *
 * Exported middleware:
 *   handleValidation         – reads validationResult and responds 400 on failure
 *
 * Usage:
 *   router.post('/login', validateLogin, handleValidation, loginController);
 */

const { body, validationResult } = require('express-validator');
const { parse: parseHtml }       = require('node-html-parser');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip all HTML tags from a string and return plain text.
 * Used to measure meaningful content length independent of markup.
 *
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
  if (typeof html !== 'string') return '';
  try {
    const root = parseHtml(html);
    return root.text || root.textContent || '';
  } catch {
    // Fallback: naive regex strip
    return html.replace(/<[^>]*>/g, '');
  }
}

/**
 * Return true when the trimmed plain-text extracted from `html` has at least
 * `minLength` characters.
 *
 * @param {string} html
 * @param {number} minLength
 * @returns {boolean}
 */
function htmlHasMinLength(html, minLength) {
  return stripHtml(html).trim().length >= minLength;
}

// ─── validateLogin ────────────────────────────────────────────────────────────

/**
 * Validates a login request body.
 * Fields: email, password
 */
const validateLogin = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('כתובת האימייל נדרשת')
    .isEmail()
    .withMessage('כתובת האימייל אינה תקינה')
    .normalizeEmail(),

  body('password')
    .notEmpty()
    .withMessage('הסיסמה נדרשת')
    .isLength({ min: 1 })
    .withMessage('הסיסמה נדרשת'),
];

// ─── validateRegister ─────────────────────────────────────────────────────────

/**
 * Validates a rabbi registration request body.
 * Fields: name, email, password
 *
 * Password strength rules (mirrors zxcvbn score 3+):
 *   - At least 8 characters
 *   - At least one uppercase letter (A-Z)
 *   - At least one digit (0-9)
 *   - At least one special character (!@#$%^&* etc.)
 */
const validateRegister = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('השם נדרש')
    .isLength({ min: 2, max: 100 })
    .withMessage('השם חייב להכיל בין 2 ל-100 תווים'),

  body('email')
    .trim()
    .notEmpty()
    .withMessage('כתובת האימייל נדרשת')
    .isEmail()
    .withMessage('כתובת האימייל אינה תקינה')
    .normalizeEmail(),

  body('password')
    .notEmpty()
    .withMessage('הסיסמה נדרשת')
    .isLength({ min: 8 })
    .withMessage('הסיסמה חייבת להכיל לפחות 8 תווים')
    .matches(/[A-Z]/)
    .withMessage('הסיסמה חייבת להכיל לפחות אות גדולה אחת (A-Z)')
    .matches(/[0-9]/)
    .withMessage('הסיסמה חייבת להכיל לפחות ספרה אחת')
    .matches(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/)
    .withMessage('הסיסמה חייבת להכיל לפחות תו מיוחד אחד (כגון !@#$%^&*)'),
];

// ─── validateAnswer ───────────────────────────────────────────────────────────

/**
 * Validates a rabbi's answer body.
 * Field: content  (may contain HTML from a rich-text editor)
 *
 * Rules:
 *   - content must be present and non-empty
 *   - After stripping all HTML tags, the plain text must be at least 10 characters
 *     (prevents answers like "<p> </p>" or whitespace-only submissions)
 */
const validateAnswer = [
  body('content')
    .notEmpty()
    .withMessage('תוכן התשובה נדרש')
    .custom((value) => {
      if (typeof value !== 'string') {
        throw new Error('תוכן התשובה חייב להיות טקסט');
      }
      if (!htmlHasMinLength(value, 10)) {
        throw new Error('התשובה חייבת להכיל לפחות 10 תווים');
      }
      return true;
    }),
];

// ─── validateDiscussionMessage ────────────────────────────────────────────────

/**
 * Validates a message sent in a question discussion thread.
 * Field: content  (plain text; rich text is not supported in discussions)
 *
 * Rules:
 *   - At least 1 character after trimming
 *   - At most 5000 characters
 */
const validateDiscussionMessage = [
  body('content')
    .trim()
    .notEmpty()
    .withMessage('תוכן ההודעה נדרש')
    .isLength({ min: 1, max: 5000 })
    .withMessage('ההודעה חייבת להכיל בין 1 ל-5000 תווים'),
];

// ─── handleValidation ─────────────────────────────────────────────────────────

/**
 * Final middleware in a validation chain.
 * Reads express-validator's result and, if any errors exist, responds with
 * HTTP 400 and an array of Hebrew error objects.
 *
 * If validation passes, calls next() to hand control to the route handler.
 *
 * Response shape on failure:
 * {
 *   ok: false,
 *   errors: [{ field: string, message: string }, ...]
 * }
 *
 * @type {import('express').RequestHandler}
 */
function handleValidation(req, res, next) {
  const result = validationResult(req);

  if (result.isEmpty()) {
    return next();
  }

  const formatted = result.array().map((err) => ({
    field:   err.path || err.param || 'unknown',
    message: err.msg,
  }));

  return res.status(400).json({
    ok:     false,
    errors: formatted,
  });
}

module.exports = {
  validateLogin,
  validateRegister,
  validateAnswer,
  validateDiscussionMessage,
  handleValidation,
};
