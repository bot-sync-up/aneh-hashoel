-- Migration 005: Category enhancements
-- Adds: status (approved/pending/rejected), suggested_by, wp_term_id to categories
-- Adds: wp_category_id to categories for WordPress ask-cat mapping

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS status        TEXT    NOT NULL DEFAULT 'approved'
    CHECK (status IN ('approved', 'pending', 'rejected')),
  ADD COLUMN IF NOT EXISTS suggested_by  UUID    REFERENCES rabbis(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wp_term_id    INTEGER;

CREATE INDEX IF NOT EXISTS idx_categories_status ON categories (status);
