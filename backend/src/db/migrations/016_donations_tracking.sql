-- Migration 016: Donations tracking via Nedarim Plus
-- Tracks donations reported by Nedarim Plus webhook callbacks.
-- No payment processing — Nedarim Plus handles that externally.

CREATE TABLE IF NOT EXISTS donations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id       UUID        REFERENCES questions(id) ON DELETE SET NULL,
  rabbi_id          UUID        REFERENCES users(id)     ON DELETE SET NULL,
  amount            DECIMAL(12,2) NOT NULL,
  currency          VARCHAR(3)  NOT NULL DEFAULT 'ILS',
  donor_name        VARCHAR(255),
  donor_email       VARCHAR(255),
  donor_phone       VARCHAR(50),
  nedarim_reference VARCHAR(255),
  payment_method    VARCHAR(50),
  status            VARCHAR(20) NOT NULL DEFAULT 'completed',
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for admin queries: recent donations, monthly totals
CREATE INDEX IF NOT EXISTS idx_donations_created_at ON donations (created_at DESC);

-- Index for linking donations to questions/rabbis
CREATE INDEX IF NOT EXISTS idx_donations_question_id ON donations (question_id) WHERE question_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_donations_rabbi_id    ON donations (rabbi_id)    WHERE rabbi_id IS NOT NULL;

-- Index for deduplication by Nedarim reference
CREATE UNIQUE INDEX IF NOT EXISTS idx_donations_nedarim_ref
  ON donations (nedarim_reference) WHERE nedarim_reference IS NOT NULL;
