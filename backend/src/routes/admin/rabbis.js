'use strict';

/**
 * Admin — Rabbi Management Routes
 *
 * Mounted at: /api/admin/rabbis
 * All routes require authenticate + requireAdmin.
 *
 * Endpoints:
 *   GET    /                – list all rabbis with current-week stats
 *   POST   /                – create new rabbi (sends setup-password email)
 *   PUT    /:id             – edit rabbi details
 *   PUT    /:id/status      – activate / deactivate rabbi
 *   DELETE /:id             – soft delete (set status = 'deleted')
 *   PUT    /:id/role        – change role (rabbi | admin)
 *   GET    /:id/audit       – activity log for a specific rabbi
 */

const express = require('express');

const { query, withTransaction }      = require('../../db/pool');
const { authenticate, requireAdmin }  = require('../../middleware/authenticate');
const { ACTIONS, createAuditEntry }   = require('../../middleware/auditLog');
const { createEmailHTML, BRAND_GOLD } = require('../../templates/emailBase');
const { sendEmail }                   = require('../../services/email');
const {
  createRabbi,
  getRabbiById,
}                                      = require('../../services/rabbiService');

const router = express.Router();

// ─── Auth guards (applied to every route in this file) ───────────────────────
router.use(authenticate, requireAdmin);

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX     = 100;

const VALID_ROLES       = new Set(['rabbi', 'admin', 'customer_service']);
const VALID_STATUSES    = new Set(['active', 'inactive']);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _parseLimit(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return PAGE_SIZE_DEFAULT;
  return Math.min(n, PAGE_SIZE_MAX);
}

function _parseOffset(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function _currentWeekStart() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

function _clientIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.ip ||
    null
  );
}

/**
 * Send setup-password welcome email to a newly created rabbi.
 *
 * @param {string} email
 * @param {string} name
 * @param {string} tempPassword
 */
async function _sendSetupEmail(email, name, tempPassword) {
  const appUrl   = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const loginUrl = `${appUrl}/login`;

  const body = `
    <p style="margin: 0 0 12px; font-size: 15px;">שלום ${name},</p>
    <p style="margin: 0 0 12px; font-size: 15px;">
      נוצר עבורך חשבון במערכת <strong>"ענה את השואל"</strong>.
    </p>
    <p style="margin: 0 0 4px; font-size: 15px;">פרטי כניסה זמניים:</p>
    <div style="
      background: #f8f8fb;
      border-right: 4px solid ${BRAND_GOLD};
      padding: 16px 20px;
      margin: 16px 0;
      border-radius: 4px;
      font-family: monospace;
      font-size: 15px;
    ">
      <p style="margin: 0 0 6px;"><strong>אימייל:</strong> ${email}</p>
      <p style="margin: 0;"><strong>סיסמה זמנית:</strong> ${tempPassword}</p>
    </div>
    <p style="margin: 12px 0; color: #cc4444; font-size: 14px; font-weight: bold;">
      יש לשנות את הסיסמה בכניסה הראשונה.
    </p>
    <p style="margin: 12px 0 0; font-size: 14px; color: #888;">
      לשאלות פנה/י למנהל המערכת.
    </p>
  `;

  const html = createEmailHTML('ברוכים הבאים למערכת', body, [
    { label: 'כניסה למערכת', url: loginUrl, color: BRAND_GOLD },
  ]);

  await sendEmail(email, 'ברוכים הבאים למערכת ענה את השואל', html);
}

// ─── GET / ────────────────────────────────────────────────────────────────────

/**
 * List all rabbis with their current-week stats.
 *
 * Query params:
 *   status   – 'active' | 'inactive' | 'deleted'
 *   role     – 'rabbi' | 'admin'
 *   limit    – default 20, max 100
 *   offset   – default 0
 *   search   – substring match on name or email
 */
router.get('/', async (req, res, next) => {
  try {
    const { status, role, search } = req.query;
    const limit  = _parseLimit(req.query.limit);
    const offset = _parseOffset(req.query.offset);

    const filters = [];
    const params  = [];
    let   idx     = 1;

    if (status) {
      if (!['active', 'inactive', 'deleted'].includes(status)) {
        return res.status(400).json({ error: 'ערך status לא חוקי — active | inactive | deleted' });
      }
      params.push(status);
      filters.push(`r.status = $${idx++}`);
    }

    if (role) {
      if (!VALID_ROLES.has(role)) {
        return res.status(400).json({ error: 'ערך role לא חוקי — rabbi | admin | customer_service' });
      }
      params.push(role);
      filters.push(`r.role = $${idx++}`);
    }

    if (search) {
      const term = `%${search.trim()}%`;
      params.push(term);
      filters.push(`(r.name ILIKE $${idx} OR r.email ILIKE $${idx})`);
      idx++;
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const weekStart   = _currentWeekStart();

    params.push(weekStart);
    const weekParam = idx++;

    params.push(limit);
    const limitParam = idx++;

    params.push(offset);
    const offsetParam = idx++;

    const { rows } = await query(
      `SELECT
         r.id,
         r.name,
         r.email,
         r.role,
         r.phone,
         r.signature,
         r.status,
         r.is_vacation,
         r.notification_channel,
         r.preferred_categories,
         r.color_label,
         r.last_login_at,
         r.created_at,
         COALESCE(rs.answers_count, 0)  AS answers_count,
         rs.avg_response_minutes,
         rs.avg_response_time_hours,
         COALESCE(rs.thanks_count, 0)   AS thanks_count,
         COALESCE(rs.views_count, 0)    AS views_count
       FROM rabbis r
       LEFT JOIN rabbi_stats rs
              ON rs.rabbi_id = r.id AND rs.week_start = $${weekParam}
       ${whereClause}
       ORDER BY r.name ASC
       LIMIT  $${limitParam}
       OFFSET $${offsetParam}`,
      params
    );

    // Total count for pagination
    const countParams  = params.slice(0, filters.length);
    const countFilters = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const { rows: countRows } = await query(
      `SELECT COUNT(*) AS total FROM rabbis r ${countFilters}`,
      countParams
    );

    return res.json({
      rabbis: rows,
      total:  parseInt(countRows[0].total, 10),
      limit,
      offset,
    });
  } catch (err) {
    return next(err);
  }
});

// ─── POST / ───────────────────────────────────────────────────────────────────

/**
 * Create a new rabbi account and send a setup-password email.
 *
 * Body:
 *   name         {string}   required
 *   email        {string}   required
 *   role         {string}   'rabbi' | 'admin'   (default: 'rabbi')
 *   phone        {string}   optional
 *   signature    {string}   optional
 *   preferred_categories   {number[]}  optional
 *   notification_channel   {string}    optional
 *   color_label  {string}   optional
 */
router.post('/', async (req, res, next) => {
  try {
    const {
      name,
      email,
      role = 'rabbi',
      phone,
      signature,
      preferred_categories,
      notification_channel,
      color_label,
    } = req.body ?? {};

    // ── Validation ───────────────────────────────────────────────────────────
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'שם הרב הוא שדה חובה' });
    }
    if (name.trim().length < 2 || name.trim().length > 100) {
      return res.status(400).json({ error: 'שם הרב חייב להיות בין 2 ל-100 תווים' });
    }
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'כתובת אימייל היא שדה חובה' });
    }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email.trim())) {
      return res.status(400).json({ error: 'כתובת אימייל אינה תקינה' });
    }
    if (!VALID_ROLES.has(role)) {
      return res.status(400).json({ error: 'תפקיד לא חוקי — rabbi | admin | customer_service' });
    }
    if (phone && !/^\+?[\d\s\-()]{7,20}$/.test(phone)) {
      return res.status(400).json({ error: 'מספר טלפון אינו תקין' });
    }
    if (preferred_categories !== undefined) {
      if (!Array.isArray(preferred_categories) ||
          preferred_categories.some((c) => !Number.isInteger(c) || c < 1)) {
        return res.status(400).json({ error: 'preferred_categories חייב להיות מערך של מספרים שלמים חיוביים' });
      }
    }

    const VALID_CHANNELS = new Set(['email', 'whatsapp', 'both', 'push']);
    if (notification_channel && !VALID_CHANNELS.has(notification_channel)) {
      return res.status(400).json({ error: 'ערוץ התראה לא חוקי — email | whatsapp | both | push' });
    }

    // ── Create ───────────────────────────────────────────────────────────────
    const { rabbi, tempPassword } = await createRabbi({
      name:                 name.trim(),
      email:                email.trim(),
      role,
      phone:                phone?.trim() || undefined,
      signature:            signature?.trim() || undefined,
      preferred_categories: preferred_categories || [],
      notification_channel: notification_channel || 'email',
      color_label:          color_label || undefined,
    });

    // ── Send welcome email (non-fatal) ────────────────────────────────────────
    try {
      await _sendSetupEmail(rabbi.email, rabbi.name, tempPassword);
    } catch (emailErr) {
      console.error('[admin/rabbis] שגיאה בשליחת מייל ברוך הבא:', emailErr.message);
    }

    // ── Audit ────────────────────────────────────────────────────────────────
    setImmediate(() => {
      createAuditEntry(
        req.rabbi.id,
        ACTIONS.RABBI_CREATED,
        'rabbi',
        rabbi.id,
        null,
        { name: rabbi.name, email: rabbi.email, role: rabbi.role }
      ).catch(() => {});
    });

    return res.status(201).json({
      rabbi,
      message: 'הרב נוצר בהצלחה. נשלח אימייל עם פרטי כניסה.',
    });
  } catch (err) {
    if (err.status === 409) {
      return res.status(409).json({ error: err.message });
    }
    return next(err);
  }
});

// ─── PUT /:id ─────────────────────────────────────────────────────────────────

/**
 * Edit rabbi details.
 *
 * Editable: name, email, phone, signature, preferred_categories,
 *           notification_channel, color_label
 * (Status and role have dedicated endpoints.)
 */
router.put('/:id', async (req, res, next) => {
  try {
    const targetId = req.params.id;

    // Verify rabbi exists
    const { rows: existing } = await query(
      `SELECT id, name, email, role, status FROM rabbis WHERE id = $1`,
      [targetId]
    );
    if (!existing[0]) {
      return res.status(404).json({ error: 'רב לא נמצא' });
    }
    const oldRabbi = existing[0];

    const body = req.body ?? {};
    const EDITABLE = ['name', 'email', 'phone', 'signature',
      'preferred_categories', 'notification_channel', 'color_label'];

    const setClauses = [];
    const params     = [];
    let   idx        = 1;

    for (const key of EDITABLE) {
      if (!(key in body)) continue;
      const val = body[key];

      if (key === 'name') {
        const t = String(val).trim();
        if (t.length < 2 || t.length > 100) {
          return res.status(400).json({ error: 'שם חייב להיות בין 2 ל-100 תווים' });
        }
        params.push(t);
      } else if (key === 'email') {
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRe.test(String(val).trim())) {
          return res.status(400).json({ error: 'כתובת אימייל אינה תקינה' });
        }
        const lc = String(val).toLowerCase().trim();
        const { rows: dup } = await query(
          `SELECT id FROM rabbis WHERE email = $1 AND id <> $2`,
          [lc, targetId]
        );
        if (dup[0]) {
          return res.status(409).json({ error: 'כתובת אימייל זו כבר בשימוש' });
        }
        params.push(lc);
      } else if (key === 'phone') {
        if (val !== null && !/^\+?[\d\s\-()]{7,20}$/.test(String(val))) {
          return res.status(400).json({ error: 'מספר טלפון אינו תקין' });
        }
        params.push(val ? String(val).trim() : null);
      } else if (key === 'signature') {
        params.push(val === null ? null : String(val).trim().slice(0, 1000));
      } else if (key === 'preferred_categories') {
        if (!Array.isArray(val) || val.some((c) => !Number.isInteger(c) || c < 1)) {
          return res.status(400).json({ error: 'preferred_categories חייב להיות מערך של מספרים שלמים חיוביים' });
        }
        params.push(val);
      } else if (key === 'notification_channel') {
        const VALID_CH = new Set(['email', 'whatsapp', 'both', 'push']);
        if (!VALID_CH.has(val)) {
          return res.status(400).json({ error: 'ערוץ התראה לא חוקי — email | whatsapp | both | push' });
        }
        params.push(val);
      } else if (key === 'color_label') {
        params.push(val ? String(val).trim().slice(0, 50) : null);
      } else {
        params.push(val);
      }

      setClauses.push(`${key} = $${idx++}`);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'לא סופקו שדות לעדכון' });
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(targetId);

    const { rows } = await query(
      `UPDATE rabbis
       SET    ${setClauses.join(', ')}
       WHERE  id = $${idx}
       RETURNING
         id, name, email, role, phone, signature, status,
         preferred_categories, notification_channel, color_label,
         is_vacation, updated_at`,
      params
    );

    setImmediate(() => {
      createAuditEntry(
        req.rabbi.id,
        ACTIONS.RABBI_UPDATED,
        'rabbi',
        targetId,
        { name: oldRabbi.name, email: oldRabbi.email },
        { name: rows[0].name,  email: rows[0].email  },
        _clientIp(req)
      ).catch(() => {});
    });

    return res.json({ rabbi: rows[0] });
  } catch (err) {
    return next(err);
  }
});

// ─── PUT /:id/status ──────────────────────────────────────────────────────────

/**
 * Activate or deactivate a rabbi.
 *
 * Body: { status: 'active' | 'inactive' }
 */
router.put('/:id/status', async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const { status } = req.body ?? {};

    if (!VALID_STATUSES.has(status)) {
      return res.status(400).json({ error: 'ערך status לא חוקי — active | inactive' });
    }

    // Prevent admin from deactivating themselves
    if (status === 'inactive' && String(req.rabbi.id) === String(targetId)) {
      return res.status(400).json({ error: 'לא ניתן לבטל את הפעילות של החשבון הנוכחי' });
    }

    const { rows } = await query(
      `UPDATE rabbis
       SET    status     = $1,
              updated_at = NOW()
       WHERE  id = $2
         AND  status <> 'deleted'
       RETURNING id, name, status, updated_at`,
      [status, targetId]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'רב לא נמצא או שחשבון מחוק' });
    }

    const action = status === 'active'
      ? ACTIONS.RABBI_REACTIVATED
      : ACTIONS.RABBI_DEACTIVATED;

    setImmediate(() => {
      createAuditEntry(
        req.rabbi.id,
        action,
        'rabbi',
        targetId,
        null,
        { status },
        _clientIp(req)
      ).catch(() => {});
    });

    const message = status === 'active'
      ? `${rows[0].name} הופעל/ה מחדש בהצלחה`
      : `${rows[0].name} הושבת/ה בהצלחה`;

    return res.json({ message, rabbi: rows[0] });
  } catch (err) {
    return next(err);
  }
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

/**
 * Soft-delete a rabbi by setting status = 'deleted'.
 * A deleted rabbi cannot log in and is excluded from all active queries.
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const targetId = req.params.id;

    if (String(req.rabbi.id) === String(targetId)) {
      return res.status(400).json({ error: 'לא ניתן למחוק את החשבון הנוכחי' });
    }

    const { rows } = await query(
      `UPDATE rabbis
       SET    status     = 'deleted',
              updated_at = NOW()
       WHERE  id = $1
         AND  status <> 'deleted'
       RETURNING id, name, status`,
      [targetId]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'רב לא נמצא או שכבר מחוק' });
    }

    setImmediate(() => {
      createAuditEntry(
        req.rabbi.id,
        ACTIONS.RABBI_DELETED,
        'rabbi',
        targetId,
        null,
        { status: 'deleted' },
        _clientIp(req)
      ).catch(() => {});
    });

    return res.json({ message: `${rows[0].name} נמחק/ה מהמערכת בהצלחה`, rabbi: rows[0] });
  } catch (err) {
    return next(err);
  }
});

// ─── PUT /:id/role ────────────────────────────────────────────────────────────

/**
 * Change a rabbi's role.
 *
 * Body: { role: 'rabbi' | 'admin' }
 */
router.put('/:id/role', async (req, res, next) => {
  try {
    const targetId  = req.params.id;
    const { role }  = req.body ?? {};

    if (!VALID_ROLES.has(role)) {
      return res.status(400).json({ error: 'תפקיד לא חוקי — rabbi | admin | customer_service' });
    }

    // Prevent admin from demoting themselves (would lock them out)
    if (role === 'rabbi' && String(req.rabbi.id) === String(targetId)) {
      return res.status(400).json({ error: 'לא ניתן לשנות את תפקיד החשבון הנוכחי' });
    }

    const { rows: existing } = await query(
      `SELECT id, name, role FROM rabbis WHERE id = $1 AND status <> 'deleted'`,
      [targetId]
    );
    if (!existing[0]) {
      return res.status(404).json({ error: 'רב לא נמצא' });
    }
    const oldRole = existing[0].role;

    const { rows } = await query(
      `UPDATE rabbis
       SET    role       = $1,
              updated_at = NOW()
       WHERE  id = $2
       RETURNING id, name, role, updated_at`,
      [role, targetId]
    );

    setImmediate(() => {
      createAuditEntry(
        req.rabbi.id,
        ACTIONS.ADMIN_ROLE_CHANGED,
        'rabbi',
        targetId,
        { role: oldRole },
        { role },
        _clientIp(req)
      ).catch(() => {});
    });

    return res.json({
      message: `תפקיד ${rows[0].name} שונה ל-${role} בהצלחה`,
      rabbi:   rows[0],
    });
  } catch (err) {
    return next(err);
  }
});

// ─── GET /:id/audit ───────────────────────────────────────────────────────────

/**
 * Retrieve the audit log for a specific rabbi (actions they performed).
 *
 * Query params:
 *   limit  – default 20, max 100
 *   offset – default 0
 *   action – filter by action string (partial match)
 */
router.get('/:id/audit', async (req, res, next) => {
  try {
    const targetId = req.params.id;

    // Verify the rabbi exists
    const { rows: check } = await query(
      `SELECT id FROM rabbis WHERE id = $1`,
      [targetId]
    );
    if (!check[0]) {
      return res.status(404).json({ error: 'רב לא נמצא' });
    }

    const limit  = _parseLimit(req.query.limit);
    const offset = _parseOffset(req.query.offset);

    const params  = [targetId];
    const filters = [`al.actor_id = $1`];
    let   idx     = 2;

    if (req.query.action) {
      params.push(`%${req.query.action.trim()}%`);
      filters.push(`al.action ILIKE $${idx++}`);
    }

    const whereClause = `WHERE ${filters.join(' AND ')}`;

    params.push(limit);
    const limitParam = idx++;
    params.push(offset);
    const offsetParam = idx++;

    const { rows } = await query(
      `SELECT
         al.id,
         al.action,
         al.entity_type,
         al.entity_id,
         al.old_value,
         al.new_value,
         al.ip,
         al.created_at
       FROM audit_log al
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT  $${limitParam}
       OFFSET $${offsetParam}`,
      params
    );

    const { rows: countRows } = await query(
      `SELECT COUNT(*) AS total FROM audit_log al ${whereClause}`,
      params.slice(0, filters.length)
    );

    return res.json({
      log:    rows,
      total:  parseInt(countRows[0].total, 10),
      limit,
      offset,
    });
  } catch (err) {
    return next(err);
  }
});

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = router;
