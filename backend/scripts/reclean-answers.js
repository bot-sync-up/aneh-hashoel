#!/usr/bin/env node
'use strict';

/**
 * One-shot backfill: re-run the smart signature detector on every existing
 * answer's `content` column. Use this after upgrading emailParser.js with
 * a smarter detector — stored answers keep the old stripped output until
 * this script rewrites them.
 *
 * Idempotent: if the detector doesn't find a signature, the content stays
 * identical and no UPDATE is issued. Running twice is a no-op.
 *
 * Run:
 *   docker compose exec backend node scripts/reclean-answers.js
 *
 * Flags:
 *   --dry     Report what would change without writing.
 *   --limit=N Only process the first N answers (useful for testing).
 */

require('dotenv').config();

const { query, closePool } = require('../src/db/pool');
const { detectAndStripSignature } = require('../src/services/emailParser');

const args     = process.argv.slice(2);
const DRY_RUN  = args.includes('--dry');
const LIMIT    = (() => {
  const f = args.find((a) => a.startsWith('--limit='));
  return f ? Math.max(1, parseInt(f.slice(8), 10) || 0) : null;
})();

// HTML-aware wrapper: matches cleanEmailBody's HTML→plain conversion so the
// detector sees paragraph structure, then re-wraps any preserved body lines
// in <p>/<br> so the display (which expects HTML) keeps looking the same.
function recleanHtmlContent(raw) {
  if (!raw) return raw;

  // 1. Turn block tags into newlines the same way cleanEmailBody does
  let text = raw
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(?:p|div|li|h[1-6]|tr|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ');

  // 2. Run the detector on the plain-text form
  const stripped = detectAndStripSignature(text).trim();
  if (!stripped) return raw; // detector found nothing meaningful — leave alone

  // 3. If the detector didn't remove anything, bail (nothing to write back)
  const normalizedOrig = text.replace(/\s+/g, ' ').trim();
  const normalizedNew  = stripped.replace(/\s+/g, ' ').trim();
  if (normalizedOrig === normalizedNew) return raw;

  // 4. Re-wrap the result as HTML so the UI renders the same way. Each
  //    non-empty line becomes either a <p> or a <br>, mirroring the
  //    original rabbi-authored formatting.
  const paragraphs = stripped
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const html = paragraphs
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

  return html;
}

async function main() {
  const limitClause = LIMIT ? `LIMIT ${LIMIT}` : '';
  const { rows } = await query(
    `SELECT id, content FROM answers
     WHERE content IS NOT NULL AND content <> ''
     ORDER BY created_at DESC
     ${limitClause}`
  );

  console.log(`Loaded ${rows.length} answer rows. Dry-run: ${DRY_RUN}`);

  let changed = 0;
  let unchanged = 0;
  let sampleShown = 0;

  for (const row of rows) {
    const cleaned = recleanHtmlContent(row.content);
    if (cleaned === row.content) {
      unchanged++;
      continue;
    }

    changed++;

    if (sampleShown < 5) {
      sampleShown++;
      const origTail = row.content.slice(-180).replace(/\s+/g, ' ');
      const newTail  = cleaned.slice(-180).replace(/\s+/g, ' ');
      console.log(`\n── ${row.id} ──`);
      console.log(`  old tail: …${origTail}`);
      console.log(`  new tail: …${newTail}`);
    }

    if (!DRY_RUN) {
      await query(
        `UPDATE answers SET content = $1, updated_at = NOW() WHERE id = $2`,
        [cleaned, row.id]
      );
    }
  }

  console.log(`\nDone. changed=${changed} unchanged=${unchanged} dry=${DRY_RUN}`);
  await closePool();
}

main().catch((err) => {
  console.error('reclean-answers failed:', err);
  process.exit(1);
});
