-- Migration 004: CRM Leads System
-- Adds customer_service role + dedicated leads table

-- 1. Add customer_service to rabbis role enum
ALTER TABLE rabbis
  DROP CONSTRAINT IF EXISTS rabbis_role_check;

ALTER TABLE rabbis
  ADD CONSTRAINT rabbis_role_check
    CHECK (role IN ('rabbi', 'admin', 'customer_service'));

-- 2. Main leads table — one row per unique asker (deduped by email_hash)
CREATE TABLE IF NOT EXISTS leads (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash            TEXT        UNIQUE NOT NULL,
  asker_name            TEXT,
  asker_email_encrypted TEXT,
  asker_phone_encrypted TEXT,
  question_count        INTEGER     NOT NULL DEFAULT 1,
  interaction_score     INTEGER     NOT NULL DEFAULT 0,
  is_hot                BOOLEAN     NOT NULL DEFAULT false,
  contacted             BOOLEAN     NOT NULL DEFAULT false,
  contact_notes         TEXT        NOT NULL DEFAULT '',
  last_category_id      UUID        REFERENCES categories (id) ON DELETE SET NULL,
  first_question_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_question_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_is_hot      ON leads (is_hot);
CREATE INDEX IF NOT EXISTS idx_leads_contacted   ON leads (contacted);
CREATE INDEX IF NOT EXISTS idx_leads_last_q_at   ON leads (last_question_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_score       ON leads (interaction_score DESC);
