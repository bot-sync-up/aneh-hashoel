-- =============================================================================
-- Migration 026 – follow_up_questions table
-- =============================================================================
-- Stores follow-up questions from askers on answered questions.
-- =============================================================================

CREATE TABLE IF NOT EXISTS follow_up_questions (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id     UUID         NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  content         TEXT         NOT NULL,
  asker_name      TEXT,
  asker_email     TEXT,
  answer_content  TEXT,
  answered_by     UUID         REFERENCES rabbis (id) ON DELETE SET NULL,
  answered_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_follow_up_questions_question_id
  ON follow_up_questions (question_id);

-- DOWN
DROP TABLE IF EXISTS follow_up_questions;
