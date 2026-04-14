-- =============================================================================
-- Migration 023 – Comprehensive schema catch-up
-- =============================================================================
-- Adds ALL missing tables, columns, and aliases that the application code
-- expects but were never captured in migration files. This single migration
-- closes the gap between the old (manually-evolved) database and the
-- migration-managed schema.
-- =============================================================================

-- ─── MISSING TABLES ──────────────────────────────────────────────────────────

-- Rabbi weekly statistics (used by dashboard, profile, admin)
CREATE TABLE IF NOT EXISTS rabbi_stats (
  id                      SERIAL       PRIMARY KEY,
  rabbi_id                UUID         NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  week_start              DATE         NOT NULL,
  answers_count           INTEGER      NOT NULL DEFAULT 0,
  views_count             INTEGER      NOT NULL DEFAULT 0,
  thanks_count            INTEGER      NOT NULL DEFAULT 0,
  avg_response_minutes    NUMERIC      DEFAULT NULL,
  avg_response_time_hours NUMERIC      DEFAULT NULL,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (rabbi_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_rabbi_stats_rabbi_id
  ON rabbi_stats (rabbi_id);
CREATE INDEX IF NOT EXISTS idx_rabbi_stats_week_start
  ON rabbi_stats (week_start DESC);

-- Rabbi achievements / badges (gamification)
CREATE TABLE IF NOT EXISTS rabbi_achievements (
  id         SERIAL       PRIMARY KEY,
  rabbi_id   UUID         NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  badge_type VARCHAR(50)  NOT NULL,
  earned_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (rabbi_id, badge_type)
);

CREATE INDEX IF NOT EXISTS idx_rabbi_achievements_rabbi_id
  ON rabbi_achievements (rabbi_id);

-- Rabbi ↔ Category many-to-many (preferred categories)
CREATE TABLE IF NOT EXISTS rabbi_categories (
  rabbi_id    UUID    NOT NULL REFERENCES rabbis     (id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  PRIMARY KEY (rabbi_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_rabbi_categories_category_id
  ON rabbi_categories (category_id);

-- Discussion message reactions (emoji per rabbi)
CREATE TABLE IF NOT EXISTS message_reactions (
  id         SERIAL       PRIMARY KEY,
  message_id UUID         NOT NULL REFERENCES discussion_messages (id) ON DELETE CASCADE,
  rabbi_id   UUID         NOT NULL REFERENCES rabbis              (id) ON DELETE CASCADE,
  emoji      VARCHAR(20)  NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, rabbi_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message_id
  ON message_reactions (message_id);

-- WordPress sync queue / log
CREATE TABLE IF NOT EXISTS wp_sync_log (
  id             SERIAL       PRIMARY KEY,
  entity_type    VARCHAR(50)  NOT NULL,
  entity_id      VARCHAR(255) NOT NULL,
  action         VARCHAR(50)  NOT NULL,
  payload        JSONB        DEFAULT '{}',
  status         VARCHAR(20)  NOT NULL DEFAULT 'pending',
  error_message  TEXT,
  attempts       INTEGER      NOT NULL DEFAULT 0,
  next_retry_at  TIMESTAMPTZ,
  synced_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wp_sync_log_status
  ON wp_sync_log (status, next_retry_at)
  WHERE status = 'pending';

-- ─── MISSING COLUMNS — questions ─────────────────────────────────────────────

ALTER TABLE questions ADD COLUMN IF NOT EXISTS asker_name          TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS asker_email         TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS asker_phone         TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS source              VARCHAR(50)  DEFAULT 'wordpress';
ALTER TABLE questions ADD COLUMN IF NOT EXISTS attachment_url      TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS question_number     SERIAL;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS previous_status     VARCHAR(20);
ALTER TABLE questions ADD COLUMN IF NOT EXISTS draft_content       TEXT;

-- ─── MISSING COLUMNS — rabbis ────────────────────────────────────────────────

ALTER TABLE rabbis ADD COLUMN IF NOT EXISTS status                 VARCHAR(20)  DEFAULT 'active';
ALTER TABLE rabbis ADD COLUMN IF NOT EXISTS is_vacation            BOOLEAN      DEFAULT FALSE;
ALTER TABLE rabbis ADD COLUMN IF NOT EXISTS is_available           BOOLEAN      DEFAULT TRUE;
ALTER TABLE rabbis ADD COLUMN IF NOT EXISTS whatsapp_number        VARCHAR(20);
ALTER TABLE rabbis ADD COLUMN IF NOT EXISTS phone                  VARCHAR(20);
ALTER TABLE rabbis ADD COLUMN IF NOT EXISTS must_change_password   BOOLEAN      DEFAULT FALSE;
ALTER TABLE rabbis ADD COLUMN IF NOT EXISTS max_concurrent_questions INTEGER     DEFAULT 5;
ALTER TABLE rabbis ADD COLUMN IF NOT EXISTS last_login_at          TIMESTAMPTZ;
ALTER TABLE rabbis ADD COLUMN IF NOT EXISTS notification_channel   VARCHAR(30)  DEFAULT 'email';
ALTER TABLE rabbis ADD COLUMN IF NOT EXISTS color_label            VARCHAR(20);

-- ─── MISSING COLUMNS — discussions ───────────────────────────────────────────

ALTER TABLE discussions ADD COLUMN IF NOT EXISTS is_open     BOOLEAN     DEFAULT TRUE;
ALTER TABLE discussions ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT NOW();

-- ─── MISSING COLUMNS — discussion_messages ───────────────────────────────────

ALTER TABLE discussion_messages ADD COLUMN IF NOT EXISTS parent_id   UUID REFERENCES discussion_messages (id) ON DELETE SET NULL;
ALTER TABLE discussion_messages ADD COLUMN IF NOT EXISTS is_pinned   BOOLEAN      DEFAULT FALSE;
ALTER TABLE discussion_messages ADD COLUMN IF NOT EXISTS is_edited   BOOLEAN      DEFAULT FALSE;
ALTER TABLE discussion_messages ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ;

-- ─── MISSING COLUMNS — discussion_members ────────────────────────────────────

ALTER TABLE discussion_members ADD COLUMN IF NOT EXISTS joined_at   TIMESTAMPTZ DEFAULT NOW();

-- ─── MISSING COLUMNS — categories ────────────────────────────────────────────

ALTER TABLE categories ADD COLUMN IF NOT EXISTS parent_id   INTEGER REFERENCES categories (id) ON DELETE SET NULL;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS sort_order  INTEGER DEFAULT 0;

-- ─── MISSING COLUMNS — answers ───────────────────────────────────────────────

ALTER TABLE answers ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ;
ALTER TABLE answers ADD COLUMN IF NOT EXISTS created_at     TIMESTAMPTZ DEFAULT NOW();

-- ─── MISSING COLUMNS — leads_log ─────────────────────────────────────────────

ALTER TABLE leads_log ADD COLUMN IF NOT EXISTS asker_name   TEXT;
ALTER TABLE leads_log ADD COLUMN IF NOT EXISTS email_hash   VARCHAR(128);
ALTER TABLE leads_log ADD COLUMN IF NOT EXISTS phone_hash   VARCHAR(128);
ALTER TABLE leads_log ADD COLUMN IF NOT EXISTS name         TEXT;

-- ─── USEFUL INDEXES ──────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_questions_asker_email
  ON questions (asker_email)
  WHERE asker_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_categories_parent_id
  ON categories (parent_id)
  WHERE parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_categories_sort_order
  ON categories (sort_order);

CREATE INDEX IF NOT EXISTS idx_discussions_is_open
  ON discussions (is_open)
  WHERE is_open = TRUE;

CREATE INDEX IF NOT EXISTS idx_leads_log_email_hash
  ON leads_log (email_hash)
  WHERE email_hash IS NOT NULL;

-- ─── BACKFILL — sync is_vacation with existing vacation_mode ─────────────────

UPDATE rabbis SET is_vacation = vacation_mode WHERE is_vacation IS NULL AND vacation_mode = TRUE;

-- DOWN
-- (Rollback not recommended — too many structural changes)
