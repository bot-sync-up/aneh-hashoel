'use strict';

/**
 * CRM Leads Routes — /api/leads
 *
 * Accessible to: admin, customer_service
 *
 * GET    /               — paginated leads list
 * GET    /:id            — single lead + question history
 * PATCH  /:id            — update contacted / contact_notes
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { getLeads, getLeadById, updateLead } = require('../services/leadsService');

const router = express.Router();

// ─── Authorization guard — admin OR customer_service ─────────────────────────

function requireCRM(req, res, next) {
  if (!req.rabbi) {
    return res.status(401).json({ error: 'נדרשת התחברות' });
  }
  if (req.rabbi.role !== 'admin' && req.rabbi.role !== 'customer_service') {
    return res.status(403).json({ error: 'אין הרשאה — נדרש מנהל מערכת או שירות לקוחות' });
  }
  return next();
}

router.use(authenticate, requireCRM);

// ─── GET / ───────────────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const filter = ['all', 'hot', 'contacted', 'not_contacted'].includes(req.query.filter)
      ? req.query.filter : 'all';
    const search = req.query.search || '';

    const result = await getLeads({ page, limit, filter, search });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────

router.get('/:id', async (req, res, next) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: 'ליד לא נמצא' });
    }
    return res.json({ lead });
  } catch (err) {
    return next(err);
  }
});

// ─── PATCH /:id ───────────────────────────────────────────────────────────────

router.patch('/:id', async (req, res, next) => {
  try {
    const { contacted, contact_notes } = req.body;

    const updated = await updateLead(req.params.id, {
      ...(typeof contacted     === 'boolean' && { contacted }),
      ...(typeof contact_notes === 'string'  && { contact_notes }),
    });

    if (!updated) {
      return res.status(404).json({ error: 'ליד לא נמצא' });
    }

    return res.json({ message: 'הליד עודכן בהצלחה', lead: updated });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
