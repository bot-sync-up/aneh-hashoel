-- =============================================================================
-- 011: Support Messages + Discussion locked column
-- =============================================================================

-- ─── Support Messages (conversation thread on support requests) ──────────────

CREATE TABLE IF NOT EXISTS support_messages (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID         NOT NULL REFERENCES support_requests (id) ON DELETE CASCADE,
  sender_id   UUID         NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  sender_role VARCHAR(20)  NOT NULL DEFAULT 'rabbi',  -- 'rabbi' | 'admin'
  message     TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_request_id
  ON support_messages (request_id, created_at ASC);

-- ─── Discussion locked column ────────────────────────────────────────────────

ALTER TABLE discussions
  ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE;
