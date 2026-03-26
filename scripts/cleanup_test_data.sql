-- ============================================================
-- Cleanup test/dummy data from production DB
-- Review carefully before running!
-- ============================================================

-- Delete test categories (only if they have no questions attached)
DELETE FROM categories
WHERE name IN ('Test Category')
  AND id NOT IN (SELECT DISTINCT category_id FROM questions WHERE category_id IS NOT NULL);

-- Verify: check for any remaining test data
-- SELECT * FROM categories WHERE name ILIKE '%test%';
-- SELECT * FROM questions WHERE title ILIKE '%test%';
