-- =============================================================================
-- Migration 022 – Add missing columns (discussions + discussion_members)
-- =============================================================================

ALTER TABLE discussions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE discussion_members
  ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ DEFAULT NULL;

-- Index for soft-delete queries
CREATE INDEX IF NOT EXISTS idx_discussions_deleted_at
  ON discussions (deleted_at)
  WHERE deleted_at IS NULL;

-- DOWN
ALTER TABLE discussions DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE discussion_members DROP COLUMN IF EXISTS last_read_at;
