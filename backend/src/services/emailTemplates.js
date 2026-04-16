'use strict';

/**
 * emailTemplates service
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralised helper for loading + rendering + sending admin-editable emails.
 *
 * Single source of truth:
 *   system_config['email_templates']   (JSONB)  ← admin edits this
 *   constants/defaultEmailTemplates.js         ← seeded into DB on startup
 *
 * On backend startup, seedDefaultEmailTemplates() merges DEFAULT_EMAIL_TEMPLATES
 * with whatever is already in the DB so that the admin UI always shows fully
 * populated editable fields. Admin-edited values are preserved.
 *
 * Exports:
 *   seedDefaultEmailTemplates() – idempotent, safe to call on every boot
 *   loadAllTemplates()          – returns the resolved templates object
 *   getTemplate(key)            – returns { subject, body } for the given key
 *   renderTemplate(key, vars)   – returns { subject, html } ready to send
 *   sendTemplated(key, opts)    – end-to-end: load + render + sendEmail()
 *   fillVariables(str, vars)    – string → string with {placeholders} replaced
 *
 * Depends on:
 *   ../db/pool                 – query()
 *   ../constants/defaultEmailTemplates  – DEFAULT_EMAIL_TEMPLATES
 *   ../templates/emailBase     – createEmailHTML()
 *   ../services/email          – sendEmail()
 *   ../routes/unsubscribe      – signUnsubscribeToken (for asker leads)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { query } = require('../db/pool');
const { DEFAULT_EMAIL_TEMPLATES } = require('../constants/defaultEmailTemplates');
const { createEmailHTML } = require('../templates/emailBase');

// ─── In-memory cache (invalidated on admin save) ─────────────────────────────

let _cache = null;
let _cacheAt = 0;
const CACHE_MS = 60_000; // 1 minute — plenty fresh, avoids hammering DB

function _invalidateCache() {
  _cache = null;
  _cacheAt = 0;
}

// ─── seedDefaultEmailTemplates ────────────────────────────────────────────────

/**
 * Ensure every default template key is present in system_config['email_templates'].
 * Existing admin-edited values are preserved; only MISSING keys are filled in.
 * Idempotent, safe to call on every backend boot.
 */
async function seedDefaultEmailTemplates() {
  try {
    const { rows } = await query(
      "SELECT value FROM system_config WHERE key = 'email_templates'"
    );

    const existing = rows.length > 0 && rows[0].value
      ? (typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value)
      : {};

    const merged = { ...DEFAULT_EMAIL_TEMPLATES, ...existing };

    // Only write back if there are new keys to add
    const newKeys = Object.keys(DEFAULT_EMAIL_TEMPLATES)
      .filter((k) => !(k in existing));

    if (newKeys.length > 0 || rows.length === 0) {
      await query(
        `INSERT INTO system_config (key, value, updated_at)
         VALUES ('email_templates', $1::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE
           SET value = $1::jsonb, updated_at = NOW()`,
        [JSON.stringify(merged)]
      );
      console.log(
        `[emailTemplates] seeded ${newKeys.length} new template keys` +
        (newKeys.length ? ` (${newKeys.slice(0, 5).join(', ')}${newKeys.length > 5 ? '…' : ''})` : '')
      );
    } else {
      console.log('[emailTemplates] all default keys already present — no seed needed');
    }

    _invalidateCache();
  } catch (err) {
    console.error('[emailTemplates] seed error:', err.message);
  }
}

// ─── loadAllTemplates ─────────────────────────────────────────────────────────

/**
 * Resolve the full templates object from cache or DB (falling back to defaults).
 * @returns {Promise<Record<string,string>>}
 */
async function loadAllTemplates() {
  if (_cache && Date.now() - _cacheAt < CACHE_MS) return _cache;

  try {
    const { rows } = await query(
      "SELECT value FROM system_config WHERE key = 'email_templates'"
    );
    const dbVal = rows.length > 0 && rows[0].value
      ? (typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value)
      : {};
    _cache = { ...DEFAULT_EMAIL_TEMPLATES, ...dbVal };
  } catch (err) {
    console.error('[emailTemplates] loadAllTemplates DB error:', err.message);
    _cache = { ...DEFAULT_EMAIL_TEMPLATES };
  }
  _cacheAt = Date.now();
  return _cache;
}

// ─── getTemplate ──────────────────────────────────────────────────────────────

/**
 * @param {string} key   prefix (e.g. 'welcome', 'asker_answer_ready')
 * @returns {Promise<{ subject: string, body: string, systemName: string }>}
 */
async function getTemplate(key) {
  const all = await loadAllTemplates();
  const subject = all[`${key}_subject`] ?? DEFAULT_EMAIL_TEMPLATES[`${key}_subject`] ?? '';
  const body    = all[`${key}_body`]    ?? DEFAULT_EMAIL_TEMPLATES[`${key}_body`]    ?? '';

  // Pick appropriate systemName based on audience hint in the key
  const isAsker = key.startsWith('asker_') || key.startsWith('onboarding_');
  const systemName = isAsker
    ? (all.asker_system_name || DEFAULT_EMAIL_TEMPLATES.asker_system_name)
    : (all.rabbi_system_name || DEFAULT_EMAIL_TEMPLATES.rabbi_system_name);

  return { subject, body, systemName };
}

// ─── fillVariables ────────────────────────────────────────────────────────────

/**
 * Replace {placeholder} tokens in `str` with values from `vars`. Unknown
 * tokens are left in place. Null/undefined values are coerced to ''.
 */
function fillVariables(str, vars) {
  if (!str) return '';
  let out = String(str);
  for (const [k, v] of Object.entries(vars || {})) {
    const safe = v === null || v === undefined ? '' : String(v);
    const re = new RegExp('\\{' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\}', 'g');
    out = out.replace(re, safe);
  }
  return out;
}

// ─── renderTemplate ───────────────────────────────────────────────────────────

/**
 * Load a template, substitute variables, wrap in the email shell.
 *
 * @param {string} key
 * @param {object} options
 * @param {object} [options.vars={}]       – placeholder substitutions
 * @param {Array}  [options.buttons=[]]    – [{ label, url, color? }] call-to-action
 * @param {'asker'|'rabbi'} [options.audience]  – controls footer links
 * @param {string} [options.unsubscribeLink]    – if provided adds opt-out footer
 * @returns {Promise<{ subject: string, html: string, systemName: string }>}
 */
async function renderTemplate(key, options = {}) {
  const { subject: rawSubject, body: rawBody, systemName } = await getTemplate(key);

  const baseVars = { system_name: systemName, ...options.vars };
  const subject = fillVariables(rawSubject, baseVars);
  const body    = fillVariables(rawBody,    baseVars);

  const html = createEmailHTML(subject || key, body, options.buttons || [], {
    systemName,
    audience: options.audience,
    unsubscribeLink: options.unsubscribeLink,
  });

  return { subject, html, systemName };
}

// ─── sendTemplated ────────────────────────────────────────────────────────────

/**
 * Load → render → send. The single function every caller should use.
 *
 * @param {string} key
 * @param {object} options
 * @param {string} options.to               – recipient email
 * @param {object} [options.vars={}]        – placeholder substitutions
 * @param {Array}  [options.buttons=[]]     – action buttons
 * @param {'asker'|'rabbi'} [options.audience]
 * @param {string} [options.unsubscribeLink]
 * @param {string} [options.fromName]       – override display name
 * @returns {Promise<{ ok: boolean, subject?: string, error?: string }>}
 */
async function sendTemplated(key, options = {}) {
  if (!options.to) {
    return { ok: false, error: 'missing recipient' };
  }
  try {
    const { subject, html } = await renderTemplate(key, options);
    const { sendEmail } = require('./email');
    await sendEmail(options.to, subject, html, options.fromName ? { fromName: options.fromName } : undefined);
    return { ok: true, subject };
  } catch (err) {
    console.error(`[emailTemplates] sendTemplated(${key}) failed:`, err.message);
    return { ok: false, error: err.message };
  }
}

// ─── buildUnsubscribeLink ────────────────────────────────────────────────────

/**
 * Build a public unsubscribe URL for a given lead. Returns '' if no lead id
 * so callers can pass `unsubscribeLink || undefined` safely.
 *
 * Uses the signed JWT from routes/unsubscribe.js so the lead doesn't need
 * to be logged in to opt out.
 */
function buildUnsubscribeLink(leadId) {
  if (!leadId) return '';
  try {
    const { signUnsubscribeToken } = require('../routes/unsubscribe');
    const base = (process.env.APP_URL || '').replace(/\/$/, '');
    const token = signUnsubscribeToken(leadId);
    return `${base}/unsubscribe?token=${token}`;
  } catch (err) {
    console.warn('[emailTemplates] buildUnsubscribeLink error:', err.message);
    return '';
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  seedDefaultEmailTemplates,
  loadAllTemplates,
  getTemplate,
  renderTemplate,
  sendTemplated,
  fillVariables,
  buildUnsubscribeLink,
  _invalidateCache, // exported for the admin save handler
};
