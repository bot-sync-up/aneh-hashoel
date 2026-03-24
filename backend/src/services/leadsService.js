'use strict';

/**
 * Leads (CRM) Service
 *
 * Manages the leads table — one row per unique asker (deduplicated by email_hash).
 *
 * Public API:
 *   upsertLead(question)          — call after every new question is created
 *   getLeads({ page, limit, filter, search }) — paginated list for CRM UI
 *   updateLead(id, { contacted, contact_notes }) — CS agent updates
 *   getLeadById(id)               — single lead with question history
 */

const crypto         = require('crypto');
const { query }      = require('../db/pool');
const { decryptField } = require('../utils/encryption');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _emailHash(plainEmail) {
  if (!plainEmail) return null;
  return crypto.createHash('sha256').update(plainEmail.toLowerCase().trim()).digest('hex');
}

function _hotScore(questionCount, thankCount, hasUrgent) {
  let score = questionCount;
  if (thankCount > 0)  score += 3;
  if (hasUrgent)       score += 2;
  return score;
}

function _isHot(questionCount, thankCount, hasUrgent) {
  return thankCount > 0 || questionCount > 3 || hasUrgent;
}

// ─── upsertLead ───────────────────────────────────────────────────────────────

/**
 * Create or update a lead entry when a new question arrives.
 * Safe to call multiple times — uses ON CONFLICT DO UPDATE.
 *
 * @param {object} question — row from questions table (after createFromWebhook)
 */
async function upsertLead(question) {
  const {
    id:           questionId,
    asker_email:  plainEmail,   // already decrypted by caller
    asker_phone:  plainPhone,
    asker_email_encrypted,
    asker_phone_encrypted,
    asker_name,
    category_id,
    is_urgent,
    thank_count = 0,
    created_at,
  } = question;

  const emailHash = _emailHash(plainEmail);
  if (!emailHash) return; // no email — skip

  try {
    // Aggregate stats for this asker across all questions
    const { rows: stats } = await query(
      `SELECT COUNT(*)::int          AS question_count,
              COALESCE(SUM(thank_count), 0)::int AS total_thanks,
              bool_or(is_urgent)     AS has_urgent
       FROM   questions
       WHERE  asker_email_encrypted = $1`,
      [asker_email_encrypted]
    );

    const { question_count, total_thanks, has_urgent } = stats[0] || {};
    const score  = _hotScore(question_count, total_thanks, has_urgent);
    const is_hot = _isHot(question_count, total_thanks, has_urgent);

    await query(
      `INSERT INTO leads
         (email_hash, asker_name, asker_email_encrypted, asker_phone_encrypted,
          question_count, interaction_score, is_hot, last_category_id,
          first_question_at, last_question_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       ON CONFLICT (email_hash) DO UPDATE SET
         asker_name            = COALESCE(EXCLUDED.asker_name, leads.asker_name),
         asker_phone_encrypted = COALESCE(EXCLUDED.asker_phone_encrypted, leads.asker_phone_encrypted),
         question_count        = $5,
         interaction_score     = $6,
         is_hot                = $7,
         last_category_id      = COALESCE($8, leads.last_category_id),
         last_question_at      = GREATEST(leads.last_question_at, $9),
         updated_at            = NOW()`,
      [
        emailHash,
        asker_name || null,
        asker_email_encrypted || null,
        asker_phone_encrypted || null,
        question_count || 1,
        score,
        is_hot,
        category_id ? parseInt(category_id, 10) || null : null,
        created_at || new Date().toISOString(),
      ]
    );
  } catch (err) {
    console.error('[leadsService] upsertLead error:', err.message);
    // Non-critical — do not propagate
  }
}

// ─── getLeads ─────────────────────────────────────────────────────────────────

/**
 * Paginated leads list for the CRM UI.
 *
 * @param {object} opts
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=20]
 * @param {'all'|'hot'|'contacted'|'not_contacted'} [opts.filter='all']
 * @param {string} [opts.search='']
 * @returns {Promise<{ leads: object[], total: number }>}
 */
async function getLeads({ page = 1, limit = 20, filter = 'all', search = '' } = {}) {
  const offset = (page - 1) * limit;
  const conditions = [];
  const params     = [];
  let   idx        = 1;

  if (filter === 'hot') {
    conditions.push(`l.is_hot = true`);
  } else if (filter === 'contacted') {
    conditions.push(`l.contacted = true`);
  } else if (filter === 'not_contacted') {
    conditions.push(`l.contacted = false`);
  }

  if (search && search.trim()) {
    conditions.push(`l.asker_name ILIKE $${idx}`);
    params.push(`%${search.trim()}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit, offset);

  const { rows } = await query(
    `SELECT l.*,
            c.name AS last_category_name
     FROM   leads l
     LEFT JOIN categories c ON c.id = l.last_category_id
     ${where}
     ORDER BY l.is_hot DESC, l.interaction_score DESC, l.last_question_at DESC
     LIMIT  $${idx} OFFSET $${idx + 1}`,
    params
  );

  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS total FROM leads l ${where}`,
    params.slice(0, params.length - 2) // exclude limit/offset
  );

  // Decrypt contact info for authorised consumer
  const leads = rows.map((row) => ({
    ...row,
    email: decryptField(row.asker_email_encrypted) || null,
    phone: decryptField(row.asker_phone_encrypted) || null,
    // Remove encrypted fields from response
    asker_email_encrypted: undefined,
    asker_phone_encrypted: undefined,
    email_hash: undefined,
  }));

  return { leads, total: countRows[0]?.total ?? 0 };
}

// ─── getLeadById ──────────────────────────────────────────────────────────────

async function getLeadById(id) {
  const { rows } = await query(
    `SELECT l.*, c.name AS last_category_name
     FROM   leads l
     LEFT JOIN categories c ON c.id = l.last_category_id
     WHERE  l.id = $1`,
    [id]
  );

  if (!rows[0]) return null;

  const lead = {
    ...rows[0],
    email: decryptField(rows[0].asker_email_encrypted) || null,
    phone: decryptField(rows[0].asker_phone_encrypted) || null,
    asker_email_encrypted: undefined,
    asker_phone_encrypted: undefined,
    email_hash: undefined,
  };

  // Fetch question history for this lead
  const { rows: questions } = await query(
    `SELECT id, title, status, category_id, thank_count, is_urgent, created_at, answered_at
     FROM   questions
     WHERE  asker_email_encrypted = $1
     ORDER  BY created_at DESC
     LIMIT  50`,
    [rows[0].asker_email_encrypted]
  );

  lead.questions = questions;
  return lead;
}

// ─── updateLead ───────────────────────────────────────────────────────────────

/**
 * CS agent marks a lead as contacted or adds notes.
 *
 * @param {string} id
 * @param {{ contacted?: boolean, contact_notes?: string }} updates
 */
async function updateLead(id, updates) {
  const sets  = [];
  const vals  = [];
  let   idx   = 1;

  if (typeof updates.contacted === 'boolean') {
    sets.push(`contacted = $${idx++}`);
    vals.push(updates.contacted);
  }

  if (typeof updates.contact_notes === 'string') {
    sets.push(`contact_notes = $${idx++}`);
    vals.push(updates.contact_notes);
  }

  if (!sets.length) return null;

  sets.push(`updated_at = NOW()`);
  vals.push(id);

  const { rows } = await query(
    `UPDATE leads SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    vals
  );

  return rows[0] || null;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { upsertLead, getLeads, getLeadById, updateLead };
