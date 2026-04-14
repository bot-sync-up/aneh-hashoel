-- =============================================================================
-- Migration 025 – Final missing tables catch-up
-- =============================================================================
-- Tables referenced by application code but never created in migrations.
-- =============================================================================

-- ─── notification_preferences ────────────────────────────────────────────────
-- Per-rabbi notification preferences for different event types
CREATE TABLE IF NOT EXISTS notification_preferences (
  rabbi_id    UUID        NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  event_type  VARCHAR(50) NOT NULL,
  channel     VARCHAR(20) NOT NULL DEFAULT 'email',
  enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
  PRIMARY KEY (rabbi_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_rabbi_id
  ON notification_preferences (rabbi_id);

-- ─── sessions ────────────────────────────────────────────────────────────────
-- Active login sessions with refresh token hashes
CREATE TABLE IF NOT EXISTS sessions (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  rabbi_id            UUID         NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  refresh_token_hash  VARCHAR(255) UNIQUE,
  device_info         JSONB        DEFAULT '{}',
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,
  is_revoked          BOOLEAN      NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_sessions_rabbi_id
  ON sessions (rabbi_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash
  ON sessions (refresh_token_hash)
  WHERE refresh_token_hash IS NOT NULL;

-- ─── whatsapp_log ────────────────────────────────────────────────────────────
-- Outbound WhatsApp message log
CREATE TABLE IF NOT EXISTS whatsapp_log (
  id           SERIAL       PRIMARY KEY,
  phone        VARCHAR(20)  NOT NULL,
  message_type VARCHAR(50),
  status       VARCHAR(20)  DEFAULT 'pending',
  message_id   VARCHAR(255),
  attempts     INTEGER      DEFAULT 0,
  error        TEXT,
  sent_at      TIMESTAMPTZ  DEFAULT NOW()
);

-- ─── whatsapp_inbound_log ────────────────────────────────────────────────────
-- Inbound WhatsApp message log
CREATE TABLE IF NOT EXISTS whatsapp_inbound_log (
  id            SERIAL       PRIMARY KEY,
  sender_phone  VARCHAR(20),
  sender_name   VARCHAR(255),
  message_id    VARCHAR(255) UNIQUE,
  message_text  VARCHAR(1000),
  handled       BOOLEAN      DEFAULT FALSE,
  question_id   UUID         REFERENCES questions (id) ON DELETE SET NULL,
  answer_id     UUID,
  ip            VARCHAR(45),
  received_at   TIMESTAMPTZ  DEFAULT NOW()
);

-- DOWN
DROP TABLE IF EXISTS whatsapp_inbound_log;
DROP TABLE IF EXISTS whatsapp_log;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS notification_preferences;
