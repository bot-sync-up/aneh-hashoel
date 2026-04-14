-- =============================================================================
-- Migration 024 – Add updated_at to questions table
-- =============================================================================
-- The questions table was created without updated_at, but the application
-- code references q.updated_at in multiple queries (dashboard, listings, etc.)
-- =============================================================================

ALTER TABLE questions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill: set updated_at to the most recent meaningful timestamp
UPDATE questions
SET updated_at = COALESCE(answered_at, lock_timestamp, created_at)
WHERE updated_at IS NULL OR updated_at = created_at;

-- Auto-update trigger
CREATE TRIGGER trg_questions_updated_at
  BEFORE UPDATE ON questions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Index for sorting by last activity
CREATE INDEX IF NOT EXISTS idx_questions_updated_at
  ON questions (updated_at DESC);

-- DOWN
DROP TRIGGER IF EXISTS trg_questions_updated_at ON questions;
ALTER TABLE questions DROP COLUMN IF EXISTS updated_at;
