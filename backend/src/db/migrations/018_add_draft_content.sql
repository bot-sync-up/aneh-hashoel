-- Migration 018: Add draft_content column to questions table
-- Stores the rabbi's in-progress answer draft separately from the published answer.
-- This prevents draft saves from creating a full answer row and marking the question as 'answered'.

ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS draft_content TEXT,
  ADD COLUMN IF NOT EXISTS draft_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN questions.draft_content IS
  'Rich HTML draft of the rabbi''s answer, saved before publishing.';
COMMENT ON COLUMN questions.draft_updated_at IS
  'Timestamp of the last draft save.';
