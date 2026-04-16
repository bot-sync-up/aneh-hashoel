-- 005_donations_to_leads.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- קישור תרומות ללידים — כדי שכרטסת ליד תציג גם את היסטוריית התרומות
-- ושירות הלקוחות יוכל לראות איזה ליד כבר תרם, כמה, ומתי.
--
-- העיקרון: כל תרומה שהדונור שלה מזוהה לפי אימייל או טלפון — משויכת ל-lead
-- המתאים (אם קיים). תרומות אנונימיות נשארות בלי lead_id.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE donations
  ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;

-- Backfill של תרומות קיימות: התאמה לפי email/phone hash.
-- משתמשים ב-encode(digest(...)) כי email_hash/phone_hash ב-leads נשמרים
-- כ-SHA-256 הקסה (ראה leadsService.js). אם פונקציית digest לא קיימת
-- (תלוי בהתקנת pgcrypto), הבלוק פשוט ידלג שקט.
DO $$
BEGIN
  -- Enable pgcrypto if not already (safe to run repeatedly)
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  -- Match by email (case-insensitive)
  UPDATE donations d
     SET lead_id = l.id
    FROM leads l
   WHERE d.lead_id IS NULL
     AND d.donor_email IS NOT NULL
     AND d.donor_email <> ''
     AND l.email_hash  = encode(digest(lower(trim(d.donor_email)), 'sha256'), 'hex');

  -- Match remaining by phone (last 9 digits normalised, israeli-style)
  UPDATE donations d
     SET lead_id = l.id
    FROM leads l
   WHERE d.lead_id IS NULL
     AND d.donor_phone IS NOT NULL
     AND d.donor_phone <> ''
     AND l.phone_hash = encode(
           digest(
             right(regexp_replace(d.donor_phone, '\D', '', 'g'), 9),
             'sha256'
           ), 'hex');
EXCEPTION WHEN OTHERS THEN
  -- Missing pgcrypto or schema mismatch — skip quietly, the app-side
  -- upsertDonation will populate lead_id for new rows going forward.
  RAISE NOTICE 'donations.lead_id backfill skipped: %', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS idx_donations_lead_id
  ON donations (lead_id)
  WHERE lead_id IS NOT NULL;
