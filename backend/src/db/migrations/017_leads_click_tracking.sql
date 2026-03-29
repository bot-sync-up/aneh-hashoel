-- Migration 017: Click tracking columns for leads
-- Adds last_click_at and click_count to the leads table so the CRM can
-- see when (and how often) an asker clicked the answer link in their
-- notification email or WhatsApp message.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS last_click_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS click_count    INTEGER NOT NULL DEFAULT 0;

-- Index for quickly finding recently-clicked leads (telemarketing prioritisation)
CREATE INDEX IF NOT EXISTS idx_leads_last_click_at
  ON leads (last_click_at DESC NULLS LAST)
  WHERE last_click_at IS NOT NULL;
