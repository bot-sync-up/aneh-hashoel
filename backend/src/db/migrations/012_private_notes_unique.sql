-- Migration 012: Add unique constraint on private_notes(question_id, rabbi_id)
-- Required for ON CONFLICT upsert to work correctly

CREATE UNIQUE INDEX IF NOT EXISTS idx_private_notes_question_rabbi
  ON private_notes (question_id, rabbi_id);
