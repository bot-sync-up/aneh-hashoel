'use strict';

/**
 * IMAP Poller — connects to the rabbis mailbox via IMAP, fetches unread
 * reply emails, matches them to questions, and submits answers.
 *
 * Runs every 2 minutes via cron.
 *
 * Flow:
 *   1. Connect to IMAP mailbox
 *   2. Search for UNSEEN emails
 *   3. For each email:
 *      a. Parse sender, subject, body
 *      b. Match to a question via subject token [Q:xxx] or In-Reply-To header
 *      c. Find the rabbi by sender email
 *      d. Auto-claim if needed, then submit answer
 *      e. Mark email as SEEN
 *   4. Disconnect
 *
 * Env vars:
 *   IMAP_HOST     — IMAP server (default: same as SMTP_HOST)
 *   IMAP_PORT     — IMAP port (default: 993)
 *   IMAP_USER     — IMAP username (default: same as SMTP_USER)
 *   IMAP_PASS     — IMAP password (default: same as SMTP_PASS)
 *   IMAP_TLS      — use TLS (default: true)
 */

const Imap = require('imap');
const { simpleParser } = require('mailparser');
const { query: db } = require('../../db/pool');
const { logger } = require('../../utils/logger');

const log = logger.child({ module: 'imapPoller' });

// ── Config ───────────────────────────────────────────────────────────────────

function getImapConfig() {
  return {
    host:     process.env.IMAP_HOST || process.env.SMTP_HOST,
    port:     parseInt(process.env.IMAP_PORT, 10) || 993,
    user:     process.env.IMAP_USER || process.env.SMTP_USER,
    password: process.env.IMAP_PASS || process.env.SMTP_PASS,
    tls:      process.env.IMAP_TLS !== 'false',
    tlsOptions: { rejectUnauthorized: false },
    connTimeout: 15000,
    authTimeout: 10000,
  };
}

// ── Extract question ID from subject ─────────────────────────────────────────

// Match [Q:id], [ID:id], [CLAIM:id] — supports both UUID and numeric IDs
const QUESTION_ID_PATTERNS = [
  /\[Q[:\-]?\s*([a-f0-9\-]{36})\]/i,       // UUID
  /\[ID[:\-]?\s*([a-f0-9\-]{36})\]/i,      // UUID
  /\[CLAIM[:\-]?\s*([a-f0-9\-]{36})\]/i,   // UUID
  /\[Q[:\-]?\s*(\d+)\]/i,                   // Numeric
  /\[ID[:\-]?\s*(\d+)\]/i,                  // Numeric
  /\[CLAIM[:\-]?\s*(\d+)\]/i,              // Numeric
];
const FOLLOWUP_PATTERN = /\[FOLLOWUP[:\-]?\s*(\d+)[:\-]?\s*(\d+)\]/i;

function extractQuestionId(subject) {
  if (!subject) return null;
  for (const pattern of QUESTION_ID_PATTERNS) {
    const match = subject.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractFollowUpId(subject) {
  if (!subject) return null;
  const match = subject.match(FOLLOWUP_PATTERN);
  return match ? { questionId: match[1], followUpId: match[2] } : null;
}

// ── Strip email signature & quoted text ──────────────────────────────────────

function stripReplyContent(text) {
  if (!text) return '';

  // Remove everything after common reply markers
  const markers = [
    /^--\s*$/m,                           // -- (standard sig separator)
    /^_{3,}/m,                            // ___ (Outlook)
    /^-{3,}/m,                            // --- (generic)
    /^On .+ wrote:$/m,                    // On Mon, Jan 1... wrote:
    /^ב.+ כתב.*:$/m,                     // Hebrew: ב-1 בינואר... כתב:
    /^מאת:.*$/m,                          // Hebrew: מאת: (From:)
    /^From:.*$/m,                         // From:
    /^>+\s/m,                             // Quoted text starting with >
    /^Sent from my/m,                     // Mobile signatures
    /^נשלח מ-/m,                          // Hebrew mobile sig
    /^Get Outlook for/m,                  // Outlook mobile
    /^\*{3,}/m,                           // *** separator
  ];

  let cleaned = text;
  for (const marker of markers) {
    const match = cleaned.match(marker);
    if (match) {
      cleaned = cleaned.substring(0, match.index).trim();
    }
  }

  // Remove excessive whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}

// ── Claim-only keywords ──────────────────────────────────────────────────────

const CLAIM_KEYWORDS = ['תפוס', 'תפיסה', 'קבל', 'אני לוקח', 'claim'];
const RELEASE_KEYWORDS = ['שחרר', 'שחרור', 'release'];

function isClaimOnly(text) {
  if (!text) return false;
  // Take only the first line (ignore signatures, quoted text, etc.)
  const firstLine = text.split('\n')[0].trim().replace(/[.\s!]+$/, '');
  return CLAIM_KEYWORDS.some((kw) => firstLine === kw);
}

function isReleaseOnly(text) {
  if (!text) return false;
  const firstLine = text.split('\n')[0].trim().replace(/[.\s!]+$/, '');
  return RELEASE_KEYWORDS.some((kw) => firstLine === kw);
}

// ── Send confirmation email back to rabbi ────────────────────────────────────

async function sendConfirmation(rabbiEmail, type, questionTitle, questionId) {
  try {
    const { sendEmail } = require('../../services/email');
    const { createEmailHTML } = require('../../templates/emailBase');

    const messages = {
      claimed:  `השאלה "${questionTitle}" נתפסה בהצלחה ומחכה לתשובתך. תוכל לענות בהשב למייל זה או דרך המערכת.`,
      answered: `התשובה שלך לשאלה "${questionTitle}" נקלטה ופורסמה בהצלחה!`,
      released: `השאלה "${questionTitle}" שוחררה בהצלחה וזמינה כעת לרבנים אחרים.`,
      already_answered: `השאלה "${questionTitle}" כבר נענתה על ידי רב אחר.`,
      already_claimed:  `השאלה "${questionTitle}" כבר נתפסה על ידי רב אחר.`,
      not_found: `השאלה שניסית לענות עליה לא נמצאה במערכת.`,
    };

    // Lookup short question number for subject
    let shortId = questionId;
    try {
      const { rows } = await db(
        `SELECT question_number, wp_post_id FROM questions WHERE id = $1`,
        [questionId]
      );
      if (rows[0]) shortId = rows[0].question_number || rows[0].wp_post_id || questionId;
    } catch (_) {}

    const msg = messages[type] || messages.answered;
    const titleMap = {
      claimed: 'השאלה נתפסה בהצלחה',
      answered: 'תשובתך נקלטה בהצלחה',
      released: 'השאלה שוחררה',
      already_answered: 'השאלה כבר נענתה',
      already_claimed: 'השאלה כבר נתפסה',
    };
    const subject = `[ID:${shortId}] ${titleMap[type] || 'עדכון שאלה'} — ${questionTitle}`;

    const html = createEmailHTML(
      titleMap[type] || 'עדכון שאלה',
      `<p style="font-size:15px;line-height:1.7;">${msg}</p>`,
      [],
      { systemName: 'ענה את השואל' }
    );

    await sendEmail(rabbiEmail, subject, html);
  } catch (err) {
    log.warn({ err, rabbiEmail, type, questionId }, 'Failed to send confirmation email');
  }
}

// ── Process a single email ───────────────────────────────────────────────────

async function processEmail(parsed) {
  const from = parsed.from?.value?.[0]?.address?.toLowerCase();
  const subject = parsed.subject || '';
  const textBody = parsed.text || '';

  if (!from) {
    log.debug('Skipping email with no sender');
    return false;
  }

  // Ignore emails sent by our own system (same mailbox)
  const systemEmail = (process.env.SMTP_FROM || process.env.SMTP_USER || '').toLowerCase();
  if (systemEmail && from === systemEmail) {
    return false; // silently skip our own outgoing emails
  }

  // Also ignore mailer-daemon / bounce / system emails
  const systemSenders = [
    'mailer-daemon', 'postmaster', 'noreply', 'no-reply',
    'bounce', 'undeliverable', 'system', 'notifications',
    'auto-reply', 'autoresponder',
  ];
  const fromLocal = from.split('@')[0];
  if (systemSenders.some((s) => fromLocal === s || from.includes(s + '@'))) {
    return false;
  }

  // Extract question ID from subject
  let questionId = extractQuestionId(subject);
  if (!questionId) {
    log.debug({ from, subject }, 'Skipping email — no question ID in subject');
    return false;
  }

  // If numeric ID, resolve to UUID via question_number or wp_post_id
  if (/^\d+$/.test(questionId)) {
    const numId = parseInt(questionId, 10);
    const { rows: resolved } = await db(
      `SELECT id FROM questions WHERE question_number = $1 OR wp_post_id = $1 LIMIT 1`,
      [numId]
    );
    if (resolved.length > 0) {
      log.info({ numericId: numId, uuid: resolved[0].id }, 'Resolved numeric ID to UUID');
      questionId = resolved[0].id;
    } else {
      log.warn({ numericId: numId }, 'Could not resolve numeric question ID');
      return false;
    }
  }

  // Find rabbi by email
  const { rows: rabbiRows } = await db(
    `SELECT id, name, email, role FROM rabbis WHERE LOWER(email) = $1 AND is_active = true`,
    [from]
  );

  if (rabbiRows.length === 0) {
    log.debug({ from }, 'Skipping email — no matching active rabbi');
    return false;
  }

  const rabbi = rabbiRows[0];

  // Get question
  const { rows: questionRows } = await db(
    `SELECT id, title, status, assigned_rabbi_id FROM questions WHERE id = $1`,
    [questionId]
  );

  if (questionRows.length === 0) {
    log.warn({ questionId }, 'Question not found');
    return false;
  }

  const question = questionRows[0];
  const questionTitle = question.title || 'שאלה';

  // Already answered? Only send confirmation if this is a RECENT email (< 10 min old)
  if (question.status === 'answered') {
    const emailDate = parsed.date ? new Date(parsed.date).getTime() : 0;
    const isRecent = emailDate && (Date.now() - emailDate) < 10 * 60 * 1000;
    log.debug({ questionId }, 'Question already answered — skipping');
    if (isRecent) {
      await sendConfirmation(from, 'already_answered', questionTitle, questionId);
    }
    return false;
  }

  // Extract and clean the reply text
  const rawText = stripReplyContent(textBody);

  // Check if this is a release request
  if (isReleaseOnly(rawText)) {
    if (question.status === 'in_process' && String(question.assigned_rabbi_id) === String(rabbi.id)) {
      await db(
        `UPDATE questions SET status = 'pending', assigned_rabbi_id = NULL, lock_timestamp = NULL WHERE id = $1`,
        [questionId]
      );
      log.info({ questionId, rabbiName: rabbi.name }, 'Release via email');
      await sendConfirmation(from, 'released', questionTitle, questionId);
      return true;
    }
    log.debug({ questionId }, 'Release request but question not assigned to this rabbi');
    return false;
  }

  // Check if this is a claim-only request
  if (isClaimOnly(rawText)) {
    // Already claimed by someone else?
    if (question.status === 'in_process' && question.assigned_rabbi_id && String(question.assigned_rabbi_id) !== String(rabbi.id)) {
      log.info({ questionId, from }, 'Question already claimed by another rabbi');
      await sendConfirmation(from, 'already_claimed', questionTitle, questionId);
      return false;
    }

    // Claim it
    if (question.status === 'pending' || !question.assigned_rabbi_id) {
      await db(
        `UPDATE questions SET status = 'in_process', assigned_rabbi_id = $1, lock_timestamp = NOW() WHERE id = $2`,
        [rabbi.id, questionId]
      );
      log.info({ questionId, rabbiName: rabbi.name }, 'Claim-only via email');
      await sendConfirmation(from, 'claimed', questionTitle, questionId);
      return true;
    }

    // Already claimed by me
    log.debug({ questionId, rabbiName: rabbi.name }, 'Question already claimed by this rabbi');
    await sendConfirmation(from, 'claimed', questionTitle, questionId);
    return false;
  }

  // This is an answer
  if (!rawText || rawText.length < 5) {
    log.debug({ from, questionId }, 'Email body too short after stripping');
    return false;
  }

  // Convert plain text to simple HTML paragraphs
  const answerHtml = rawText
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n');

  // Auto-claim if question is pending
  if (question.status === 'pending' || !question.assigned_rabbi_id) {
    log.info({ questionId, rabbiName: rabbi.name }, 'Auto-claiming question for rabbi');
    await db(
      `UPDATE questions SET status = 'in_process', assigned_rabbi_id = $1, lock_timestamp = NOW() WHERE id = $2`,
      [rabbi.id, questionId]
    );
  } else if (String(question.assigned_rabbi_id) !== String(rabbi.id)) {
    if (rabbi.role !== 'admin') {
      log.info({ questionId, from }, 'Question assigned to another rabbi');
      await sendConfirmation(from, 'already_claimed', questionTitle, questionId);
      return false;
    }
  }

  // Submit the answer
  const { rows: existingAnswer } = await db(
    `SELECT id FROM answers WHERE question_id = $1 LIMIT 1`,
    [questionId]
  );

  if (existingAnswer.length > 0) {
    await db(
      `UPDATE answers SET content = $1, updated_at = NOW() WHERE question_id = $2`,
      [answerHtml, questionId]
    );
  } else {
    await db(
      `INSERT INTO answers (question_id, rabbi_id, content, is_private, created_at) VALUES ($1, $2, $3, false, NOW())`,
      [questionId, rabbi.id, answerHtml]
    );
  }

  // Update question status
  await db(
    `UPDATE questions SET status = 'answered', answered_at = NOW(), assigned_rabbi_id = $1 WHERE id = $2`,
    [rabbi.id, questionId]
  );

  log.info({ questionId, rabbiName: rabbi.name, from }, 'Answer submitted via email');
  await sendConfirmation(from, 'answered', questionTitle, questionId);
  return true;
}

// ── Main poller ──────────────────────────────────────────────────────────────

async function runImapPoller() {
  const config = getImapConfig();

  if (!config.host || !config.user || !config.password) {
    log.debug('IMAP not configured — skipping');
    return;
  }

  return new Promise((resolve) => {
    const imap = new Imap(config);
    let processed = 0;
    let errors = 0;

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) {
          log.error({ err }, 'Failed to open INBOX');
          imap.end();
          return resolve();
        }

        // Search for unread emails
        imap.search(['UNSEEN'], (err, uids) => {
          if (err) {
            log.error({ err }, 'IMAP search failed');
            imap.end();
            return resolve();
          }

          if (!uids || uids.length === 0) {
            imap.end();
            return resolve();
          }

          log.info({ count: uids.length }, 'Found unread emails');

          // markSeen: true automatically marks emails as \Seen on fetch,
          // so they won't appear in the next UNSEEN search.
          const fetch = imap.fetch(uids, { bodies: '', markSeen: true });

          const emailPromises = [];
          let msgIndex = 0;

          fetch.on('message', (msg, seqno) => {
            let buffer = '';
            const currentUid = uids[msgIndex++];

            msg.on('body', (stream) => {
              stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
            });

            msg.on('end', () => {
              emailPromises.push(
                simpleParser(buffer)
                  .then((parsed) => processEmail(parsed))
                  .then((success) => {
                    if (success) processed++;
                  })
                  .catch((err) => {
                    errors++;
                    log.error({ err, uid: currentUid }, 'Error processing email');
                  })
              );
            });
          });

          fetch.once('end', async () => {
            try {
              await Promise.all(emailPromises);
            } catch { /* ignore */ }
            log.info({ processed, errors, total: uids.length }, 'IMAP poll complete');
            imap.end();
          });

          fetch.once('error', (err) => {
            log.error({ err }, 'IMAP fetch error');
            imap.end();
          });
        });
      });
    });

    imap.once('error', (err) => {
      log.error({ err }, 'IMAP connection error');
      resolve();
    });

    imap.once('end', () => {
      resolve();
    });

    imap.connect();
  });
}

module.exports = { runImapPoller };
