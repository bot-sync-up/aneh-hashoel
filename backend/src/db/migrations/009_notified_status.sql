-- Add notified_status column to questions table (tracks whether asker was notified of answer)
ALTER TABLE questions ADD COLUMN IF NOT EXISTS notified_status BOOLEAN DEFAULT NULL;
