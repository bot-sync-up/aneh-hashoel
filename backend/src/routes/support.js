'use strict';

/**
 * Support Routes — /api/support
 *
 * POST   /contact          — Rabbi submits a support request
 * GET    /my               — Rabbi: list my support requests
 * GET    /:id/messages     — Get messages for a support request
 * POST   /:id/messages     — Add a message to a support request (rabbi or admin)
 *
 * Admin routes (mounted at /api/admin/support via server.js):
 * GET    /                 — Admin lists all support requests
 * PATCH  /:id              — Admin marks as handled
 * GET    /:id/messages     — Get messages (also accessible here)
 * POST   /:id/messages     — Add a message (also accessible here)
 */

const express = require('express');
const { query: dbQuery } = require('../db/pool');
const { authenticate, requireAdmin } = require('../middleware/authenticate');

const router = express.Router();

// ─── POST /contact — Rabbi submits support request ──────────────────────────

router.post('/contact', authenticate, async (req, res, next) => {
  try {
    const { subject, message } = req.body;
    const rabbiId = req.rabbi.id;

    if (!subject || typeof subject !== 'string' || !subject.trim()) {
      return res.status(400).json({ error: 'נושא הפנייה נדרש' });
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'תוכן ההודעה נדרש' });
    }
    if (subject.trim().length > 200) {
      return res.status(400).json({ error: 'נושא הפנייה לא יכול לעלות על 200 תווים' });
    }

    const { rows } = await dbQuery(
      `INSERT INTO support_requests (rabbi_id, subject, message, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'open', NOW(), NOW())
       RETURNING id, subject, message, status, created_at`,
      [rabbiId, subject.trim(), message.trim()]
    );

    const requestId = rows[0].id;

    // Also insert the initial message into support_messages for conversation thread
    await dbQuery(
      `INSERT INTO support_messages (request_id, sender_id, sender_role, message, created_at)
       VALUES ($1, $2, 'rabbi', $3, NOW())`,
      [requestId, rabbiId, message.trim()]
    );

    // Fire-and-forget: send email notification to all admins
    setImmediate(async () => {
      try {
        const { sendEmail } = require('../services/email');
        const { createEmailHTML } = require('../templates/emailBase');

        const rabbiName = req.rabbi.name || 'רב';
        const subjectLine = `פנייה חדשה מ-${rabbiName}: ${subject.trim()}`;
        const html = createEmailHTML(
          `פנייה חדשה מ${rabbiName}`,
          `<p><strong>נושא:</strong> ${subject.trim()}</p><p>${message.trim().replace(/\n/g, '<br>')}</p>`,
          [{ label: 'צפה בפניות', url: `${process.env.APP_URL || ''}/admin/support` }]
        );

        // Collect all admin email addresses
        const adminEmails = new Set();

        // 1. From environment variable
        const envAdmin = process.env.ADMIN_EMAIL;
        if (envAdmin) adminEmails.add(envAdmin);

        // 2. From database — all rabbis with role='admin'
        try {
          const { rows: adminRows } = await dbQuery(
            `SELECT email FROM rabbis WHERE role = 'admin' AND is_active = true`
          );
          for (const row of adminRows) {
            if (row.email) adminEmails.add(row.email);
          }
        } catch (dbErr) {
          console.warn('[support] Failed to fetch admin emails from DB:', dbErr.message);
        }

        if (adminEmails.size === 0) {
          console.warn('[support] No admin emails found — skipping notification');
          return;
        }

        // Send to each admin
        const sendPromises = [...adminEmails].map((email) =>
          sendEmail(email, subjectLine, html).catch((e) =>
            console.error(`[support] Failed to notify admin ${email}:`, e.message)
          )
        );
        await Promise.all(sendPromises);
      } catch (err) {
        console.error('[support] Failed to send admin notification:', err.message);
      }
    });

    return res.status(201).json({
      ok: true,
      message: 'הפנייה נשלחה בהצלחה',
      request: rows[0],
    });
  } catch (err) {
    return next(err);
  }
});

// ─── GET /my — Rabbi: list my support requests ────────────────────────────

router.get('/my', authenticate, async (req, res, next) => {
  try {
    const { rows } = await dbQuery(
      `SELECT sr.*,
              (SELECT COUNT(*) FROM support_messages sm WHERE sm.request_id = sr.id)::int AS message_count
       FROM support_requests sr
       WHERE sr.rabbi_id = $1
       ORDER BY sr.updated_at DESC
       LIMIT 50`,
      [req.rabbi.id]
    );

    return res.json({ requests: rows });
  } catch (err) {
    return next(err);
  }
});

// ─── GET /:id/messages — Get messages for a support request ─────────────

router.get('/:id/messages', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const isAdmin = req.rabbi.role === 'admin';

    // Verify access: admin can see all, rabbi can only see own
    if (!isAdmin) {
      const { rows: reqRows } = await dbQuery(
        `SELECT rabbi_id FROM support_requests WHERE id = $1`,
        [id]
      );
      if (!reqRows[0]) {
        return res.status(404).json({ error: 'פנייה לא נמצאה' });
      }
      if (String(reqRows[0].rabbi_id) !== String(req.rabbi.id)) {
        return res.status(403).json({ error: 'אין הרשאה לצפות בפנייה זו' });
      }
    }

    const { rows } = await dbQuery(
      `SELECT sm.*, r.name AS sender_name
       FROM support_messages sm
       JOIN rabbis r ON r.id = sm.sender_id
       WHERE sm.request_id = $1
       ORDER BY sm.created_at ASC`,
      [id]
    );

    return res.json({ messages: rows });
  } catch (err) {
    return next(err);
  }
});

// ─── POST /:id/messages — Add message to support request ────────────────

router.post('/:id/messages', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    const isAdmin = req.rabbi.role === 'admin';

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'תוכן ההודעה נדרש' });
    }

    // Verify access
    const { rows: reqRows } = await dbQuery(
      `SELECT id, rabbi_id, status FROM support_requests WHERE id = $1`,
      [id]
    );
    if (!reqRows[0]) {
      return res.status(404).json({ error: 'פנייה לא נמצאה' });
    }

    if (!isAdmin && String(reqRows[0].rabbi_id) !== String(req.rabbi.id)) {
      return res.status(403).json({ error: 'אין הרשאה להוסיף הודעה לפנייה זו' });
    }

    const senderRole = isAdmin ? 'admin' : 'rabbi';

    const { rows } = await dbQuery(
      `INSERT INTO support_messages (request_id, sender_id, sender_role, message, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [id, req.rabbi.id, senderRole, message.trim()]
    );

    // Reopen request if it was handled and rabbi is posting
    if (!isAdmin && reqRows[0].status === 'handled') {
      await dbQuery(
        `UPDATE support_requests SET status = 'open', updated_at = NOW() WHERE id = $1`,
        [id]
      );
    }

    // Update the updated_at timestamp on the request
    await dbQuery(
      `UPDATE support_requests SET updated_at = NOW() WHERE id = $1`,
      [id]
    );

    // Get sender name
    const { rows: rabbiRows } = await dbQuery(
      `SELECT name FROM rabbis WHERE id = $1`,
      [req.rabbi.id]
    );

    // If admin replied — notify the rabbi via socket + email
    if (isAdmin) {
      const rabbiId = reqRows[0].rabbi_id;

      // Socket: real-time alert to the rabbi
      try {
        const io = req.app.get('io');
        if (io) {
          io.to(`rabbi:${rabbiId}`).emit('support:reply', {
            requestId: id,
            message: message.trim(),
            senderName: rabbiRows[0]?.name || 'מנהל',
          });
        }
      } catch (socketErr) {
        console.error('[support] Failed to emit support:reply socket event:', socketErr.message);
      }

      // Email: fire-and-forget
      setImmediate(async () => {
        try {
          const { sendSupportReply } = require('../services/email');
          const { rows: targetRabbi } = await dbQuery(
            `SELECT name, email FROM rabbis WHERE id = $1`,
            [rabbiId]
          );
          if (targetRabbi[0]?.email) {
            await sendSupportReply(
              targetRabbi[0].email,
              targetRabbi[0].name || 'רב',
              message.trim()
            );
          }
        } catch (emailErr) {
          console.error('[support] Failed to send support reply email:', emailErr.message);
        }
      });
    }

    return res.status(201).json({
      ok: true,
      message: { ...rows[0], sender_name: rabbiRows[0]?.name || 'רב' },
    });
  } catch (err) {
    return next(err);
  }
});

// ─── GET / — Admin: list all support requests ──────────────────────────────

router.get('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const status = req.query.status || 'all';
    const conditions = [];
    const params = [];

    if (status === 'open') {
      conditions.push(`sr.status = 'open'`);
    } else if (status === 'handled') {
      conditions.push(`sr.status = 'handled'`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await dbQuery(
      `SELECT sr.*, r.name AS rabbi_name, r.email AS rabbi_email,
              (SELECT COUNT(*) FROM support_messages sm WHERE sm.request_id = sr.id)::int AS message_count
       FROM support_requests sr
       JOIN rabbis r ON r.id = sr.rabbi_id
       ${where}
       ORDER BY sr.created_at DESC
       LIMIT 100`,
      params
    );

    return res.json({ requests: rows });
  } catch (err) {
    return next(err);
  }
});

// ─── PATCH /:id — Admin: mark as handled ────────────────────────────────────

router.patch('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const newStatus = status === 'open' ? 'open' : 'handled';

    const { rows } = await dbQuery(
      `UPDATE support_requests SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [newStatus, id]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'פנייה לא נמצאה' });
    }

    return res.json({ ok: true, request: rows[0] });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
