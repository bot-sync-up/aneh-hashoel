-- =============================================================================
-- Migration 002 – Lead unsubscribe support (GDPR / Israeli Spam Law)
-- =============================================================================
-- Adds is_unsubscribed + unsubscribed_at columns to the leads table.
-- A signed token embedded in marketing emails will flip is_unsubscribed=true
-- when the recipient clicks the "הסר אותי מרשימת התפוצה" link.
-- =============================================================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_unsubscribed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_is_unsubscribed
  ON leads (is_unsubscribed)
  WHERE is_unsubscribed = TRUE;

-- DOWN
ALTER TABLE leads DROP COLUMN IF EXISTS unsubscribed_at;
ALTER TABLE leads DROP COLUMN IF EXISTS is_unsubscribed;
