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
// Reply-history boundaries: markers that reliably indicate the START of a
// quoted chain (previous message, forwarded message, reply headers). These
// are deterministic — signature heuristics are handled separately in
// detectAndStripSignature() below.
const REPLY_BOUNDARY_PATTERNS = [
  // Gmail/Apple "On <date> ... wrote:"
  /^On .{0,200}wrote:\s*$/i,
  // Gmail Hebrew "בתאריך <date>, <time>, מאת <sender> <email>:"
  /^\s*[\u200e\u200f]*בתאריך\s/,
  /^\s*[\u200e\u200f]*ב\s*\d{1,2}\/\d{1,2}\/\d{2,4}/,
  // Plain-text quoting: line begins with >
  /^>/,
  // Outlook "-----Original Message-----" / Hebrew equivalents
  /^-{3,}\s*original message\s*-{3,}/i,
  /^-{3,}\s*הודע[הה]\s*מקורית?\s*-{3,}/i,
  /^פרטי ההודעה:/,
  // Email header lines in forwarded blocks
  /^From:\s/i,  /^To:\s/i,  /^Subject:\s/i,  /^Date:\s/i,
  /^נושא:\s/,   /^מאת:\s/,  /^אל:\s/,         /^תאריך:\s/,
  // Outlook underline rule (forwarded-message separator)
  /^_{8,}/,
];

// ─── Signature detection — heuristic, language-agnostic ───────────────────────
//
// A signature is identified by its SHAPE, not by matching specific Hebrew
// phrases. We split the message into paragraphs (blank-line separated) and
// walk from the end, scoring each paragraph on signature-like traits. High
// score = cut. This correctly handles:
//   • "בכבוד רב ראובן זכאים" (+closer phrase +short)
//   • "ראובן זכאים\n050-1234567" (+phone +short +name-shaped)
//   • "-- \nRabbi's contact info" (+delimiter)
//   • Custom HTML signatures from Gmail (no `--` separator)
// Without false-positives on real content: scientific citations, hilkhot
// references, long prose paragraphs all score too low to be cut.

// Common closing openers — matched anywhere (start of paragraph or after
// sentence-ending punctuation). NOT exhaustive by design; a paragraph
// doesn't NEED a closer phrase to be flagged — phone/email/name shape
// contribute too.
const CLOSER_PHRASE_RE = /(?:^|[.!?]\s+|[\n])(בכבוד\s*רב|בברכה|בהוקרה|בהערכה|בידידות|ידידך|אוהבך|בכל\s*הכבוד|כבוד\s*הרב|תודה\s*רבה\s*מראש|בשורות\s*טובות|ויה"ר|ברכת התורה)(?=\s|[,.]|$)/;

// RFC 3676 "-- " delimiter + Outlook-style separators
const SIG_DELIMITER_RE = /^(?:-{2,}|_{3,}|={3,}|\*{3,})\s*$/;

// Mobile client auto-signatures — these ARE deterministic enough to include
const MOBILE_SIG_RE = /^(נשלח מ|Sent from (my )?|Get (Outlook|Mail) for)/i;

// Phone patterns — Israeli formats + generic international
const PHONE_RE = /(?:\+?972[-\s]?|\b0)[2-9](?:[-\s]?\d){6,8}\b/;

const URL_RE   = /\bhttps?:\/\/\S+/i;
const EMAIL_RE = /\b[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;

/**
 * Score a paragraph's signature-like traits. Returns a number.
 * Threshold for "this is a signature" is determined by caller (8+).
 */
function _signatureScore(para) {
  const trimmed = para.trim();
  if (!trimmed) return 100; // blank lines are part of the signature block

  // Clearly not a signature — long prose paragraphs
  if (trimmed.length > 350) return 0;

  const lines = trimmed.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  let score = 0;

  // Strong signals
  if (lines.some((l) => SIG_DELIMITER_RE.test(l)))             score += 20;
  if (lines.some((l) => MOBILE_SIG_RE.test(l)))                score += 20;
  if (CLOSER_PHRASE_RE.test(trimmed))                          score += 12;
  if (PHONE_RE.test(trimmed))                                   score += 8;
  if (URL_RE.test(trimmed))                                     score += 6;
  if (EMAIL_RE.test(trimmed))                                   score += 6;

  // Shape signals
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  const hasEndingPunct = /[?!.:]/.test(trimmed);
  const allShortLines = lines.every((l) => l.length < 60);

  // Short paragraph with all short lines → block of signature info
  if (allShortLines && lines.length <= 6 && trimmed.length < 200) score += 3;

  // Name-shape: 1-4 tokens, no sentence-ending punctuation, single line.
  // Ending punctuation (., !, ?, :) → this is a complete sentence, not a name,
  // so we don't apply the name-shape bonus. A signature name is typically
  // a bare noun-phrase ("ראובן זכאים") with no terminator.
  if (
    lines.length === 1 &&
    wordCount <= 4 &&
    trimmed.length < 80 &&
    !/[?!.:]$/.test(trimmed)
  ) {
    score += 6;
    // Extra bonus if it looks like a proper Hebrew name (Hebrew letters, no digits)
    if (!/\d/.test(trimmed) && /[\u0590-\u05FF]/.test(trimmed)) score += 2;
  }

  // Lines that are just contact info (phone/email/URL each on its own line)
  const contactLines = lines.filter((l) =>
    PHONE_RE.test(l) || URL_RE.test(l) || EMAIL_RE.test(l)
  ).length;
  if (contactLines >= 1 && contactLines === lines.length - 1) score += 4;

  // Penalty: paragraph with sentence-like structure
  if (hasEndingPunct && trimmed.length > 120) score -= 6;

  return score;
}

/**
 * Two-phase signature detector:
 *
 * Phase 1 — Inline cut at the first closer phrase (e.g. "בכבוד רב")
 *   preceded by a sentence/line boundary. This handles the common case
 *   where the whole sign-off is glued into the final paragraph.
 *
 * Phase 2 — Walk the remaining paragraphs from the end, scoring each on
 *   signature-like SHAPE (phone, email, URL, delimiter, short name-line,
 *   etc). Strip contiguous signature-scored paragraphs.
 *
 * Doing inline first prevents Phase 2 from over-cutting an entire
 * paragraph when only the last sentence was a sign-off.
 */
function detectAndStripSignature(text) {
  if (!text) return text;

  let body = text.replace(/\r\n?/g, '\n');

  // ── Phase 1: inline closer phrase ───────────────────────────────────────
  const inline = body.match(CLOSER_PHRASE_RE);
  if (inline && inline.index != null) {
    // CLOSER_PHRASE_RE captures:
    //   match[0] = boundary + phrase    (e.g. "\nבכבוד רב" or ". בכבוד רב")
    //   match[1] = phrase               (e.g. "בכבוד רב")
    // The boundary has length = match[0].length - match[1].length.
    const boundaryLen = inline[0].length - inline[1].length;
    const cutAt      = inline.index + boundaryLen;
    const before     = body.slice(0, cutAt).trim();
    // Keep the cut only when real content precedes the sign-off. If the
    // whole message IS the sign-off (e.g. the rabbi only typed their name),
    // leave it untouched so we don't drop everything.
    if (before.length >= 20) {
      body = before;
    }
  }

  // ── Phase 2: paragraph-shape walk from the end ──────────────────────────
  const paragraphs = body.split(/\n\s*\n/);
  let keepCount = paragraphs.length;
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const score = _signatureScore(paragraphs[i]);
    if (score >= 10) {
      keepCount = i;
    } else {
      break;
    }
  }

  return paragraphs.slice(0, keepCount).join('\n\n').trim();
}

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

  // 1a. Convert block-level HTML tags to newlines BEFORE stripping the rest.
  //     Otherwise <br>/<p>/<div>/<li> become spaces and the whole message
  //     collapses to a single line — killing the paragraph-based signature
  //     detection below.
  text = text
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(?:p|div|li|h[1-6]|tr|blockquote)\s*>/gi, '\n');

  // 1b. Strip remaining HTML tags
  text = text.replace(HTML_TAG_RE, ' ');

  // 2. Decode HTML entities
  text = text.replace(NBSP_RE, ' ');
  text = text.replace(HTML_ENTITY_RE, (ent) => HTML_ENTITIES[ent.toLowerCase()] || '');

  // 3a. Cut quoted-reply history at its first deterministic marker.
  //     These are reliable (email-client generated): Gmail's "בתאריך",
  //     Outlook's "Original Message", forwarded headers, etc.
  const lines = text.split(/\r?\n/);
  let cutAt = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (REPLY_BOUNDARY_PATTERNS.some((re) => re.test(lines[i]))) {
      cutAt = i;
      break;
    }
  }
  text = lines.slice(0, cutAt).join('\n');

  // 3b. Signature detection — heuristic, works by SHAPE not specific words.
  //     Scores paragraphs from the end; strips those that look like sigs.
  text = detectAndStripSignature(text);

  // 4. Collapse horizontal whitespace (preserve newlines)
  text = text.replace(EXCESS_SPACE, ' ');
  text = text.replace(/[ \t]+$/gm, '');
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
  // Exposed for one-shot backfill scripts that want to re-clean stored answers
  detectAndStripSignature,
};
