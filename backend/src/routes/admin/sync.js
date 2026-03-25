'use strict';

/**
 * Admin Sync Routes — /api/admin/sync
 *
 * Category and rabbi synchronization with WordPress.
 *
 * POST /categories  — Pull all ask-cat from WP, create missing locally
 * POST /rabbis      — Pull all rabi-add from WP, log them
 * POST /push-category — Push a local category to WP
 * POST /push-rabbi    — Push a local rabbi to WP
 */

const express = require('express');
const { query: dbQuery } = require('../../db/pool');
const { authenticate, requireAdmin } = require('../../middleware/authenticate');
const {
  getWPCategories,
  createWPCategory,
  getWPRabbis,
  createWPRabbi,
} = require('../../services/wpService');

const router = express.Router();
router.use(authenticate, requireAdmin);

// ─── POST /sync/categories — Pull WP categories, create missing locally ──────

router.post('/categories', async (req, res) => {
  try {
    const wpResult = await getWPCategories();
    if (!wpResult.success) {
      return res.status(502).json({ error: `שגיאה בשליפת קטגוריות מ-WP: ${wpResult.error}` });
    }

    const wpTerms = wpResult.data || [];
    let created = 0;
    let skipped = 0;
    let linked = 0;

    for (const term of wpTerms) {
      // Check if we already have this wp_term_id
      const { rows: existing } = await dbQuery(
        `SELECT id FROM categories WHERE wp_term_id = $1`,
        [term.id]
      );

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      // Check if a category with the same name exists (link it)
      const { rows: byName } = await dbQuery(
        `SELECT id FROM categories WHERE name = $1 AND wp_term_id IS NULL`,
        [term.name]
      );

      if (byName.length > 0) {
        await dbQuery(
          `UPDATE categories SET wp_term_id = $1 WHERE id = $2`,
          [term.id, byName[0].id]
        );
        linked++;
        continue;
      }

      // Create new category locally
      await dbQuery(
        `INSERT INTO categories (name, status, wp_term_id, created_at)
         VALUES ($1, 'approved', $2, NOW())`,
        [term.name, term.id]
      );
      created++;
    }

    console.log(
      `[admin/sync] categories: WP=${wpTerms.length}, created=${created}, linked=${linked}, skipped=${skipped}`
    );

    return res.json({
      ok: true,
      message: `סנכרון קטגוריות הושלם`,
      wp_total: wpTerms.length,
      created,
      linked,
      skipped,
    });
  } catch (err) {
    console.error('[admin/sync] POST /categories error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /sync/rabbis — Pull WP rabbi terms, log them ──────────────────────

router.post('/rabbis', async (req, res) => {
  try {
    const wpResult = await getWPRabbis();
    if (!wpResult.success) {
      return res.status(502).json({ error: `שגיאה בשליפת רבנים מ-WP: ${wpResult.error}` });
    }

    const wpTerms = wpResult.data || [];
    let matched = 0;
    let linked = 0;
    const unmatched = [];

    for (const term of wpTerms) {
      // Check if already linked
      const { rows: existingLinked } = await dbQuery(
        `SELECT id, name FROM rabbis WHERE wp_term_id = $1`,
        [term.id]
      );

      if (existingLinked.length > 0) {
        matched++;
        continue;
      }

      // Try to match by name
      const { rows: byName } = await dbQuery(
        `SELECT id, name FROM rabbis WHERE name ILIKE $1 AND wp_term_id IS NULL`,
        [`%${term.name}%`]
      );

      if (byName.length > 0) {
        await dbQuery(
          `UPDATE rabbis SET wp_term_id = $1 WHERE id = $2`,
          [term.id, byName[0].id]
        );
        linked++;
        console.log(`[admin/sync] linked rabbi ${byName[0].name} to wpTermId=${term.id}`);
      } else {
        unmatched.push({ wp_id: term.id, wp_name: term.name });
      }
    }

    console.log(
      `[admin/sync] rabbis: WP=${wpTerms.length}, matched=${matched}, linked=${linked}, unmatched=${unmatched.length}`
    );

    return res.json({
      ok: true,
      message: `סנכרון רבנים הושלם`,
      wp_total: wpTerms.length,
      matched,
      linked,
      unmatched,
    });
  } catch (err) {
    console.error('[admin/sync] POST /rabbis error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /sync/push-category — Push local category to WP ───────────────────

router.post('/push-category', async (req, res) => {
  try {
    const { category_id } = req.body;
    if (!category_id) {
      return res.status(400).json({ error: 'category_id נדרש' });
    }

    const { rows } = await dbQuery(
      `SELECT id, name, wp_term_id FROM categories WHERE id = $1`,
      [category_id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'קטגוריה לא נמצאה' });
    }

    if (rows[0].wp_term_id) {
      return res.json({ ok: true, message: 'הקטגוריה כבר מסונכרנת עם WP', wp_term_id: rows[0].wp_term_id });
    }

    const wpResult = await createWPCategory(rows[0].name);
    if (!wpResult.success) {
      return res.status(502).json({ error: `שגיאה ביצירת קטגוריה ב-WP: ${wpResult.error}` });
    }

    await dbQuery(
      `UPDATE categories SET wp_term_id = $1 WHERE id = $2`,
      [wpResult.data.id, category_id]
    );

    return res.json({
      ok: true,
      message: 'הקטגוריה נוצרה ב-WP בהצלחה',
      wp_term_id: wpResult.data.id,
    });
  } catch (err) {
    console.error('[admin/sync] POST /push-category error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /sync/push-rabbi — Push local rabbi to WP ─────────────────────────

router.post('/push-rabbi', async (req, res) => {
  try {
    const { rabbi_id } = req.body;
    if (!rabbi_id) {
      return res.status(400).json({ error: 'rabbi_id נדרש' });
    }

    const { rows } = await dbQuery(
      `SELECT id, name, wp_term_id FROM rabbis WHERE id = $1`,
      [rabbi_id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'רב לא נמצא' });
    }

    if (rows[0].wp_term_id) {
      return res.json({ ok: true, message: 'הרב כבר מסונכרן עם WP', wp_term_id: rows[0].wp_term_id });
    }

    const wpResult = await createWPRabbi(rows[0].name);
    if (!wpResult.success) {
      return res.status(502).json({ error: `שגיאה ביצירת רב ב-WP: ${wpResult.error}` });
    }

    await dbQuery(
      `UPDATE rabbis SET wp_term_id = $1 WHERE id = $2`,
      [wpResult.data.id, rabbi_id]
    );

    return res.json({
      ok: true,
      message: 'הרב נוצר ב-WP בהצלחה',
      wp_term_id: wpResult.data.id,
    });
  } catch (err) {
    console.error('[admin/sync] POST /push-rabbi error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
