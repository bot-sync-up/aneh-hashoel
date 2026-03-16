'use strict';

/**
 * Request Validation Middleware & Helpers
 *
 * Each exported helper either:
 *   (a) returns a boolean (pure validation)  — validateEmail
 *   (b) returns an Express middleware         — validateRequired, validateEnum,
 *                                               validateLogin, validateRabbiCreate,
 *                                               validateAnswer, validateQuestion
 *
 * No external validation library is used — only plain JavaScript checks.
 * All error messages are in Hebrew.
 */

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Basic RFC-5322-inspired email regex (practical, not exhaustive). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Send a 400 validation error response.
 *
 * @param {import('express').Response} res
 * @param {string} message
 */
function fail(res, message) {
  return res.status(400).json({ error: message });
}

/**
 * Return true when the value is a non-empty string after trimming.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Return true when the string is a safe integer (or a string that parses to one).
 *
 * @param {*} value
 * @returns {boolean}
 */
function isInteger(value) {
  if (typeof value === 'number') return Number.isInteger(value);
  if (typeof value === 'string') return /^\d+$/.test(value.trim());
  return false;
}

// ─── validateEmail ────────────────────────────────────────────────────────────

/**
 * Pure helper: return true if the string is a syntactically valid email address.
 * Does NOT send any response — the caller decides what to do with the result.
 *
 * @param {string} email
 * @returns {boolean}
 */
function validateEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim());
}

// ─── validateRequired ────────────────────────────────────────────────────────

/**
 * Middleware factory: verify that all listed field names are present and
 * non-empty in req.body.
 *
 * Usage:
 *   router.post('/rabbis', validateRequired(['name', 'email', 'role']), handler);
 *
 * @param {string[]} fields  – list of required req.body field names
 * @returns {import('express').RequestHandler}
 */
function validateRequired(fields) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new TypeError('validateRequired: fields חייב להיות מערך לא ריק');
  }

  return function _validateRequired(req, res, next) {
    const body = req.body ?? {};

    for (const field of fields) {
      const value = body[field];

      if (value === undefined || value === null) {
        return fail(res, `השדה "${field}" נדרש`);
      }

      // Reject blank strings; allow 0, false, etc.
      if (typeof value === 'string' && value.trim().length === 0) {
        return fail(res, `השדה "${field}" אינו יכול להיות ריק`);
      }
    }

    next();
  };
}

// ─── validateEnum ─────────────────────────────────────────────────────────────

/**
 * Middleware factory: verify that req.body[field] is one of the allowed values.
 *
 * Usage:
 *   router.post('/rabbis', validateEnum('role', ['rabbi', 'admin']), handler);
 *
 * @param {string}   field   – req.body field name to inspect
 * @param {Array}    values  – array of acceptable values
 * @returns {import('express').RequestHandler}
 */
function validateEnum(field, values) {
  if (typeof field !== 'string' || !field) {
    throw new TypeError('validateEnum: field חייב להיות מחרוזת לא ריקה');
  }
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError('validateEnum: values חייב להיות מערך לא ריק');
  }

  const allowed = new Set(values);

  return function _validateEnum(req, res, next) {
    const value = (req.body ?? {})[field];

    if (value === undefined || value === null) {
      return fail(res, `השדה "${field}" נדרש`);
    }

    if (!allowed.has(value)) {
      const list = values.map((v) => `"${v}"`).join(', ');
      return fail(res, `ערך לא חוקי עבור "${field}" — ערכים מותרים: ${list}`);
    }

    next();
  };
}

// ─── validateLogin ────────────────────────────────────────────────────────────

/**
 * Validate POST /auth/login body.
 * Required: email (valid format), password (min 6 characters).
 */
function validateLogin(req, res, next) {
  const { email, password } = req.body ?? {};

  if (!isNonEmptyString(email)) {
    return fail(res, 'כתובת אימייל נדרשת');
  }
  if (!validateEmail(email)) {
    return fail(res, 'כתובת האימייל אינה תקינה');
  }
  if (!isNonEmptyString(password)) {
    return fail(res, 'סיסמה נדרשת');
  }
  if (password.length < 6) {
    return fail(res, 'הסיסמה חייבת להכיל לפחות 6 תווים');
  }

  next();
}

// ─── validateRabbiCreate ──────────────────────────────────────────────────────

const VALID_ROLES = new Set(['rabbi', 'admin']);

/**
 * Validate POST /rabbis body.
 * Required: name (2–100 chars), email (valid format), role (rabbi|admin).
 */
function validateRabbiCreate(req, res, next) {
  const { name, email, role } = req.body ?? {};

  if (!isNonEmptyString(name)) {
    return fail(res, 'שם הרב נדרש');
  }
  const trimmedName = name.trim();
  if (trimmedName.length < 2) {
    return fail(res, 'שם הרב חייב להכיל לפחות 2 תווים');
  }
  if (trimmedName.length > 100) {
    return fail(res, 'שם הרב לא יכול לעלות על 100 תווים');
  }

  if (!isNonEmptyString(email)) {
    return fail(res, 'כתובת אימייל נדרשת');
  }
  if (!validateEmail(email)) {
    return fail(res, 'כתובת האימייל אינה תקינה');
  }

  if (!isNonEmptyString(role)) {
    return fail(res, 'תפקיד נדרש');
  }
  if (!VALID_ROLES.has(role.trim())) {
    return fail(res, 'תפקיד לא חוקי — יש לבחור rabbi או admin');
  }

  next();
}

// ─── validateAnswer ───────────────────────────────────────────────────────────

const ANSWER_MIN_LENGTH = 10;
const ANSWER_MAX_LENGTH = 50000;

/**
 * Validate POST /answers body.
 * Required: content (min 10 chars, max 50,000 chars).
 */
function validateAnswer(req, res, next) {
  const { content } = req.body ?? {};

  if (!isNonEmptyString(content)) {
    return fail(res, 'תוכן התשובה נדרש');
  }
  const len = content.trim().length;
  if (len < ANSWER_MIN_LENGTH) {
    return fail(res, `התשובה חייבת להכיל לפחות ${ANSWER_MIN_LENGTH} תווים`);
  }
  if (len > ANSWER_MAX_LENGTH) {
    return fail(res, `התשובה לא יכולה לעלות על ${ANSWER_MAX_LENGTH.toLocaleString()} תווים`);
  }

  next();
}

// ─── validateQuestion ─────────────────────────────────────────────────────────

/**
 * Validate POST /questions body.
 * Required: title, content, wp_post_id (integer).
 */
function validateQuestion(req, res, next) {
  const { title, content, wp_post_id } = req.body ?? {};

  if (!isNonEmptyString(title)) {
    return fail(res, 'כותרת השאלה נדרשת');
  }
  if (!isNonEmptyString(content)) {
    return fail(res, 'תוכן השאלה נדרש');
  }
  if (wp_post_id === undefined || wp_post_id === null || wp_post_id === '') {
    return fail(res, 'מזהה פוסט וורדפרס נדרש');
  }
  if (!isInteger(wp_post_id)) {
    return fail(res, 'מזהה פוסט וורדפרס חייב להיות מספר שלם');
  }

  next();
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Generic composable helpers (used directly in routes)
  validateEmail,
  validateRequired,
  validateEnum,
  // Domain-specific middleware
  validateLogin,
  validateRabbiCreate,
  validateAnswer,
  validateQuestion,
};
