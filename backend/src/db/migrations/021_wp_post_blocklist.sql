-- =============================================================================
-- Migration 021 – wp_post_blocklist table
-- =============================================================================
-- Stores WordPress post IDs that should be ignored during WP→system sync.
-- =============================================================================

CREATE TABLE IF NOT EXISTS wp_post_blocklist (
  wp_post_id  INTEGER      PRIMARY KEY,
  reason      TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wp_post_blocklist_created_at
  ON wp_post_blocklist (created_at DESC);

-- DOWN
DROP TABLE IF EXISTS wp_post_blocklist;
