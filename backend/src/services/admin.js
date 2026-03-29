'use strict';

/**
 * Admin Business Logic Service
 *
 * Exports:
 *   getAllRabbis(filters)                 - list rabbis with filters
 *   createRabbi(data)                    - create rabbi account + welcome email
 *   updateRabbi(rabbiId, data)           - update rabbi profile (admin editing)
 *   deleteRabbi(rabbiId)                 - soft delete + reassign pending questions
 *   getSystemConfig()                    - get all system_config entries
 *   updateSystemConfig(key, value, adminId) - upsert system_config
 *   getAuditLog(filters)                - paginated audit log with filters
 *   exportQuestions(filters, format)     - export questions to Excel/PDF
 *   bulkUpdateQuestions(questionIds, updates) - bulk update questions
 *   sendBroadcast(message, targetRabbiIds)  - emergency broadcast
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const { query: dbQuery, withTransaction } = require('../db/pool');
const { logAction, ACTIONS } = require('../middleware/auditLog');
const { exportToExcel, exportToPDF } = require('./export');

// Notification helpers resolved lazily to avoid circular deps.
let _notificationEvents = null;
function getNotificationEvents() {
  if (!_notificationEvents) {
    _notificationEvents = require('../socket/notificationEvents');
  }
  return _notificationEvents;
}

const BCRYPT_ROUNDS = 12;

// ---------------------------------------------------------------------------
// getAllRabbis
// ---------------------------------------------------------------------------

/**
 * List rabbis with optional filters.
 *
 * @param {object} filters
 * @param {string} [filters.role]     - 'rabbi' | 'admin'
 * @param {number} [filters.group]    - group id
 * @param {boolean}[filters.active]   - is_active flag
 * @param {string} [filters.search]   - free-text search on name/email
 * @param {number} [filters.page]     - page number (1-based)
 * @param {number} [filters.limit]    - items per page
 * @returns {Promise<{ rabbis: object[], total: number }>}
 */
async function getAllRabbis(filters = {}) {
  const conditions = [];
  const params = [];
  let paramIdx = 0;

  if (filters.role) {
    conditions.push(`r.role = $${++paramIdx}`);
    params.push(filters.role);
  }

  if (filters.active !== undefined && filters.active !== null) {
    const isActive = filters.active === true || filters.active === 'true';
    conditions.push(`r.is_active = $${++paramIdx}`);
    params.push(isActive);
  }

  if (filters.search) {
    conditions.push(`(r.name ILIKE $${++paramIdx} OR r.email ILIKE $${paramIdx})`);
    params.push(`%${filters.search}%`);
  }

  if (filters.group) {
    conditions.push(`EXISTS (
      SELECT 1 FROM rabbi_group_members rgm
      WHERE rgm.rabbi_id = r.id AND rgm.group_id = $${++paramIdx}
    )`);
    params.push(filters.group);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  // Count
  const countResult = await dbQuery(
    `SELECT COUNT(*)::int AS total FROM rabbis r ${whereClause}`,
    params
  );
  const total = countResult.rows[0].total;

  // Paginated list
  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(filters.limit, 10) || 20));
  const offset = (page - 1) * limit;

  const listParams = [...params, limit, offset];

  const { rows } = await dbQuery(
    `SELECT r.id, r.name, r.email, r.role, r.photo_url, r.is_active,
            r.vacation_mode, r.notification_pref, r.max_open_questions,
            r.milestone_count, r.created_at, r.updated_at
     FROM rabbis r
     ${whereClause}
     ORDER BY r.created_at DESC
     LIMIT $${++paramIdx} OFFSET $${++paramIdx}`,
    listParams
  );

  return { rabbis: rows, total };
}

// ---------------------------------------------------------------------------
// createRabbi
// ---------------------------------------------------------------------------

/**
 * Create a new rabbi account.
 * Generates a random password, hashes it, and sends a welcome email.
 *
 * @param {object} data
 * @param {string} data.name
 * @param {string} data.email
 * @param {string} data.role   - 'rabbi' | 'admin'
 * @param {string} [data.password] - optional; auto-generated if omitted
 * @param {string} [data.adminId]  - the admin performing the creation
 * @param {string} [data.ip]       - request IP for audit
 * @returns {Promise<object>} created rabbi row
 */
async function createRabbi(data) {
  const { name, email, role, adminId, ip } = data;

  // Check for duplicate email
  const existing = await dbQuery(
    'SELECT id FROM rabbis WHERE email = $1',
    [email.toLowerCase().trim()]
  );
  if (existing.rows.length > 0) {
    const e = new Error('כתובת האימייל כבר קיימת במערכת');
    e.status = 409;
    throw e;
  }

  // Password: use provided or generate random
  const rawPassword = data.password || crypto.randomBytes(12).toString('base64url');
  const passwordHash = await bcrypt.hash(rawPassword, BCRYPT_ROUNDS);

  const { rows } = await dbQuery(
    `INSERT INTO rabbis (name, email, password_hash, role, is_active)
     VALUES ($1, $2, $3, $4, true)
     RETURNING id, name, email, role, is_active, created_at`,
    [name.trim(), email.toLowerCase().trim(), passwordHash, role]
  );

  const rabbi = rows[0];

  // Audit log
  await logAction(
    adminId || null,
    ACTIONS.RABBI_CREATED,
    'rabbi',
    rabbi.id,
    null,
    { name: rabbi.name, email: rabbi.email, role: rabbi.role },
    ip || null,
    null
  );

  // Send welcome email (fire-and-forget)
  _sendWelcomeEmail(rabbi, rawPassword).catch((err) => {
    console.error('[admin] שגיאה בשליחת מייל ברוכים הבאים:', err.message);
  });

  return rabbi;
}

/**
 * Send welcome email to newly created rabbi.
 * @private
 */
async function _sendWelcomeEmail(rabbi, rawPassword) {
  try {
    const nodemailer = require('nodemailer');
    const { createEmailHTML } = require('../templates/emailBase');

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const loginUrl = `${(process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '')}/login`;

    const body = `
      <p>שלום ${rabbi.name},</p>
      <p>חשבון חדש נוצר עבורך במערכת <strong>ענה את השואל</strong>.</p>
      <p>להלן פרטי ההתחברות שלך:</p>
      <ul style="list-style: none; padding: 0;">
        <li><strong>אימייל:</strong> ${rabbi.email}</li>
        <li><strong>סיסמה:</strong> ${rawPassword}</li>
      </ul>
      <p>מומלץ לשנות את הסיסמה מיד לאחר ההתחברות הראשונה.</p>
    `;

    const html = createEmailHTML('ברוכים הבאים למערכת', body, [
      { label: 'כניסה למערכת', url: loginUrl },
    ]);

    await transporter.sendMail({
      from: process.env.SMTP_FROM || '"ענה את השואל" <noreply@aneh-hashoel.co.il>',
      to: rabbi.email,
      subject: 'ברוכים הבאים למערכת ענה את השואל',
      html,
    });
  } catch (err) {
    // Log but do not throw — welcome email failure should not block creation
    console.error('[admin] _sendWelcomeEmail error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// updateRabbi
// ---------------------------------------------------------------------------

/**
 * Update a rabbi profile (admin editing another rabbi).
 *
 * @param {string} rabbiId
 * @param {object} data     - fields to update
 * @param {string} [data.adminId] - admin performing the update
 * @param {string} [data.ip]
 * @returns {Promise<object>} updated rabbi row
 */
async function updateRabbi(rabbiId, data) {
  const { adminId, ip, ...fields } = data;

  // Fetch current state for audit old_value
  const current = await dbQuery(
    `SELECT id, name, email, role, is_active, photo_url, signature,
            notification_pref, max_open_questions, vacation_mode
     FROM rabbis WHERE id = $1`,
    [rabbiId]
  );

  if (current.rows.length === 0) {
    const e = new Error('רב לא נמצא');
    e.status = 404;
    throw e;
  }

  const oldValue = current.rows[0];

  // Build dynamic SET clause
  const allowedFields = [
    'name', 'email', 'role', 'photo_url', 'signature',
    'notification_pref', 'max_open_questions', 'vacation_mode',
    'vacation_until', 'is_active', 'availability_hours',
  ];

  const setClauses = [];
  const setParams = [];
  let idx = 0;

  for (const field of allowedFields) {
    if (fields[field] !== undefined) {
      let value = fields[field];
      // Lowercase email
      if (field === 'email' && typeof value === 'string') {
        value = value.toLowerCase().trim();
      }
      setClauses.push(`${field} = $${++idx}`);
      setParams.push(value);
    }
  }

  // Handle password change separately
  if (fields.password) {
    const hash = await bcrypt.hash(fields.password, BCRYPT_ROUNDS);
    setClauses.push(`password_hash = $${++idx}`);
    setParams.push(hash);
  }

  if (setClauses.length === 0) {
    const e = new Error('לא סופקו שדות לעדכון');
    e.status = 400;
    throw e;
  }

  setParams.push(rabbiId);

  const { rows } = await dbQuery(
    `UPDATE rabbis SET ${setClauses.join(', ')}
     WHERE id = $${++idx}
     RETURNING id, name, email, role, is_active, photo_url, signature,
               notification_pref, max_open_questions, vacation_mode, updated_at`,
    setParams
  );

  const updated = rows[0];

  // Audit
  await logAction(
    adminId || null,
    ACTIONS.RABBI_UPDATED,
    'rabbi',
    rabbiId,
    oldValue,
    fields,
    ip || null,
    null
  );

  return updated;
}

// ---------------------------------------------------------------------------
// deleteRabbi  (soft-delete)
// ---------------------------------------------------------------------------

/**
 * Soft-delete a rabbi (set is_active=false) and reassign their pending questions.
 *
 * @param {string} rabbiId
 * @param {string} [adminId]
 * @param {string} [ip]
 * @returns {Promise<{ deactivated: boolean, reassignedCount: number }>}
 */
async function deleteRabbi(rabbiId, adminId, ip) {
  // Verify rabbi exists
  const check = await dbQuery(
    'SELECT id, name, email, is_active FROM rabbis WHERE id = $1',
    [rabbiId]
  );

  if (check.rows.length === 0) {
    const e = new Error('רב לא נמצא');
    e.status = 404;
    throw e;
  }

  const rabbi = check.rows[0];

  if (!rabbi.is_active) {
    const e = new Error('הרב כבר מושבת');
    e.status = 400;
    throw e;
  }

  // Cannot deactivate yourself
  if (String(rabbiId) === String(adminId)) {
    const e = new Error('לא ניתן להשבית את החשבון שלך');
    e.status = 400;
    throw e;
  }

  let reassignedCount = 0;

  await withTransaction(async (client) => {
    // Deactivate
    await client.query(
      'UPDATE rabbis SET is_active = false WHERE id = $1',
      [rabbiId]
    );

    // Reassign pending/in_process questions back to pool
    const reassign = await client.query(
      `UPDATE questions
       SET assigned_rabbi_id = NULL,
           status = 'pending',
           lock_timestamp = NULL
       WHERE assigned_rabbi_id = $1
         AND status IN ('pending', 'in_process')`,
      [rabbiId]
    );

    reassignedCount = reassign.rowCount || 0;
  });

  // Audit
  await logAction(
    adminId || null,
    ACTIONS.RABBI_DEACTIVATED,
    'rabbi',
    rabbiId,
    { is_active: true },
    { is_active: false, reassigned_questions: reassignedCount },
    ip || null,
    null
  );

  return { deactivated: true, reassignedCount };
}

// ---------------------------------------------------------------------------
// getSystemConfig
// ---------------------------------------------------------------------------

/**
 * Get all system_config entries.
 *
 * @returns {Promise<object[]>}
 */
async function getSystemConfig() {
  const { rows } = await dbQuery(
    'SELECT key, value, updated_by, updated_at FROM system_config ORDER BY key'
  );
  return rows;
}

// ---------------------------------------------------------------------------
// updateSystemConfig
// ---------------------------------------------------------------------------

/**
 * Upsert a system_config entry.
 *
 * @param {string} key
 * @param {*}      value    - will be stored as JSONB
 * @param {string} adminId
 * @param {string} [ip]
 * @returns {Promise<object>}
 */
async function updateSystemConfig(key, value, adminId, ip) {
  if (!key) {
    const e = new Error('מפתח הגדרה נדרש');
    e.status = 400;
    throw e;
  }

  // Fetch old value for audit
  const old = await dbQuery(
    'SELECT value FROM system_config WHERE key = $1',
    [key]
  );
  const oldValue = old.rows.length > 0 ? old.rows[0].value : null;

  const { rows } = await dbQuery(
    `INSERT INTO system_config (key, value, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (key) DO UPDATE
     SET value = $2, updated_by = $3, updated_at = NOW()
     RETURNING key, value, updated_by, updated_at`,
    [key, JSON.stringify(value), adminId]
  );

  // Audit
  await logAction(
    adminId,
    ACTIONS.ADMIN_CONFIG_CHANGED,
    'system_config',
    key,
    { value: oldValue },
    { value },
    ip || null,
    null
  );

  return rows[0];
}

// ---------------------------------------------------------------------------
// getAuditLog
// ---------------------------------------------------------------------------

/**
 * Paginated audit log with filters.
 *
 * @param {object} filters
 * @param {string} [filters.actor]       - actor rabbi ID
 * @param {string} [filters.action]      - action type filter
 * @param {string} [filters.entity_type] - entity type filter
 * @param {string} [filters.dateFrom]    - ISO date string
 * @param {string} [filters.dateTo]      - ISO date string
 * @param {number} [filters.page]        - 1-based
 * @param {number} [filters.limit]       - items per page
 * @returns {Promise<{ entries: object[], total: number }>}
 */
async function getAuditLog(filters = {}) {
  const conditions = [];
  const params = [];
  let paramIdx = 0;

  if (filters.actor) {
    conditions.push(`al.actor_id = $${++paramIdx}`);
    params.push(filters.actor);
  }

  if (filters.action) {
    conditions.push(`al.action = $${++paramIdx}`);
    params.push(filters.action);
  }

  if (filters.entity_type) {
    conditions.push(`al.entity_type = $${++paramIdx}`);
    params.push(filters.entity_type);
  }

  if (filters.entity_id) {
    conditions.push(`al.entity_id = $${++paramIdx}`);
    params.push(filters.entity_id);
  }

  if (filters.dateFrom) {
    conditions.push(`al.created_at >= $${++paramIdx}`);
    params.push(filters.dateFrom);
  }

  if (filters.dateTo) {
    conditions.push(`al.created_at <= $${++paramIdx}`);
    params.push(filters.dateTo);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  // Count
  const countResult = await dbQuery(
    `SELECT COUNT(*)::int AS total FROM audit_log al ${whereClause}`,
    params
  );
  const total = countResult.rows[0].total;

  // Paginated results
  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(filters.limit, 10) || 50));
  const offset = (page - 1) * limit;

  const listParams = [...params, limit, offset];

  const { rows } = await dbQuery(
    `SELECT al.id, al.actor_id, r.name AS actor_name,
            al.action, al.entity_type, al.entity_id,
            al.old_value, al.new_value,
            al.ip, al.created_at
     FROM audit_log al
     LEFT JOIN rabbis r ON r.id = al.actor_id
     ${whereClause}
     ORDER BY al.created_at DESC
     LIMIT $${++paramIdx} OFFSET $${++paramIdx}`,
    listParams
  );

  return { entries: rows, total };
}

// ---------------------------------------------------------------------------
// exportQuestions
// ---------------------------------------------------------------------------

/**
 * Export filtered questions with answers to Excel or PDF.
 *
 * @param {object} filters
 * @param {string} [filters.status]
 * @param {string} [filters.dateFrom]
 * @param {string} [filters.dateTo]
 * @param {number} [filters.category]
 * @param {string} format  - 'excel' | 'pdf'
 * @param {string} [adminId]
 * @param {string} [ip]
 * @returns {Promise<{ buffer: Buffer, contentType: string, filename: string }>}
 */
async function exportQuestions(filters = {}, format, adminId, ip) {
  const conditions = [];
  const params = [];
  let paramIdx = 0;

  if (filters.status) {
    conditions.push(`q.status = $${++paramIdx}`);
    params.push(filters.status);
  }

  if (filters.dateFrom) {
    conditions.push(`q.created_at >= $${++paramIdx}`);
    params.push(filters.dateFrom);
  }

  if (filters.dateTo) {
    conditions.push(`q.created_at <= $${++paramIdx}`);
    params.push(filters.dateTo);
  }

  if (filters.category) {
    conditions.push(`q.category_id = $${++paramIdx}`);
    params.push(filters.category);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const { rows: questions } = await dbQuery(
    `SELECT q.id, q.title, q.content, q.status, q.urgency,
            q.created_at, q.answered_at,
            c.name AS category_name,
            r.name AS rabbi_name,
            a.content AS answer_content
     FROM questions q
     LEFT JOIN categories c ON c.id = q.category_id
     LEFT JOIN rabbis r ON r.id = q.assigned_rabbi_id
     LEFT JOIN LATERAL (
       SELECT content FROM answers
       WHERE  question_id = q.id
       ORDER  BY created_at DESC
       LIMIT  1
     ) a ON true
     ${whereClause}
     ORDER BY q.created_at DESC`,
    params
  );

  let buffer;
  let contentType;
  let filename;

  if (format === 'pdf') {
    buffer = await exportToPDF(questions);
    contentType = 'application/pdf';
    filename = `questions_export_${Date.now()}.pdf`;
  } else {
    buffer = await exportToExcel(questions);
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    filename = `questions_export_${Date.now()}.xlsx`;
  }

  // Audit
  await logAction(
    adminId || null,
    ACTIONS.ADMIN_BULK_EXPORT,
    'question',
    null,
    null,
    { format, filters, count: questions.length },
    ip || null,
    null
  );

  return { buffer, contentType, filename };
}

// ---------------------------------------------------------------------------
// bulkUpdateQuestions
// ---------------------------------------------------------------------------

/**
 * Bulk update status/category/urgency for multiple questions.
 *
 * @param {string[]} questionIds
 * @param {object}   updates       - { status, category_id, urgency }
 * @param {string}   [adminId]
 * @param {string}   [ip]
 * @returns {Promise<{ updatedCount: number }>}
 */
async function bulkUpdateQuestions(questionIds, updates, adminId, ip) {
  if (!Array.isArray(questionIds) || questionIds.length === 0) {
    const e = new Error('יש לספק לפחות שאלה אחת לעדכון');
    e.status = 400;
    throw e;
  }

  const setClauses = [];
  const params = [];
  let idx = 0;

  if (updates.status) {
    const validStatuses = ['pending', 'in_process', 'answered', 'hidden'];
    if (!validStatuses.includes(updates.status)) {
      const e = new Error('סטטוס לא חוקי');
      e.status = 400;
      throw e;
    }
    setClauses.push(`status = $${++idx}`);
    params.push(updates.status);
  }

  if (updates.category_id !== undefined) {
    setClauses.push(`category_id = $${++idx}`);
    params.push(updates.category_id);
  }

  if (updates.urgency) {
    const validUrgency = ['normal', 'urgent'];
    if (!validUrgency.includes(updates.urgency)) {
      const e = new Error('דחיפות לא חוקית');
      e.status = 400;
      throw e;
    }
    setClauses.push(`urgency = $${++idx}`);
    params.push(updates.urgency);
  }

  if (setClauses.length === 0) {
    const e = new Error('לא סופקו שדות לעדכון');
    e.status = 400;
    throw e;
  }

  // Add question IDs as array parameter
  params.push(questionIds);

  const result = await dbQuery(
    `UPDATE questions SET ${setClauses.join(', ')}
     WHERE id = ANY($${++idx})`,
    params
  );

  // Audit
  await logAction(
    adminId || null,
    'admin.bulk_update',
    'question',
    null,
    null,
    { question_ids: questionIds, updates },
    ip || null,
    null
  );

  return { updatedCount: result.rowCount || 0 };
}

// ---------------------------------------------------------------------------
// sendBroadcast
// ---------------------------------------------------------------------------

/**
 * Send an emergency broadcast via the notification system.
 *
 * @param {string}   message         - broadcast message text
 * @param {string[]} targetRabbiIds  - specific rabbi IDs (empty = all)
 * @param {object}   options
 * @param {object}   options.io      - Socket.io server instance
 * @param {string}   [options.adminId]
 * @param {string}   [options.ip]
 * @returns {Promise<{ sent: boolean, recipientCount: number }>}
 */
async function sendBroadcast(message, targetRabbiIds, options = {}) {
  const { io, adminId, ip } = options;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    const e = new Error('יש לספק הודעה לשידור');
    e.status = 400;
    throw e;
  }

  const notificationEvents = getNotificationEvents();

  if (!targetRabbiIds || targetRabbiIds.length === 0) {
    // Broadcast to all
    if (io) {
      notificationEvents.sendEmergencyBroadcast(io, message.trim());
    }

    // Also persist to notifications_log for all active rabbis
    const { rows: activeRabbis } = await dbQuery(
      'SELECT id FROM rabbis WHERE is_active = true'
    );

    for (const rabbi of activeRabbis) {
      await dbQuery(
        `INSERT INTO notifications_log (rabbi_id, type, channel, content, status)
         VALUES ($1, 'emergency_broadcast', 'push', $2, 'sent')`,
        [rabbi.id, JSON.stringify({ message: message.trim() })]
      );
    }

    // Audit
    await logAction(
      adminId || null,
      'admin.broadcast',
      'notification',
      null,
      null,
      { message: message.trim(), target: 'all', count: activeRabbis.length },
      ip || null,
      null
    );

    return { sent: true, recipientCount: activeRabbis.length };
  }

  // Targeted broadcast
  for (const rabbiId of targetRabbiIds) {
    if (io) {
      notificationEvents.sendNotification(io, rabbiId, {
        title: 'הודעה דחופה מהנהלת המערכת',
        body: message.trim(),
        type: 'warning',
      });
    }

    await dbQuery(
      `INSERT INTO notifications_log (rabbi_id, type, channel, content, status)
       VALUES ($1, 'emergency_broadcast', 'push', $2, 'sent')`,
      [rabbiId, JSON.stringify({ message: message.trim() })]
    );
  }

  // Audit
  await logAction(
    adminId || null,
    'admin.broadcast',
    'notification',
    null,
    null,
    { message: message.trim(), target: targetRabbiIds, count: targetRabbiIds.length },
    ip || null,
    null
  );

  return { sent: true, recipientCount: targetRabbiIds.length };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  getAllRabbis,
  createRabbi,
  updateRabbi,
  deleteRabbi,
  getSystemConfig,
  updateSystemConfig,
  getAuditLog,
  exportQuestions,
  bulkUpdateQuestions,
  sendBroadcast,
};
