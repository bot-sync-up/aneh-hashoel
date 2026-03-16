'use strict';

/**
 * Categories Management Routes — /api/categories
 *
 * GET /categories         — public tree (authenticated rabbis)
 * POST /categories        — admin only
 * PUT /categories/reorder — admin only (drag-reorder)
 * PUT /categories/:id     — admin only
 * DELETE /categories/:id  — admin only (blocked if questions assigned)
 *
 * Mounted at: /api/categories
 */

const express = require('express');

const { query, withTransaction } = require('../db/pool');
const { authenticate, requireAdmin } = require('../middleware/authenticate');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a nested tree structure from a flat list of category rows.
 * Rows must have: id, name, parent_id, sort_order, created_at.
 *
 * @param {object[]} rows  Flat category rows from the DB
 * @returns {object[]}     Top-level categories with a `children` array each
 */
function buildTree(rows) {
  const map      = new Map();
  const roots    = [];

  for (const row of rows) {
    map.set(row.id, { ...row, children: [] });
  }

  for (const row of rows) {
    const node = map.get(row.id);
    if (row.parent_id && map.has(row.parent_id)) {
      map.get(row.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort children by sort_order then name
  function sortChildren(node) {
    node.children.sort((a, b) =>
      a.sort_order !== b.sort_order
        ? a.sort_order - b.sort_order
        : a.name.localeCompare(b.name, 'he')
    );
    node.children.forEach(sortChildren);
  }

  roots.sort((a, b) =>
    a.sort_order !== b.sort_order
      ? a.sort_order - b.sort_order
      : a.name.localeCompare(b.name, 'he')
  );
  roots.forEach(sortChildren);

  return roots;
}

// ─── GET /categories ──────────────────────────────────────────────────────────

/**
 * Return all categories as a nested tree (parent → children).
 * Accessible by any authenticated rabbi.
 *
 * Response:
 *   categories: [{ id, name, parent_id, sort_order, created_at, children: [...] }]
 */
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, parent_id, sort_order, created_at
       FROM   categories
       ORDER  BY sort_order, name`
    );

    const tree = buildTree(rows);
    return res.json({ categories: tree });
  } catch (err) {
    return next(err);
  }
});

// ─── POST /categories ─────────────────────────────────────────────────────────

/**
 * Create a new category.
 * Admin only.
 *
 * Body:
 *   name       {string}      required — 1–100 chars
 *   parent_id  {number|null} optional — must reference existing category
 *   sort_order {number}      optional — default 0
 */
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { name, parent_id = null, sort_order = 0 } = req.body ?? {};

    // Validate name
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'שם הקטגוריה נדרש' });
    }
    const trimmedName = name.trim();
    if (trimmedName.length > 100) {
      return res.status(400).json({ error: 'שם הקטגוריה לא יכול לעלות על 100 תווים' });
    }

    // Validate sort_order
    const order = parseInt(sort_order, 10);
    if (!Number.isFinite(order)) {
      return res.status(400).json({ error: 'sort_order חייב להיות מספר שלם' });
    }

    // Validate parent_id if provided
    if (parent_id !== null && parent_id !== undefined) {
      const pid = parseInt(parent_id, 10);
      if (!Number.isFinite(pid)) {
        return res.status(400).json({ error: 'parent_id חייב להיות מספר שלם' });
      }
      const { rows: parentRows } = await query(
        `SELECT id FROM categories WHERE id = $1`,
        [pid]
      );
      if (!parentRows[0]) {
        return res.status(400).json({ error: 'קטגוריית האב לא נמצאה' });
      }
    }

    // Check for duplicate name under the same parent
    const { rows: dupRows } = await query(
      `SELECT id FROM categories
       WHERE  name = $1
         AND  (parent_id = $2 OR (parent_id IS NULL AND $2 IS NULL))`,
      [trimmedName, parent_id || null]
    );
    if (dupRows[0]) {
      return res.status(409).json({ error: 'קטגוריה בשם זה כבר קיימת תחת אותה קטגוריית אב' });
    }

    const { rows } = await query(
      `INSERT INTO categories (name, parent_id, sort_order, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, name, parent_id, sort_order, created_at`,
      [trimmedName, parent_id || null, order]
    );

    return res.status(201).json({ category: rows[0] });
  } catch (err) {
    return next(err);
  }
});

// ─── PUT /categories/reorder ──────────────────────────────────────────────────

/**
 * Bulk-update sort_order for multiple categories (admin drag-reorder).
 * Admin only.
 *
 * Body:
 *   items: [{ id: number, sort_order: number }, ...]
 *
 * Executes all updates in a single transaction.
 */
router.put('/reorder', requireAdmin, async (req, res, next) => {
  try {
    const { items } = req.body ?? {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: '"items" חייב להיות מערך לא ריק' });
    }

    // Validate each item
    for (const item of items) {
      if (!Number.isInteger(item.id) || !Number.isFinite(parseInt(item.sort_order, 10))) {
        return res.status(400).json({
          error: 'כל פריט ב-items חייב לכלול id (מספר) ו-sort_order (מספר)',
        });
      }
    }

    await withTransaction(async (client) => {
      for (const item of items) {
        await client.query(
          `UPDATE categories
           SET    sort_order = $1
           WHERE  id = $2`,
          [parseInt(item.sort_order, 10), item.id]
        );
      }
    });

    return res.json({ message: `סדר ${items.length} קטגוריות עודכן בהצלחה` });
  } catch (err) {
    return next(err);
  }
});

// ─── PUT /categories/:id ──────────────────────────────────────────────────────

/**
 * Update a category's name, parent, or sort_order.
 * Admin only.
 *
 * Body (all optional):
 *   name       {string}
 *   parent_id  {number|null}
 *   sort_order {number}
 */
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const catId = parseInt(req.params.id, 10);
    if (!Number.isFinite(catId)) {
      return res.status(400).json({ error: 'מזהה קטגוריה אינו חוקי' });
    }

    // Verify category exists
    const { rows: existing } = await query(
      `SELECT id, name, parent_id, sort_order FROM categories WHERE id = $1`,
      [catId]
    );
    if (!existing[0]) {
      return res.status(404).json({ error: 'קטגוריה לא נמצאה' });
    }

    const current = existing[0];
    const body    = req.body ?? {};

    const setClauses = [];
    const params     = [];
    let   idx        = 1;

    if ('name' in body) {
      const trimmedName = String(body.name).trim();
      if (trimmedName.length === 0 || trimmedName.length > 100) {
        return res.status(400).json({ error: 'שם הקטגוריה חייב להיות בין 1 ל-100 תווים' });
      }
      // Duplicate check (excluding current record)
      const newParent = 'parent_id' in body ? (body.parent_id || null) : current.parent_id;
      const { rows: dup } = await query(
        `SELECT id FROM categories
         WHERE  name = $1
           AND  id <> $2
           AND  (parent_id = $3 OR (parent_id IS NULL AND $3 IS NULL))`,
        [trimmedName, catId, newParent]
      );
      if (dup[0]) {
        return res.status(409).json({ error: 'קטגוריה בשם זה כבר קיימת תחת אותה קטגוריית אב' });
      }
      params.push(trimmedName);
      setClauses.push(`name = $${idx++}`);
    }

    if ('parent_id' in body) {
      const newParent = body.parent_id;
      if (newParent !== null && newParent !== undefined) {
        const pid = parseInt(newParent, 10);
        if (!Number.isFinite(pid)) {
          return res.status(400).json({ error: 'parent_id חייב להיות מספר שלם או null' });
        }
        // Prevent circular reference (cannot set parent to self or own child)
        if (pid === catId) {
          return res.status(400).json({ error: 'קטגוריה לא יכולה להיות אב של עצמה' });
        }
        // Check that the proposed parent is not a descendant of this category
        const { rows: parentRow } = await query(
          `SELECT id FROM categories WHERE id = $1`,
          [pid]
        );
        if (!parentRow[0]) {
          return res.status(400).json({ error: 'קטגוריית האב לא נמצאה' });
        }
        params.push(pid);
      } else {
        params.push(null);
      }
      setClauses.push(`parent_id = $${idx++}`);
    }

    if ('sort_order' in body) {
      const order = parseInt(body.sort_order, 10);
      if (!Number.isFinite(order)) {
        return res.status(400).json({ error: 'sort_order חייב להיות מספר שלם' });
      }
      params.push(order);
      setClauses.push(`sort_order = $${idx++}`);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'לא סופקו שדות לעדכון' });
    }

    params.push(catId);

    const { rows } = await query(
      `UPDATE categories
       SET    ${setClauses.join(', ')}
       WHERE  id = $${idx}
       RETURNING id, name, parent_id, sort_order, created_at`,
      params
    );

    return res.json({ category: rows[0] });
  } catch (err) {
    return next(err);
  }
});

// ─── DELETE /categories/:id ───────────────────────────────────────────────────

/**
 * Delete a category.
 * Admin only.
 * Blocked if any questions are assigned to this category, or if it has child categories.
 */
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const catId = parseInt(req.params.id, 10);
    if (!Number.isFinite(catId)) {
      return res.status(400).json({ error: 'מזהה קטגוריה אינו חוקי' });
    }

    // Verify category exists
    const { rows: existing } = await query(
      `SELECT id, name FROM categories WHERE id = $1`,
      [catId]
    );
    if (!existing[0]) {
      return res.status(404).json({ error: 'קטגוריה לא נמצאה' });
    }

    // Block if questions are assigned
    const { rows: questionCheck } = await query(
      `SELECT COUNT(*) AS cnt FROM questions WHERE category_id = $1`,
      [catId]
    );
    if (parseInt(questionCheck[0].cnt, 10) > 0) {
      return res.status(409).json({
        error: `לא ניתן למחוק קטגוריה שיש לה שאלות. ישנן ${questionCheck[0].cnt} שאלות בקטגוריה זו.`,
      });
    }

    // Block if child categories exist
    const { rows: childCheck } = await query(
      `SELECT COUNT(*) AS cnt FROM categories WHERE parent_id = $1`,
      [catId]
    );
    if (parseInt(childCheck[0].cnt, 10) > 0) {
      return res.status(409).json({
        error: 'לא ניתן למחוק קטגוריה שיש לה תת-קטגוריות. יש למחוק תחילה את תת-הקטגוריות.',
      });
    }

    // Safe to delete — also remove rabbi_categories rows
    await withTransaction(async (client) => {
      await client.query(
        `DELETE FROM rabbi_categories WHERE category_id = $1`,
        [catId]
      );
      await client.query(
        `DELETE FROM categories WHERE id = $1`,
        [catId]
      );
    });

    return res.json({
      message: `הקטגוריה "${existing[0].name}" נמחקה בהצלחה`,
    });
  } catch (err) {
    return next(err);
  }
});

// ─── GET /:id/stats ───────────────────────────────────────────────────────────

/**
 * Return question statistics for a specific category.
 *
 * Response:
 *   category         { id, name, parent_id }
 *   total            number — all non-deleted questions in this category
 *   by_status        { [status]: count }
 *   last_30_days     number — questions created in the last 30 days
 *   answered_count   number — questions that have a published answer
 *   avg_response_hours  number|null — average hours from lock to published answer
 */
router.get('/:id/stats', async (req, res, next) => {
  try {
    const catId = parseInt(req.params.id, 10);
    if (!Number.isFinite(catId)) {
      return res.status(400).json({ error: 'מזהה קטגוריה אינו חוקי' });
    }

    // Verify category exists
    const { rows: catRows } = await query(
      `SELECT id, name, parent_id FROM categories WHERE id = $1`,
      [catId]
    );
    if (!catRows[0]) {
      return res.status(404).json({ error: 'קטגוריה לא נמצאה' });
    }

    // Total question count (non-deleted)
    const { rows: totalRows } = await query(
      `SELECT COUNT(*) AS total
       FROM   questions
       WHERE  category_id = $1
         AND  (deleted_at IS NULL OR deleted_at > NOW())`,
      [catId]
    );

    // Breakdown by status
    const { rows: statusRows } = await query(
      `SELECT status, COUNT(*) AS count
       FROM   questions
       WHERE  category_id = $1
         AND  (deleted_at IS NULL OR deleted_at > NOW())
       GROUP  BY status`,
      [catId]
    );
    const byStatus = {};
    for (const row of statusRows) {
      byStatus[row.status] = parseInt(row.count, 10);
    }

    // Questions in last 30 days
    const { rows: recentRows } = await query(
      `SELECT COUNT(*) AS total
       FROM   questions
       WHERE  category_id = $1
         AND  (deleted_at IS NULL OR deleted_at > NOW())
         AND  created_at >= NOW() - INTERVAL '30 days'`,
      [catId]
    );

    // Answered count and avg response time (hours)
    const { rows: answerRows } = await query(
      `SELECT
         COUNT(a.id)                                                AS answered_count,
         ROUND(
           AVG(
             EXTRACT(EPOCH FROM (a.published_at - q.lock_timestamp)) / 3600
           )::numeric,
           2
         )                                                          AS avg_response_hours
       FROM   answers a
       JOIN   questions q ON q.id = a.question_id
       WHERE  q.category_id  = $1
         AND  (q.deleted_at IS NULL OR q.deleted_at > NOW())
         AND  a.published_at IS NOT NULL
         AND  q.lock_timestamp IS NOT NULL`,
      [catId]
    );

    return res.json({
      category:           catRows[0],
      total:              parseInt(totalRows[0].total, 10),
      by_status:          byStatus,
      last_30_days:       parseInt(recentRows[0].total, 10),
      answered_count:     parseInt(answerRows[0].answered_count, 10),
      avg_response_hours: answerRows[0].avg_response_hours != null
        ? parseFloat(answerRows[0].avg_response_hours)
        : null,
    });
  } catch (err) {
    return next(err);
  }
});

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = router;
