'use strict';

/**
 * Rabbi Self-Profile Routes — /api/profile
 *
 * All routes are authenticated; they operate only on the currently logged-in
 * rabbi's own record. No admin elevation is required or permitted here —
 * admin operations on other rabbis belong in /api/rabbis.
 *
 * Mounted at: /api/profile
 */

const express = require('express');

const { query }         = require('../db/pool');
const { authenticate }  = require('../middleware/authenticate');
const { validateEmail }  = require('../middleware/validateRequest');
const { getRabbiById }   = require('../services/rabbiService');

const router = express.Router();

// All profile routes require authentication
router.use(authenticate);

// ─── Constants ────────────────────────────────────────────────────────────────

/** Self-editable fields and their optional validators. */
const EDITABLE_PROFILE_FIELDS = [
  'signature',
  'whatsapp_number',
  'is_available',
  'preferred_categories',
];

/** Known event types that can have per-event notification preferences. */
const NOTIFICATION_EVENT_TYPES = [
  'new_question',
  'question_timeout_warning',
  'question_timeout',
  'discussion_message',
  'achievement',
  'weekly_report',
];

// ─── GET /profile ─────────────────────────────────────────────────────────────

/**
 * Return the authenticated rabbi's own full profile, including categories
 * and current-week stats.
 */
router.get('/', async (req, res, next) => {
  try {
    const rabbi = await getRabbiById(req.rabbi.id);

    // Attach achievements
    const { rows: achievements } = await query(
      `SELECT id, badge_type, earned_at
       FROM   rabbi_achievements
       WHERE  rabbi_id = $1
       ORDER  BY earned_at DESC`,
      [req.rabbi.id]
    );
    rabbi.achievements = achievements;

    return res.json({ rabbi });
  } catch (err) {
    return next(err);
  }
});

// ─── PUT /profile ─────────────────────────────────────────────────────────────

/**
 * Update the authenticated rabbi's own editable profile fields.
 *
 * Allowed fields:
 *   signature            {string|null}
 *   whatsapp_number      {string|null}
 *   is_available         {boolean}
 *   preferred_categories {number[]}
 *
 * Note: notification_pref is updated via PUT /profile/notification-preferences.
 */
router.put('/', async (req, res, next) => {
  try {
    const rabbiId = req.rabbi.id;
    const body    = req.body ?? {};

    const setClauses = [];
    const params     = [];
    let   idx        = 1;

    for (const key of EDITABLE_PROFILE_FIELDS) {
      if (!(key in body)) continue;
      const val = body[key];

      if (key === 'signature') {
        params.push(val === null ? null : String(val).trim().slice(0, 1000));
        setClauses.push(`signature = $${idx++}`);
      } else if (key === 'whatsapp_number') {
        if (val !== null && val !== undefined && val !== '') {
          if (!/^\+?[\d\s\-()]{7,20}$/.test(String(val))) {
            return res.status(400).json({ error: 'מספר WhatsApp אינו תקין' });
          }
          params.push(String(val).trim());
        } else {
          params.push(null);
        }
        setClauses.push(`whatsapp_number = $${idx++}`);
      } else if (key === 'is_available') {
        params.push(Boolean(val));
        setClauses.push(`is_available = $${idx++}`);
      } else if (key === 'preferred_categories') {
        if (!Array.isArray(val) || val.some((c) => !Number.isInteger(c))) {
          return res.status(400).json({
            error: 'preferred_categories חייב להיות מערך של מספרים שלמים',
          });
        }
        params.push(val);
        setClauses.push(`preferred_categories = $${idx++}`);
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'לא סופקו שדות לעדכון' });
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(rabbiId);

    const { rows } = await query(
      `UPDATE rabbis
       SET    ${setClauses.join(', ')}
       WHERE  id = $${idx}
       RETURNING id, name, email, signature, whatsapp_number,
                 is_available, is_vacation, preferred_categories,
                 notification_pref, updated_at`,
      params
    );

    return res.json({ rabbi: rows[0] });
  } catch (err) {
    return next(err);
  }
});

// ─── PUT /profile/notification-preferences ────────────────────────────────────

/**
 * Update the authenticated rabbi's notification preferences.
 *
 * The body may contain the top-level channel flags:
 *   email    {boolean}  — receive email notifications
 *   whatsapp {boolean}  — receive WhatsApp notifications
 *   push     {boolean}  — receive push (browser/app) notifications
 *
 * Optionally, per-event overrides can be nested under each channel or
 * under an "events" key mapping event type → channel object:
 *   events: {
 *     new_question:             { email: true, whatsapp: true, push: true }
 *     question_timeout_warning: { email: true, whatsapp: false, push: true }
 *     ...
 *   }
 *
 * The entire notification_pref JSONB is replaced (merge strategy applied so
 * missing keys preserve existing values).
 */
router.put('/notification-preferences', async (req, res, next) => {
  try {
    const rabbiId = req.rabbi.id;
    const body    = req.body ?? {};

    // Fetch current prefs for merge
    const { rows } = await query(
      `SELECT notification_pref FROM rabbis WHERE id = $1`,
      [rabbiId]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'רב לא נמצא' });
    }

    const current = rows[0].notification_pref || {};
    const merged  = { ...current };

    // Top-level channel flags
    for (const channel of ['email', 'whatsapp', 'push']) {
      if (channel in body) {
        merged[channel] = Boolean(body[channel]);
      }
    }

    // Per-event overrides
    if (body.events && typeof body.events === 'object' && !Array.isArray(body.events)) {
      merged.events = merged.events || {};
      for (const eventType of NOTIFICATION_EVENT_TYPES) {
        if (!(eventType in body.events)) continue;
        const eventPrefs = body.events[eventType];
        if (typeof eventPrefs !== 'object' || eventPrefs === null) {
          return res.status(400).json({
            error: `העדפות עבור "${eventType}" חייבות להיות אובייקט`,
          });
        }
        merged.events[eventType] = {};
        for (const channel of ['email', 'whatsapp', 'push']) {
          if (channel in eventPrefs) {
            merged.events[eventType][channel] = Boolean(eventPrefs[channel]);
          } else if (merged.events[eventType]) {
            merged.events[eventType][channel] =
              merged.events?.[eventType]?.[channel] ?? merged[channel] ?? true;
          }
        }
      }

      // Reject unknown event types
      const unknownEvents = Object.keys(body.events).filter(
        (k) => !NOTIFICATION_EVENT_TYPES.includes(k)
      );
      if (unknownEvents.length > 0) {
        return res.status(400).json({
          error: `סוגי אירועים לא מוכרים: ${unknownEvents.join(', ')}`,
        });
      }
    }

    const { rows: updated } = await query(
      `UPDATE rabbis
       SET    notification_pref = $1::jsonb, updated_at = NOW()
       WHERE  id = $2
       RETURNING id, notification_pref`,
      [JSON.stringify(merged), rabbiId]
    );

    return res.json({
      message: 'העדפות ההתראות עודכנו',
      notification_pref: updated[0].notification_pref,
    });
  } catch (err) {
    return next(err);
  }
});

// ─── GET /profile/stats ───────────────────────────────────────────────────────

/**
 * Return the authenticated rabbi's own stats for the past 4 weeks.
 * Each week includes: answers_count, avg_response_time_hours, views_count, thanks_count.
 * Also includes a lifetime totals summary.
 */
router.get('/stats', async (req, res, next) => {
  try {
    const rabbiId = req.rabbi.id;

    // Last 4 weeks
    const { rows: weeklyStats } = await query(
      `SELECT
         week_start,
         answers_count,
         avg_response_time_hours,
         views_count,
         thanks_count
       FROM rabbi_stats
       WHERE rabbi_id = $1
         AND week_start >= CURRENT_DATE - (4 * INTERVAL '7 days')
       ORDER BY week_start DESC`,
      [rabbiId]
    );

    // Lifetime aggregates
    const { rows: lifetime } = await query(
      `SELECT
         COUNT(a.id)                                              AS total_answers,
         ROUND(AVG(
           EXTRACT(EPOCH FROM (a.published_at - q.lock_timestamp)) / 3600
         )::numeric, 1)                                          AS avg_response_hours,
         COALESCE(SUM(q.thank_count), 0)                        AS total_thanks
       FROM   answers a
       JOIN   questions q ON q.id = a.question_id
       WHERE  a.rabbi_id = $1
         AND  a.published_at IS NOT NULL`,
      [rabbiId]
    );

    return res.json({
      weekly:   weeklyStats,
      lifetime: lifetime[0],
    });
  } catch (err) {
    return next(err);
  }
});

// ─── GET /profile/achievements ────────────────────────────────────────────────

/**
 * Return the authenticated rabbi's badges/achievements in chronological order.
 */
router.get('/achievements', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, badge_type, earned_at
       FROM   rabbi_achievements
       WHERE  rabbi_id = $1
       ORDER  BY earned_at DESC`,
      [req.rabbi.id]
    );

    return res.json({ achievements: rows });
  } catch (err) {
    return next(err);
  }
});

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = router;
