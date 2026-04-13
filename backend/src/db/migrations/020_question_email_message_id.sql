-- Migration 020: Add email_message_id column to questions for email threading
-- Stores the Message-ID of the initial broadcast email so follow-up emails
-- can reference it via In-Reply-To / References headers (threading in email clients).

ALTER TABLE questions ADD COLUMN IF NOT EXISTS email_message_id VARCHAR(500);
