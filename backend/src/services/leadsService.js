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

function _phoneHash(plainPhone) {
  if (!plainPhone) return null;
  // Normalize: strip spaces, dashes, and leading zeros after country code
  const normalized = plainPhone.replace(/[\s\-()]/g, '').trim();
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function _nameHash(name) {
  if (!name) return null;
  // Prefix with 'name:' to avoid collisions with email hashes
  return crypto.createHash('sha256').update('name:' + name.trim()).digest('hex');
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
 * Deduplicates by phone OR email: if a lead with the same phone or email
 * already exists, updates it (increments question count, updates timestamps)
 * instead of creating a new row.
 *
 * @param {object} question — row from questions table (after createFromWebhook)
 */
async function upsertLead(question) {
  const {
    id:           questionId,
    asker_email:  plainEmail,   // plaintext email (passed explicitly by caller)
    asker_phone:  plainPhone,   // plaintext phone (passed explicitly by caller)
    asker_email_encrypted,      // encrypted email for DB storage
    asker_phone_encrypted,      // encrypted phone for DB storage
    asker_name,
    category_id,
    urgency,                    // questions table uses 'urgency' varchar, not 'is_urgent' boolean
    thank_count = 0,
    created_at,
  } = question;

  const emailHash = _emailHash(plainEmail);
  const phoneHash = _phoneHash(plainPhone);

  // If no email AND no phone AND no name, skip — we can't identify this lead
  if (!emailHash && !phoneHash && !asker_name) return;

  // Fallback hash from name when neither email nor phone is available
  const nameHash = _nameHash(asker_name);

  try {
    // ── Step 1: Find existing lead by phone OR email ───────────────────────
    let existingLead = null;

    if (emailHash) {
      const { rows } = await query(
        `SELECT id, email_hash, phone_hash FROM leads WHERE email_hash = $1 LIMIT 1`,
        [emailHash]
      );
      if (rows[0]) existingLead = rows[0];
    }

    if (!existingLead && phoneHash) {
      const { rows } = await query(
        `SELECT id, email_hash, phone_hash FROM leads WHERE phone_hash = $1 LIMIT 1`,
        [phoneHash]
      );
      if (rows[0]) existingLead = rows[0];
    }

    // Fallback: try name hash (for leads created before phone dedup was added)
    if (!existingLead && !emailHash && !phoneHash && nameHash) {
      const { rows } = await query(
        `SELECT id, email_hash, phone_hash FROM leads WHERE email_hash = $1 LIMIT 1`,
        [nameHash]
      );
      if (rows[0]) existingLead = rows[0];
    }

    // ── Step 2: Compute aggregate stats ────────────────────────────────────
    let question_count = 1;
    let total_thanks = 0;
    let has_urgent = (urgency === 'urgent' || urgency === 'critical' || urgency === 'high') || false;

    if (asker_email_encrypted) {
      const { rows: stats } = await query(
        `SELECT COUNT(*)::int AS question_count,
                COALESCE(SUM(thank_count), 0)::int AS total_thanks,
                bool_or(urgency IN ('urgent','critical','high')) AS has_urgent
         FROM   questions
         WHERE  asker_email = $1`,
        [asker_email_encrypted]
      );
      question_count = stats[0]?.question_count || 1;
      total_thanks   = stats[0]?.total_thanks || 0;
      has_urgent     = stats[0]?.has_urgent || false;
    } else if (asker_name) {
      const { rows: stats } = await query(
        `SELECT COUNT(*)::int AS question_count,
                COALESCE(SUM(thank_count), 0)::int AS total_thanks,
                bool_or(urgency IN ('urgent','critical','high')) AS has_urgent
         FROM   questions
         WHERE  asker_name = $1 AND asker_email IS NULL`,
        [asker_name]
      );
      question_count = stats[0]?.question_count || 1;
      total_thanks   = stats[0]?.total_thanks || 0;
      has_urgent     = stats[0]?.has_urgent || false;
    }

    const score  = _hotScore(question_count, total_thanks, has_urgent);
    const is_hot = _isHot(question_count, total_thanks, has_urgent);
    const now    = created_at || new Date().toISOString();
    const catId  = category_id ? parseInt(category_id, 10) || null : null;

    // ── Step 3: Update existing or insert new ──────────────────────────────
    if (existingLead) {
      // UPDATE existing lead — merge in any new contact info, bump stats
      await query(
        `UPDATE leads SET
           asker_name            = COALESCE($1, asker_name),
           asker_email_encrypted = COALESCE($2, asker_email_encrypted),
           asker_phone_encrypted = COALESCE($3, asker_phone_encrypted),
           email_hash            = COALESCE($4, email_hash),
           phone_hash            = COALESCE($5, phone_hash),
           question_count        = $6,
           interaction_score     = $7,
           is_hot                = $8,
           last_category_id      = COALESCE($9, last_category_id),
           last_question_at      = GREATEST(last_question_at, $10),
           updated_at            = NOW()
         WHERE id = $11`,
        [
          asker_name || null,
          asker_email_encrypted || null,
          asker_phone_encrypted || null,
          emailHash,
          phoneHash,
          question_count || 1,
          score,
          is_hot,
          catId,
          now,
          existingLead.id,
        ]
      );
    } else {
      // INSERT new lead
      const resolvedEmailHash = emailHash || (!phoneHash ? nameHash : null);
      const { rows: insertedRows } = await query(
        `INSERT INTO leads
           (email_hash, phone_hash, asker_name, asker_email_encrypted, asker_phone_encrypted,
            question_count, interaction_score, is_hot, last_category_id,
            first_question_at, last_question_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         RETURNING id`,
        [
          resolvedEmailHash,
          phoneHash,
          asker_name || null,
          asker_email_encrypted || null,
          asker_phone_encrypted || null,
          question_count || 1,
          score,
          is_hot,
          catId,
          now,
        ]
      );

      // Queue onboarding emails for first-time askers
      if (insertedRows[0]?.id && asker_email_encrypted) {
        try {
          const { queueOnboarding } = require('../cron/jobs/onboardingDrip');
          queueOnboarding(insertedRows[0].id, asker_email_encrypted, asker_name);
        } catch (onboardErr) {
          console.warn('[leadsService] onboarding queue failed:', onboardErr.message);
        }
      }
    }
  } catch (err) {
    console.error('[leadsService] upsertLead error:', err.message);
    // Non-critical — do not propagate
  }
}

/**
 * Sync all questions into leads — scans all questions and calls upsertLead for each.
 * Intended for admin use to backfill leads.
 *
 * @returns {Promise<{ synced: number, skipped: number }>}
 */
async function syncLeadsFromQuestions() {
  // The questions table may have encrypted email/phone in either
  // `asker_email_encrypted` (original schema) or `asker_email` (fix migration).
  // Read both and use whichever is populated.
  const { rows } = await query(
    `SELECT id, asker_name,
            asker_email  AS asker_email_col,
            asker_phone  AS asker_phone_col,
            category_id, urgency, thank_count, created_at
     FROM questions
     ORDER BY created_at ASC`
  );

  let synced = 0;
  let skipped = 0;

  for (const q of rows) {
    const encryptedEmail = q.asker_email_col || null;
    const encryptedPhone = q.asker_phone_col || null;

    // Try to decrypt email for hash
    let plainEmail = null;
    try {
      plainEmail = decryptField(encryptedEmail) || null;
    } catch { /* ignore */ }

    let plainPhone = null;
    try {
      plainPhone = decryptField(encryptedPhone) || null;
    } catch { /* ignore */ }

    // Skip if no email AND no name
    if (!plainEmail && !q.asker_name) {
      skipped++;
      continue;
    }

    await upsertLead({
      ...q,
      asker_email: plainEmail,
      asker_phone: plainPhone,
      asker_email_encrypted: encryptedEmail,
      asker_phone_encrypted: encryptedPhone,
    });
    synced++;
  }

  return { synced, skipped };
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
    phone_hash: undefined,
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
    phone_hash: undefined,
  };

  // Fetch question history for this lead
  // The questions table uses `asker_email` column for encrypted email
  const { rows: questions } = await query(
    `SELECT id, title, status, category_id, thank_count, urgency, created_at, answered_at
     FROM   questions
     WHERE  asker_email = $1
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

module.exports = { upsertLead, getLeads, getLeadById, updateLead, syncLeadsFromQuestions };
