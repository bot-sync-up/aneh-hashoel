'use strict';

/**
 * Support Routes — /api/support
 *
 * POST   /contact          — Rabbi submits a support request
 * GET    /admin/support     — Admin lists all support requests (mounted via server.js)
 * PATCH  /admin/support/:id — Admin marks as handled
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

    // Fire-and-forget: send email to admin
    setImmediate(async () => {
      try {
        const { sendEmail } = require('../services/email');
        const { createEmailHTML } = require('../templates/emailBase');

        const adminEmail = process.env.ADMIN_EMAIL;
        if (!adminEmail) return;

        const rabbiName = req.rabbi.name || 'רב';
        const html = createEmailHTML({
          title: `פנייה חדשה מ${rabbiName}`,
          body: `<p><strong>נושא:</strong> ${subject.trim()}</p><p>${message.trim().replace(/\n/g, '<br>')}</p>`,
          ctaText: 'צפה בפניות',
          ctaUrl: `${process.env.APP_URL || 'http://localhost:3000'}/admin/support`,
        });

        await sendEmail(adminEmail, `פנייה חדשה: ${subject.trim()}`, html);
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

// ─── GET / — Admin: list all support requests ──────────────────────────────

router.get('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const status = req.query.status || 'all';
    const conditions = [];
    const params = [];
    let idx = 1;

    if (status === 'open') {
      conditions.push(`sr.status = 'open'`);
    } else if (status === 'handled') {
      conditions.push(`sr.status = 'handled'`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await dbQuery(
      `SELECT sr.*, r.name AS rabbi_name, r.email AS rabbi_email
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
