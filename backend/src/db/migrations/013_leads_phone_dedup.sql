-- Migration 013: Add phone_hash to leads for deduplication by phone OR email
-- Previously leads were only deduplicated by email_hash. This adds phone_hash
-- so we can find existing leads by phone number as well.

-- Add phone_hash column (nullable — not all leads have a phone)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS phone_hash TEXT;

-- Create index for fast lookups by phone_hash
CREATE INDEX IF NOT EXISTS idx_leads_phone_hash ON leads (phone_hash) WHERE phone_hash IS NOT NULL;

-- Drop the NOT NULL constraint on email_hash — leads may have only a phone
ALTER TABLE leads ALTER COLUMN email_hash DROP NOT NULL;

-- The UNIQUE constraint on email_hash stays, but we also need uniqueness on phone_hash
-- (only among non-null values, which a unique index on a nullable column handles automatically)
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_phone_hash_unique ON leads (phone_hash) WHERE phone_hash IS NOT NULL;
