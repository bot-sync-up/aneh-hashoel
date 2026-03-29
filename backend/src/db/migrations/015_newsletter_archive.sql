-- Migration 015: Newsletter archive table
-- Stores a copy of each sent newsletter for admin review.

CREATE TABLE IF NOT EXISTS newsletter_archive (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT        NOT NULL,
  content_html    TEXT        NOT NULL,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recipient_count INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for listing newsletters in reverse chronological order
CREATE INDEX IF NOT EXISTS idx_newsletter_archive_sent_at
  ON newsletter_archive (sent_at DESC);
