-- Migration 010: Add wp_term_id column to rabbis table
-- Stores the WordPress rabi-add taxonomy term ID for bidirectional sync.

ALTER TABLE rabbis ADD COLUMN IF NOT EXISTS wp_term_id INTEGER;
