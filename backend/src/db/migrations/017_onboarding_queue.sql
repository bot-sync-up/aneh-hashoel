-- Migration 017: Onboarding Email Queue
-- Tracks drip email sequence for first-time askers (3 welcome emails)

CREATE TABLE IF NOT EXISTS onboarding_queue (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID        NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  email_encrypted TEXT        NOT NULL,
  asker_name      TEXT,
  -- Which step in the sequence: 1 = welcome, 2 = about org, 3 = donation ask
  step            INTEGER     NOT NULL DEFAULT 1,
  -- When this email should be sent
  send_at         TIMESTAMPTZ NOT NULL,
  -- NULL = pending, timestamp = sent
  sent_at         TIMESTAMPTZ,
  -- Error message if sending failed
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for the cron job: find unsent emails that are due
CREATE INDEX IF NOT EXISTS idx_onboarding_queue_pending
  ON onboarding_queue (send_at)
  WHERE sent_at IS NULL;

-- Prevent duplicate onboarding for the same lead
CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_queue_lead_step
  ON onboarding_queue (lead_id, step);
