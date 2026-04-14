-- =============================================================================
-- Migration 001 – Full unified schema
-- Platform: ענה את השואל (Aneh HaShoel) — Rabbi Q&A
-- =============================================================================
-- This is the SINGLE SOURCE OF TRUTH for the database schema.
-- All tables, indexes, triggers, and seed data are defined here.
-- Running this on a fresh database creates everything needed.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── TRIGGER FUNCTIONS ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION questions_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(NEW.content, '')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(NEW.asker_name, '')), 'C') ||
    setweight(to_tsvector('simple', COALESCE(NEW.asker_email, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═════════════════════════════════════════════════════════════════════════════
-- TABLES
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── rabbis ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rabbis (
  id                        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      VARCHAR(100) NOT NULL,
  email                     VARCHAR(255) UNIQUE NOT NULL,
  password_hash             TEXT,
  google_id                 VARCHAR(255) UNIQUE,
  signature                 TEXT,
  photo_url                 TEXT,
  preferred_categories      INTEGER[]    NOT NULL DEFAULT '{}',
  availability_hours        JSONB        NOT NULL DEFAULT '{}',
  vacation_mode             BOOLEAN      NOT NULL DEFAULT FALSE,
  vacation_until            TIMESTAMPTZ,
  notification_pref         VARCHAR(20)  NOT NULL DEFAULT 'all'
                              CHECK (notification_pref IN ('email','whatsapp','push','all')),
  max_open_questions        INTEGER,
  role                      VARCHAR(20)  NOT NULL DEFAULT 'rabbi'
                              CHECK (role IN ('rabbi','admin','customer_service')),
  two_fa_enabled            BOOLEAN      NOT NULL DEFAULT FALSE,
  two_fa_secret             TEXT,
  milestone_count           INTEGER      NOT NULL DEFAULT 0,
  is_active                 BOOLEAN      NOT NULL DEFAULT TRUE,
  fcm_token                 TEXT,
  wp_term_id                INTEGER,
  status                    VARCHAR(20)  DEFAULT 'active',
  is_vacation               BOOLEAN      DEFAULT FALSE,
  is_available              BOOLEAN      DEFAULT TRUE,
  whatsapp_number           VARCHAR(20),
  phone                     VARCHAR(20),
  must_change_password      BOOLEAN      DEFAULT FALSE,
  max_concurrent_questions  INTEGER      DEFAULT 5,
  last_login_at             TIMESTAMPTZ,
  notification_channel      VARCHAR(30)  DEFAULT 'email',
  color_label               VARCHAR(20),
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_rabbis_updated_at
  BEFORE UPDATE ON rabbis FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── rabbi_groups ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rabbi_groups (
  id          SERIAL       PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  created_by  UUID         REFERENCES rabbis (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── rabbi_group_members ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rabbi_group_members (
  rabbi_id  UUID        NOT NULL REFERENCES rabbis       (id) ON DELETE CASCADE,
  group_id  INTEGER     NOT NULL REFERENCES rabbi_groups (id) ON DELETE CASCADE,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (rabbi_id, group_id)
);

-- ─── categories ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS categories (
  id           SERIAL       PRIMARY KEY,
  name         VARCHAR(100) NOT NULL UNIQUE,
  description  TEXT,
  color        VARCHAR(7)   NOT NULL DEFAULT '#1B2B5E',
  group_id     INTEGER      REFERENCES rabbi_groups (id) ON DELETE SET NULL,
  status       TEXT         NOT NULL DEFAULT 'approved'
                 CHECK (status IN ('approved','pending','rejected')),
  suggested_by UUID         REFERENCES rabbis(id) ON DELETE SET NULL,
  wp_term_id   INTEGER,
  parent_id    INTEGER      REFERENCES categories (id) ON DELETE SET NULL,
  sort_order   INTEGER      DEFAULT 0,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_categories_updated_at
  BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── questions ───────────────────────────────────────────────────────────────

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
  asker_name             TEXT,
  asker_email            TEXT,
  asker_phone            TEXT,
  source                 VARCHAR(50)  DEFAULT 'wordpress',
  attachment_url         TEXT,
  question_number        SERIAL,
  previous_status        VARCHAR(20),
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
  wp_link                TEXT,
  notified_status        BOOLEAN      DEFAULT NULL,
  search_vector          TSVECTOR,
  draft_content          TEXT,
  draft_updated_at       TIMESTAMPTZ,
  email_message_id       VARCHAR(500),
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  answered_at            TIMESTAMPTZ,
  wp_synced_at           TIMESTAMPTZ,
  updated_at             TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TRIGGER trg_questions_updated_at
  BEFORE UPDATE ON questions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_questions_search_vector
  BEFORE INSERT OR UPDATE OF title, content, asker_name, asker_email ON questions
  FOR EACH ROW EXECUTE FUNCTION questions_search_vector_update();

-- ─── answers ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS answers (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id      UUID        NOT NULL UNIQUE REFERENCES questions (id) ON DELETE CASCADE,
  rabbi_id         UUID        NOT NULL REFERENCES rabbis (id) ON DELETE RESTRICT,
  content          TEXT        NOT NULL,
  content_versions JSONB       NOT NULL DEFAULT '[]',
  follow_up_content TEXT,
  is_private       BOOLEAN     NOT NULL DEFAULT FALSE,
  published_at     TIMESTAMPTZ,
  last_edited_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ
);

-- ─── follow_up_questions ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS follow_up_questions (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id     UUID         NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  asker_content   TEXT         NOT NULL,
  rabbi_answer    TEXT,
  answered_by     UUID         REFERENCES rabbis (id) ON DELETE SET NULL,
  answered_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── answer_templates ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS answer_templates (
  id         SERIAL       PRIMARY KEY,
  rabbi_id   UUID         NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  title      VARCHAR(200) NOT NULL,
  content    TEXT         NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── rabbi_templates ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rabbi_templates (
  id          SERIAL       PRIMARY KEY,
  rabbi_id    UUID         NOT NULL REFERENCES rabbis(id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL,
  content     TEXT         NOT NULL,
  shortcut    VARCHAR(30),
  usage_count INTEGER      NOT NULL DEFAULT 0,
  category_id INTEGER      REFERENCES categories(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── private_notes ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS private_notes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID        NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  rabbi_id    UUID        NOT NULL REFERENCES rabbis    (id) ON DELETE CASCADE,
  content     TEXT        NOT NULL,
  is_shared   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (question_id, rabbi_id)
);

CREATE TRIGGER trg_private_notes_updated_at
  BEFORE UPDATE ON private_notes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── discussions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS discussions (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID         REFERENCES questions (id) ON DELETE SET NULL,
  title       VARCHAR(300) NOT NULL,
  created_by  UUID         NOT NULL REFERENCES rabbis (id) ON DELETE RESTRICT,
  locked      BOOLEAN      NOT NULL DEFAULT FALSE,
  is_open     BOOLEAN      DEFAULT TRUE,
  deleted_at  TIMESTAMPTZ  DEFAULT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- ─── discussion_members ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS discussion_members (
  discussion_id UUID        NOT NULL REFERENCES discussions (id) ON DELETE CASCADE,
  rabbi_id      UUID        NOT NULL REFERENCES rabbis      (id) ON DELETE CASCADE,
  added_by      UUID        REFERENCES rabbis (id) ON DELETE SET NULL,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at  TIMESTAMPTZ DEFAULT NULL,
  joined_at     TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (discussion_id, rabbi_id)
);

-- ─── discussion_messages ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS discussion_messages (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  discussion_id     UUID        NOT NULL REFERENCES discussions (id) ON DELETE CASCADE,
  rabbi_id          UUID        NOT NULL REFERENCES rabbis      (id) ON DELETE RESTRICT,
  content           TEXT        NOT NULL,
  quoted_message_id UUID        REFERENCES discussion_messages (id) ON DELETE SET NULL,
  parent_id         UUID        REFERENCES discussion_messages (id) ON DELETE SET NULL,
  pinned            BOOLEAN     NOT NULL DEFAULT FALSE,
  is_pinned         BOOLEAN     DEFAULT FALSE,
  is_edited         BOOLEAN     DEFAULT FALSE,
  reactions         JSONB       NOT NULL DEFAULT '{}',
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at         TIMESTAMPTZ
);

-- ─── message_reactions ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS message_reactions (
  id         SERIAL       PRIMARY KEY,
  message_id UUID         NOT NULL REFERENCES discussion_messages (id) ON DELETE CASCADE,
  rabbi_id   UUID         NOT NULL REFERENCES rabbis              (id) ON DELETE CASCADE,
  emoji      VARCHAR(20)  NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, rabbi_id, emoji)
);

-- ─── notifications_log ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications_log (
  id        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  rabbi_id  UUID         NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  type      VARCHAR(100) NOT NULL,
  channel   VARCHAR(20)  NOT NULL,
  content   JSONB        NOT NULL,
  entity_id VARCHAR(255),
  sent_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  status    VARCHAR(20)  NOT NULL DEFAULT 'sent'
              CHECK (status IN ('sent','failed','pending'))
);

-- ─── notification_preferences ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_preferences (
  rabbi_id    UUID        NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  event_type  VARCHAR(50) NOT NULL,
  channel     VARCHAR(20) NOT NULL DEFAULT 'email',
  enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
  PRIMARY KEY (rabbi_id, event_type)
);

-- ─── audit_log ───────────────────────────────────────────────────────────────

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

-- ─── device_sessions ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS device_sessions (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  rabbi_id           UUID         NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  device_fingerprint VARCHAR(255) NOT NULL,
  ip                 VARCHAR(45),
  user_agent         TEXT,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_seen          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── sessions ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  rabbi_id            UUID         NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  refresh_token_hash  VARCHAR(255) UNIQUE,
  device_info         JSONB        DEFAULT '{}',
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,
  is_revoked          BOOLEAN      NOT NULL DEFAULT FALSE
);

-- ─── leads_log ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leads_log (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asker_email_encrypted TEXT,
  asker_phone_encrypted TEXT,
  question_id           UUID        REFERENCES questions  (id) ON DELETE SET NULL,
  category_id           INTEGER     REFERENCES categories (id) ON DELETE SET NULL,
  interaction_score     INTEGER     NOT NULL DEFAULT 0,
  is_hot                BOOLEAN     NOT NULL DEFAULT FALSE,
  synced_to_sheets      BOOLEAN     NOT NULL DEFAULT FALSE,
  asker_name            TEXT,
  email_hash            VARCHAR(128),
  phone_hash            VARCHAR(128),
  name                  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_leads_log_updated_at
  BEFORE UPDATE ON leads_log FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── leads ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leads (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash            TEXT        UNIQUE,
  phone_hash            TEXT,
  asker_name            TEXT,
  asker_email_encrypted TEXT,
  asker_phone_encrypted TEXT,
  question_count        INTEGER     NOT NULL DEFAULT 1,
  interaction_score     INTEGER     NOT NULL DEFAULT 0,
  is_hot                BOOLEAN     NOT NULL DEFAULT FALSE,
  contacted             BOOLEAN     NOT NULL DEFAULT FALSE,
  contact_notes         TEXT        NOT NULL DEFAULT '',
  last_category_id      INTEGER     REFERENCES categories (id) ON DELETE SET NULL,
  last_click_at         TIMESTAMPTZ,
  click_count           INTEGER     NOT NULL DEFAULT 0,
  has_thanked           BOOLEAN     DEFAULT FALSE,
  first_question_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_question_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── sla_config ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sla_config (
  id               INTEGER     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  hours_to_warning INTEGER     NOT NULL DEFAULT 3,
  hours_to_timeout INTEGER     NOT NULL DEFAULT 4,
  enabled          BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sla_config (id, hours_to_warning, hours_to_timeout, enabled, updated_at)
VALUES (1, 3, 4, TRUE, NOW()) ON CONFLICT (id) DO NOTHING;

-- ─── system_config ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_config (
  key        VARCHAR(100) PRIMARY KEY,
  value      JSONB        NOT NULL,
  updated_by UUID         REFERENCES rabbis (id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── badges ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS badges (
  id        SERIAL      PRIMARY KEY,
  rabbi_id  UUID        NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  type      VARCHAR(50) NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rabbi_id, type)
);

-- ─── rabbi_stats ─────────────────────────────────────────────────────────────

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

-- ─── rabbi_achievements ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rabbi_achievements (
  id         SERIAL       PRIMARY KEY,
  rabbi_id   UUID         NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  badge_type VARCHAR(50)  NOT NULL,
  earned_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (rabbi_id, badge_type)
);

-- ─── rabbi_categories ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rabbi_categories (
  rabbi_id    UUID    NOT NULL REFERENCES rabbis     (id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  PRIMARY KEY (rabbi_id, category_id)
);

-- ─── support_requests ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS support_requests (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  rabbi_id    UUID         NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  subject     VARCHAR(200) NOT NULL,
  message     TEXT         NOT NULL,
  status      VARCHAR(20)  NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── support_messages ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS support_messages (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID         NOT NULL REFERENCES support_requests (id) ON DELETE CASCADE,
  sender_id   UUID         NOT NULL REFERENCES rabbis (id) ON DELETE CASCADE,
  sender_role VARCHAR(20)  NOT NULL DEFAULT 'rabbi',
  message     TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── newsletter_archive ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS newsletter_archive (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT        NOT NULL,
  content_html    TEXT        NOT NULL,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recipient_count INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── donations ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS donations (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id       UUID          REFERENCES questions(id) ON DELETE SET NULL,
  rabbi_id          UUID          REFERENCES rabbis(id) ON DELETE SET NULL,
  amount            DECIMAL(12,2) NOT NULL,
  currency          VARCHAR(3)    NOT NULL DEFAULT 'ILS',
  donor_name        VARCHAR(255),
  donor_email       VARCHAR(255),
  donor_phone       VARCHAR(50),
  nedarim_reference VARCHAR(255),
  payment_method    VARCHAR(50),
  status            VARCHAR(20)   NOT NULL DEFAULT 'completed',
  notes             TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── onboarding_queue ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS onboarding_queue (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID        NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  email_encrypted TEXT        NOT NULL,
  asker_name      TEXT,
  step            INTEGER     NOT NULL DEFAULT 1,
  send_at         TIMESTAMPTZ NOT NULL,
  sent_at         TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── wp_post_blocklist ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wp_post_blocklist (
  wp_post_id  INTEGER      PRIMARY KEY,
  reason      TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── wp_sync_log ─────────────────────────────────────────────────────────────

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

-- ─── whatsapp_log ────────────────────────────────────────────────────────────

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

-- ═════════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ═════════════════════════════════════════════════════════════════════════════

-- rabbis
CREATE UNIQUE INDEX IF NOT EXISTS idx_rabbis_email ON rabbis (email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rabbis_google_id ON rabbis (google_id) WHERE google_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rabbis_is_active ON rabbis (is_active) WHERE is_active = TRUE;

-- rabbi_group_members
CREATE INDEX IF NOT EXISTS idx_rabbi_group_members_rabbi_id ON rabbi_group_members (rabbi_id);
CREATE INDEX IF NOT EXISTS idx_rabbi_group_members_group_id ON rabbi_group_members (group_id);

-- categories
CREATE INDEX IF NOT EXISTS idx_categories_group_id ON categories (group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_categories_status ON categories (status);
CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_categories_sort_order ON categories (sort_order);

-- questions
CREATE INDEX IF NOT EXISTS idx_questions_status ON questions (status);
CREATE INDEX IF NOT EXISTS idx_questions_assigned_rabbi_id ON questions (assigned_rabbi_id) WHERE assigned_rabbi_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_questions_category_id ON questions (category_id);
CREATE INDEX IF NOT EXISTS idx_questions_created_at ON questions (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_wp_post_id ON questions (wp_post_id);
CREATE INDEX IF NOT EXISTS idx_questions_assigned_status ON questions (assigned_rabbi_id, status) WHERE assigned_rabbi_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_questions_lock_timestamp ON questions (lock_timestamp) WHERE lock_timestamp IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_questions_newsletter_featured ON questions (newsletter_featured) WHERE newsletter_featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_questions_urgency ON questions (urgency) WHERE urgency = 'urgent';
CREATE INDEX IF NOT EXISTS idx_questions_flagged ON questions (flagged) WHERE flagged = TRUE;
CREATE INDEX IF NOT EXISTS idx_questions_search_vector ON questions USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_questions_asker_email ON questions (asker_email) WHERE asker_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_questions_updated_at ON questions (updated_at DESC);

-- answers
CREATE INDEX IF NOT EXISTS idx_answers_question_id ON answers (question_id);
CREATE INDEX IF NOT EXISTS idx_answers_rabbi_id ON answers (rabbi_id);

-- follow_up_questions
CREATE INDEX IF NOT EXISTS idx_follow_up_questions_question_id ON follow_up_questions (question_id);

-- answer_templates
CREATE INDEX IF NOT EXISTS idx_answer_templates_rabbi_id ON answer_templates (rabbi_id);

-- rabbi_templates
CREATE INDEX IF NOT EXISTS idx_rabbi_templates_rabbi_id ON rabbi_templates (rabbi_id);
CREATE INDEX IF NOT EXISTS idx_rabbi_templates_category_id ON rabbi_templates (category_id);

-- private_notes
CREATE INDEX IF NOT EXISTS idx_private_notes_question_id ON private_notes (question_id);
CREATE INDEX IF NOT EXISTS idx_private_notes_rabbi_id ON private_notes (rabbi_id);
CREATE INDEX IF NOT EXISTS idx_private_notes_is_shared ON private_notes (question_id, is_shared) WHERE is_shared = TRUE;

-- discussions
CREATE INDEX IF NOT EXISTS idx_discussions_question_id ON discussions (question_id) WHERE question_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_discussions_created_by ON discussions (created_by);
CREATE INDEX IF NOT EXISTS idx_discussions_deleted_at ON discussions (deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_discussions_is_open ON discussions (is_open) WHERE is_open = TRUE;

-- discussion_members
CREATE INDEX IF NOT EXISTS idx_discussion_members_rabbi_id ON discussion_members (rabbi_id);

-- discussion_messages
CREATE INDEX IF NOT EXISTS idx_discussion_messages_discussion_id ON discussion_messages (discussion_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_discussion_messages_pinned ON discussion_messages (discussion_id, pinned) WHERE pinned = TRUE;

-- message_reactions
CREATE INDEX IF NOT EXISTS idx_message_reactions_message_id ON message_reactions (message_id);

-- notifications_log
CREATE INDEX IF NOT EXISTS idx_notifications_log_rabbi_id ON notifications_log (rabbi_id);
CREATE INDEX IF NOT EXISTS idx_notifications_log_sent_at ON notifications_log (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_log_failed ON notifications_log (status) WHERE status = 'failed';

-- notification_preferences
CREATE INDEX IF NOT EXISTS idx_notification_preferences_rabbi_id ON notification_preferences (rabbi_id);

-- audit_log
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id ON audit_log (actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_type ON audit_log (entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_type_id ON audit_log (entity_type, entity_id) WHERE entity_id IS NOT NULL;

-- device_sessions
CREATE INDEX IF NOT EXISTS idx_device_sessions_rabbi_id ON device_sessions (rabbi_id);
CREATE INDEX IF NOT EXISTS idx_device_sessions_fingerprint ON device_sessions (device_fingerprint);

-- sessions
CREATE INDEX IF NOT EXISTS idx_sessions_rabbi_id ON sessions (rabbi_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions (refresh_token_hash) WHERE refresh_token_hash IS NOT NULL;

-- leads_log
CREATE INDEX IF NOT EXISTS idx_leads_log_is_hot ON leads_log (is_hot) WHERE is_hot = TRUE;
CREATE INDEX IF NOT EXISTS idx_leads_log_synced_to_sheets ON leads_log (synced_to_sheets) WHERE synced_to_sheets = FALSE;
CREATE INDEX IF NOT EXISTS idx_leads_log_question_id ON leads_log (question_id) WHERE question_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_log_email_hash ON leads_log (email_hash) WHERE email_hash IS NOT NULL;

-- leads
CREATE INDEX IF NOT EXISTS idx_leads_is_hot ON leads (is_hot);
CREATE INDEX IF NOT EXISTS idx_leads_contacted ON leads (contacted);
CREATE INDEX IF NOT EXISTS idx_leads_last_q_at ON leads (last_question_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_score ON leads (interaction_score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_phone_hash ON leads (phone_hash) WHERE phone_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_phone_hash_unique ON leads (phone_hash) WHERE phone_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_last_click_at ON leads (last_click_at DESC NULLS LAST) WHERE last_click_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_has_thanked ON leads (has_thanked) WHERE has_thanked = TRUE;

-- badges
CREATE INDEX IF NOT EXISTS idx_badges_rabbi_id ON badges (rabbi_id);

-- rabbi_stats
CREATE INDEX IF NOT EXISTS idx_rabbi_stats_rabbi_id ON rabbi_stats (rabbi_id);
CREATE INDEX IF NOT EXISTS idx_rabbi_stats_week_start ON rabbi_stats (week_start DESC);

-- rabbi_achievements
CREATE INDEX IF NOT EXISTS idx_rabbi_achievements_rabbi_id ON rabbi_achievements (rabbi_id);

-- rabbi_categories
CREATE INDEX IF NOT EXISTS idx_rabbi_categories_category_id ON rabbi_categories (category_id);

-- support_requests
CREATE INDEX IF NOT EXISTS idx_support_requests_rabbi_id ON support_requests (rabbi_id);
CREATE INDEX IF NOT EXISTS idx_support_requests_status ON support_requests (status, created_at DESC);

-- support_messages
CREATE INDEX IF NOT EXISTS idx_support_messages_request_id ON support_messages (request_id, created_at ASC);

-- newsletter_archive
CREATE INDEX IF NOT EXISTS idx_newsletter_archive_sent_at ON newsletter_archive (sent_at DESC);

-- donations
CREATE INDEX IF NOT EXISTS idx_donations_created_at ON donations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_donations_question_id ON donations (question_id) WHERE question_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_donations_rabbi_id ON donations (rabbi_id) WHERE rabbi_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_donations_nedarim_ref ON donations (nedarim_reference) WHERE nedarim_reference IS NOT NULL;

-- onboarding_queue
CREATE INDEX IF NOT EXISTS idx_onboarding_queue_pending ON onboarding_queue (send_at) WHERE sent_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_queue_lead_step ON onboarding_queue (lead_id, step);

-- wp_post_blocklist
CREATE INDEX IF NOT EXISTS idx_wp_post_blocklist_created_at ON wp_post_blocklist (created_at DESC);

-- wp_sync_log
CREATE INDEX IF NOT EXISTS idx_wp_sync_log_status ON wp_sync_log (status, next_retry_at) WHERE status = 'pending';
