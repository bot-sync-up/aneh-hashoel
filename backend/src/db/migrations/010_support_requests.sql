-- =============================================================================
-- SUPPORT REQUESTS (rabbi -> admin contact)
-- =============================================================================

CREATE TABLE IF NOT EXISTS support_requests (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  rabbi_id    UUID         NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  subject     VARCHAR(200) NOT NULL,
  message     TEXT         NOT NULL,
  status      VARCHAR(20)  NOT NULL DEFAULT 'open',   -- open | handled
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_requests_rabbi_id
  ON support_requests (rabbi_id);

CREATE INDEX IF NOT EXISTS idx_support_requests_status
  ON support_requests (status, created_at DESC);
