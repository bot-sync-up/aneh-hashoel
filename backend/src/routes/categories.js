'use strict';

const express = require('express');
const { query, withTransaction } = require('../db/pool');
const { authenticate, requireAdmin } = require('../middleware/authenticate');
const { getWPCategories, createWPCategory, deleteWPCategory } = require('../services/wpService');

const router = express.Router();
router.use(authenticate);

function buildTree(rows) {
  const map   = new Map();
  const roots = [];
  for (const row of rows) map.set(row.id, { ...row, children: [] });
  for (const row of rows) {
    const node = map.get(row.id);
    if (row.parent_id && map.has(row.parent_id)) map.get(row.parent_id).children.push(node);
    else roots.push(node);
  }
  function sortChildren(node) {
    node.children.sort((a, b) =>
      a.sort_order !== b.sort_order ? a.sort_order - b.sort_order : a.name.localeCompare(b.name, 'he')
    );
    node.children.forEach(sortChildren);
  }
  roots.sort((a, b) =>
    a.sort_order !== b.sort_order ? a.sort_order - b.sort_order : a.name.localeCompare(b.name, 'he')
  );
  roots.forEach(sortChildren);
  return roots;
}

// GET / — approved categories (+ own pending for rabbi)
router.get('/', async (req, res, next) => {
  try {
    const isAdmin = req.rabbi.role === 'admin';
    let rows;
    if (isAdmin) {
      ({ rows } = await query(
        `SELECT c.id, c.name, c.parent_id, c.sort_order, c.status, c.suggested_by, c.wp_term_id, c.created_at,
                COUNT(q.id)::int AS "questionCount"
         FROM   categories c
         LEFT JOIN questions q ON q.category_id = c.id
         WHERE  c.status IN ('approved','pending')
         GROUP BY c.id
         ORDER  BY c.sort_order, c.name`
      ));
    } else {
      ({ rows } = await query(
        `SELECT c.id, c.name, c.parent_id, c.sort_order, c.status, c.suggested_by, c.wp_term_id, c.created_at,
                COUNT(q.id)::int AS "questionCount"
         FROM   categories c
         LEFT JOIN questions q ON q.category_id = c.id
         WHERE  c.status = 'approved'
            OR (c.status = 'pending' AND c.suggested_by = $1)
         GROUP BY c.id
         ORDER  BY c.sort_order, c.name`,
        [req.rabbi.id]
      ));
    }
    const tree = buildTree(rows.filter(r => r.status === 'approved'));
    return res.json({ categories: tree });
  } catch (err) { return next(err); }
});

// GET /pending — admin: list pending suggestions with suggester name
router.get('/pending', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.id, c.name, c.parent_id, c.sort_order, c.status, c.suggested_by,
              c.created_at, r.name AS suggester_name
       FROM   categories c
       LEFT JOIN rabbis r ON r.id = c.suggested_by
       WHERE  c.status = 'pending'
       ORDER  BY c.created_at DESC`
    );
    return res.json({ suggestions: rows });
  } catch (err) { return next(err); }
});

// POST / — any rabbi can suggest; admins create directly
router.post('/', async (req, res, next) => {
  try {
    const isAdmin = req.rabbi.role === 'admin';
    const { name, parent_id = null, sort_order = 0 } = req.body ?? {};

    if (!name || typeof name !== 'string' || name.trim().length === 0)
      return res.status(400).json({ error: 'שם הקטגוריה נדרש' });
    const trimmedName = name.trim();
    if (trimmedName.length > 100)
      return res.status(400).json({ error: 'שם הקטגוריה לא יכול לעלות על 100 תווים' });

    const order = parseInt(sort_order, 10);
    if (!Number.isFinite(order))
      return res.status(400).json({ error: 'sort_order חייב להיות מספר שלם' });

    if (parent_id !== null && parent_id !== undefined) {
      const pid = parseInt(parent_id, 10);
      if (!Number.isFinite(pid))
        return res.status(400).json({ error: 'parent_id חייב להיות מספר שלם' });
      const { rows: parentRows } = await query(`SELECT id FROM categories WHERE id = $1`, [pid]);
      if (!parentRows[0])
        return res.status(400).json({ error: 'קטגוריית האב לא נמצאה' });
    }

    const { rows: dupRows } = await query(
      `SELECT id FROM categories
       WHERE  name = $1 AND status != 'rejected'
         AND  (parent_id = $2 OR (parent_id IS NULL AND $2 IS NULL))`,
      [trimmedName, parent_id || null]
    );
    if (dupRows[0])
      return res.status(409).json({ error: 'קטגוריה בשם זה כבר קיימת' });

    const status      = isAdmin ? 'approved' : 'pending';
    const suggestedBy = isAdmin ? null : req.rabbi.id;

    const { rows } = await query(
      `INSERT INTO categories (name, parent_id, sort_order, status, suggested_by, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id, name, parent_id, sort_order, status, suggested_by, created_at`,
      [trimmedName, parent_id || null, order, status, suggestedBy]
    );

    // If admin creates (approved), also create in WP — fire-and-forget
    if (isAdmin && rows[0]) {
      setImmediate(async () => {
        try {
          const wpResult = await createWPCategory(trimmedName);
          if (wpResult.success && wpResult.data?.id) {
            await query(
              `UPDATE categories SET wp_term_id = $1 WHERE id = $2`,
              [wpResult.data.id, rows[0].id]
            );
            rows[0].wp_term_id = wpResult.data.id;
            console.log(`[categories] WP category synced: localId=${rows[0].id} wpTermId=${wpResult.data.id}`);
          }
        } catch (err) {
          console.error('[categories] WP category creation failed (non-fatal):', err.message);
        }
      });
    }

    // Rabbi-suggested category → notify all admins by email (fire-and-forget).
    // UI already surfaces a badge via GET /categories/pending count.
    if (!isAdmin && rows[0]) {
      setImmediate(async () => {
        try {
          const { rows: admins } = await query(
            `SELECT email, name FROM rabbis
             WHERE role = 'admin' AND is_active = TRUE
               AND email IS NOT NULL AND email <> ''`
          );
          if (admins.length === 0) return;

          const { sendEmail } = require('../services/email');
          const { createEmailHTML } = require('../templates/emailBase');
          const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');

          const suggesterName = req.rabbi.name || 'רב';
          const body = `
            <p>שלום,</p>
            <p>הרב <strong>${suggesterName}</strong> הציע קטגוריה חדשה:</p>
            <div style="background:#f8f8fb;border-right:4px solid #B8973A;padding:14px 18px;margin:14px 0;border-radius:4px;">
              <p style="margin:0;font-size:15px;"><strong>${trimmedName}</strong></p>
            </div>
            <p>הקטגוריה ממתינה לאישור במערכת הניהול.</p>
          `;
          const html = createEmailHTML(
            'הצעת קטגוריה חדשה ממתינה לאישור',
            body,
            [{ label: 'לאישור הקטגוריה', url: `${appUrl}/admin/categories` }]
          );

          for (const admin of admins) {
            try {
              await sendEmail(
                admin.email,
                `קטגוריה חדשה להצעה: ${trimmedName}`,
                html
              );
            } catch (e) {
              console.warn(`[categories] admin notify failed for ${admin.email}:`, e.message);
            }
          }
        } catch (err) {
          console.error('[categories] admin notification error:', err.message);
        }
      });
    }

    const statusCode = isAdmin ? 201 : 202; // 202 = accepted for review
    const message    = isAdmin
      ? 'הקטגוריה נוצרה בהצלחה'
      : 'הצעת הקטגוריה נשלחה לאישור מנהל';

    return res.status(statusCode).json({ category: rows[0], message });
  } catch (err) { return next(err); }
});

// PUT /reorder — admin only
router.put('/reorder', requireAdmin, async (req, res, next) => {
  try {
    const { items } = req.body ?? {};
    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: '"items" חייב להיות מערך לא ריק' });
    for (const item of items) {
      if (!Number.isInteger(item.id) || !Number.isFinite(parseInt(item.sort_order, 10)))
        return res.status(400).json({ error: 'כל פריט ב-items חייב לכלול id ו-sort_order' });
    }
    await withTransaction(async (client) => {
      for (const item of items) {
        await client.query(
          `UPDATE categories SET sort_order = $1 WHERE id = $2`,
          [parseInt(item.sort_order, 10), item.id]
        );
      }
    });
    return res.json({ message: `סדר ${items.length} קטגוריות עודכן בהצלחה` });
  } catch (err) { return next(err); }
});

// PUT /:id/approve — admin approves a pending suggestion
router.put('/:id/approve', requireAdmin, async (req, res, next) => {
  try {
    const catId = parseInt(req.params.id, 10);
    if (!Number.isFinite(catId))
      return res.status(400).json({ error: 'מזהה קטגוריה אינו חוקי' });

    const { rows } = await query(
      `UPDATE categories SET status = 'approved', updated_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING id, name, status`,
      [catId]
    );
    if (!rows[0])
      return res.status(404).json({ error: 'הצעת קטגוריה לא נמצאה' });

    return res.json({ category: rows[0], message: 'הקטגוריה אושרה' });
  } catch (err) { return next(err); }
});

// PUT /:id/reject — admin rejects (deletes) a pending suggestion
router.put('/:id/reject', requireAdmin, async (req, res, next) => {
  try {
    const catId = parseInt(req.params.id, 10);
    if (!Number.isFinite(catId))
      return res.status(400).json({ error: 'מזהה קטגוריה אינו חוקי' });

    const { rows } = await query(
      `UPDATE categories SET status = 'rejected', updated_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING id, name`,
      [catId]
    );
    if (!rows[0])
      return res.status(404).json({ error: 'הצעת קטגוריה לא נמצאה' });

    return res.json({ message: `הצעת הקטגוריה "${rows[0].name}" נדחתה` });
  } catch (err) { return next(err); }
});

// PUT /:id — admin edits category
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const catId = parseInt(req.params.id, 10);
    if (!Number.isFinite(catId))
      return res.status(400).json({ error: 'מזהה קטגוריה אינו חוקי' });

    const { rows: existing } = await query(
      `SELECT id, name, parent_id, sort_order FROM categories WHERE id = $1`, [catId]
    );
    if (!existing[0])
      return res.status(404).json({ error: 'קטגוריה לא נמצאה' });

    const current = existing[0];
    const body    = req.body ?? {};
    const setClauses = [];
    const params     = [];
    let   idx        = 1;

    if ('name' in body) {
      const trimmedName = String(body.name).trim();
      if (trimmedName.length === 0 || trimmedName.length > 100)
        return res.status(400).json({ error: 'שם הקטגוריה חייב להיות בין 1 ל-100 תווים' });
      const newParent = 'parent_id' in body ? (body.parent_id || null) : current.parent_id;
      const { rows: dup } = await query(
        `SELECT id FROM categories WHERE name = $1 AND id <> $2
           AND (parent_id = $3 OR (parent_id IS NULL AND $3 IS NULL))`,
        [trimmedName, catId, newParent]
      );
      if (dup[0])
        return res.status(409).json({ error: 'קטגוריה בשם זה כבר קיימת' });
      params.push(trimmedName);
      setClauses.push(`name = $${idx++}`);
    }

    if ('parent_id' in body) {
      const newParent = body.parent_id;
      if (newParent !== null && newParent !== undefined) {
        const pid = parseInt(newParent, 10);
        if (!Number.isFinite(pid))
          return res.status(400).json({ error: 'parent_id חייב להיות מספר שלם או null' });
        if (pid === catId)
          return res.status(400).json({ error: 'קטגוריה לא יכולה להיות אב של עצמה' });
        const { rows: parentRow } = await query(`SELECT id FROM categories WHERE id = $1`, [pid]);
        if (!parentRow[0])
          return res.status(400).json({ error: 'קטגוריית האב לא נמצאה' });
        params.push(pid);
      } else { params.push(null); }
      setClauses.push(`parent_id = $${idx++}`);
    }

    if ('sort_order' in body) {
      const order = parseInt(body.sort_order, 10);
      if (!Number.isFinite(order))
        return res.status(400).json({ error: 'sort_order חייב להיות מספר שלם' });
      params.push(order);
      setClauses.push(`sort_order = $${idx++}`);
    }

    if ('wp_term_id' in body) {
      params.push(body.wp_term_id ? parseInt(body.wp_term_id, 10) : null);
      setClauses.push(`wp_term_id = $${idx++}`);
    }

    if (setClauses.length === 0)
      return res.status(400).json({ error: 'לא סופקו שדות לעדכון' });

    params.push(catId);
    const { rows } = await query(
      `UPDATE categories SET ${setClauses.join(', ')} WHERE id = $${idx}
       RETURNING id, name, parent_id, sort_order, status, wp_term_id, created_at`,
      params
    );
    return res.json({ category: rows[0] });
  } catch (err) { return next(err); }
});

// DELETE /:id — admin only
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const catId = parseInt(req.params.id, 10);
    if (!Number.isFinite(catId))
      return res.status(400).json({ error: 'מזהה קטגוריה אינו חוקי' });

    const { rows: existing } = await query(
      `SELECT id, name FROM categories WHERE id = $1`, [catId]
    );
    if (!existing[0])
      return res.status(404).json({ error: 'קטגוריה לא נמצאה' });

    const { rows: questionCheck } = await query(
      `SELECT COUNT(*) AS cnt FROM questions WHERE category_id = $1`, [catId]
    );
    if (parseInt(questionCheck[0].cnt, 10) > 0)
      return res.status(409).json({
        error: `לא ניתן למחוק קטגוריה שיש לה שאלות. ישנן ${questionCheck[0].cnt} שאלות.`
      });

    const { rows: childCheck } = await query(
      `SELECT COUNT(*) AS cnt FROM categories WHERE parent_id = $1`, [catId]
    );
    if (parseInt(childCheck[0].cnt, 10) > 0)
      return res.status(409).json({ error: 'לא ניתן למחוק קטגוריה שיש לה תת-קטגוריות.' });

    await withTransaction(async (client) => {
      await client.query(`DELETE FROM rabbi_categories WHERE category_id = $1`, [catId]);
      await client.query(`DELETE FROM categories WHERE id = $1`, [catId]);
    });

    return res.json({ message: `הקטגוריה "${existing[0].name}" נמחקה בהצלחה` });
  } catch (err) { return next(err); }
});

// GET /:id/stats
router.get('/:id/stats', async (req, res, next) => {
  try {
    const catId = parseInt(req.params.id, 10);
    if (!Number.isFinite(catId))
      return res.status(400).json({ error: 'מזהה קטגוריה אינו חוקי' });

    const { rows: catRows } = await query(
      `SELECT id, name, parent_id FROM categories WHERE id = $1`, [catId]
    );
    if (!catRows[0])
      return res.status(404).json({ error: 'קטגוריה לא נמצאה' });

    const { rows: totalRows } = await query(
      `SELECT COUNT(*) AS total FROM questions
       WHERE category_id = $1 AND (deleted_at IS NULL OR deleted_at > NOW())`, [catId]
    );
    const { rows: statusRows } = await query(
      `SELECT status, COUNT(*) AS count FROM questions
       WHERE category_id = $1 AND (deleted_at IS NULL OR deleted_at > NOW())
       GROUP BY status`, [catId]
    );
    const byStatus = {};
    for (const row of statusRows) byStatus[row.status] = parseInt(row.count, 10);

    const { rows: recentRows } = await query(
      `SELECT COUNT(*) AS total FROM questions
       WHERE category_id = $1 AND (deleted_at IS NULL OR deleted_at > NOW())
         AND created_at >= NOW() - INTERVAL '30 days'`, [catId]
    );
    const { rows: answerRows } = await query(
      `SELECT COUNT(a.id) AS answered_count,
              ROUND(AVG(EXTRACT(EPOCH FROM (a.published_at - q.lock_timestamp)) / 3600)::numeric, 2) AS avg_response_hours
       FROM   answers a JOIN questions q ON q.id = a.question_id
       WHERE  q.category_id = $1 AND (q.deleted_at IS NULL OR q.deleted_at > NOW())
         AND  a.published_at IS NOT NULL AND q.lock_timestamp IS NOT NULL`, [catId]
    );

    return res.json({
      category:           catRows[0],
      total:              parseInt(totalRows[0].total, 10),
      by_status:          byStatus,
      last_30_days:       parseInt(recentRows[0].total, 10),
      answered_count:     parseInt(answerRows[0].answered_count, 10),
      avg_response_hours: answerRows[0].avg_response_hours != null
        ? parseFloat(answerRows[0].avg_response_hours) : null,
    });
  } catch (err) { return next(err); }
});

// POST /sync-from-wp — admin: pull all ask-cat terms from WP, create missing ones locally
router.post('/sync-from-wp', requireAdmin, async (req, res, next) => {
  try {
    const wpResult = await getWPCategories();
    if (!wpResult.success) {
      return res.status(502).json({ error: `שגיאה בשליפת קטגוריות מ-WP: ${wpResult.error}` });
    }

    const wpTerms = wpResult.data || [];
    if (wpTerms.length === 0) {
      return res.json({ message: 'לא נמצאו קטגוריות ב-WP', created: 0, existing: 0 });
    }

    // Get all local categories with wp_term_id set
    const { rows: localCats } = await query(
      `SELECT id, name, wp_term_id FROM categories WHERE status != 'rejected'`
    );

    const existingWpIds = new Set(localCats.filter(c => c.wp_term_id).map(c => c.wp_term_id));
    const existingNames = new Set(localCats.map(c => c.name.trim().toLowerCase()));

    let created = 0;
    let existing = 0;
    let skipped = 0;

    for (const wpTerm of wpTerms) {
      if (existingWpIds.has(wpTerm.id)) {
        existing++;
        continue;
      }

      // Also check by name to avoid duplicates
      if (existingNames.has(wpTerm.name.trim().toLowerCase())) {
        // Link existing local category to WP term
        const localMatch = localCats.find(
          c => c.name.trim().toLowerCase() === wpTerm.name.trim().toLowerCase() && !c.wp_term_id
        );
        if (localMatch) {
          await query(
            `UPDATE categories SET wp_term_id = $1 WHERE id = $2`,
            [wpTerm.id, localMatch.id]
          );
          console.log(`[categories/sync] linked local=${localMatch.id} to wpTermId=${wpTerm.id}`);
        }
        existing++;
        continue;
      }

      // Create new local category
      try {
        await query(
          `INSERT INTO categories (name, parent_id, sort_order, status, wp_term_id, created_at)
           VALUES ($1, NULL, 0, 'approved', $2, NOW())`,
          [wpTerm.name.trim(), wpTerm.id]
        );
        created++;
        console.log(`[categories/sync] created local category: "${wpTerm.name}" wpTermId=${wpTerm.id}`);
      } catch (insertErr) {
        console.error(`[categories/sync] failed to create "${wpTerm.name}":`, insertErr.message);
        skipped++;
      }
    }

    console.log(`[categories/sync] סנכרון הושלם: ${created} נוצרו, ${existing} קיימות, ${skipped} דולגו`);
    return res.json({
      message: `סנכרון קטגוריות מ-WP הושלם`,
      total_wp: wpTerms.length,
      created,
      existing,
      skipped,
    });
  } catch (err) { return next(err); }
});

module.exports = router;
