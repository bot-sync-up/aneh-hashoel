'use strict';

/**
 * Inbound Email Parsing Service
 *
 * Parses rabbi reply emails that arrive via the SendGrid Inbound Parse webhook.
 * Extracts question IDs from subjects, strips quoted history and signatures
 * from the body, and validates that the sender is the assigned rabbi.
 *
 * Export surface:
 *   parseInboundEmail(rawEmail)                  → { questionId, senderEmail, content, attachments }
 *   extractQuestionId(subject)                   → number | null
 *   cleanEmailBody(rawText)                      → string
 *   validateRabbiEmail(email, questionId)        → Promise<{ valid, rabbi, question }>
 *
 * Dependencies:
 *   ../db/pool   – query()
 */

const { query } = require('../db/pool');

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Matches "[ID: ###]" anywhere in a subject line (case-insensitive).
 * Also matches "Re: [ID: ###]" reply chains.
 *
 * Examples:
 *   "Re: שאלה בהלכה [ID: 42]"       → 42
 *   "Fwd: [ID:7] ברכות"              → 7
 *   "RE: RE: [ID: 1234] ..."         → 1234
 */
const QUESTION_ID_PATTERN = /\[ID:\s*(\d+)\]/i;

/**
 * Matches "[CLAIM:42]" — rabbi sends this to claim a question.
 * Created by the "קבל שאלה" mailto: button in broadcast emails.
 */
const CLAIM_PATTERN = /\[CLAIM:\s*(\d+)\]/i;

/**
 * Matches "[RELEASE:42]" — rabbi sends this to release a claimed question.
 * Created by the "שחרר שאלה" mailto: button in full-question emails.
 */
const RELEASE_PATTERN = /\[RELEASE:\s*(\d+)\]/i;

/**
 * Matches "[FOLLOWUP:42:7]" — rabbi replies to a follow-up notification.
 * The first number is the question ID, the second is the follow-up ID.
 */
const FOLLOWUP_PATTERN = /\[FOLLOWUP:\s*(\d+)\s*:\s*(\d+)\]/i;

/**
 * Lines starting with any of these patterns mark the beginning of quoted
 * history, reply chains, or signatures — everything from this line down is
 * discarded.
 *
 * Order matters: more-specific patterns first.
 */
const REPLY_BOUNDARY_PATTERNS = [
  // Gmail/Apple "On <date> ... wrote:"
  /^On .{0,200}wrote:\s*$/i,
  // Standard plain-text quoting: line begins with >
  /^>/,
  // Outlook "-----Original Message-----"
  /^-{3,}\s*original message\s*-{3,}/i,
  // Hebrew "--- הודעה מקורית ---" / "--- המקור ---"
  /^-{3,}\s*הודע[הה]\s*מקורית?\s*-{3,}/i,
  // Outlook Hebrew "פרטי ההודעה:"
  /^פרטי ההודעה:/,
  // Hebrew mobile signature "נשלח מ-iPhone" / "נשלח מהאייפון"
  /^נשלח מ/,
  // English mobile signature "Sent from my iPhone"
  /^Sent from /i,
  // RFC 3676 sig delimiter: standalone "-- "
  /^--\s*$/,
  // Email header lines in forwarded blocks
  /^From:\s/i,
  /^To:\s/i,
  /^Subject:\s/i,
  /^Date:\s/i,
  /^נושא:\s/,
  /^מאת:\s/,
  /^אל:\s/,
  /^תאריך:\s/,
  // Outlook underline rule
  /^_{8,}/,
  // Common divider lines
  /^[-=*]{3,}\s*$/,
  // Hebrew signatures: "בכבוד רב", "בברכה", "בהוקרה"
  /^בכבוד רב[,.]?\s*$/,
  /^בברכה[,.]?\s*$/,
  /^בהוקרה[,.]?\s*$/,
  /^בידידות[,.]?\s*$/,
  /^כבוד הרב[,.]?\s*$/,
  // "Get Outlook for iOS" / similar app footers
  /^Get (Outlook|Mail) for /i,
];

/** HTML tag stripper */
const HTML_TAG_RE    = /<[^>]*>/g;
const NBSP_RE        = /&nbsp;/gi;
const HTML_ENTITY_RE = /&[a-z0-9#]+;/gi;
const EXCESS_SPACE   = /[ \t]{2,}/g;

/** Minimal HTML entity decode map */
const HTML_ENTITIES = {
  '&amp;':  '&',
  '&lt;':   '<',
  '&gt;':   '>',
  '&quot;': '"',
  '&#39;':  "'",
  '&apos;': "'",
};

// ─── extractQuestionId ────────────────────────────────────────────────────────

/**
 * Extract the numeric question ID from an email Subject header.
 *
 * @param {string} subject  Full value of the Subject header
 * @returns {number|null}   Parsed question ID, or null if not found
 */
function extractQuestionId(subject) {
  if (!subject || typeof subject !== 'string') return null;

  const match = subject.match(QUESTION_ID_PATTERN);
  if (!match) return null;

  const id = parseInt(match[1], 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// ─── cleanEmailBody ───────────────────────────────────────────────────────────

/**
 * Clean a raw inbound email body, keeping only the rabbi's actual reply.
 *
 * Pipeline:
 *   1. Strip HTML tags (body-plain may still carry lightweight markup)
 *   2. Decode common HTML entities
 *   3. Remove quoted reply chains, signatures (see REPLY_BOUNDARY_PATTERNS)
 *   4. Collapse excessive whitespace
 *   5. Trim leading / trailing blanks
 *
 * @param {string} rawText  Raw plain-text (or lightly tagged) email body
 * @returns {string}        Clean reply text
 */
function cleanEmailBody(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';

  let text = rawText;

  // 1. Strip HTML tags
  text = text.replace(HTML_TAG_RE, ' ');

  // 2. Decode HTML entities
  text = text.replace(NBSP_RE, ' ');
  text = text.replace(HTML_ENTITY_RE, (ent) => HTML_ENTITIES[ent.toLowerCase()] || '');

  // 3. Remove reply chains and signatures
  const lines = text.split(/\r?\n/);
  let cutAt = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (REPLY_BOUNDARY_PATTERNS.some((re) => re.test(lines[i]))) {
      cutAt = i;
      break;
    }
  }
  text = lines.slice(0, cutAt).join('\n');

  // 4. Collapse horizontal whitespace (preserve newlines)
  text = text.replace(EXCESS_SPACE, ' ');

  // Strip trailing whitespace per line
  text = text.replace(/[ \t]+$/gm, '');

  // Collapse 3+ blank lines to 2
  text = text.replace(/\n{3,}/g, '\n\n');

  // 5. Trim
  return text.trim();
}

// ─── validateRabbiEmail ───────────────────────────────────────────────────────

/**
 * Verify that the inbound email sender is the rabbi assigned to the question.
 *
 * @param {string} email        From-address of the inbound email (plain address)
 * @param {number} questionId   Numeric question ID
 * @returns {Promise<{ valid: boolean, rabbi: object|null, question: object|null }>}
 */
async function validateRabbiEmail(email, questionId) {
  const invalid = { valid: false, rabbi: null, question: null };

  if (!email || !questionId) return invalid;

  const normalizedSender = email.trim().toLowerCase();

  const { rows } = await query(
    `SELECT
       q.id                 AS question_id,
       q.status             AS question_status,
       q.question_text,
       q.asker_email,
       q.assigned_rabbi_id,
       q.follow_up_id,
       r.id                 AS rabbi_id,
       r.email              AS rabbi_email,
       r.name               AS rabbi_name,
       r.title              AS rabbi_title
     FROM  questions q
     LEFT JOIN rabbis r ON r.id = q.assigned_rabbi_id
     WHERE q.id = $1
     LIMIT 1`,
    [questionId]
  );

  if (rows.length === 0) return invalid;

  const row = rows[0];

  const question = {
    id:               row.question_id,
    status:           row.question_status,
    question_text:    row.question_text,
    asker_email:      row.asker_email,
    assigned_rabbi_id: row.assigned_rabbi_id,
    follow_up_id:     row.follow_up_id,
  };

  if (!row.rabbi_id || !row.rabbi_email) {
    return { valid: false, rabbi: null, question };
  }

  const rabbi = {
    id:    row.rabbi_id,
    email: row.rabbi_email,
    name:  row.rabbi_name,
    title: row.rabbi_title,
  };

  const emailMatch = row.rabbi_email.trim().toLowerCase() === normalizedSender;

  return {
    valid:    emailMatch,
    rabbi:    emailMatch ? rabbi : null,
    question,
  };
}

// ─── parseInboundEmail ────────────────────────────────────────────────────────

/**
 * Parse a raw inbound email payload from the SendGrid Inbound Parse webhook.
 *
 * SendGrid delivers the email as a multipart/form-data POST.  The body fields
 * used here are:
 *   subject      – email Subject header
 *   from         – email From header (may include display name)
 *   text         – plain-text body
 *   html         – HTML body (fallback if text is absent)
 *   attachments  – JSON string with attachment metadata (SendGrid format)
 *   attachment-info – additional SendGrid attachment metadata
 *
 * @param {object} rawEmail  req.body from the SendGrid webhook handler
 * @returns {{
 *   questionId:   number | null,
 *   senderEmail:  string,
 *   content:      string,
 *   attachments:  Array<{ filename: string, url: string, contentType: string, size: number }>,
 * }}
 */
function parseInboundEmail(rawEmail) {
  if (!rawEmail || typeof rawEmail !== 'object') {
    return { questionId: null, senderEmail: '', content: '', attachments: [] };
  }

  // ── Subject & question ID ──
  const subject    = rawEmail.subject || '';
  const questionId = extractQuestionId(subject);

  // ── Sender email (strip display name) ──
  const fromRaw     = rawEmail.from || rawEmail.sender || '';
  const angleMatch  = fromRaw.match(/<([^>]+)>/);
  const senderEmail = (angleMatch ? angleMatch[1] : fromRaw).trim().toLowerCase();

  // ── Body ──
  const rawBody  = rawEmail.text || rawEmail.html || '';
  const content  = cleanEmailBody(rawBody);

  // ── Attachments ──
  // SendGrid provides attachment info as a JSON object keyed by "attachment1", "attachment2", …
  let attachments = [];
  try {
    const info = rawEmail['attachment-info']
      ? JSON.parse(rawEmail['attachment-info'])
      : {};

    attachments = Object.entries(info).map(([key, meta]) => ({
      filename:    meta.filename    || key,
      contentType: meta['content-type'] || meta.type || 'application/octet-stream',
      size:        meta.attachment_size  || meta.size || 0,
      // SendGrid uploads attachments to a temporary URL; persist these immediately
      // in the calling code if you need permanent storage.
      url:         rawEmail[key]
        ? `data:${meta['content-type'] || 'application/octet-stream'};base64,${
            Buffer.isBuffer(rawEmail[key])
              ? rawEmail[key].toString('base64')
              : Buffer.from(rawEmail[key]).toString('base64')
          }`
        : '',
    }));
  } catch {
    // Attachment parsing is best-effort; don't fail the whole parse
    attachments = [];
  }

  return { questionId, senderEmail, content, attachments };
}

// ─── Task-spec API — canonical names ─────────────────────────────────────────

/**
 * Parse an incoming email payload (SendGrid Inbound Parse webhook body).
 * Returns the three fields needed by the webhook route:
 *   { questionId, rabbiEmail, cleanContent }
 *
 * This is a thin adapter over parseInboundEmail that renames fields to the
 * exact interface the routes/emailWebhook.js route expects.
 *
 * @param {object} rawEmail  req.body from SendGrid Inbound Parse
 * @returns {{ questionId: number|null, rabbiEmail: string, cleanContent: string }}
 */
function parseIncomingEmail(rawEmail) {
  const { questionId, senderEmail, content } = parseInboundEmail(rawEmail);
  return {
    questionId,
    rabbiEmail:   senderEmail,
    cleanContent: content,
  };
}

/**
 * Extract the numeric question ID from a subject line, with optional fallback
 * to the first line of the body.
 *
 * @param {string} subject  Email Subject header value
 * @param {string} [body]   Optional plain-text body to search when subject has no ID
 * @returns {number|null}
 */
function extractQuestionIdFull(subject, body) {
  // Try subject first
  const fromSubject = extractQuestionId(subject);
  if (fromSubject !== null) return fromSubject;

  // Fallback: scan the first line of the body
  if (body && typeof body === 'string') {
    const firstLine = body.split(/\r?\n/)[0] || '';
    return extractQuestionId(firstLine);
  }

  return null;
}

/**
 * Clean raw email content — alias of cleanEmailBody.
 * Removes quoted reply history, mobile signatures, email headers, and extra whitespace.
 *
 * @param {string} rawText
 * @returns {string}
 */
function cleanEmailContent(rawText) {
  return cleanEmailBody(rawText);
}

/**
 * Verify that the sender email corresponds to the rabbi assigned to questionId.
 * Alias of validateRabbiEmail with the same signature used in routes.
 *
 * @param {string} email
 * @param {number} questionId
 * @returns {Promise<{ valid: boolean, rabbi: object|null, question: object|null }>}
 */
async function validateSender(email, questionId) {
  return validateRabbiEmail(email, questionId);
}

// ─── extractEmailAction ────────────────────────────────────────────────────────

/**
 * Determine the action type from an inbound email subject line and optional body.
 *
 * Priority:
 *   1. [CLAIM:XX]          → rabbi wants to claim question XX
 *   2. [RELEASE:XX]        → rabbi wants to release question XX
 *   3. [FOLLOWUP:XX:YY]    → rabbi is answering follow-up YY on question XX
 *   4. [ID: XX] + body "תפוס"  → claim (reply to notification email)
 *   5. [ID: XX] + body "שחרר"  → release (reply to full-question email)
 *   6. [ID: XX]            → rabbi is answering question XX
 *
 * @param {string} subject
 * @param {string} [body]  Cleaned plain-text body (optional)
 * @returns {{ action: 'claim'|'release'|'answer'|'followup_answer', questionId: number, followUpId?: number } | null}
 */
function extractEmailAction(subject, body) {
  if (!subject || typeof subject !== 'string') return null;

  const claimMatch = subject.match(CLAIM_PATTERN);
  if (claimMatch) {
    const id = parseInt(claimMatch[1], 10);
    if (Number.isFinite(id) && id > 0) return { action: 'claim', questionId: id };
  }

  const releaseMatch = subject.match(RELEASE_PATTERN);
  if (releaseMatch) {
    const id = parseInt(releaseMatch[1], 10);
    if (Number.isFinite(id) && id > 0) return { action: 'release', questionId: id };
  }

  const followupMatch = subject.match(FOLLOWUP_PATTERN);
  if (followupMatch) {
    const qId  = parseInt(followupMatch[1], 10);
    const fuId = parseInt(followupMatch[2], 10);
    if (Number.isFinite(qId) && qId > 0 && Number.isFinite(fuId) && fuId > 0) {
      return { action: 'followup_answer', questionId: qId, followUpId: fuId };
    }
  }

  const answerId = extractQuestionId(subject);
  if (answerId) {
    // Check body for Hebrew command words before treating as an answer
    if (body && typeof body === 'string') {
      const trimmed = body.trim();
      if (trimmed === 'תפוס') return { action: 'claim',   questionId: answerId };
      if (trimmed === 'שחרר') return { action: 'release', questionId: answerId };
    }
    return { action: 'answer', questionId: answerId };
  }

  return null;
}

// ─── findRabbiByEmail ──────────────────────────────────────────────────────────

/**
 * Look up an active rabbi by their email address (case-insensitive).
 * Used for claim/release where any active rabbi may act (not only the assigned one).
 *
 * @param {string} email  Plain email address (no display name)
 * @returns {Promise<object|null>}  Rabbi row or null
 */
async function findRabbiByEmail(email) {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  const { rows } = await query(
    `SELECT id, name, email, title
     FROM   rabbis
     WHERE  LOWER(email) = $1
       AND  status = 'active'
     LIMIT  1`,
    [normalized]
  );
  return rows[0] || null;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Existing / canonical implementations
  parseInboundEmail,
  cleanEmailBody,
  validateRabbiEmail,
  // Task-spec canonical names
  parseIncomingEmail,
  /** extractQuestionId(subject, body?) — body is optional fallback */
  extractQuestionId: extractQuestionIdFull,
  cleanEmailContent,
  validateSender,
  // Email-action routing (claim / release / answer)
  extractEmailAction,
  findRabbiByEmail,
};
