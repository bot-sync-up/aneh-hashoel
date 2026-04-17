-- 006_donations_transaction_time.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- מציגים ומסננים תרומות לפי תאריך העסקה האמיתי (כפי שנדרים רושמים),
-- לא לפי created_at (שהוא מתי שלנו סונכרנו).
--
-- ה-4167 תרומות שכבר במערכת יצריכו backfill מ-raw_payload->>'TransactionTime'.
-- פורמט הזמן מנדרים: '2025-09-15T09:23:51.000Z' או דומה.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE donations
  ADD COLUMN IF NOT EXISTS transaction_time TIMESTAMPTZ;

-- Backfill: קורא את raw_payload.TransactionTime וממיר ל-timestamp.
-- עושים את זה בתוך DO block כדי לטפל בשגיאות פורמט בשקט.
DO $$
DECLARE
  total_updated INT := 0;
BEGIN
  UPDATE donations
     SET transaction_time = (raw_payload->>'TransactionTime')::timestamptz
   WHERE transaction_time IS NULL
     AND raw_payload IS NOT NULL
     AND raw_payload ? 'TransactionTime'
     AND raw_payload->>'TransactionTime' ~ '^\d{4}-\d{2}-\d{2}';

  GET DIAGNOSTICS total_updated = ROW_COUNT;
  RAISE NOTICE 'Backfilled transaction_time for % donations', total_updated;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Backfill skipped / partial: %', SQLERRM;
END $$;

-- Fallback: לשורות שעדיין אין להן transaction_time — נשתמש ב-created_at
-- כדי שהכל יהיה עם ערך (לפילטרים עתידיים). זה לא אידיאלי אבל יציב.
UPDATE donations
   SET transaction_time = created_at
 WHERE transaction_time IS NULL;

-- Indexes לביצועים על שאילתות של "החודש/השבוע/היום"
CREATE INDEX IF NOT EXISTS idx_donations_transaction_time
  ON donations (transaction_time DESC)
  WHERE transaction_time IS NOT NULL;
