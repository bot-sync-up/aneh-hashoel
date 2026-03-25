-- =============================================================================
-- Migration 007 – Templates: ensure rabbi_templates table exists with category_id
-- =============================================================================

-- Create rabbi_templates table if it doesn't exist yet
-- (may have been created as answer_templates in earlier migrations)
CREATE TABLE IF NOT EXISTS rabbi_templates (
  id          SERIAL       PRIMARY KEY,
  rabbi_id    UUID         NOT NULL REFERENCES rabbis(id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL,
  content     TEXT         NOT NULL,
  shortcut    VARCHAR(30),
  usage_count INTEGER      NOT NULL DEFAULT 0,
  category_id INTEGER      REFERENCES categories(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- In case the table already existed without category_id, add the column
ALTER TABLE rabbi_templates ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;

-- In case the table already existed without shortcut/usage_count
ALTER TABLE rabbi_templates ADD COLUMN IF NOT EXISTS shortcut    VARCHAR(30);
ALTER TABLE rabbi_templates ADD COLUMN IF NOT EXISTS usage_count INTEGER NOT NULL DEFAULT 0;

-- Index for fast lookups by rabbi
CREATE INDEX IF NOT EXISTS idx_rabbi_templates_rabbi_id    ON rabbi_templates (rabbi_id);
CREATE INDEX IF NOT EXISTS idx_rabbi_templates_category_id ON rabbi_templates (category_id);
