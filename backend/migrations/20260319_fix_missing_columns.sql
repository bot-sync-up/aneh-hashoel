-- Migration: Fix missing columns and tables
-- Date: 2026-03-19

-- questions: add missing columns
ALTER TABLE questions ADD COLUMN IF NOT EXISTS asker_name   VARCHAR(255);
ALTER TABLE questions ADD COLUMN IF NOT EXISTS asker_email  TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS asker_phone  TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS source       VARCHAR(50) DEFAULT 'wordpress';

-- answers: add missing timestamp columns
ALTER TABLE answers ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
ALTER TABLE answers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

-- audit_log: add missing user_agent column
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_agent TEXT;

-- follow_up_questions: create missing table
CREATE TABLE IF NOT EXISTS follow_up_questions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id   UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  asker_content TEXT NOT NULL,
  rabbi_answer  TEXT,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_follow_up_questions_question_id ON follow_up_questions(question_id);
