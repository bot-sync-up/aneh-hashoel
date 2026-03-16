-- =============================================================================
-- Seed 001 – Default admin rabbi
-- =============================================================================
-- IMPORTANT: This seed intentionally does NOT set a real password_hash.
--
-- To create the admin account with a proper bcrypt password hash run:
--
--   node scripts/create-admin.js
--
-- The script will prompt for (or accept via argv) the email, display name,
-- and password, then insert or update the row safely.
--
-- This SQL file exists only to reserve the email address and role in
-- environments where the interactive script cannot be run (e.g. CI).
-- =============================================================================

INSERT INTO rabbis (
  email,
  name,
  role,
  password_hash,
  notification_pref,
  milestone_count,
  warning_sent,
  vacation_mode,
  two_fa_enabled
)
VALUES (
  'admin@example.com',
  'מנהל המערכת',
  'admin',
  -- Placeholder: run `node scripts/create-admin.js` to set a real bcrypt hash
  NULL,
  'all',
  0,
  FALSE,
  FALSE,
  FALSE
)
ON CONFLICT (email) DO NOTHING;
