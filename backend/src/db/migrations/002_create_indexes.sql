-- =============================================================================
-- Migration 002 – Performance indexes
-- Platform: ענה את השואל (Aneh HaShoel) — Rabbi Q&A
-- =============================================================================
-- All indexes use CREATE INDEX IF NOT EXISTS so re-running this file is safe.
-- Naming convention: idx_<table>_<column(s)>
-- Partial indexes carry a _where suffix to signal their predicate.
-- =============================================================================

-- ─── rabbis ───────────────────────────────────────────────────────────────────

-- Fast lookup by email (login / duplicate-check)
CREATE UNIQUE INDEX IF NOT EXISTS idx_rabbis_email
  ON rabbis (email);

-- OAuth login path
CREATE UNIQUE INDEX IF NOT EXISTS idx_rabbis_google_id
  ON rabbis (google_id)
  WHERE google_id IS NOT NULL;

-- Filter to only active rabbis (most list queries exclude deactivated accounts)
CREATE INDEX IF NOT EXISTS idx_rabbis_is_active
  ON rabbis (is_active)
  WHERE is_active = TRUE;

-- ─── rabbi_group_members ──────────────────────────────────────────────────────

-- Fetch all groups a rabbi belongs to
CREATE INDEX IF NOT EXISTS idx_rabbi_group_members_rabbi_id
  ON rabbi_group_members (rabbi_id);

-- Fetch all members of a group
CREATE INDEX IF NOT EXISTS idx_rabbi_group_members_group_id
  ON rabbi_group_members (group_id);

-- ─── categories ───────────────────────────────────────────────────────────────

-- Lookup categories assigned to a routing group
CREATE INDEX IF NOT EXISTS idx_categories_group_id
  ON categories (group_id)
  WHERE group_id IS NOT NULL;

-- ─── questions ────────────────────────────────────────────────────────────────

-- Most common query predicate: workflow status filter
CREATE INDEX IF NOT EXISTS idx_questions_status
  ON questions (status);

-- All questions assigned to a specific rabbi
CREATE INDEX IF NOT EXISTS idx_questions_assigned_rabbi_id
  ON questions (assigned_rabbi_id)
  WHERE assigned_rabbi_id IS NOT NULL;

-- Filter / group by category
CREATE INDEX IF NOT EXISTS idx_questions_category_id
  ON questions (category_id);

-- Time-based sorting and range queries on the inbox
CREATE INDEX IF NOT EXISTS idx_questions_created_at
  ON questions (created_at DESC);

-- WordPress sync: local record lookup by WP post ID
CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_wp_post_id
  ON questions (wp_post_id);

-- Composite: "open questions for a rabbi" — the dominant dashboard query
CREATE INDEX IF NOT EXISTS idx_questions_assigned_status
  ON questions (assigned_rabbi_id, status)
  WHERE assigned_rabbi_id IS NOT NULL;

-- SLA monitor: find questions locked before a cutoff time
CREATE INDEX IF NOT EXISTS idx_questions_lock_timestamp
  ON questions (lock_timestamp)
  WHERE lock_timestamp IS NOT NULL;

-- Newsletter feature flag: pull featured questions quickly
CREATE INDEX IF NOT EXISTS idx_questions_newsletter_featured
  ON questions (newsletter_featured)
  WHERE newsletter_featured = TRUE;

-- Urgency filter: surface urgent questions on top
CREATE INDEX IF NOT EXISTS idx_questions_urgency
  ON questions (urgency)
  WHERE urgency = 'urgent';

-- Flagged content moderation queue
CREATE INDEX IF NOT EXISTS idx_questions_flagged
  ON questions (flagged)
  WHERE flagged = TRUE;

-- ─── answers ──────────────────────────────────────────────────────────────────

-- Join from questions to their answer
CREATE INDEX IF NOT EXISTS idx_answers_question_id
  ON answers (question_id);

-- All answers written by a rabbi (profile / statistics)
CREATE INDEX IF NOT EXISTS idx_answers_rabbi_id
  ON answers (rabbi_id);

-- ─── answer_templates ─────────────────────────────────────────────────────────

-- Load a rabbi's saved templates
CREATE INDEX IF NOT EXISTS idx_answer_templates_rabbi_id
  ON answer_templates (rabbi_id);

-- ─── private_notes ────────────────────────────────────────────────────────────

-- All notes for a question
CREATE INDEX IF NOT EXISTS idx_private_notes_question_id
  ON private_notes (question_id);

-- All notes written by a rabbi
CREATE INDEX IF NOT EXISTS idx_private_notes_rabbi_id
  ON private_notes (rabbi_id);

-- Shared notes visible to the whole team
CREATE INDEX IF NOT EXISTS idx_private_notes_is_shared
  ON private_notes (question_id, is_shared)
  WHERE is_shared = TRUE;

-- ─── discussions ──────────────────────────────────────────────────────────────

-- Discussions linked to a specific question
CREATE INDEX IF NOT EXISTS idx_discussions_question_id
  ON discussions (question_id)
  WHERE question_id IS NOT NULL;

-- Discussions created by a rabbi
CREATE INDEX IF NOT EXISTS idx_discussions_created_by
  ON discussions (created_by);

-- ─── discussion_members ───────────────────────────────────────────────────────

-- All discussions a rabbi participates in
CREATE INDEX IF NOT EXISTS idx_discussion_members_rabbi_id
  ON discussion_members (rabbi_id);

-- ─── discussion_messages ──────────────────────────────────────────────────────

-- Load all messages for a thread (primary read path), oldest-first
CREATE INDEX IF NOT EXISTS idx_discussion_messages_discussion_id
  ON discussion_messages (discussion_id, created_at ASC);

-- Pinned messages across all discussions
CREATE INDEX IF NOT EXISTS idx_discussion_messages_pinned
  ON discussion_messages (discussion_id, pinned)
  WHERE pinned = TRUE;

-- ─── notifications_log ────────────────────────────────────────────────────────

-- All notifications for a rabbi (inbox view)
CREATE INDEX IF NOT EXISTS idx_notifications_log_rabbi_id
  ON notifications_log (rabbi_id);

-- Time-ordered notification feed
CREATE INDEX IF NOT EXISTS idx_notifications_log_sent_at
  ON notifications_log (sent_at DESC);

-- Failed notifications that need retrying
CREATE INDEX IF NOT EXISTS idx_notifications_log_failed
  ON notifications_log (status)
  WHERE status = 'failed';

-- ─── audit_log ────────────────────────────────────────────────────────────────

-- Audit trail per actor
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id
  ON audit_log (actor_id)
  WHERE actor_id IS NOT NULL;

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

-- ─── device_sessions ──────────────────────────────────────────────────────────

-- All sessions for a rabbi
CREATE INDEX IF NOT EXISTS idx_device_sessions_rabbi_id
  ON device_sessions (rabbi_id);

-- Session lookup by fingerprint (login / trust check)
CREATE INDEX IF NOT EXISTS idx_device_sessions_fingerprint
  ON device_sessions (device_fingerprint);

-- ─── leads_log ────────────────────────────────────────────────────────────────

-- CRM pipeline: filter hot leads
CREATE INDEX IF NOT EXISTS idx_leads_log_is_hot
  ON leads_log (is_hot)
  WHERE is_hot = TRUE;

-- Google Sheets sync: find un-synced leads
CREATE INDEX IF NOT EXISTS idx_leads_log_synced_to_sheets
  ON leads_log (synced_to_sheets)
  WHERE synced_to_sheets = FALSE;

-- Join leads to their originating question
CREATE INDEX IF NOT EXISTS idx_leads_log_question_id
  ON leads_log (question_id)
  WHERE question_id IS NOT NULL;

-- ─── badges ───────────────────────────────────────────────────────────────────

-- All badges for a rabbi (profile page)
CREATE INDEX IF NOT EXISTS idx_badges_rabbi_id
  ON badges (rabbi_id);
