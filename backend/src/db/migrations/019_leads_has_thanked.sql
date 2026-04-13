-- Migration 019: Add has_thanked column to leads for thank→donation attribution
-- Tracks whether this lead has ever clicked "thank rabbi" on any of their questions

ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_thanked BOOLEAN DEFAULT false;

-- Backfill: mark leads as has_thanked based on existing question thank_count data
UPDATE leads l
SET    has_thanked = true
WHERE  EXISTS (
  SELECT 1
  FROM   questions q
  WHERE  q.asker_email = l.asker_email_encrypted
    AND  q.thank_count > 0
);

CREATE INDEX IF NOT EXISTS idx_leads_has_thanked ON leads (has_thanked) WHERE has_thanked = true;
