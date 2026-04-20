-- ──────────────────────────────────────────────────────────────────────────────
-- Migration 009 — strip Hebrew sign-off signatures from existing answers
--
-- Answers stored before emailParser's HTML-aware fix may carry the rabbi's
-- sign-off as the last line — e.g. "בכבוד רב ראובן זכאים". The original
-- parser required the full line to equal "בכבוד רב" so anything with a
-- trailing name slipped through.
--
-- We cut the content at the first occurrence of a recognised sign-off
-- phrase, preceded by a word boundary (whitespace, <br>, </p>, newline, or
-- block start). Matching is NON-GREEDY so the earliest occurrence wins, and
-- we avoid cutting inside a word by anchoring on a preceding separator.
--
-- Safe to re-run. Only updates rows whose content actually matches.
-- ──────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Pattern covers the most common Hebrew sign-offs. (?i) = case-insensitive,
-- (?s) = dot matches newline. The \m (word start) + preceding separator
-- ensures we don't cut mid-sentence.
--
-- Separator class: whitespace, HTML line-break, end-of-paragraph, or start
-- of string. The signature and everything after it are removed, then
-- dangling <br>/<p> fragments at the tail are tidied up.

UPDATE answers
SET    content = regexp_replace(
         content,
         '(?is)(\s|<br\s*/?>|</p>|</div>)+(בכבוד\s+רב|בברכה|בהוקרה|בהערכה|בידידות|כבוד\s+הרב|בכל\s+הכבוד|ידידך|אוהבך)\b.*$',
         '',
         'g'
       )
WHERE  content ~* '(\s|<br\s*/?>|</p>|</div>)(בכבוד\s+רב|בברכה|בהוקרה|בהערכה|בידידות|כבוד\s+הרב|בכל\s+הכבוד|ידידך|אוהבך)\b';

-- Tidy trailing empty tags left behind (e.g. "<p></p>", "<br>", etc.)
UPDATE answers
SET    content = regexp_replace(content, '(<br\s*/?>|<p>\s*</p>|\s)+$', '', 'g')
WHERE  content ~ '(<br\s*/?>|<p>\s*</p>|\s)+$';

-- Close unbalanced <p> if we stripped the closing tag
UPDATE answers
SET    content = content || '</p>'
WHERE  content ~ '^\s*<p[> ]'
   AND content !~ '</p>\s*$';

COMMIT;
