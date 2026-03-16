-- =============================================================================
-- Migration 001 – Full schema
-- Platform: ענה את השואל (Aneh HaShoel) — Rabbi Q&A
-- =============================================================================
-- Notes:
--   • UUID primary keys use gen_random_uuid() (pgcrypto, built-in on PG 13+).
--   • Serial PKs (rabbi_groups, categories, etc.) use SERIAL for simple
--     auto-increment sequences.
--   • All timestamps are TIMESTAMPTZ (UTC-aware).
--   • JSONB columns carry explicit defaults to simplify application code.
--   • Encrypted PII columns store AES-256-CBC ciphertext as base64 text.
--   • The set_updated_at() trigger function is created once and reused by
--     every table that carries an updated_at column.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- TRIGGER FUNCTION — auto-update updated_at on every row change
-- =============================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- =============================================================================
-- RABBIS
-- =============================================================================
CREATE TABLE IF NOT EXISTS rabbis (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 VARCHAR(100) NOT NULL,
  email                VARCHAR(255) UNIQUE NOT NULL,
  password_hash        TEXT,
  google_id            VARCHAR(255) UNIQUE,
  signature            TEXT,
  photo_url            TEXT,
  -- int[] lets the app store references to categories(id) SERIAL values
  preferred_categories INTEGER[]    NOT NULL DEFAULT '{}',
  availability_hours   JSONB        NOT NULL DEFAULT '{}',
  vacation_mode        BOOLEAN      NOT NULL DEFAULT FALSE,
  vacation_until       TIMESTAMPTZ,
  notification_pref    VARCHAR(20)  NOT NULL DEFAULT 'all'
                         CHECK (notification_pref IN ('email','whatsapp','push','all')),
  max_open_questions   INTEGER,
  role                 VARCHAR(20)  NOT NULL DEFAULT 'rabbi'
                         CHECK (role IN ('rabbi','admin')),
  two_fa_enabled       BOOLEAN      NOT NULL DEFAULT FALSE,
  two_fa_secret        TEXT,
  milestone_count      INTEGER      NOT NULL DEFAULT 0,
  is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_rabbis_updated_at
  BEFORE UPDATE ON rabbis
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- RABBI GROUPS
-- =============================================================================
CREATE TABLE IF NOT EXISTS rabbi_groups (
  id          SERIAL       PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  created_by  UUID         REFERENCES rabbis (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- RABBI GROUP MEMBERS  (many-to-many join table)
-- =============================================================================
CREATE TABLE IF NOT EXISTS rabbi_group_members (
  rabbi_id  UUID        NOT NULL REFERENCES rabbis       (id) ON DELETE CASCADE,
  group_id  INTEGER     NOT NULL REFERENCES rabbi_groups (id) ON DELETE CASCADE,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (rabbi_id, group_id)
);

-- =============================================================================
-- CATEGORIES
-- =============================================================================
CREATE TABLE IF NOT EXISTS categories (
  id          SERIAL       PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  color       VARCHAR(7)   NOT NULL DEFAULT '#1B2B5E',
  -- nullable: categories not linked to a group are routed globally
  group_id    INTEGER      REFERENCES rabbi_groups (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_categories_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- QUESTIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS questions (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  wp_post_id             INTEGER      UNIQUE NOT NULL,
  title                  VARCHAR(500) NOT NULL,
  content                TEXT         NOT NULL,
  category_id            INTEGER      REFERENCES categories (id) ON DELETE SET NULL,
  status                 VARCHAR(20)  NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','in_process','answered','hidden')),
  assigned_rabbi_id      UUID         REFERENCES rabbis (id) ON DELETE SET NULL,
  lock_timestamp         TIMESTAMPTZ,
  warning_sent           BOOLEAN      NOT NULL DEFAULT FALSE,
  follow_up_content      TEXT,
  follow_up_answered_at  TIMESTAMPTZ,
  follow_up_count        INTEGER      NOT NULL DEFAULT 0,
  notified_asker         BOOLEAN      NOT NULL DEFAULT FALSE,
  asker_email_encrypted  TEXT,
  asker_phone_encrypted  TEXT,
  urgency                VARCHAR(10)  NOT NULL DEFAULT 'normal'
                           CHECK (urgency IN ('normal','urgent')),
  difficulty             VARCHAR(10)
                           CHECK (difficulty IS NULL OR difficulty IN ('simple','medium','complex')),
  flagged                BOOLEAN      NOT NULL DEFAULT FALSE,
  flag_reason            TEXT,
  hidden_reason          TEXT,
  newsletter_featured    BOOLEAN      NOT NULL DEFAULT FALSE,
  view_count             INTEGER      NOT NULL DEFAULT 0,
  thank_count            INTEGER      NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  answered_at            TIMESTAMPTZ,
  wp_synced_at           TIMESTAMPTZ
);

-- =============================================================================
-- ANSWERS
-- =============================================================================
CREATE TABLE IF NOT EXISTS answers (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id      UUID        NOT NULL UNIQUE REFERENCES questions (id) ON DELETE CASCADE,
  rabbi_id         UUID        NOT NULL REFERENCES rabbis    (id) ON DELETE RESTRICT,
  content          TEXT        NOT NULL,
  -- Full edit history: [{content, edited_at, edited_by}, ...]
  content_versions JSONB       NOT NULL DEFAULT '[]',
  follow_up_content TEXT,
  published_at     TIMESTAMPTZ,
  last_edited_at   TIMESTAMPTZ
);

-- =============================================================================
-- ANSWER TEMPLATES
-- =============================================================================
CREATE TABLE IF NOT EXISTS answer_templates (
  id         SERIAL       PRIMARY KEY,
  rabbi_id   UUID         NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  title      VARCHAR(200) NOT NULL,
  content    TEXT         NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
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

CREATE TRIGGER trg_private_notes_updated_at
  BEFORE UPDATE ON private_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- DISCUSSIONS  (rabbi-only threaded chat, optionally linked to a question)
-- =============================================================================
CREATE TABLE IF NOT EXISTS discussions (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID         REFERENCES questions (id) ON DELETE SET NULL,
  title       VARCHAR(300) NOT NULL,
  created_by  UUID         NOT NULL REFERENCES rabbis (id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- DISCUSSION MEMBERS
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
  -- Self-referential FK for quoted / threaded replies
  quoted_message_id UUID        REFERENCES discussion_messages (id) ON DELETE SET NULL,
  pinned            BOOLEAN     NOT NULL DEFAULT FALSE,
  -- reactions: {"emoji_codepoint": ["rabbi_uuid", ...], ...}
  reactions         JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at         TIMESTAMPTZ
);

-- =============================================================================
-- NOTIFICATIONS LOG
-- =============================================================================
CREATE TABLE IF NOT EXISTS notifications_log (
  id       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  rabbi_id UUID         NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  type     VARCHAR(100) NOT NULL,
  channel  VARCHAR(20)  NOT NULL,
  content  JSONB        NOT NULL,
  sent_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  status   VARCHAR(20)  NOT NULL DEFAULT 'sent'
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
  entity_id   VARCHAR(255),
  old_value   JSONB,
  new_value   JSONB,
  ip          VARCHAR(45),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- DEVICE SESSIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS device_sessions (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  rabbi_id           UUID         NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  device_fingerprint VARCHAR(255) NOT NULL,
  ip                 VARCHAR(45),
  user_agent         TEXT,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_seen          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- LEADS LOG  (CRM-style; asker contact info for sales / follow-up pipeline)
-- =============================================================================
CREATE TABLE IF NOT EXISTS leads_log (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asker_email_encrypted TEXT,
  asker_phone_encrypted TEXT,
  question_id           UUID        REFERENCES questions  (id) ON DELETE SET NULL,
  category_id           INTEGER     REFERENCES categories (id) ON DELETE SET NULL,
  interaction_score     INTEGER     NOT NULL DEFAULT 0,
  is_hot                BOOLEAN     NOT NULL DEFAULT FALSE,
  synced_to_sheets      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_leads_log_updated_at
  BEFORE UPDATE ON leads_log
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- SLA CONFIG  (singleton row; id always = 1)
-- =============================================================================
CREATE TABLE IF NOT EXISTS sla_config (
  id               INTEGER     PRIMARY KEY DEFAULT 1
                     CHECK (id = 1),
  hours_to_warning INTEGER     NOT NULL DEFAULT 3,
  hours_to_timeout INTEGER     NOT NULL DEFAULT 4,
  enabled          BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the single allowed row if it does not yet exist.
INSERT INTO sla_config (id, hours_to_warning, hours_to_timeout, enabled, updated_at)
VALUES (1, 3, 4, TRUE, NOW())
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- SYSTEM CONFIG  (key/value store for runtime flags, feature toggles, etc.)
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
  id        SERIAL      PRIMARY KEY,
  rabbi_id  UUID        NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  type      VARCHAR(50) NOT NULL,
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
