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
const { getLeads, getLeadById, updateLead, syncLeadsFromQuestions } = require('../services/leadsService');

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
    const filter = ['all', 'hot', 'urgent', 'contacted', 'not_contacted'].includes(req.query.filter)
      ? req.query.filter : 'all';
    const search = req.query.search || '';

    const result = await getLeads({ page, limit, filter, search, role: req.rabbi.role });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

// ─── GET /export — CSV export of all leads ───────────────────────────────────

router.get('/export', async (req, res, next) => {
  try {
    const role = req.rabbi.role;
    const isCS = role === 'customer_service';

    // Fetch all leads (no pagination)
    const result = await getLeads({ page: 1, limit: 10000, filter: 'all', search: '', role });
    const leads = result.leads || [];

    // Build CSV manually — no external dependency needed
    // CS agents get restricted columns (no email, no question content)
    const headers = isCS
      ? ['שם', 'טלפון', 'מספר שאלות', 'קטגוריה אחרונה', 'חם', 'טופל', 'תאריך יצירה', 'הערות']
      : ['שם', 'אימייל', 'טלפון', 'מספר שאלות', 'קטגוריה אחרונה', 'חם', 'דחוף', 'טופל', 'תאריך יצירה', 'שאלה אחרונה', 'הערות'];

    function escapeCsvField(val) {
      const str = String(val ?? '');
      if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }

    const rows = leads.map((l) => isCS
      ? [
          l.asker_name || '',
          l.phone || '',
          l.question_count || 0,
          l.last_category_name || '',
          l.is_hot ? 'כן' : 'לא',
          l.contacted ? 'כן' : 'לא',
          l.created_at ? new Date(l.created_at).toLocaleDateString('he-IL') : '',
          l.contact_notes || '',
        ].map(escapeCsvField).join(',')
      : [
          l.asker_name || '',
          l.email || '',
          l.phone || '',
          l.question_count || 0,
          l.last_category_name || '',
          l.is_hot ? 'כן' : 'לא',
          l.has_urgent ? 'כן' : 'לא',
          l.contacted ? 'כן' : 'לא',
          l.created_at ? new Date(l.created_at).toLocaleDateString('he-IL') : '',
          l.last_question_at ? new Date(l.last_question_at).toLocaleDateString('he-IL') : '',
          l.contact_notes || '',
        ].map(escapeCsvField).join(','));

    // UTF-8 BOM for Excel compatibility
    const BOM = '\uFEFF';
    const csv = BOM + [headers.map(escapeCsvField).join(','), ...rows].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${new Date().toISOString().split('T')[0]}.csv"`);
    return res.send(csv);
  } catch (err) {
    return next(err);
  }
});

// ─── POST /sync — Admin: sync leads from all questions ───────────────────────

router.post('/sync', async (req, res, next) => {
  try {
    // Only admin can trigger sync
    if (req.rabbi.role !== 'admin') {
      return res.status(403).json({ error: 'רק מנהל מערכת יכול להפעיל סנכרון לידים' });
    }

    const result = await syncLeadsFromQuestions();
    return res.json({
      message: `סנכרון הושלם: ${result.synced} לידים עודכנו, ${result.skipped} דולגו`,
      ...result,
    });
  } catch (err) {
    return next(err);
  }
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────

router.get('/:id', async (req, res, next) => {
  try {
    const lead = await getLeadById(req.params.id, req.rabbi.role);
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
