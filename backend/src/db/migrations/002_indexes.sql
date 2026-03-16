-- =============================================================================
-- Migration 002 – Performance indexes
-- =============================================================================
-- All indexes use CREATE INDEX IF NOT EXISTS so re-running this file is safe.
-- Naming convention: idx_<table>_<column(s)>
-- =============================================================================

-- ─── questions ────────────────────────────────────────────────────────────────

-- Filter by workflow status (the most common query predicate)
CREATE INDEX IF NOT EXISTS idx_questions_status
  ON questions (status);

-- Fetch all questions assigned to a specific rabbi
CREATE INDEX IF NOT EXISTS idx_questions_assigned_rabbi_id
  ON questions (assigned_rabbi_id);

-- Filter / group questions by category
CREATE INDEX IF NOT EXISTS idx_questions_category_id
  ON questions (category_id);

-- Time-based sorting and range queries on the inbox
CREATE INDEX IF NOT EXISTS idx_questions_created_at
  ON questions (created_at DESC);

-- WordPress sync: look up local record by WP post ID
CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_wp_post_id
  ON questions (wp_post_id);

-- Composite index for the common "open questions for rabbi" query
CREATE INDEX IF NOT EXISTS idx_questions_assigned_status
  ON questions (assigned_rabbi_id, status)
  WHERE assigned_rabbi_id IS NOT NULL;

-- ─── answers ──────────────────────────────────────────────────────────────────

-- Join from questions to answers
CREATE INDEX IF NOT EXISTS idx_answers_question_id
  ON answers (question_id);

-- All answers written by a rabbi (profile / statistics)
CREATE INDEX IF NOT EXISTS idx_answers_rabbi_id
  ON answers (rabbi_id);

-- ─── audit_log ────────────────────────────────────────────────────────────────

-- Audit trail per admin user
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id
  ON audit_log (actor_id);

-- Chronological audit stream
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON audit_log (created_at DESC);

-- Look up all events that touched a specific entity type
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_type
  ON audit_log (entity_type);

-- Look up all events for a specific entity (type + id together)
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_type_id
  ON audit_log (entity_type, entity_id)
  WHERE entity_id IS NOT NULL;

-- ─── notifications_log ────────────────────────────────────────────────────────

-- All notifications for a rabbi (inbox view)
CREATE INDEX IF NOT EXISTS idx_notifications_log_rabbi_id
  ON notifications_log (rabbi_id);

-- Time-ordered notification feed
CREATE INDEX IF NOT EXISTS idx_notifications_log_sent_at
  ON notifications_log (sent_at DESC);

-- ─── device_sessions ──────────────────────────────────────────────────────────

-- All sessions for a rabbi
CREATE INDEX IF NOT EXISTS idx_device_sessions_rabbi_id
  ON device_sessions (rabbi_id);

-- Look up a session by fingerprint (login / trust check)
CREATE INDEX IF NOT EXISTS idx_device_sessions_fingerprint
  ON device_sessions (device_fingerprint);

-- ─── refresh_tokens ───────────────────────────────────────────────────────────

-- All tokens belonging to a rabbi (revocation on logout-all)
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_rabbi_id
  ON refresh_tokens (rabbi_id);

-- Token lookup by hash (the common auth path)
CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash
  ON refresh_tokens (token_hash);

-- Filter out expired / revoked tokens efficiently
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_active
  ON refresh_tokens (rabbi_id, expires_at)
  WHERE revoked = FALSE;

-- ─── leads_log ────────────────────────────────────────────────────────────────

-- Sales pipeline: filter hot leads
CREATE INDEX IF NOT EXISTS idx_leads_log_is_hot
  ON leads_log (is_hot)
  WHERE is_hot = TRUE;

-- CRM sync: find un-synced leads for the Google Sheets exporter
CREATE INDEX IF NOT EXISTS idx_leads_log_gs_synced
  ON leads_log (gs_synced)
  WHERE gs_synced = FALSE;

-- ─── discussion_messages ──────────────────────────────────────────────────────

-- Load all messages for a discussion thread (the primary read path)
CREATE INDEX IF NOT EXISTS idx_discussion_messages_discussion_id
  ON discussion_messages (discussion_id, created_at ASC);

-- Time-ordered message feed per discussion
CREATE INDEX IF NOT EXISTS idx_discussion_messages_created_at
  ON discussion_messages (created_at DESC);
