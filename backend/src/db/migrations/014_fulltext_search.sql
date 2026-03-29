-- Migration 014: Add full-text search vector to questions table
-- Replaces ILIKE-based search with PostgreSQL tsvector + GIN index

-- 1. Add the search_vector column
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. Create a GIN index for fast full-text lookups
CREATE INDEX IF NOT EXISTS idx_questions_search_vector
  ON questions USING GIN (search_vector);

-- 3. Create a function that builds the search vector from relevant columns.
--    Uses 'simple' config (language-agnostic) which works well for Hebrew text.
--    Weights: title = A (highest), content = B, asker_name = C, asker_email = D.
CREATE OR REPLACE FUNCTION questions_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(NEW.content, '')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(NEW.asker_name, '')), 'C') ||
    setweight(to_tsvector('simple', COALESCE(NEW.asker_email, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Create trigger to auto-update on INSERT or UPDATE of the relevant columns
DROP TRIGGER IF EXISTS trg_questions_search_vector ON questions;
CREATE TRIGGER trg_questions_search_vector
  BEFORE INSERT OR UPDATE OF title, content, asker_name, asker_email
  ON questions
  FOR EACH ROW
  EXECUTE FUNCTION questions_search_vector_update();

-- 5. Populate search_vector for all existing rows
UPDATE questions
SET search_vector =
  setweight(to_tsvector('simple', COALESCE(title, '')), 'A') ||
  setweight(to_tsvector('simple', COALESCE(content, '')), 'B') ||
  setweight(to_tsvector('simple', COALESCE(asker_name, '')), 'C') ||
  setweight(to_tsvector('simple', COALESCE(asker_email, '')), 'D');
