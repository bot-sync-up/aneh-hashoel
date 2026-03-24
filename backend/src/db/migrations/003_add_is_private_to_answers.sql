-- Migration 003: Add is_private column to answers table
-- A private answer is visible only to the rabbi who wrote it.
-- It is NOT synced to WordPress and the asker does NOT receive a notification.

ALTER TABLE answers
  ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN answers.is_private IS
  'When true, the answer is private to the answering rabbi only. '
  'Not synced to WordPress; asker is not notified.';
