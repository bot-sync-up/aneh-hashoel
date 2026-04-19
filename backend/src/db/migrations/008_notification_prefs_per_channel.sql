-- ──────────────────────────────────────────────────────────────────────────────
-- Migration 008 — notification_preferences: one row per (event, channel)
--
-- Bug: PK was (rabbi_id, event_type) so only one row per event was kept.
-- The UI sends one row per channel (email/whatsapp/push), all 3 targeted the
-- same PK, and ON CONFLICT caused the last row to overwrite the others.
-- Result: preferences "reset" on every save, and the stored channel was
-- arbitrary (usually 'push' because it's the last in the loop).
--
-- Fix: expand existing 'both'/'all' rows into per-channel rows, then rewrite
-- the PK to include `channel`. From now on each (rabbi, event, channel) pair
-- is a discrete toggle.
-- ──────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Drop the old PK so we can insert new per-channel rows without collision
ALTER TABLE notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_pkey;

-- 2. Expand existing 'both'/'all' rows into explicit per-channel rows
--    'both' → email + whatsapp
--    'all'  → email + whatsapp + push
INSERT INTO notification_preferences (rabbi_id, event_type, channel, enabled)
SELECT rabbi_id, event_type, 'whatsapp', enabled
FROM   notification_preferences
WHERE  channel IN ('both', 'all');

INSERT INTO notification_preferences (rabbi_id, event_type, channel, enabled)
SELECT rabbi_id, event_type, 'push', enabled
FROM   notification_preferences
WHERE  channel = 'all';

-- 3. Normalize the legacy 'both'/'all' rows into 'email'
UPDATE notification_preferences
SET    channel = 'email'
WHERE  channel IN ('both', 'all');

-- 4. Dedupe any accidental duplicates that may exist (keep highest ctid)
DELETE FROM notification_preferences a
USING  notification_preferences b
WHERE  a.ctid < b.ctid
  AND  a.rabbi_id   = b.rabbi_id
  AND  a.event_type = b.event_type
  AND  a.channel    = b.channel;

-- 5. Add the new per-channel composite PK
ALTER TABLE notification_preferences
  ADD PRIMARY KEY (rabbi_id, event_type, channel);

COMMIT;
