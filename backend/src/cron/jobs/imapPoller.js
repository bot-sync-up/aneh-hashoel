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

const TAG = '[imapPoller]';

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

// Match [Q:uuid], [ID:uuid], [CLAIM:uuid], or Re: versions of these
const QUESTION_ID_PATTERNS = [
  /\[Q[:\-]?\s*([a-f0-9\-]{36})\]/i,
  /\[ID[:\-]?\s*([a-f0-9\-]{36})\]/i,
  /\[CLAIM[:\-]?\s*([a-f0-9\-]{36})\]/i,
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

// ── Process a single email ───────────────────────────────────────────────────

async function processEmail(parsed) {
  const from = parsed.from?.value?.[0]?.address?.toLowerCase();
  const subject = parsed.subject || '';
  const textBody = parsed.text || '';
  const htmlBody = parsed.html || '';

  if (!from) {
    console.log(TAG, 'Skipping email with no sender');
    return false;
  }

  // Extract question ID from subject
  const questionId = extractQuestionId(subject);
  if (!questionId) {
    console.log(TAG, `Skipping email from ${from} — no question ID in subject: "${subject}"`);
    return false;
  }

  // Find rabbi by email
  const { rows: rabbiRows } = await db(
    `SELECT id, name, role FROM rabbis WHERE LOWER(email) = $1 AND is_active = true`,
    [from]
  );

  if (rabbiRows.length === 0) {
    console.log(TAG, `Skipping email from ${from} — no matching active rabbi`);
    return false;
  }

  const rabbi = rabbiRows[0];

  // Get question
  const { rows: questionRows } = await db(
    `SELECT id, status, assigned_rabbi_id FROM questions WHERE id = $1`,
    [questionId]
  );

  if (questionRows.length === 0) {
    console.log(TAG, `Question ${questionId} not found`);
    return false;
  }

  const question = questionRows[0];

  // Already answered?
  if (question.status === 'answered') {
    console.log(TAG, `Question ${questionId} already answered — skipping`);
    return false;
  }

  // Extract and clean the answer text
  const rawText = stripReplyContent(textBody);
  if (!rawText || rawText.length < 5) {
    console.log(TAG, `Email from ${from} for Q:${questionId} — body too short after stripping`);
    return false;
  }

  // Convert plain text to simple HTML paragraphs
  const answerHtml = rawText
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n');

  // Auto-claim if question is pending
  if (question.status === 'pending' || !question.assigned_rabbi_id) {
    console.log(TAG, `Auto-claiming Q:${questionId} for rabbi ${rabbi.name}`);
    await db(
      `UPDATE questions SET status = 'in_process', assigned_rabbi_id = $1, lock_timestamp = NOW() WHERE id = $2`,
      [rabbi.id, questionId]
    );
  } else if (String(question.assigned_rabbi_id) !== String(rabbi.id)) {
    // Question is assigned to someone else
    if (rabbi.role !== 'admin') {
      console.log(TAG, `Q:${questionId} assigned to another rabbi — skipping (${from})`);
      return false;
    }
  }

  // Submit the answer
  const { rows: existingAnswer } = await db(
    `SELECT id FROM answers WHERE question_id = $1 LIMIT 1`,
    [questionId]
  );

  if (existingAnswer.length > 0) {
    // Update existing answer
    await db(
      `UPDATE answers SET content = $1, updated_at = NOW() WHERE question_id = $2`,
      [answerHtml, questionId]
    );
  } else {
    // Insert new answer
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

  console.log(TAG, `Answer submitted via email: Q:${questionId} by ${rabbi.name} (${from})`);
  return true;
}

// ── Main poller ──────────────────────────────────────────────────────────────

async function runImapPoller() {
  const config = getImapConfig();

  if (!config.host || !config.user || !config.password) {
    console.log(TAG, 'IMAP not configured — skipping');
    return;
  }

  return new Promise((resolve) => {
    const imap = new Imap(config);
    let processed = 0;
    let errors = 0;

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) {
          console.error(TAG, 'Failed to open INBOX:', err.message);
          imap.end();
          return resolve();
        }

        // Search for unread emails
        imap.search(['UNSEEN'], (err, uids) => {
          if (err) {
            console.error(TAG, 'Search failed:', err.message);
            imap.end();
            return resolve();
          }

          if (!uids || uids.length === 0) {
            imap.end();
            return resolve();
          }

          console.log(TAG, `Found ${uids.length} unread emails`);

          const fetch = imap.fetch(uids, { bodies: '', markSeen: false });

          const emailPromises = [];

          fetch.on('message', (msg, seqno) => {
            let buffer = '';

            msg.on('body', (stream) => {
              stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
            });

            msg.on('end', () => {
              const uid = uids[seqno - 1];
              emailPromises.push(
                simpleParser(buffer)
                  .then((parsed) => processEmail(parsed))
                  .then((success) => {
                    if (success) {
                      processed++;
                      // Mark as seen
                      imap.addFlags(uid, ['\\Seen'], (err) => {
                        if (err) console.warn(TAG, `Failed to mark ${uid} as seen:`, err.message);
                      });
                    }
                  })
                  .catch((err) => {
                    errors++;
                    console.error(TAG, `Error processing email #${seqno}:`, err.message);
                  })
              );
            });
          });

          fetch.once('end', async () => {
            try {
              await Promise.all(emailPromises);
            } catch { /* ignore */ }
            console.log(TAG, `Done — processed: ${processed}, errors: ${errors}, total: ${uids.length}`);
            imap.end();
          });

          fetch.once('error', (err) => {
            console.error(TAG, 'Fetch error:', err.message);
            imap.end();
          });
        });
      });
    });

    imap.once('error', (err) => {
      console.error(TAG, 'IMAP connection error:', err.message);
      resolve();
    });

    imap.once('end', () => {
      resolve();
    });

    imap.connect();
  });
}

module.exports = { runImapPoller };
