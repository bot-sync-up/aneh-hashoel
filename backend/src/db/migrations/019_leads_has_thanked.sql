-- Migration 019: Add has_thanked column to leads for thank→donation attribution
-- Tracks whether this lead has ever clicked "thank rabbi" on any of their questions

ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_thanked BOOLEAN DEFAULT false;

-- Note: backfill skipped — asker emails in questions are AES-encrypted and
-- cannot be compared directly in SQL. The has_thanked flag will be set
-- going forward when leads are upserted with thank_count > 0.

CREATE INDEX IF NOT EXISTS idx_leads_has_thanked ON leads (has_thanked) WHERE has_thanked = true;
