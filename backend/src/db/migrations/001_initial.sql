-- =============================================================================
-- Migration 001 – Initial schema
-- Platform: ענה את השואל (Aneh HaShoel) — Rabbi Q&A
-- =============================================================================
-- Notes:
--   • All primary keys use gen_random_uuid() (available in Postgres 13+
--     via the built-in pgcrypto extension; enabled below).
--   • All timestamps are TIMESTAMPTZ (UTC) to avoid ambiguity.
--   • JSONB columns carry explicit defaults to simplify application code.
--   • Encrypted PII columns store AES-256-CBC ciphertext as base64 text
--     alongside a separate IV column.
-- =============================================================================

-- Enable pgcrypto so gen_random_uuid() is available on Postgres < 14
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- RABBIS
-- =============================================================================
CREATE TABLE IF NOT EXISTS rabbis (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 VARCHAR(100) NOT NULL,
  email                VARCHAR(255) UNIQUE NOT NULL,
  password_hash        VARCHAR,
  google_id            VARCHAR      UNIQUE,
  signature            TEXT,
  photo_url            VARCHAR,
  preferred_categories UUID[]       NOT NULL DEFAULT '{}',
  availability_hours   JSONB        NOT NULL DEFAULT '{"sun":null,"mon":null,"tue":null,"wed":null,"thu":null,"fri":null,"sat":null}',
  vacation_mode        BOOLEAN      NOT NULL DEFAULT FALSE,
  vacation_until       TIMESTAMPTZ,
  notification_pref    VARCHAR      NOT NULL DEFAULT 'all'
                         CHECK (notification_pref IN ('email','whatsapp','push','all')),
  max_open_questions   INTEGER,
  role                 VARCHAR      NOT NULL DEFAULT 'rabbi'
                         CHECK (role IN ('rabbi','admin')),
  two_fa_enabled       BOOLEAN      NOT NULL DEFAULT FALSE,
  two_fa_secret        VARCHAR,
  milestone_count      INTEGER      NOT NULL DEFAULT 0,
  warning_sent         BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- RABBI GROUPS
-- =============================================================================
CREATE TABLE IF NOT EXISTS rabbi_groups (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  created_by  UUID         REFERENCES rabbis (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- RABBI GROUP MEMBERS  (many-to-many)
-- =============================================================================
CREATE TABLE IF NOT EXISTS rabbi_group_members (
  rabbi_id  UUID        NOT NULL REFERENCES rabbis       (id) ON DELETE CASCADE,
  group_id  UUID        NOT NULL REFERENCES rabbi_groups (id) ON DELETE CASCADE,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (rabbi_id, group_id)
);

-- =============================================================================
-- CATEGORIES
-- =============================================================================
CREATE TABLE IF NOT EXISTS categories (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  color       VARCHAR(7)   NOT NULL DEFAULT '#1B2B5E',
  group_id    UUID         REFERENCES rabbi_groups (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- QUESTIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS questions (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  wp_post_id              INTEGER      UNIQUE NOT NULL,
  title                   VARCHAR(500) NOT NULL,
  content                 TEXT         NOT NULL,
  category_id             UUID         REFERENCES categories (id) ON DELETE SET NULL,
  status                  VARCHAR      NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','in_process','answered','hidden')),
  assigned_rabbi_id       UUID         REFERENCES rabbis (id) ON DELETE SET NULL,
  lock_timestamp          TIMESTAMPTZ,
  warning_sent            BOOLEAN      NOT NULL DEFAULT FALSE,
  follow_up_content       TEXT,
  follow_up_answered_at   TIMESTAMPTZ,
  follow_up_count         INTEGER      NOT NULL DEFAULT 0,
  notified_asker          BOOLEAN      NOT NULL DEFAULT FALSE,
  -- Encrypted PII (AES-256-CBC, base64-encoded ciphertext + hex IV)
  asker_email_encrypted   TEXT,
  asker_phone_encrypted   TEXT,
  asker_email_iv          VARCHAR,
  asker_phone_iv          VARCHAR,
  urgency                 VARCHAR      NOT NULL DEFAULT 'normal'
                            CHECK (urgency IN ('normal','urgent')),
  difficulty              VARCHAR
                            CHECK (difficulty IS NULL OR difficulty IN ('simple','medium','complex')),
  flagged                 BOOLEAN      NOT NULL DEFAULT FALSE,
  flag_reason             TEXT,
  recommended_newsletter  BOOLEAN      NOT NULL DEFAULT FALSE,
  hidden_reason           TEXT,
  view_count              INTEGER      NOT NULL DEFAULT 0,
  thank_count             INTEGER      NOT NULL DEFAULT 0,
  wp_synced_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  answered_at             TIMESTAMPTZ,
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- ANSWERS
-- =============================================================================
CREATE TABLE IF NOT EXISTS answers (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id      UUID        NOT NULL UNIQUE REFERENCES questions (id) ON DELETE CASCADE,
  rabbi_id         UUID        NOT NULL REFERENCES rabbis (id) ON DELETE RESTRICT,
  content          TEXT        NOT NULL,
  -- Full edit history stored as a JSONB array of {content, edited_at, edited_by}
  content_versions JSONB       NOT NULL DEFAULT '[]',
  follow_up_content TEXT,
  published_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_edited_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- ANSWER TEMPLATES
-- =============================================================================
CREATE TABLE IF NOT EXISTS answer_templates (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  rabbi_id   UUID         NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  title      VARCHAR(200) NOT NULL,
  content    TEXT         NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- PRIVATE NOTES  (per-question rabbi scratchpad)
-- =============================================================================
CREATE TABLE IF NOT EXISTS private_notes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID        NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  rabbi_id    UUID        NOT NULL REFERENCES rabbis    (id) ON DELETE CASCADE,
  content     TEXT        NOT NULL,
  is_shared   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- DISCUSSIONS  (threaded rabbi-only chat, optionally linked to a question)
-- =============================================================================
CREATE TABLE IF NOT EXISTS discussions (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID         REFERENCES questions (id) ON DELETE SET NULL,
  title       VARCHAR(300) NOT NULL,
  created_by  UUID         NOT NULL REFERENCES rabbis (id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- DISCUSSION MEMBERS  (who can read/write each discussion)
-- =============================================================================
CREATE TABLE IF NOT EXISTS discussion_members (
  discussion_id UUID        NOT NULL REFERENCES discussions (id) ON DELETE CASCADE,
  rabbi_id      UUID        NOT NULL REFERENCES rabbis      (id) ON DELETE CASCADE,
  added_by      UUID        REFERENCES rabbis (id) ON DELETE SET NULL,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (discussion_id, rabbi_id)
);

-- =============================================================================
-- DISCUSSION MESSAGES
-- =============================================================================
CREATE TABLE IF NOT EXISTS discussion_messages (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  discussion_id     UUID        NOT NULL REFERENCES discussions        (id) ON DELETE CASCADE,
  rabbi_id          UUID        NOT NULL REFERENCES rabbis             (id) ON DELETE RESTRICT,
  content           TEXT        NOT NULL,
  quoted_message_id UUID        REFERENCES discussion_messages (id) ON DELETE SET NULL,
  pinned            BOOLEAN     NOT NULL DEFAULT FALSE,
  -- reactions stored as {"emoji": [rabbi_id, ...], ...}
  reactions         JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at         TIMESTAMPTZ
);

-- =============================================================================
-- NOTIFICATIONS LOG
-- =============================================================================
CREATE TABLE IF NOT EXISTS notifications_log (
  id        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  rabbi_id  UUID         NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  type      VARCHAR(100) NOT NULL,
  channel   VARCHAR(20)  NOT NULL,
  content   JSONB        NOT NULL,
  sent_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  status    VARCHAR      NOT NULL DEFAULT 'sent'
              CHECK (status IN ('sent','failed','pending'))
);

-- =============================================================================
-- AUDIT LOG
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID         REFERENCES rabbis (id) ON DELETE SET NULL,
  action      VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100),
  entity_id   UUID,
  old_value   JSONB,
  new_value   JSONB,
  ip          VARCHAR(45),
  user_agent  TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- DEVICE SESSIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS device_sessions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rabbi_id           UUID        NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  device_fingerprint VARCHAR(64) NOT NULL,
  ip                 VARCHAR(45),
  user_agent         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- REFRESH TOKENS
-- =============================================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rabbi_id    UUID        NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  token_hash  VARCHAR(64) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked     BOOLEAN     NOT NULL DEFAULT FALSE
);

-- =============================================================================
-- LEADS LOG  (CRM-style; asker contact info mirrored here for sales pipeline)
-- =============================================================================
CREATE TABLE IF NOT EXISTS leads_log (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id           UUID        REFERENCES questions  (id) ON DELETE SET NULL,
  asker_email_encrypted TEXT,
  asker_phone_encrypted TEXT,
  asker_email_iv        VARCHAR,
  asker_phone_iv        VARCHAR,
  category_id           UUID        REFERENCES categories (id) ON DELETE SET NULL,
  interaction_score     INTEGER     NOT NULL DEFAULT 0,
  is_hot                BOOLEAN     NOT NULL DEFAULT FALSE,
  gs_synced             BOOLEAN     NOT NULL DEFAULT FALSE,
  gs_synced_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- SLA CONFIG  (single-row configuration table)
-- =============================================================================
CREATE TABLE IF NOT EXISTS sla_config (
  -- id is always 1; enforced by the check constraint below
  id               INTEGER PRIMARY KEY DEFAULT 1
                     CHECK (id = 1),
  hours_to_warning INTEGER NOT NULL DEFAULT 3,
  hours_to_timeout INTEGER NOT NULL DEFAULT 4,
  enabled          BOOLEAN NOT NULL DEFAULT TRUE
);

-- Seed the single allowed row if it doesn't exist yet
INSERT INTO sla_config (id, hours_to_warning, hours_to_timeout, enabled)
VALUES (1, 3, 4, TRUE)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- SYSTEM CONFIG  (key/value store for runtime feature flags, etc.)
-- =============================================================================
CREATE TABLE IF NOT EXISTS system_config (
  key        VARCHAR(100) PRIMARY KEY,
  value      JSONB        NOT NULL,
  updated_by UUID         REFERENCES rabbis (id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- BADGES
-- =============================================================================
CREATE TABLE IF NOT EXISTS badges (
  id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rabbi_id  UUID        NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  type      VARCHAR(50) NOT NULL
              CHECK (type IN ('answers_1','answers_10','answers_50','answers_100','answers_500')),
  earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rabbi_id, type)
);

-- =============================================================================
-- SCHEMA MIGRATIONS  (tracks applied migration files — managed by migrate.js)
-- =============================================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
  id         SERIAL       PRIMARY KEY,
  filename   VARCHAR(255) UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
