-- =============================================================================
-- Migration 008 – FCM push token per rabbi
-- =============================================================================

ALTER TABLE rabbis ADD COLUMN IF NOT EXISTS fcm_token TEXT;
